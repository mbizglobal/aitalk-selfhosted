
import { PrismaClient } from '@prisma/client'
import { offFeatureFor } from '@/lib/edition-features'
import { AIToolClient, ToolDefinition } from './types'
import { SendGridToolClient } from './sendgrid-tool'
import { TelegramToolClient } from './telegram-tool'
import { SmsToolClient } from './sms-tool'
import { SmtpToolClient } from './smtp-tool'
import { GoogleCalendarToolClient } from './google-calendar-tool'
import { MicrosoftCalendarToolClient } from './microsoft-calendar-tool'
import { CallTransferToolClient } from './call-transfer-tool'
import { SubWorkflowToolClient } from './subworkflow-tool'
import { MultiCalendarDispatcher, CalendarRosterEntry, CalendarNodeInput } from './multi-calendar-dispatcher'
import { isAiNodeRaw } from '../find-ai-node'
import { bookingMessagePromptOf } from '@/lib/calendar/booking-message'
import { describeCaughtError, safeLogNumber, safeLogToken } from '@/lib/log-mask'
import { isAppWorkflow, pickNonAppWorkflow } from '@/lib/workflow/start-trigger'

interface LoadAgentAppsToolsResult {
  clients: Map<string, AIToolClient>
  definitions: Array<{
    type: 'function'
    name: string
    description: string
    parameters: object
  }>
  bookingQuestions?: string
  bookingMessagePrompt?: string
  multiCalendar?: {
    dispatcher: MultiCalendarDispatcher
    roster: CalendarRosterEntry[]
    routingMode: 'ask'
    rosterPreamble: string
  }
  hasCapacityCalendar: boolean
  staffTransferNumber: string
  failedTools: Array<{ toolType: string; reason: string }>
  handoff?: { staffNumber: string; staffLang: string; callerLang?: string; introMessage?: string; sourcePhoneNumber?: string; originalAudio?: 'off' | 'presence'; mixTuning?: { duckGain?: number; idleGain?: number; releaseMs?: number; attackMs?: number } }
}

const BRIDGE_TO_HUMAN_DEF = {
  type: 'function' as const,
  name: 'bridge_to_human_with_translation',
  description:
    'Connect the caller to a human staff member with live two-way voice translation. ' +
    'You (the AI) stay on the line as the interpreter — the caller and the staff speak different languages and you bridge them in real time. ' +
    'Call this function only when the caller explicitly asks to be connected to a human staff member, or after you offer a human connection and the caller accepts. ' +
    'A direct request such as "connect me to staff" or "직원 연결해 주세요" counts as consent. ' +
    'Do not call this function for questions that merely mention staff, staff availability, or staff policies unless the caller is asking to be connected now. ' +
    'When the caller has asked or accepted and you are going to connect them, call this function in the same turn; do not only say that you will connect them. ' +
    'After you call this, stop speaking — the translation relay takes over the call.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Short label describing why you are connecting the caller to staff.' },
    },
    required: [],
  },
}

export type AppsToolChannel = 'pstn' | 'web_voice' | 'chat_widget' | 'test' | 'booking_widget'

const CHANNEL_DATA_KEY: Record<AppsToolChannel, 'pstn' | 'webVoice' | 'chatWidget' | 'test' | 'bookingWidget'> = {
  pstn: 'pstn',
  web_voice: 'webVoice',
  chat_widget: 'chatWidget',
  test: 'test',
  booking_widget: 'bookingWidget',
}

export function isChannelEnabledForCalendarNode(nodeData: any, channel?: AppsToolChannel): boolean {
  if (!channel) return true
  const enabled = nodeData?.enabledChannels
  if (channel === 'booking_widget') return !!enabled && typeof enabled === 'object' && enabled.bookingWidget === true
  if (!enabled || typeof enabled !== 'object') return true
  const key = CHANNEL_DATA_KEY[channel]
  return enabled[key] !== false
}

