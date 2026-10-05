
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { loadTempData } from '../temp-storage'
import { isSaveAsKeyAllowed } from '@/lib/connection-scope'
import { markTemplateVar } from '../template-scope'
import { WorkflowNode, WorkflowContext, WorkflowDebugLogEntry } from '../types'
import { evaluateCondition } from '../utils'
import { PrismaClient } from '@prisma/client'
import { redactDebugLogEntry } from '../debug-redact'
import { extractContextVariables } from '../engine/context-projection'
import { createStepBudget, defaultStepLimit, rewindLimit, stepBudgetExceededMessage, clampMaxIterations, clampRestoredIteration } from '../engine/step-budget'

const NESTED_LOOP_ERROR = 'Nested loops are not supported: a While/ForEach node cannot be used as a loop body node.'
const RESERVED_ITEM_VAR_ERROR = (v: string) =>
  `ForEach "Item variable" cannot be "${v}" — it is a reserved execution key (ownership / billing / prototype). ` +
  `Rename it (e.g. "current${v.charAt(0).toUpperCase()}${v.slice(1)}").`
type FatalError = { nodeId: string; nodeLabel: string; error: string; folderNotFound?: boolean }

export interface WhileLoopResult {
  isWaiting: boolean
  waitingNodeId?: string
  context: WorkflowContext
  iterations: any[]
  totalIterations: number
  terminatedBy: 'condition' | 'max-iterations' | 'wait' | 'forEach-complete' | 'archive-failed' | 'error'
  loopMode?: 'while' | 'forEach'
  needsRetry?: boolean
  retryAfterMs?: number
  fatalError?: FatalError
}

export type ExecuteNodeCallback = (
  node: WorkflowNode,
  nodeType: WorkflowNode['type'],
  context: WorkflowContext
) => Promise<NodeExecutionResult>

export interface WhileLoopCallbacks {
  onNodeStart?: (nodeId: string, nodeName: string, nodeType: string, totalNodes: number) => void
  onNodeComplete?: (log: WorkflowDebugLogEntry) => void
}

export class WhileLoopExecutor {
  private prisma: PrismaClient
  private nodes: WorkflowNode[]
  private edges: any[]
  private executeNode: ExecuteNodeCallback
  private resolveNodeType: (node?: WorkflowNode | null) => WorkflowNode['type'] | null
  private callbacks?: WhileLoopCallbacks

  constructor(
    prisma: PrismaClient,
    nodes: WorkflowNode[],
    edges: any[],
    executeNode: ExecuteNodeCallback,
    resolveNodeType: (node?: WorkflowNode | null) => WorkflowNode['type'] | null,
    callbacks?: WhileLoopCallbacks
  ) {
    this.prisma = prisma
    this.nodes = nodes
    this.edges = edges
    this.executeNode = executeNode
    this.resolveNodeType = resolveNodeType
    this.callbacks = callbacks
  }

