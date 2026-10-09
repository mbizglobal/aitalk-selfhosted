
import { PrismaClient } from '@prisma/client'
import { findEditionOffParts, editionOffMessage } from './edition-guard'
import { restoreExecutionOwner, SAVE_AS_RESERVED_KEYS } from '@/lib/connection-scope'
import { preserveTemplateVars } from './template-scope'
import {
  WorkflowJson,
  WorkflowNode,
  WorkflowContext,
  WorkflowExecutionResult,
  WorkflowDebugLogEntry
} from './types'
import { NodeExecutionResult, WhileLoopExecutor } from './nodes'
import { resolveNodeType, executeNodeByType } from './engine/nodeRouter'
import { isChannelEnabledForCalendarNode } from './tools/load-agent-tools'
import { bookingMessagePromptOf } from '@/lib/calendar/booking-message'
import { redactDebugLogEntry } from './debug-redact'
import { describeCaughtError, safeLogToken } from '@/lib/log-mask'
import { createStepBudget, defaultStepLimit, stepBudgetExceededMessage } from './engine/step-budget'
import { extractContextVariables } from './engine/context-projection'
import { isMiniAppNode, miniAppsRunBy } from './mini-app-registry'
import { isAgentLocked, AGENT_LOCKED_MESSAGE } from '@/lib/agent-lock'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const PUBLIC_NODE_ERROR_MESSAGE = 'Sorry, I could not process your request.'

export class WorkflowEngine {
  private prisma = prisma