export async function loadAgentAppsTools(
  prisma: PrismaClient,
  agentId: string,
  userId?: string,
  workflowId?: string,
  channel?: AppsToolChannel,
  aiNodeId?: string | null,
  startNodeId?: string | null
): Promise<LoadAgentAppsToolsResult> {
  const empty: LoadAgentAppsToolsResult = { clients: new Map(), definitions: [], hasCapacityCalendar: false, staffTransferNumber: '', failedTools: [] }
  const isDev = process.env.NODE_ENV !== 'production'

  const workflow = workflowId
    ? await prisma.workflow.findFirst({
        where: { workflowId, agentId },
        select: { workflowJson: true, workflowId: true },
      })
    : pickNonAppWorkflow(await prisma.workflow.findMany({
        where: { agentId, status: 'production' },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { workflowJson: true, workflowId: true },
      }))

  if (workflow?.workflowJson && isAppWorkflow(workflow.workflowJson)) return empty
  if (!workflow?.workflowJson) {
    if (isDev) console.log('[AppsTools] No workflow JSON for agent:', agentId, 'workflowId:', workflowId ? safeLogToken(workflowId) : '(auto)')
    return empty
  }

  let wfJson: { nodes: any[]; edges: any[] }
  try {
    wfJson = JSON.parse(workflow.workflowJson)
  } catch {
    return empty
  }

  const { nodes, edges } = wfJson
  if (!nodes || !edges) return empty

  const aiNode =
    aiNodeId === undefined
      ? nodes.find((n: any) => n.type === 'ai' || n.data?.nodeType === 'ai')
      : aiNodeId
        ? nodes.find((n: any) => n?.id === aiNodeId && isAiNodeRaw(n))
        : null
  if (!aiNode) {
    if (isDev) console.log('[AppsTools] No AI node found in workflow', aiNodeId === undefined ? '' : `(requested: ${aiNodeId ?? 'none'})`)
    return empty
  }

  const isPstnStartNode = (n: any) => n?.data?.nodeType === 'start' && n?.data?.triggerType === 'pstn'
  const explicitStart = startNodeId
    ? nodes.find((n: any) => String(n?.id) === String(startNodeId) && isPstnStartNode(n))
    : undefined
  const pstnStartNode = explicitStart ?? nodes.find(isPstnStartNode)
  const staffTransferNumber: string = typeof pstnStartNode?.data?.staffTransferNumber === 'string'
    ? pstnStartNode.data.staffTransferNumber.trim()
    : ''
  const handoffMode: string = pstnStartNode?.data?.handoffMode === 'bridge_translate' ? 'bridge_translate' : 'transfer'
  const translateStaffLang: string = typeof pstnStartNode?.data?.translateStaffLang === 'string'
    ? pstnStartNode.data.translateStaffLang.trim()
    : ''
  const translateCallerLang: string = typeof pstnStartNode?.data?.translateCallerLang === 'string'
    ? pstnStartNode.data.translateCallerLang.trim()
    : ''
  const translateIntroMessage: string = typeof pstnStartNode?.data?.translateIntroMessage === 'string'
    ? pstnStartNode.data.translateIntroMessage.trim()
    : ''
  const translateOriginalAudio: 'off' | 'presence' =
    pstnStartNode?.data?.translateOriginalAudio === 'off' ? 'off' : 'presence'
  const numField = (v: any): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)
  const duckPct = numField(pstnStartNode?.data?.translateDuckGain)
  const idlePct = numField(pstnStartNode?.data?.translateIdleGain)
  const releaseMsField = numField(pstnStartNode?.data?.translateReleaseMs)
  const attackMsField = numField(pstnStartNode?.data?.translateAttackMs)
  const translateMixTuning =
    duckPct !== undefined || idlePct !== undefined || releaseMsField !== undefined || attackMsField !== undefined
      ? {
          duckGain: duckPct !== undefined ? duckPct / 100 : undefined,
          idleGain: idlePct !== undefined ? idlePct / 100 : undefined,
          releaseMs: releaseMsField,
          attackMs: attackMsField,
        }
      : undefined
  const pstnSourceNumber: string = typeof pstnStartNode?.data?.phoneNumber === 'string'
    ? pstnStartNode.data.phoneNumber.trim()
    : ''
  const transferToolName = handoffMode === 'bridge_translate' ? 'bridge_to_human_with_translation' : 'transfer_to_staff'

  let pstnCallbackNumber = ''
  try {
    const cpn = await prisma.callPhoneNumber.findFirst({
      where: { agentId, isActive: true },
      select: { phoneNumber: true },
      orderBy: { createdAt: 'asc' },
    })
    pstnCallbackNumber = cpn?.phoneNumber || ''
  } catch {
    /* best-effort */
  }

  const toolEdges = edges.filter((e: any) =>
    e.source === aiNode.id && e.sourceHandle === 'tools'
  )

  const appsToolTypes = ['sendgrid', 'telegram', 'sms', 'smtp', 'google_calendar', 'microsoft_calendar', 'subworkflow'] as const
  type AppsToolType = typeof appsToolTypes[number]

  const toolNodes: Array<{ nodeId: string; toolType: AppsToolType; connectionId: string; nodeData: any }> = []
  const failedTools: Array<{ toolType: string; reason: string }> = []
  const skipped: Array<{ toolType: string; reason: string }> = []

  for (const edge of toolEdges) {
    const toolNode = nodes.find((n: any) => n.id === edge.target)
    if (!toolNode || toolNode.type !== 'tool') continue

    const toolType = toolNode.data?.toolType as string
    const connectionId = (toolType === 'subworkflow' ? toolNode.data?.subWorkflowId : toolNode.data?.connectionId) as string

    if (!appsToolTypes.includes(toolType as AppsToolType)) continue
    if (offFeatureFor('toolTypes', toolType)) {
      skipped.push({ toolType, reason: 'not included in this installation' })
      failedTools.push({ toolType, reason: 'not included in this installation' })
      continue
    }
    if (channel === 'booking_widget' && toolType !== 'google_calendar' && toolType !== 'microsoft_calendar') continue

    if (!connectionId) {
      const reason = toolType === 'subworkflow' ? 'no subWorkflowId' : 'no connectionId'
      skipped.push({ toolType, reason })
      failedTools.push({ toolType, reason })
      continue
    }

    if ((toolType === 'google_calendar' || toolType === 'microsoft_calendar')
        && !isChannelEnabledForCalendarNode(toolNode.data, channel)) {
      skipped.push({ toolType, reason: `channel "${channel}" disabled by enabledChannels` })
      continue
    }

    toolNodes.push({
      nodeId: toolNode.id,
      toolType: toolType as AppsToolType,
      connectionId,
      nodeData: toolNode.data || {},
    })
  }

  if (isDev && (toolNodes.length > 0 || skipped.length > 0)) {
    console.log(
      '[AppsTools] Detected tool nodes:',
      toolNodes.map((t) => t.toolType),
      skipped.length > 0 ? `| skipped: ${JSON.stringify(skipped)}` : ''
    )
  }

  const clients = new Map<string, AIToolClient>()
  const definitions: LoadAgentAppsToolsResult['definitions'] = []
  let handoff: LoadAgentAppsToolsResult['handoff']
  let bookingQuestions: string | undefined
  let bookingMessagePrompt: string | undefined

  if ((channel === 'pstn' || channel === 'web_voice') && staffTransferNumber) {
    if (handoffMode === 'bridge_translate') {
      definitions.push(BRIDGE_TO_HUMAN_DEF)
      handoff = {
        staffNumber: staffTransferNumber,
        staffLang: translateStaffLang || 'en',
        callerLang: translateCallerLang || undefined,
        introMessage: translateIntroMessage || undefined,
        sourcePhoneNumber: pstnSourceNumber || undefined,
        originalAudio: translateOriginalAudio,
        mixTuning: translateMixTuning,
      }
      if (isDev)
        console.log(
          `[AppsTools] Registered bridge_to_human_with_translation (${channel} bridge_translate, staff:`,
          safeLogNumber(staffTransferNumber), 'lang:', safeLogToken(handoff.staffLang), ')'
        )
    } else if (channel === 'pstn') {
      try {
        const transferClient = new CallTransferToolClient()
        await transferClient.initialize(prisma, '', { agentId, staffTransferNumber }, userId)
        for (const tool of transferClient.listTools()) {
          clients.set(tool.name, transferClient)
          definitions.push({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })
        }
        if (isDev) console.log('[AppsTools] Registered transfer_to_staff (PSTN, number:', safeLogNumber(staffTransferNumber), ')')
      } catch (error: any) {
        console.error('[AppsTools] Failed to initialize CallTransferToolClient:', describeCaughtError(error))
        failedTools.push({ toolType: 'call_transfer', reason: describeCaughtError(error) })
      }
    }
  }

  // ========================================
  // ========================================

  const calendarToolNodes = toolNodes.filter(
    (t) => t.toolType === 'google_calendar' || t.toolType === 'microsoft_calendar'
  )
  const otherToolNodes = toolNodes.filter(
    (t) => t.toolType !== 'google_calendar' && t.toolType !== 'microsoft_calendar'
  )

  let hasCapacityCalendar = calendarToolNodes
    .slice(0, 15)
    .some((t) => t.nodeData?.capacityMode === 'simple' || t.nodeData?.capacityMode === 'tables')

  let multiCalendar: LoadAgentAppsToolsResult['multiCalendar']

  if (calendarToolNodes.length >= 2) {
    hasCapacityCalendar = false
    if (calendarToolNodes.length > 15) {
      console.error('[AppsTools] Too many calendar nodes (max 15):', calendarToolNodes.length)
    }
    try {
      const dispatcher = new MultiCalendarDispatcher()
      const dispatcherInputs: CalendarNodeInput[] = calendarToolNodes
        .slice(0, 15)
        .map((t) => ({
          nodeId: t.nodeId,
          toolType: t.toolType as 'google_calendar' | 'microsoft_calendar',
          connectionId: t.connectionId,
          label: t.nodeData?.label || t.nodeData?.name || 'Calendar',
          nodeData: t.nodeData,
        }))
      await dispatcher.initializeMulti(prisma, { agentId, userId }, dispatcherInputs, staffTransferNumber, pstnCallbackNumber, channel, transferToolName)
      for (const tool of dispatcher.listTools()) {
        clients.set(tool.name, dispatcher)
        definitions.push({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })
      }
      const okNodeIds = dispatcher.initializedNodeIds()
      const liveCalendarNodes = calendarToolNodes.slice(0, 15).filter((t) => okNodeIds.has(t.nodeId))
      hasCapacityCalendar = dispatcher.hasAnyCapacityCalendar()
      for (const t of liveCalendarNodes) {
        if (typeof t.nodeData?.bookingQuestions === 'string' && t.nodeData.bookingQuestions.trim()) {
          bookingQuestions = t.nodeData.bookingQuestions.trim()
          break
        }
      }
      bookingMessagePrompt = liveCalendarNodes.map((t) => bookingMessagePromptOf(t.nodeData)).find(Boolean)
      dispatcher.setBookingMessagePrompt(bookingMessagePrompt)
      multiCalendar = {
        dispatcher,
        roster: dispatcher.rosterEntries(),
        routingMode: 'ask',
        rosterPreamble: dispatcher.buildRosterPreamble(),
      }
      if (isDev) {
        console.log('[AppsTools] Multi-Calendar mode active:', dispatcherInputs.length, 'calendars')
      }
    } catch (error: any) {
      console.error('[AppsTools] MultiCalendarDispatcher init failed:', describeCaughtError(error))
      failedTools.push({ toolType: 'calendar_multi', reason: describeCaughtError(error) })
    }
  }

  if (toolNodes.length === 0) {
    return { clients, definitions, bookingQuestions, bookingMessagePrompt, multiCalendar, hasCapacityCalendar, staffTransferNumber, handoff, failedTools }
  }

  const singleModeNodesAll = calendarToolNodes.length >= 2
    ? otherToolNodes
    : toolNodes
  const subWorkflowNodes = singleModeNodesAll.filter((t) => t.toolType === 'subworkflow')
  const singleModeNodes = singleModeNodesAll.filter((t) => t.toolType !== 'subworkflow')

  for (const { toolType, connectionId, nodeData } of singleModeNodes) {
    try {
      let client: AIToolClient
      let overrides: any = undefined

      switch (toolType) {
        case 'sendgrid':
          client = new SendGridToolClient()
          overrides = {
            agentId,
            fromEmail: nodeData.fromEmail,
            fromName: nodeData.fromName,
            toEmail: nodeData.toEmail,
          }
          break
        case 'telegram':
          client = new TelegramToolClient()
          overrides = { agentId, chatId: nodeData.chatId }
          break
        case 'sms':
          client = new SmsToolClient()
          overrides = { agentId, defaultTo: typeof nodeData.recipient === 'string' ? nodeData.recipient.trim() : '' }
          break
        case 'smtp':
          client = new SmtpToolClient()
          overrides = { agentId, toEmail: nodeData.toEmail }
          break
        case 'google_calendar':
          client = new GoogleCalendarToolClient()
          overrides = {
            agentId,
            userId,
            accountId: nodeData.accountId,
            calendarId: nodeData.calendarId,
            timezone: nodeData.timezone,
            workingHoursStart: nodeData.workingHoursStart,
            workingHoursEnd: nodeData.workingHoursEnd,
            defaultDurationMin: nodeData.defaultDurationMin,
            inviteAttendee: nodeData.inviteAttendee,
            notifyOnBook: nodeData.notifyOnBook,
            notifyOnReschedule: nodeData.notifyOnReschedule,
            notifyOnCancel: nodeData.notifyOnCancel,
            bookingWindowDays: nodeData.bookingWindowDays,
            historyLookupDays: nodeData.historyLookupDays,
            cancellationPolicy: nodeData.cancellationPolicy,
            reschedulePolicy: nodeData.reschedulePolicy,
            breakTimes: nodeData.breakTimes,
            weeklyClosedDays: nodeData.weeklyClosedDays,
            holidays: nodeData.holidays,
            closedRanges: nodeData.closedRanges,
            cleanupMin: nodeData.cleanupMin,
            capacityMode: nodeData.capacityMode,
            simpleCapacity: nodeData.simpleCapacity,
            tableInventory: nodeData.tableInventory,
            mealDurationMin: nodeData.mealDurationMin,
            reservationGridMin: nodeData.reservationGridMin,
            tableMatchPolicy: nodeData.tableMatchPolicy,
            lastCallMin: nodeData.lastCallMin,
            lastCallBreakMin: nodeData.lastCallBreakMin,
            bookingMessagePrompt: bookingMessagePromptOf(nodeData),
            staffTransferNumber,
            transferToolName,
            pstnCallbackNumber,
            channel,
          }
          if (!bookingQuestions && typeof nodeData.bookingQuestions === 'string' && nodeData.bookingQuestions.trim()) {
            bookingQuestions = nodeData.bookingQuestions.trim()
          }
          bookingMessagePrompt ??= bookingMessagePromptOf(nodeData)
          break
        case 'microsoft_calendar':
          client = new MicrosoftCalendarToolClient()
          overrides = {
            agentId,
            userId,
            accountId: nodeData.accountId,
            calendarId: nodeData.calendarId,
            userPrincipalName: nodeData.userPrincipalName,
            timezone: nodeData.timezone,
            workingHoursStart: nodeData.workingHoursStart,
            workingHoursEnd: nodeData.workingHoursEnd,
            defaultDurationMin: nodeData.defaultDurationMin,
            inviteAttendee: nodeData.inviteAttendee,
            notifyOnBook: nodeData.notifyOnBook,
            notifyOnReschedule: nodeData.notifyOnReschedule,
            notifyOnCancel: nodeData.notifyOnCancel,
            bookingWindowDays: nodeData.bookingWindowDays,
            historyLookupDays: nodeData.historyLookupDays,
            cancellationPolicy: nodeData.cancellationPolicy,
            reschedulePolicy: nodeData.reschedulePolicy,
            breakTimes: nodeData.breakTimes,
            weeklyClosedDays: nodeData.weeklyClosedDays,
            holidays: nodeData.holidays,
            closedRanges: nodeData.closedRanges,
            cleanupMin: nodeData.cleanupMin,
            capacityMode: nodeData.capacityMode,
            simpleCapacity: nodeData.simpleCapacity,
            tableInventory: nodeData.tableInventory,
            mealDurationMin: nodeData.mealDurationMin,
            reservationGridMin: nodeData.reservationGridMin,
            tableMatchPolicy: nodeData.tableMatchPolicy,
            lastCallMin: nodeData.lastCallMin,
            lastCallBreakMin: nodeData.lastCallBreakMin,
            bookingMessagePrompt: bookingMessagePromptOf(nodeData),
            staffTransferNumber,
            transferToolName,
            pstnCallbackNumber,
            channel,
          }
          if (!bookingQuestions && typeof nodeData.bookingQuestions === 'string' && nodeData.bookingQuestions.trim()) {
            bookingQuestions = nodeData.bookingQuestions.trim()
          }
          bookingMessagePrompt ??= bookingMessagePromptOf(nodeData)
          break
        case 'subworkflow':
          continue
      }

      await client.initialize(prisma, connectionId, overrides, userId)

      const tools = client.listTools()
      for (const tool of tools) {
        clients.set(tool.name, client)
        definitions.push({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        })
      }
    } catch (error: any) {
      console.error(`[Widget] Failed to load Apps Tool ${toolType}:`, describeCaughtError(error))
      failedTools.push({ toolType, reason: describeCaughtError(error) })
    }
  }

  if (subWorkflowNodes.length > 0) {
    const loaded: Array<{ client: SubWorkflowToolClient; subWorkflowId: string }> = []
    for (const { connectionId: subWorkflowId } of subWorkflowNodes) {
      try {
        const client = new SubWorkflowToolClient()
        await client.initialize(prisma, subWorkflowId, { agentId, channel, callerWorkflowId: workflow.workflowId }, userId)
        loaded.push({ client, subWorkflowId })
      } catch (error: any) {
        console.error(`[Widget] Failed to load Sub-workflow tool ${safeLogToken(subWorkflowId)}:`, describeCaughtError(error))
        failedTools.push({ toolType: 'subworkflow', reason: describeCaughtError(error) })
      }
    }
    const nameCount = new Map<string, number>()
    for (const { client } of loaded) if (client.functionName) nameCount.set(client.functionName, (nameCount.get(client.functionName) ?? 0) + 1)
    for (const { client } of loaded) {
      const fn = client.functionName
      if (!fn) continue
      if ((nameCount.get(fn) ?? 0) > 1) {
        console.error(`[Widget] Sub-workflow tool name collision "${fn}" — none of the colliding tools is loaded`)
        failedTools.push({ toolType: 'subworkflow', reason: `tool name collision: ${fn}` })
        continue
      }
      for (const tool of client.listTools()) {
        clients.set(tool.name, client)
        definitions.push({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })
      }
    }
  }

  return { clients, definitions, bookingQuestions, bookingMessagePrompt, multiCalendar, hasCapacityCalendar, staffTransferNumber, handoff, failedTools }
}