  async executeLoop(
    whileNode: WorkflowNode,
    context: WorkflowContext
  ): Promise<WhileLoopResult> {
    const loopMode = whileNode.data?.loopMode || 'while'  // 'while' | 'forEach'
    const isDev = process.env.NODE_ENV === 'development'

    if (loopMode === 'forEach') {
      return this.executeForEachLoop(whileNode, context)
    }

    const maxIterations = clampMaxIterations(whileNode.data?.maxIterations, 'while')
    let loopIteration = 0
    const loopIterations: any[] = []

    if (!context.isResuming) {
      context.aiResponse = undefined
    }

    if (context.isResuming && context.whileLoopContext?.whileNodeId === whileNode.id) {
      loopIteration = clampRestoredIteration(context.whileLoopContext.currentIteration, maxIterations)
    }

    let isWaiting = false
    let waitingNodeId: string | undefined

    let executedIterations = 0

    while (loopIteration < maxIterations && executedIterations < maxIterations) {
      executedIterations++
      const conditionResult = evaluateCondition(context, whileNode.data)

      if (!conditionResult) {
        await this.loadJsonDataFromTempStorage(context)
        break
      }

      const loopEdges = this.edges.filter(
        e => e.source === whileNode.id && e.sourceHandle === 'loop'
      )

      if (loopEdges.length > 0) {
        const result = await this.executeLoopTools(
          whileNode,
          loopEdges,
          context,
          loopIteration,
          loopIterations
        )

        context = result.context
        isWaiting = result.isWaiting
        waitingNodeId = result.waitingNodeId

        if (result.fatalError) {
          return {
            isWaiting: false,
            context,
            iterations: loopIterations,
            totalIterations: loopIteration,
            terminatedBy: 'error',
            loopMode: 'while',
            fatalError: result.fatalError
          }
        }

        if (isWaiting) {
          break
        }

        if (result.shouldBreak) {
          break
        }
      }

      loopIteration++
    }

    if (!isWaiting) {
      context.whileResult = {
        type: 'while',
        totalIterations: loopIteration,
        maxIterations,
        iterations: loopIterations,
        terminatedBy: loopIteration >= maxIterations ? 'max-iterations' : 'condition'
      }

      context.aiResponse = undefined
    }

    return {
      isWaiting,
      waitingNodeId,
      context,
      iterations: loopIterations,
      totalIterations: loopIteration,
      terminatedBy: isWaiting ? 'wait' : (loopIteration >= maxIterations ? 'max-iterations' : 'condition'),
      loopMode: 'while'
    }
  }