  async execute(
    workflowJson: WorkflowJson,
    context: WorkflowContext,
    options?: {
      breakpointNodeIds?: string[]
      resumeFromNodeId?: string
      startFromNodeId?: string
      initialContext?: any
      onNodeStart?: (nodeId: string, nodeName: string, nodeType: string, totalNodes: number) => void
      onNodeComplete?: (log: WorkflowDebugLogEntry) => void
      channel?: 'pstn' | 'web_voice' | 'chat_widget' | 'test'
      debugEnabled?: boolean
    }
  ): Promise<WorkflowExecutionResult> {
    const execChannel = options?.channel
    const emitDebug = options?.debugEnabled === true
    const streamLogs = (logs: WorkflowDebugLogEntry[]) => (emitDebug ? logs : [])
    const { nodes, edges } = workflowJson
    const breakpointNodeIds = options?.breakpointNodeIds || []

    const editionOff = findEditionOffParts({ nodes })
    if (editionOff.length > 0) {
      const nodeError = { nodeId: editionOff[0].nodeId, nodeLabel: editionOff[0].label, error: editionOffMessage(editionOff) }
      console.error(`[Workflow] Not included in this installation [${editionOff.map((p) => safeLogToken(p.nodeId)).join(',')}]: ${[...new Set(editionOff.map((p) => p.feature.name))].join(', ')}`)
      return {
        streamResponse: this.createErrorStreamResponse(
          emitDebug ? `[${nodeError.nodeLabel}] ${nodeError.error}` : PUBLIC_NODE_ERROR_MESSAGE,
          [],
        ),
        executionPath: [],
        totalDuration: 0,
        debugLogs: [],
        context,
        nodeError,
      }
    }

    if (await isAgentLocked(context.agentId)) {
      const startNodeId = nodes.find(n => resolveNodeType(n) === 'start')?.id || ''
      const nodeError = { nodeId: startNodeId, nodeLabel: 'Start', error: AGENT_LOCKED_MESSAGE }
      console.warn(`[Workflow] Agent locked (plan limit) [${safeLogToken(context.agentId)}]`)
      return {
        streamResponse: this.createErrorStreamResponse(AGENT_LOCKED_MESSAGE, []),
        executionPath: [],
        totalDuration: 0,
        debugLogs: [],
        context,
        nodeError,
      }
    }

    let currentNode = nodes.find(n => resolveNodeType(n) === 'start')
    if (!currentNode) {
      throw new Error('Workflow must start with a Start node')
    }

    const aiNode = nodes.find(n => resolveNodeType(n) === 'ai')
    const workflowAiModel = aiNode?.data?.model as string | undefined

    const owner = { agentId: context.agentId, userId: context.userId }
    const keepOwner = (ctx: WorkflowContext): WorkflowContext => restoreExecutionOwner(owner, ctx)
    const executeNodeScoped = async (
      node: WorkflowNode,
      nodeType: WorkflowNode['type'],
      ctx: WorkflowContext
    ): Promise<NodeExecutionResult> => {
      const result = await this.executeNode(node, nodeType, keepOwner(ctx))
      return result?.context ? { ...result, context: keepOwner(result.context) } : result
    }

    //
    //
    const safeInitialContext = options?.initialContext
      ? Object.fromEntries(
          Object.entries(options.initialContext as Record<string, unknown>)
            .filter(([k]) => !SAVE_AS_RESERVED_KEYS.has(k)),
        )
      : undefined

    let data: WorkflowContext = keepOwner(
      safeInitialContext
        ? preserveTemplateVars({ ...context, ...safeInitialContext, workflowAiModel }, context)
        : { ...context, workflowAiModel }
    )

    //
    //
    //
    //
    data = { ...data, __debugEnabled: emitDebug }

    if (options?.startFromNodeId) {
      const startNode = nodes.find(n => n.id === options.startFromNodeId)
      if (startNode) {
        currentNode = startNode
        console.log(`[Workflow] Starting from node: ${options.startFromNodeId} (${startNode.data?.label || resolveNodeType(startNode)})`)
      } else {
        console.warn(`[Workflow] Start node not found: ${options.startFromNodeId}, falling back to Start node`)
      }
    }
    const executedPath: string[] = []
    const startTime = Date.now()
    const debugLogs: WorkflowDebugLogEntry[] = []
    let isWaiting = false
    let waitingNodeId: string | undefined
    let isPausedAtBreakpoint = false
    let pausedNodeId: string | undefined

    const totalNodes = nodes.filter(n => {
      const nodeType = resolveNodeType(n)
      if (n.type === 'tool') return false
      return nodeType !== null
    }).length

    if (context.isResuming && context.whileLoopContext) {
      const whileNode = nodes.find(n => n.id === context.whileLoopContext!.whileNodeId)
      if (whileNode) {
        currentNode = whileNode
        console.log(`[Workflow] Resuming from While node: ${context.whileLoopContext.whileNodeId}`)
      }
    } else if (context.isResuming && context.waitingNodeId) {
      const resumeNode = nodes.find(n => n.id === context.waitingNodeId)
      if (resumeNode) {
        currentNode = resumeNode
        console.log(`[Workflow] Resuming from Wait node: ${context.waitingNodeId}`)
      }
    }

    if (options?.resumeFromNodeId) {
      const resumeNode = nodes.find(n => n.id === options.resumeFromNodeId)
      if (resumeNode) {
        currentNode = resumeNode
        console.log(`[Workflow] Resuming from breakpoint node: ${options.resumeFromNodeId}`)
      }
    }

    //
    //
    const stepBudget = createStepBudget(defaultStepLimit(nodes.length))

    while (currentNode) {
      if (!stepBudget.consume()) {
        console.error(`[Workflow] Step budget exhausted (${stepBudget.limit}) — aborting. Graph likely contains a cycle.`)
        data.nodeError = {
          nodeId: currentNode.id,
          nodeLabel: currentNode.data?.label || resolveNodeType(currentNode) || currentNode.id,
          error: stepBudgetExceededMessage(stepBudget.limit),
        }
        break
      }

      const currentNodeType = resolveNodeType(currentNode)
      if (!currentNodeType) {
        console.warn(`[Workflow] Unsupported node type: ${currentNode.data?.nodeType || currentNode.type}`)
        const nextEdge = edges.find(e => e.source === currentNode!.id && !e.sourceHandle)
        currentNode = nextEdge ? nodes.find(n => n.id === nextEdge.target) : undefined
        continue
      }

      const isResumeNode = options?.resumeFromNodeId === currentNode.id
      if (!isResumeNode && currentNodeType !== 'start' && breakpointNodeIds.includes(currentNode.id)) {
        console.log(`[Workflow] Hit breakpoint at node: ${safeLogToken(currentNode.id)} (${safeLogToken(currentNodeType)})`)
        isPausedAtBreakpoint = true
        pausedNodeId = currentNode.id
        break
      }

      if (currentNodeType === 'ai') {
        const toolEdges = edges.filter(e => e.source === currentNode!.id && e.sourceHandle === 'tools')

        const selectedTools = {
          source: false,
          mcp: false,
          webSearch: false,
          functionCalling: false,
          imageInput: currentNode!.data?.imageInput || false,
          pdfInput: currentNode!.data?.pdfInput || false,
          sendgrid: false,
          telegram: false,
          sms: false,
          smtp: false,
          googleCalendar: false,
          microsoftCalendar: false,
          calendarMulti: false,
          subworkflow: false,
          workApp: false,
        }
        const subWorkflowIds: string[] = []
        const allowSubWorkflowTools = !((data.subWorkflowDepth ?? 0) >= 1)

        // ========================================
        // ========================================
        const calendarToolNodesCollected: any[] = []
        for (const e of toolEdges) {
          const tn = nodes.find(n => n.id === e.target)
          if (!tn || tn.type !== 'tool') continue
          const tt = tn.data?.toolType
          if ((tt === 'google_calendar' || tt === 'microsoft_calendar')
              && isChannelEnabledForCalendarNode(tn.data, execChannel)) {
            calendarToolNodesCollected.push(tn)
          }
        }
        const calendarMultiMode = calendarToolNodesCollected.length >= 2

        if (calendarMultiMode) {
          selectedTools.calendarMulti = true
          if (!currentNode!.data) currentNode!.data = {}
          currentNode!.data.calendarMultiNodes = calendarToolNodesCollected
            .slice(0, 15)
            .map((n: any) => ({
              nodeId: n.id,
              toolType: n.data.toolType,
              connectionId: n.data.connectionId,
              label: n.data.label || n.data.name || 'Calendar',
              nodeData: n.data,
            }))
          currentNode!.data.calendarRoutingMode = currentNode!.data.calendarRoutingMode || 'ask'
        }

        for (const toolEdge of toolEdges) {
          const toolNode = nodes.find(n => n.id === toolEdge.target)
          const toolNodeType = resolveNodeType(toolNode)

          if (toolNodeType === 'source') {
            selectedTools.source = true
            try {
              if (options?.onNodeStart) {
                const nodeName = toolNode!.data?.label || 'Source'
                options.onNodeStart(toolNode!.id, nodeName, toolNodeType, totalNodes)
              }

              const toolNodeStartTime = Date.now()
              const result = await executeNodeScoped(toolNode!, toolNodeType, data)
              const toolDuration = Date.now() - toolNodeStartTime

              if (options?.onNodeComplete) {
                const sourceLogEntry: WorkflowDebugLogEntry = redactDebugLogEntry({
                  nodeId: toolNode!.id,
                  nodeName: toolNode!.data?.label || 'Source',
                  nodeType: toolNodeType,
                  duration: toolDuration,
                  status: result.debug?.status || 'success',
                  input: result.debug?.input ?? { context: this.extractContextVariables(data) },
                  output: result.debug?.output ?? {},
                  error: result.debug?.error
                })
                options.onNodeComplete(sourceLogEntry)
              }

              data = keepOwner(result.context)
              executedPath.push(toolNode!.id)
            } catch (error) {
              console.error(`[Workflow] Source node failed:`, describeCaughtError(error))
            }
          }

          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'webSearch') {
            selectedTools.webSearch = true

            if (!currentNode!.data) currentNode!.data = {}
            currentNode!.data.webSearchDomains = toolNode.data.webSearchDomains || currentNode!.data.webSearchDomains
            currentNode!.data.webSearchCountry = toolNode.data.webSearchCountry || currentNode!.data.webSearchCountry
            currentNode!.data.webSearchRegion = toolNode.data.webSearchRegion || currentNode!.data.webSearchRegion
            currentNode!.data.webSearchCity = toolNode.data.webSearchCity || currentNode!.data.webSearchCity
            currentNode!.data.webSearchTimezone = toolNode.data.webSearchTimezone || currentNode!.data.webSearchTimezone
            currentNode!.data.webSearchContextSize = toolNode.data.webSearchContextSize || currentNode!.data.webSearchContextSize
          }

          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'mcp') {
            selectedTools.mcp = true
            if (toolNode.data.mcpConnectionId) {
              if (!currentNode!.data) currentNode!.data = {}
              currentNode!.data.mcpConnectionId = toolNode.data.mcpConnectionId
            }
          }

          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'functionCalling') {
            selectedTools.functionCalling = true
          }

          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'subworkflow') {
            const id = typeof toolNode.data.subWorkflowId === 'string' ? toolNode.data.subWorkflowId.trim() : ''
            if (!allowSubWorkflowTools) {
              console.warn(`[Workflow] Sub-workflow tool skipped inside a sub-workflow run (depth guard) — node ${toolNode.id}`)
            } else if (id && !subWorkflowIds.includes(id)) {
              subWorkflowIds.push(id)
              selectedTools.subworkflow = true
            }
          }

          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'workApp') {
            selectedTools.workApp = true
          }

          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'sendgrid') {
            selectedTools.sendgrid = true
            if (toolNode.data.connectionId) {
              if (!currentNode!.data) currentNode!.data = {}
              currentNode!.data.sendgridConnectionId = toolNode.data.connectionId
              if (toolNode.data.fromEmail) currentNode!.data.sendgridFromEmail = toolNode.data.fromEmail
              if (toolNode.data.fromName) currentNode!.data.sendgridFromName = toolNode.data.fromName
              if (toolNode.data.toEmail) currentNode!.data.sendgridToEmail = toolNode.data.toEmail
            }
          }
          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'telegram') {
            selectedTools.telegram = true
            if (toolNode.data.connectionId) {
              if (!currentNode!.data) currentNode!.data = {}
              currentNode!.data.telegramConnectionId = toolNode.data.connectionId
              if (toolNode.data.chatId) currentNode!.data.telegramChatId = toolNode.data.chatId
            }
          }
          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'smtp') {
            selectedTools.smtp = true
            if (toolNode.data.connectionId) {
              if (!currentNode!.data) currentNode!.data = {}
              currentNode!.data.smtpConnectionId = toolNode.data.connectionId
              if (toolNode.data.toEmail) currentNode!.data.smtpToEmail = toolNode.data.toEmail
            }
          }
          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'sms') {
            selectedTools.sms = true
            if (toolNode.data.connectionId) {
              if (!currentNode!.data) currentNode!.data = {}
              currentNode!.data.smsConnectionId = toolNode.data.connectionId
              const smsPin = typeof toolNode.data.recipient === 'string' ? toolNode.data.recipient.trim() : ''
              if (smsPin) currentNode!.data.smsTo = smsPin
            }
          }

          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'google_calendar'
              && isChannelEnabledForCalendarNode(toolNode.data, execChannel)
              && !calendarMultiMode) {
            selectedTools.googleCalendar = true
            if (toolNode.data.connectionId) {
              if (!currentNode!.data) currentNode!.data = {}
              currentNode!.data.googleCalendarConnectionId = toolNode.data.connectionId
              if (toolNode.data.accountId) currentNode!.data.googleCalendarAccountId = toolNode.data.accountId
              if (toolNode.data.calendarId) currentNode!.data.googleCalendarId = toolNode.data.calendarId
              if (toolNode.data.timezone) currentNode!.data.googleCalendarTimezone = toolNode.data.timezone
              if (toolNode.data.workingHoursStart) currentNode!.data.googleCalendarWorkingStart = toolNode.data.workingHoursStart
              if (toolNode.data.workingHoursEnd) currentNode!.data.googleCalendarWorkingEnd = toolNode.data.workingHoursEnd
              if (typeof toolNode.data.defaultDurationMin === 'number') currentNode!.data.googleCalendarDefaultDuration = toolNode.data.defaultDurationMin
              if (typeof toolNode.data.inviteAttendee === 'boolean') currentNode!.data.googleCalendarInviteAttendee = toolNode.data.inviteAttendee
              if (typeof toolNode.data.notifyOnBook === 'boolean') currentNode!.data.googleCalendarNotifyOnBook = toolNode.data.notifyOnBook
              if (typeof toolNode.data.notifyOnReschedule === 'boolean') currentNode!.data.googleCalendarNotifyOnReschedule = toolNode.data.notifyOnReschedule
              if (typeof toolNode.data.notifyOnCancel === 'boolean') currentNode!.data.googleCalendarNotifyOnCancel = toolNode.data.notifyOnCancel
              if (typeof toolNode.data.bookingWindowDays === 'number') currentNode!.data.googleCalendarBookingWindowDays = toolNode.data.bookingWindowDays
              if (typeof toolNode.data.historyLookupDays === 'number') currentNode!.data.googleCalendarHistoryLookupDays = toolNode.data.historyLookupDays
              if (toolNode.data.cancellationPolicy) currentNode!.data.googleCalendarCancellationPolicy = toolNode.data.cancellationPolicy
              if (toolNode.data.reschedulePolicy) currentNode!.data.googleCalendarReschedulePolicy = toolNode.data.reschedulePolicy
              if (Array.isArray(toolNode.data.breakTimes)) currentNode!.data.googleCalendarBreakTimes = toolNode.data.breakTimes
              if (toolNode.data.weeklyClosedDays) currentNode!.data.googleCalendarWeeklyClosedDays = toolNode.data.weeklyClosedDays
              if (Array.isArray(toolNode.data.holidays)) currentNode!.data.googleCalendarHolidays = toolNode.data.holidays
              if (Array.isArray(toolNode.data.closedRanges)) currentNode!.data.googleCalendarClosedRanges = toolNode.data.closedRanges
              if (typeof toolNode.data.cleanupMin === 'number') currentNode!.data.googleCalendarCleanupMin = toolNode.data.cleanupMin
              if (toolNode.data.capacityMode) currentNode!.data.googleCalendarCapacityMode = toolNode.data.capacityMode
              if (typeof toolNode.data.simpleCapacity === 'number') currentNode!.data.googleCalendarSimpleCapacity = toolNode.data.simpleCapacity
              if (Array.isArray(toolNode.data.tableInventory)) currentNode!.data.googleCalendarTableInventory = toolNode.data.tableInventory
              if (typeof toolNode.data.mealDurationMin === 'number') currentNode!.data.googleCalendarMealDurationMin = toolNode.data.mealDurationMin
              if (typeof toolNode.data.reservationGridMin === 'number') currentNode!.data.googleCalendarReservationGridMin = toolNode.data.reservationGridMin
              if (toolNode.data.tableMatchPolicy) currentNode!.data.googleCalendarTableMatchPolicy = toolNode.data.tableMatchPolicy
              if (typeof toolNode.data.lastCallMin === 'number') currentNode!.data.googleCalendarLastCallMin = toolNode.data.lastCallMin
              if (typeof toolNode.data.lastCallBreakMin === 'number') currentNode!.data.googleCalendarLastCallBreakMin = toolNode.data.lastCallBreakMin
              currentNode!.data.googleCalendarBookingMessagePrompt = bookingMessagePromptOf(toolNode.data)
            }
          }

          if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'microsoft_calendar'
              && isChannelEnabledForCalendarNode(toolNode.data, execChannel)
              && !calendarMultiMode) {
            selectedTools.microsoftCalendar = true
            if (toolNode.data.connectionId) {
              if (!currentNode!.data) currentNode!.data = {}
              currentNode!.data.microsoftCalendarConnectionId = toolNode.data.connectionId
              if (toolNode.data.accountId) currentNode!.data.microsoftCalendarAccountId = toolNode.data.accountId
              if (toolNode.data.calendarId) currentNode!.data.microsoftCalendarId = toolNode.data.calendarId
              if (toolNode.data.userPrincipalName) currentNode!.data.microsoftCalendarUpn = toolNode.data.userPrincipalName
              if (toolNode.data.timezone) currentNode!.data.microsoftCalendarTimezone = toolNode.data.timezone
              if (toolNode.data.workingHoursStart) currentNode!.data.microsoftCalendarWorkingStart = toolNode.data.workingHoursStart
              if (toolNode.data.workingHoursEnd) currentNode!.data.microsoftCalendarWorkingEnd = toolNode.data.workingHoursEnd
              if (typeof toolNode.data.defaultDurationMin === 'number') currentNode!.data.microsoftCalendarDefaultDuration = toolNode.data.defaultDurationMin
              if (typeof toolNode.data.inviteAttendee === 'boolean') currentNode!.data.microsoftCalendarInviteAttendee = toolNode.data.inviteAttendee
              if (typeof toolNode.data.notifyOnBook === 'boolean') currentNode!.data.microsoftCalendarNotifyOnBook = toolNode.data.notifyOnBook
              if (typeof toolNode.data.notifyOnReschedule === 'boolean') currentNode!.data.microsoftCalendarNotifyOnReschedule = toolNode.data.notifyOnReschedule
              if (typeof toolNode.data.notifyOnCancel === 'boolean') currentNode!.data.microsoftCalendarNotifyOnCancel = toolNode.data.notifyOnCancel
              if (typeof toolNode.data.bookingWindowDays === 'number') currentNode!.data.microsoftCalendarBookingWindowDays = toolNode.data.bookingWindowDays
              if (typeof toolNode.data.historyLookupDays === 'number') currentNode!.data.microsoftCalendarHistoryLookupDays = toolNode.data.historyLookupDays
              if (toolNode.data.cancellationPolicy) currentNode!.data.microsoftCalendarCancellationPolicy = toolNode.data.cancellationPolicy
              if (toolNode.data.reschedulePolicy) currentNode!.data.microsoftCalendarReschedulePolicy = toolNode.data.reschedulePolicy
              if (Array.isArray(toolNode.data.breakTimes)) currentNode!.data.microsoftCalendarBreakTimes = toolNode.data.breakTimes
              if (toolNode.data.weeklyClosedDays) currentNode!.data.microsoftCalendarWeeklyClosedDays = toolNode.data.weeklyClosedDays
              if (Array.isArray(toolNode.data.holidays)) currentNode!.data.microsoftCalendarHolidays = toolNode.data.holidays
              if (Array.isArray(toolNode.data.closedRanges)) currentNode!.data.microsoftCalendarClosedRanges = toolNode.data.closedRanges
              if (typeof toolNode.data.cleanupMin === 'number') currentNode!.data.microsoftCalendarCleanupMin = toolNode.data.cleanupMin
              if (toolNode.data.capacityMode) currentNode!.data.microsoftCalendarCapacityMode = toolNode.data.capacityMode
              if (typeof toolNode.data.simpleCapacity === 'number') currentNode!.data.microsoftCalendarSimpleCapacity = toolNode.data.simpleCapacity
              if (Array.isArray(toolNode.data.tableInventory)) currentNode!.data.microsoftCalendarTableInventory = toolNode.data.tableInventory
              if (typeof toolNode.data.mealDurationMin === 'number') currentNode!.data.microsoftCalendarMealDurationMin = toolNode.data.mealDurationMin
              if (typeof toolNode.data.reservationGridMin === 'number') currentNode!.data.microsoftCalendarReservationGridMin = toolNode.data.reservationGridMin
              if (toolNode.data.tableMatchPolicy) currentNode!.data.microsoftCalendarTableMatchPolicy = toolNode.data.tableMatchPolicy
              if (typeof toolNode.data.lastCallMin === 'number') currentNode!.data.microsoftCalendarLastCallMin = toolNode.data.lastCallMin
              if (typeof toolNode.data.lastCallBreakMin === 'number') currentNode!.data.microsoftCalendarLastCallBreakMin = toolNode.data.lastCallBreakMin
              currentNode!.data.microsoftCalendarBookingMessagePrompt = bookingMessagePromptOf(toolNode.data)
            }
          }
        }

        currentNode!.data = {
          ...currentNode!.data,
          selectedTools,
          subWorkflowIds,
        }

        const miniAppEdges = edges.filter(e => e.source === currentNode!.id && e.sourceHandle === 'miniapps')
        if (miniAppEdges.length > 0) {
          if (data.isScheduledTrigger) {
            const engineApps = miniAppsRunBy('engine')
            const quizNode = miniAppEdges
              .map(e => nodes.find(n => n.id === e.target))
              .find(n => isMiniAppNode(n) && engineApps.includes(n!.data.miniAppType))
            if (quizNode) {
              const { icon: _icon, ...quizSettings } = quizNode.data || {}
              currentNode!.data.miniAppQuiz = quizSettings
            }
          } else {
            console.log('[Workflow] Mini App attached but not a scheduled run — skipping (plan §6.3)')
          }
        }
      }

      if (currentNodeType === 'while') {
        const whileLoopExecutor = new WhileLoopExecutor(
          this.prisma,
          nodes,
          edges,
          executeNodeScoped,
          resolveNodeType,
          {
            onNodeStart: options?.onNodeStart,
            onNodeComplete: options?.onNodeComplete
          }
        )

        const loopResult = await whileLoopExecutor.executeLoop(currentNode!, data)

        data = keepOwner(loopResult.context)
        isWaiting = loopResult.isWaiting
        waitingNodeId = loopResult.waitingNodeId

        if (loopResult.fatalError) {
          data.nodeError = loopResult.fatalError
          break
        }

        if (isWaiting) {
          console.log('[While] Breaking from main workflow loop due to Wait')
          break
        }

        if (loopResult.needsRetry) {
          console.log(`[Workflow] Archive failed, will retry after ${loopResult.retryAfterMs}ms`)
          data.needsRetry = true
          data.retryAfterMs = loopResult.retryAfterMs
          break
        }
      }

      executedPath.push(currentNode.id)

      if (options?.onNodeStart) {
        const nodeName = currentNode.data?.label || currentNodeType
        options.onNodeStart(currentNode.id, nodeName, currentNodeType, totalNodes)
      }

      const nodeStartTime = Date.now()

      try {
        const result = await executeNodeScoped(currentNode, currentNodeType, data)
        const duration = Date.now() - nodeStartTime

        const debugLogEntry: WorkflowDebugLogEntry = redactDebugLogEntry({
          nodeId: currentNode.id,
          nodeName: currentNode.data?.label || currentNodeType,
          nodeType: currentNodeType,
          duration,
          status: result.debug?.status || 'success',
          input: result.debug?.input ?? this.buildDefaultNodeInput(currentNodeType, data, currentNode),
          output: result.debug?.output ?? this.buildDefaultNodeOutput(currentNodeType, result.context),
          error: result.debug?.error,
          children: result.debug?.children
        })
        debugLogs.push(debugLogEntry)

        if (options?.onNodeComplete) {
          options.onNodeComplete(debugLogEntry)
        }

        data = keepOwner(result.context)

        if (result.debug?.status === 'error') {
          data.nodeError = {
            nodeId: currentNode.id,
            nodeLabel: currentNode.data?.label || currentNodeType,
            error: result.debug.error || 'Node execution failed',
          }
          break
        }

        if (result.streamResponse) {
          const totalDuration = Date.now() - startTime

          const contextVariables = this.extractContextVariables(data)
          const wrappedResponse = this.wrapStreamWithDebugLogs(
            result.streamResponse,
            streamLogs(debugLogs),
            contextVariables
          )

          return {
            streamResponse: wrappedResponse,
            executionPath: executedPath,
            totalDuration,
            debugLogs,
            isWaiting: false,
            waitingNodeId: undefined,
            context: data
          }
        }

        if (result.shouldWait) {
          isWaiting = true
          waitingNodeId = currentNode.id
          break
        }
      } catch (error: any) {
        const duration = Date.now() - nodeStartTime
        const debugFromError = error?.__workflowDebug
        const errorLogEntry: WorkflowDebugLogEntry = redactDebugLogEntry({
          nodeId: currentNode.id,
          nodeName: currentNode.data?.label || currentNodeType,
          nodeType: currentNodeType,
          duration,
          status: debugFromError?.status || 'error',
          input: debugFromError?.input ?? this.buildDefaultNodeInput(currentNodeType, data, currentNode),
          output: debugFromError?.output ?? {},
          error: debugFromError?.error || error?.message || 'Unknown error'
        })
        debugLogs.push(errorLogEntry)

        if (options?.onNodeComplete) {
          options.onNodeComplete(errorLogEntry)
        }

        throw error
      }

      let nextEdge
      if (currentNodeType === 'while') {
        nextEdge = edges.find(e => e.source === currentNode!.id && e.sourceHandle === 'exit')
      } else if (currentNodeType === 'condition' || currentNodeType === 'ifElse') {
        const matchedHandle = data.ifElseResult?.matchedHandle
        if (matchedHandle) {
          nextEdge = edges.find(e => e.source === currentNode!.id && e.sourceHandle === matchedHandle)
        } else {
          nextEdge = undefined
        }
      } else {
        nextEdge = edges.find(e =>
          e.source === currentNode!.id &&
          (!e.sourceHandle || (e.sourceHandle !== 'tools' && e.sourceHandle !== 'loop' && e.sourceHandle !== 'miniapps'))
        )
      }
      currentNode = nextEdge ? nodes.find(n => n.id === nextEdge.target) : undefined
    }

    const totalDuration = Date.now() - startTime

    if (isPausedAtBreakpoint) {
      return {
        streamResponse: this.createPausedResponse(data, streamLogs(debugLogs), pausedNodeId!),
        executionPath: executedPath,
        totalDuration,
        debugLogs,
        isPausedAtBreakpoint: true,
        pausedNodeId,
        context: data
      }
    }

    if (data?.nodeError) {
      const errorMsg = `[${data.nodeError.nodeLabel}] ${data.nodeError.error}`
      console.error(`[Workflow] Node error [${safeLogToken(data.nodeError.nodeId)}]: ${data.nodeError.error}`)
      return {
        streamResponse: this.createErrorStreamResponse(
          emitDebug ? errorMsg : PUBLIC_NODE_ERROR_MESSAGE,
          streamLogs(debugLogs),
        ),
        executionPath: executedPath,
        totalDuration,
        debugLogs,
        context: data,
        nodeError: data.nodeError
      }
    }

    return {
      streamResponse: this.createStreamResponse(data, streamLogs(debugLogs)),
      executionPath: executedPath,
      totalDuration,
      debugLogs,
      isWaiting,
      waitingNodeId,
      context: data,
      needsRetry: data?.needsRetry,
      retryAfterMs: data?.retryAfterMs
    }
  }

  private buildDefaultNodeInput(
    nodeType: WorkflowNode['type'],
    data: WorkflowContext | undefined,
    node: WorkflowNode
  ) {
    if (!data) {
      return { context: undefined, node: node.id }
    }
    switch (nodeType) {
      case 'start':
        return { message: data.message }
      case 'end':
        return { aiResponse: data.aiResponse, finalAnswer: data.finalAnswer }
      default:
        return { context: this.extractContextVariables(data), node: node.id }
    }
  }

  private buildDefaultNodeOutput(
    nodeType: WorkflowNode['type'],
    context: WorkflowContext
  ) {
    switch (nodeType) {
      case 'start':
        return { context: this.extractContextVariables(context) }
      case 'end':
        return { finalAnswer: context.finalAnswer || context.aiResponse }
      default:
        return { context: this.extractContextVariables(context) }
    }
  }

  private async executeNode(
    node: WorkflowNode,
    nodeType: WorkflowNode['type'],
    data: WorkflowContext
  ): Promise<NodeExecutionResult> {
    return await executeNodeByType(node, nodeType, data, this.prisma)
  }

  private createStreamResponse(
    data: WorkflowContext,
    debugLogs?: WorkflowDebugLogEntry[]
  ): Response {
    const content = data.finalAnswer || data.aiResponse || ''

    const contextVariables = this.extractContextVariables(data)

    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()

          try {
            const chunkSize = 50
            const chunks = []
            for (let i = 0; i < content.length; i += chunkSize) {
              chunks.push(content.slice(i, i + chunkSize))
            }

            for (const chunk of chunks) {
              const outputData = `data: ${JSON.stringify({ content: chunk })}\n\n`
              controller.enqueue(encoder.encode(outputData))
            }

            const completionData = {
              type: 'completed',
              responseId: data.responseId,
              model: data.model,
              inputTokens: data.inputTokens,
              outputTokens: data.outputTokens,
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionData)}\n\n`))

            if (debugLogs && debugLogs.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'debug-log', logs: debugLogs, context: contextVariables })}\n\n`)
              )
            }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch (error) {
            console.error('[Workflow] Stream error:', describeCaughtError(error))
            controller.error(error)
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        }
      }
    )
  }

  private createPausedResponse(
    data: WorkflowContext,
    debugLogs: WorkflowDebugLogEntry[],
    pausedNodeId: string
  ): Response {
    const contextVariables = this.extractContextVariables(data)

    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()

          try {
            const pausedData = {
              type: 'paused',
              nodeId: pausedNodeId,
              context: contextVariables,
              logs: debugLogs
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(pausedData)}\n\n`))

            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch (error) {
            console.error('[Workflow] Paused stream error:', describeCaughtError(error))
            controller.error(error)
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        }
      }
    )
  }

  private createErrorStreamResponse(
    errorMessage: string,
    debugLogs: WorkflowDebugLogEntry[]
  ): Response {
    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()

          try {
            const errorData = {
              type: 'error',
              error: errorMessage,
              logs: debugLogs
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`))

            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch (error) {
            console.error('[Workflow] Error stream error:', describeCaughtError(error))
            controller.error(error)
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        }
      }
    )
  }

  private wrapStreamWithDebugLogs(
    originalResponse: Response,
    debugLogs: WorkflowDebugLogEntry[],
    contextVariables: Record<string, any>
  ): Response {
    if (!originalResponse.body) {
      return originalResponse
    }

    const reader = originalResponse.body.getReader()
    const logs = debugLogs
    const contextVars = { ...contextVariables }

    const transformedStream = new ReadableStream({
      async pull(controller) {
        const encoder = new TextEncoder()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              if (logs && logs.length > 0) {
                const debugLogEvent = `data: ${JSON.stringify({ type: 'debug-log', logs, context: contextVars })}\n\n`
                controller.enqueue(encoder.encode(debugLogEvent))
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              return
            }

            const text = decoder.decode(value, { stream: true })

            if (text.includes('"type":"search-results"')) {
              const searchResultsMatch = text.match(/data: (\{"type":"search-results"[^}]+\}[^\n]*)\n/)
              if (searchResultsMatch) {
                try {
                  const searchResultsData = JSON.parse(searchResultsMatch[1])
                  if (searchResultsData.results && Array.isArray(searchResultsData.results)) {
                    contextVars.searchResults = [
                      ...(contextVars.searchResults || []),
                      ...searchResultsData.results
                    ]
                  }
                } catch (parseError) {
                  console.warn('[Workflow] Failed to parse search-results event:', describeCaughtError(parseError))
                }
              }
              const filteredText = text.replace(/data: \{"type":"search-results"[^\n]*\n\n/g, '')
              if (filteredText.trim()) {
                controller.enqueue(encoder.encode(filteredText))
              }
              continue
            }

            if (text.includes('[DONE]')) {
              const parts = text.split('data: [DONE]')
              if (parts[0]) {
                controller.enqueue(encoder.encode(parts[0]))
              }

              if (logs && logs.length > 0) {
                const debugLogEvent = `data: ${JSON.stringify({ type: 'debug-log', logs, context: contextVars })}\n\n`
                controller.enqueue(encoder.encode(debugLogEvent))
              }

              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              return
            }

            controller.enqueue(value)
          }
        } catch (error) {
          console.error('[Workflow] Stream wrap error:', describeCaughtError(error))
          controller.error(error)
        }
      }
    })

    return new Response(transformedStream, {
      headers: originalResponse.headers
    })
  }

  private extractContextVariables(data: WorkflowContext): Record<string, any> {
    return extractContextVariables(data)
  }

}