  private async executeForEachLoop(
    whileNode: WorkflowNode,
    context: WorkflowContext
  ): Promise<WhileLoopResult> {
    const isDev = process.env.NODE_ENV === 'development'
    const forEachSource = whileNode.data?.forEachSource || ''  // e.g., 'imapResult.emails'
    const forEachItemVar = whileNode.data?.forEachItemVar || 'currentItem'  // e.g., 'currentEmail'
    const maxIterations = clampMaxIterations(whileNode.data?.maxIterations, 'forEach')

    if (!isSaveAsKeyAllowed(forEachItemVar)) {
      const fatalError: FatalError = {
        nodeId: whileNode.id,
        nodeLabel: whileNode.data?.label || whileNode.id,
        error: RESERVED_ITEM_VAR_ERROR(forEachItemVar),
      }
      context.nodeError = fatalError
      return {
        isWaiting: false,
        context,
        iterations: [],
        totalIterations: 0,
        terminatedBy: 'error',
        loopMode: 'forEach',
        fatalError,
      }
    }

    const sourceArray = this.getValueFromPath(context, forEachSource)

    if (!Array.isArray(sourceArray)) {
      console.warn(`[ForEach] Source "${forEachSource}" is not an array or not found`)
      return {
        isWaiting: false,
        context,
        iterations: [],
        totalIterations: 0,
        terminatedBy: 'forEach-complete',
        loopMode: 'forEach'
      }
    }

    const totalCount = Math.min(sourceArray.length, maxIterations)

    let loopIteration = 0
    const loopIterations: any[] = []
    let isWaiting = false
    let waitingNodeId: string | undefined

    if (context.isResuming && context.whileLoopContext?.whileNodeId === whileNode.id) {
      loopIteration = clampRestoredIteration(context.whileLoopContext.currentIteration, maxIterations)
    }

    if (!context.isResuming) {
      context.aiResponse = undefined
    }

    while (loopIteration < totalCount) {
      const currentItem = sourceArray[loopIteration]

      context.forEachContext = {
        sourceArray,
        currentIndex: loopIteration,
        currentItem,
        totalCount
      }

      ;(context as any)[forEachItemVar] = currentItem
      ;(context as any).currentIndex = loopIteration
      ;(context as any).totalCount = totalCount
      markTemplateVar(context, forEachItemVar)
      markTemplateVar(context, 'currentIndex')
      markTemplateVar(context, 'totalCount')


      const loopEdges = this.edges.filter(
        e => e.source === whileNode.id && e.sourceHandle === 'loop'
      )

      if (loopEdges.length > 0) {
        const result = await this.executeLoopTools(
          whileNode,
          loopEdges,
          context,
          loopIteration,
          loopIterations
        )

        context = result.context
        isWaiting = result.isWaiting
        waitingNodeId = result.waitingNodeId

        if (result.fatalError) {
          return {
            isWaiting: false,
            context,
            iterations: loopIterations,
            totalIterations: loopIteration,
            terminatedBy: 'error',
            loopMode: 'forEach',
            fatalError: result.fatalError
          }
        }

        if (isWaiting) {
          break
        }

        if (result.needsRetry) {
          console.log(`[ForEach] Needs retry, stopping loop after ${loopIteration + 1} items`)
          return {
            isWaiting: false,
            context,
            iterations: loopIterations,
            totalIterations: loopIteration + 1,
            terminatedBy: 'archive-failed',
            loopMode: 'forEach',
            needsRetry: true,
            retryAfterMs: result.retryAfterMs
          }
        }

      }

      loopIteration++

      if (loopIteration < totalCount) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    if (!isWaiting) {
      context.whileResult = {
        type: 'forEach',
        totalIterations: loopIteration,
        maxIterations: totalCount,
        iterations: loopIterations,
        terminatedBy: 'forEach-complete',
        sourceField: forEachSource,
        itemVariable: forEachItemVar
      }

      context.forEachContext = undefined
      context.aiResponse = undefined
    }

    return {
      isWaiting,
      waitingNodeId,
      context,
      iterations: loopIterations,
      totalIterations: loopIteration,
      terminatedBy: isWaiting ? 'wait' : 'forEach-complete',
      loopMode: 'forEach'
    }
  }

  private getValueFromPath(obj: any, path: string): any {
    if (!obj || !path) return undefined

    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined

      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/)
      if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch
        const index = parseInt(indexStr, 10)
        current = current[arrayName]
        if (!Array.isArray(current)) return undefined
        current = current[index]
      } else {
        current = current[part]
      }
    }

    return current
  }

  private async executeLoopTools(
    whileNode: WorkflowNode,
    loopEdges: any[],
    context: WorkflowContext,
    loopIteration: number,
    loopIterations: any[]
  ): Promise<{
    context: WorkflowContext
    isWaiting: boolean
    waitingNodeId?: string
    shouldBreak: boolean
    needsRetry?: boolean
    retryAfterMs?: number
    fatalError?: FatalError
  }> {
    const isDev = process.env.NODE_ENV === 'development'
    let isWaiting = false
    let waitingNodeId: string | undefined
    let shouldBreak = false

    const nestedLoop = loopEdges
      .map(e => this.nodes.find(n => n.id === e.target))
      .find(n => n && this.resolveNodeType(n) === 'while')
    if (nestedLoop) {
      const fatalError: FatalError = {
        nodeId: nestedLoop.id,
        nodeLabel: nestedLoop.data?.label || nestedLoop.id,
        error: NESTED_LOOP_ERROR
      }
      context.nodeError = fatalError
      return { context, isWaiting: false, shouldBreak: true, fatalError }
    }

    const loopToolNodes = loopEdges
      .map(e => this.nodes.find(n => n.id === e.target))
      .filter(n => n && n.data?.isLoopTool)
      .sort((a, b) => (a!.data?.loopOrder || 0) - (b!.data?.loopOrder || 0))

    let startIndex = 0
    if (context.isResuming && context.whileLoopContext?.whileNodeId === whileNode.id) {
      startIndex = context.whileLoopContext.loopToolIndex + 1
      context.isResuming = false
      context.whileLoopContext = undefined
    }

    const rewindBudget = createStepBudget(rewindLimit(loopToolNodes.length))

    for (let i = startIndex; i < loopToolNodes.length; i++) {
      const loopNode = loopToolNodes[i]!
      const loopNodeType = this.resolveNodeType(loopNode)

      if (!loopNodeType) {
        console.warn(`[Workflow] Cannot resolve type for loop node ${loopNode.id}`)
        continue
      }

      context.whileLoopContext = {
        whileNodeId: whileNode.id,
        currentIteration: loopIteration,
        loopToolIndex: i
      }

      const nodeStartTime = Date.now()

      try {
        if (loopNodeType === 'ai') {
          this.prepareAINodeTools(loopNode, context)
        }

        if (this.callbacks?.onNodeStart) {
          const nodeName = loopNode.data?.label || loopNodeType
          this.callbacks.onNodeStart(loopNode.id, `${nodeName} (Loop ${loopIteration + 1})`, loopNodeType, 0)
        }

        const loopResult = await this.executeNode(loopNode, loopNodeType, context)
        const duration = Date.now() - nodeStartTime

        if (this.callbacks?.onNodeComplete) {
          const debugLogEntry: WorkflowDebugLogEntry = redactDebugLogEntry({
            nodeId: loopNode.id,
            nodeName: `${loopNode.data?.label || loopNodeType} (Loop ${loopIteration + 1})`,
            nodeType: loopNodeType,
            duration,
            status: loopResult.debug?.status || 'success',
            input: loopResult.debug?.input ?? { context: extractContextVariables(context), iteration: loopIteration },
            output: loopResult.debug?.output ?? {},
            error: loopResult.debug?.error,
            children: loopResult.debug?.children
          })
          this.callbacks.onNodeComplete(debugLogEntry)
        }

        context = loopResult.context

        loopIterations.push({
          iteration: loopIteration,
          nodeId: loopNode.id,
          nodeLabel: loopNode.data?.label || loopNode.id,
          result: loopResult.debug?.output
        })

        if (loopResult.debug?.status === 'error') {
          const fatal: FatalError = {
            nodeId: loopNode.id,
            nodeLabel: loopNode.data?.label || loopNode.id,
            error: loopResult.debug.error || 'Node execution failed',
          }
          return { context, isWaiting: false, shouldBreak: true, fatalError: fatal }
        }

        if (loopResult.shouldWait) {
          isWaiting = true
          waitingNodeId = loopNode.id
          break
        }

        if (loopResult.debug?.output?.archiveFailed) {
          console.log(`[ForEach] Archive failed for UID ${loopResult.debug?.output?.failedUid}, stopping loop for retry`)
          return {
            context,
            isWaiting: false,
            shouldBreak: true,
            needsRetry: true,
            retryAfterMs: 1 * 60 * 1000
          }
        }

        if (loopResult.debug?.output?.folderNotFound || loopResult.debug?.output?.success === false) {
          const fatal: FatalError = {
            nodeId: loopNode.id,
            nodeLabel: loopNode.data?.label || loopNode.id,
            error: loopResult.debug?.output?.error || 'Node execution failed',
            folderNotFound: loopResult.debug?.output?.folderNotFound,
          }
          console.error(`[While] Loop node failed — aborting workflow: ${fatal.nodeLabel} - ${fatal.error}`)
          return { context, isWaiting: false, shouldBreak: true, fatalError: fatal }
        }

        if (loopNodeType === 'continue') {
          break
        }

        if (loopNodeType === 'condition' || loopNodeType === 'ifElse') {
          const branchResult = await this.handleIfElseBranch(loopNode, i, loopToolNodes, context, loopIteration, loopIterations)
          if (branchResult.context) {
            context = branchResult.context
          }
          if (branchResult.fatalError) {
            return { context, isWaiting: false, shouldBreak: true, fatalError: branchResult.fatalError }
          }
          if (branchResult.jumpIndex !== null) {
            const isRewind = branchResult.jumpIndex <= i
            if (isRewind && !rewindBudget.consume()) {
              const fatal: FatalError = {
                nodeId: loopNode.id,
                nodeLabel: loopNode.data?.label || loopNode.id,
                error: stepBudgetExceededMessage(rewindBudget.limit),
              }
              console.error('[While] Rewind budget exhausted in loop tools — aborting.')
              return { context, isWaiting: false, shouldBreak: true, fatalError: fatal }
            }
            i = branchResult.jumpIndex - 1
          }
          if (branchResult.isWaiting) {
            isWaiting = true
            waitingNodeId = branchResult.waitingNodeId
            break
          }
          if (branchResult.archiveFailed) {
            console.log(`[ForEach] Branch archive failed for UID ${branchResult.failedUid}, stopping loop for retry`)
            return {
              context,
              isWaiting: false,
              shouldBreak: true,
              needsRetry: true,
              retryAfterMs: 1 * 60 * 1000
            }
          }
        }

        const isForEachMode = whileNode.data?.loopMode === 'forEach'
        if (!isForEachMode && loopNodeType === 'ai' && context.aiResponse) {
          const shouldContinue = evaluateCondition(context, whileNode.data)
          if (!shouldContinue) {
            shouldBreak = true
            break
          }
        }
      } catch (error: any) {
        const errorMessage = error?.message || 'Loop node execution failed'
        console.error(`[While] Loop node threw — aborting workflow:`, error)

        if (this.callbacks?.onNodeComplete) {
          const debugFromError = error?.__workflowDebug
          this.callbacks.onNodeComplete(redactDebugLogEntry({
            nodeId: loopNode.id,
            nodeName: `${loopNode.data?.label || loopNodeType} (Loop ${loopIteration + 1})`,
            nodeType: loopNodeType,
            duration: Date.now() - nodeStartTime,
            status: debugFromError?.status || 'error',
            input: debugFromError?.input ?? { context: extractContextVariables(context), iteration: loopIteration },
            output: debugFromError?.output ?? {},
            error: debugFromError?.error || errorMessage
          }))
        }

        const fatal: FatalError = {
          nodeId: loopNode.id,
          nodeLabel: loopNode.data?.label || loopNode.id,
          error: errorMessage,
        }
        return { context, isWaiting: false, shouldBreak: true, fatalError: fatal }
      }
    }

    return { context, isWaiting, waitingNodeId, shouldBreak }
  }

  private prepareAINodeTools(loopNode: WorkflowNode, context: WorkflowContext): void {
    const toolEdges = this.edges.filter(e => e.source === loopNode.id && e.sourceHandle === 'tools')
    const selectedTools = {
      source: false,
      mcp: false,
      webSearch: false,
      functionCalling: false,
      imageInput: loopNode.data?.imageInput || false,
      pdfInput: loopNode.data?.pdfInput || false,
      subworkflow: false,
    }
    const subWorkflowIds: string[] = []
    const allowSubWorkflowTools = !((context.subWorkflowDepth ?? 0) >= 1)

    for (const toolEdge of toolEdges) {
      const toolNode = this.nodes.find(n => n.id === toolEdge.target)

      // Web Search Tool
      if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'webSearch') {
        selectedTools.webSearch = true

        if (!loopNode.data) loopNode.data = {}
        loopNode.data.webSearchDomains = toolNode.data.webSearchDomains || loopNode.data.webSearchDomains
        loopNode.data.webSearchCountry = toolNode.data.webSearchCountry || loopNode.data.webSearchCountry
        loopNode.data.webSearchRegion = toolNode.data.webSearchRegion || loopNode.data.webSearchRegion
        loopNode.data.webSearchCity = toolNode.data.webSearchCity || loopNode.data.webSearchCity
        loopNode.data.webSearchTimezone = toolNode.data.webSearchTimezone || loopNode.data.webSearchTimezone
        loopNode.data.webSearchContextSize = toolNode.data.webSearchContextSize || loopNode.data.webSearchContextSize
      }

      // Source Tool
      if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'source') {
        selectedTools.source = true
      }

      // MCP Tool
      if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'mcp') {
        selectedTools.mcp = true
      }

      // Function Calling Tool
      if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'functionCalling') {
        selectedTools.functionCalling = true
      }

      if (toolNode?.type === 'tool' && toolNode?.data?.toolType === 'subworkflow') {
        const id = typeof toolNode.data.subWorkflowId === 'string' ? toolNode.data.subWorkflowId.trim() : ''
        if (!allowSubWorkflowTools) {
          console.warn(`[Workflow] Sub-workflow tool skipped inside a sub-workflow run (depth guard, while loop) — node ${toolNode.id}`)
        } else if (id && !subWorkflowIds.includes(id)) {
          subWorkflowIds.push(id)
          selectedTools.subworkflow = true
        }
      }
    }

    loopNode.data = {
      ...loopNode.data,
      selectedTools,
      subWorkflowIds,
    }
  }

  private async handleIfElseBranch(
    loopNode: WorkflowNode,
    currentIndex: number,
    loopToolNodes: (WorkflowNode | undefined)[],
    context: WorkflowContext,
    loopIteration: number,
    loopIterations: any[]
  ): Promise<{
    jumpIndex: number | null
    context?: WorkflowContext
    isWaiting?: boolean
    waitingNodeId?: string
    archiveFailed?: boolean
    failedUid?: number
    fatalError?: FatalError
  }> {
    const matchedHandle = context.ifElseResult?.matchedHandle

    if (!matchedHandle) return { jumpIndex: null }

    const targetEdge = this.edges.find(e =>
      e.source === loopNode.id &&
      e.sourceHandle === matchedHandle
    )

    if (!targetEdge) return { jumpIndex: null }

    const targetNode = loopToolNodes.find(n => n?.id === targetEdge.target)

    if (targetNode) {
      const targetIndex = loopToolNodes.indexOf(targetNode)
      if (targetIndex > currentIndex) {
      } else if (targetIndex < currentIndex) {
      }
      return { jumpIndex: targetIndex }
    }

    const includeBranchesInLoop = loopNode.data?.includeBranchesInLoop !== false

    if (!includeBranchesInLoop) {
      return { jumpIndex: null }
    }

    const externalNode = this.nodes.find(n => n.id === targetEdge.target)
    if (!externalNode) {
      console.warn(`[While] If/Else target node ${targetEdge.target} not found`)
      return { jumpIndex: null }
    }


    const result = await this.executeBranchNode(externalNode, context, loopIteration, loopIterations)

    return {
      jumpIndex: null,
      context: result.context,
      isWaiting: result.isWaiting,
      waitingNodeId: result.waitingNodeId,
      archiveFailed: result.archiveFailed,
      failedUid: result.failedUid,
      fatalError: result.fatalError
    }
  }

  private async executeBranchNode(
    startNode: WorkflowNode,
    context: WorkflowContext,
    loopIteration: number,
    loopIterations: any[]
  ): Promise<{
    context: WorkflowContext
    isWaiting: boolean
    waitingNodeId?: string
    archiveFailed?: boolean
    failedUid?: number
    fatalError?: FatalError
  }> {
    let currentNode: WorkflowNode | null = startNode
    let isWaiting = false
    let waitingNodeId: string | undefined
    let archiveFailed = false
    let failedUid: number | undefined
    let fatalError: FatalError | undefined
    const chainBudget = createStepBudget(defaultStepLimit(this.nodes.length))

    while (currentNode) {
      if (!chainBudget.consume()) {
        fatalError = {
          nodeId: currentNode.id,
          nodeLabel: currentNode.data?.label || currentNode.id,
          error: stepBudgetExceededMessage(chainBudget.limit),
        }
        console.error(`[While] Chain budget exhausted in branch chain — aborting.`)
        break
      }

      const nodeType = this.resolveNodeType(currentNode)

      if (!nodeType || nodeType === 'end') {
        break
      }

      if (nodeType === 'while') {
        fatalError = {
          nodeId: currentNode.id,
          nodeLabel: currentNode.data?.label || currentNode.id,
          error: NESTED_LOOP_ERROR
        }
        context.nodeError = fatalError
        break
      }

      if (this.callbacks?.onNodeStart) {
        const nodeName = currentNode.data?.label || nodeType
        this.callbacks.onNodeStart(currentNode.id, `${nodeName} (Branch)`, nodeType, 0)
      }

      const nodeStartTime = Date.now()

      try {
        const nodeResult = await this.executeNode(currentNode, nodeType, context)
        const duration = Date.now() - nodeStartTime

        if (this.callbacks?.onNodeComplete) {
          const debugLogEntry: WorkflowDebugLogEntry = redactDebugLogEntry({
            nodeId: currentNode.id,
            nodeName: `${currentNode.data?.label || nodeType} (Branch)`,
            nodeType: nodeType,
            duration,
            status: nodeResult.debug?.status || 'success',
            input: nodeResult.debug?.input ?? { context: extractContextVariables(context), iteration: loopIteration },
            output: nodeResult.debug?.output ?? {},
            error: nodeResult.debug?.error,
            children: nodeResult.debug?.children
          })
          this.callbacks.onNodeComplete(debugLogEntry)
        }

        context = nodeResult.context

        loopIterations.push({
          iteration: loopIteration,
          nodeId: currentNode.id,
          nodeLabel: currentNode.data?.label || currentNode.id,
          branch: true,
          result: nodeResult.debug?.output
        })

        if (nodeResult.debug?.status === 'error') {
          fatalError = {
            nodeId: currentNode.id,
            nodeLabel: currentNode.data?.label || currentNode.id,
            error: nodeResult.debug.error || 'Node execution failed',
          }
          console.error(`[While] Branch node failed — aborting workflow: ${fatalError.nodeLabel} - ${fatalError.error}`)
          context.nodeError = fatalError
          break
        }

        if (nodeResult.shouldWait) {
          isWaiting = true
          waitingNodeId = currentNode.id
          break
        }

        if (nodeResult.debug?.output?.archiveFailed) {
          archiveFailed = true
          failedUid = nodeResult.debug?.output?.failedUid
          console.log(`[While] Branch node archive failed for UID ${failedUid}`)
          break
        }

        if (nodeResult.debug?.output?.folderNotFound || nodeResult.debug?.output?.success === false) {
          const errorMsg = nodeResult.debug?.output?.error || 'Node execution failed'
          console.error(`[While] Branch node failed: ${currentNode.data?.label || currentNode.id} - ${errorMsg}`)
          fatalError = {
            nodeId: currentNode.id,
            nodeLabel: currentNode.data?.label || currentNode.id,
            error: errorMsg,
            folderNotFound: nodeResult.debug?.output?.folderNotFound
          }
          context.nodeError = fatalError
          break
        }

      } catch (error: any) {
        const errorMessage = error?.message || 'Branch node execution failed'
        console.error(`[While] Branch node threw — aborting workflow:`, error)

        if (this.callbacks?.onNodeComplete) {
          const debugFromError = error?.__workflowDebug
          this.callbacks.onNodeComplete(redactDebugLogEntry({
            nodeId: currentNode.id,
            nodeName: `${currentNode.data?.label || nodeType} (Branch)`,
            nodeType,
            duration: Date.now() - nodeStartTime,
            status: debugFromError?.status || 'error',
            input: debugFromError?.input ?? { context: extractContextVariables(context), iteration: loopIteration },
            output: debugFromError?.output ?? {},
            error: debugFromError?.error || errorMessage
          }))
        }

        fatalError = {
          nodeId: currentNode.id,
          nodeLabel: currentNode.data?.label || currentNode.id,
          error: errorMessage,
        }
        context.nodeError = fatalError
        break
      }

      let nextEdge
      if (nodeType === 'condition' || nodeType === 'ifElse') {
        const matchedHandle = context.ifElseResult?.matchedHandle
        nextEdge = matchedHandle
          ? this.edges.find(e => e.source === currentNode!.id && e.sourceHandle === matchedHandle)
          : undefined
      } else {
        nextEdge = this.edges.find(e =>
          e.source === currentNode!.id &&
          (!e.sourceHandle || e.sourceHandle === 'default' || e.sourceHandle === 'output')
        )
      }

      if (nextEdge) {
        currentNode = this.nodes.find(n => n.id === nextEdge.target) || null
      } else {
        currentNode = null
      }
    }

    return { context, isWaiting, waitingNodeId, archiveFailed, failedUid, fatalError }
  }

  private async loadJsonDataFromTempStorage(context: WorkflowContext): Promise<void> {
    try {
      if (!context.conversationId || !context.agentId) return
      const jsonData = await loadTempData(this.prisma, context.conversationId, context.agentId)

      if (jsonData) {
        context.jsonData = jsonData
      }
    } catch (error) {
      console.error('[Workflow] Failed to load jsonData from temp storage:', error)
    }
  }
}

export class WhileNodeExecutor extends BaseNodeExecutor {
  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    return this.createSuccessResult(context, {
      input: { maxIterations: node.data?.maxIterations },
      output: { handled: 'by-engine' }
    })
  }
}

// Singleton instance
export const whileNodeExecutor = new WhileNodeExecutor()
