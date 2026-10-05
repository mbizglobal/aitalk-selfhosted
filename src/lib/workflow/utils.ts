
import { WorkflowJson, WorkflowNode, DEFAULT_WORKFLOW } from './types'
import { Agent } from '@prisma/client'
import { canReadTemplatePath } from './template-scope'
import { evaluateSafeExpression } from './safe-expression'

// ========================================
// ========================================

export function determineWorkflowMode(workflowJson: WorkflowJson): 'simple' | 'workflow' {
  const { nodes, edges } = workflowJson

  const startNode = nodes.find(n =>
    n.data?.nodeType === 'start' ||
    n.type === 'start' ||
    n.id === 'start' ||
    n.id === '1'
  )

  if (startNode?.data?.accessMode === 'team') {
    return 'workflow'
  }

  const aiNode = nodes.find(n =>
    n.data?.nodeType === 'ai' ||
    n.data?.label === 'AI' ||
    n.type === 'ai' ||
    n.id === 'ai' ||
    n.id === '2'
  )

  if (aiNode?.data?.outputFormat === 'json') {
    return 'workflow'
  }

  if (aiNode) {
    const hasFileInput = aiNode.data?.imageInput === true || aiNode.data?.pdfInput === true
    if (hasFileInput) {
      return 'workflow'
    }
  }

  const toolNodes = nodes.filter(n => n.type === 'tool')

  if (toolNodes.length === 0) {
    return 'workflow'
  }

  if (toolNodes.length > 1) {
    return 'workflow'
  }

  if (toolNodes.length === 1) {
    const toolType = toolNodes[0].data?.toolType
    if (toolType && toolType !== 'source') {
      return 'workflow'
    }
  }

  const logicNodes = nodes.filter(n => n.type !== 'tool')

  const nodeTypes = logicNodes
    .map(n => {
      if (n.data?.nodeType) return n.data.nodeType
      if (n.type === 'start' || n.type === 'ai' || n.type === 'end') return n.type
      if (n.id === 'start' || n.id === '1') return 'start'
      if (n.id === 'ai' || n.id === '2') return 'ai'
      if (n.id === 'end' || n.id === '3') return 'end'
      return n.type
    })
    .filter(t => t)
    .sort()

  const hasOnlyBasicNodes =
    nodeTypes.length === 3 &&
    nodeTypes[0] === 'ai' &&
    nodeTypes[1] === 'end' &&
    nodeTypes[2] === 'start'

  const flowEdges = edges.filter(e => e.sourceHandle !== 'tools' && e.sourceHandle !== 'miniapps')

  if (flowEdges.length !== 2) {
    return 'workflow'
  }

  let hasStartToAi = false
  let hasAiToEnd = false

  for (const edge of flowEdges) {
    const sourceNode = logicNodes.find(n => n.id === edge.source)
    const targetNode = logicNodes.find(n => n.id === edge.target)

    if (!sourceNode || !targetNode) continue

    const getNodeType = (node: any) => {
      if (node.data?.nodeType) return node.data.nodeType
      if (node.type === 'start' || node.type === 'ai' || node.type === 'end') return node.type
      if (node.id === 'start' || node.id === '1') return 'start'
      if (node.id === 'ai' || node.id === '2') return 'ai'
      if (node.id === 'end' || node.id === '3') return 'end'
      return node.type
    }

    const sourceType = getNodeType(sourceNode)
    const targetType = getNodeType(targetNode)

    if (sourceType === 'start' && targetType === 'ai') {
      hasStartToAi = true
    }
    if (sourceType === 'ai' && targetType === 'end') {
      hasAiToEnd = true
    }
  }

  const hasBasicFlow = hasStartToAi && hasAiToEnd

  return (hasOnlyBasicNodes && hasBasicFlow) ? 'simple' : 'workflow'
}

// ========================================
// ========================================

export function createDefaultWorkflowFromAgent(agent: Agent): WorkflowJson {
  return {
    nodes: [
      {
        id: 'start',
        type: 'start',
        position: { x: 100, y: 100 },
        data: { label: 'Chat Widget' }
      },
      {
        id: 'ai',
        type: 'ai',
        position: { x: 400, y: 100 },
        data: {
          label: 'AI',
          model: (agent as any).model || 'gpt-6-luna',
          temperature: (agent as any).temperature ?? 0.7,
          maxTokens: (agent as any).maxTokens ?? 2048,
          systemMessage: (agent as any).systemMessage || 'You are a helpful assistant',
          vectorStoreId: agent.vectorStoreId || undefined,
        }
      },
      {
        id: 'end',
        type: 'end',
        position: { x: 700, y: 100 },
        data: { label: 'End' }
      }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'ai' },
      { id: 'e2', source: 'ai', target: 'end' }
    ]
  }
}

// ========================================
// ========================================

export function extractFromAINode(workflowJson: WorkflowJson, key: string): any {
  const aiNode = workflowJson.nodes.find(n =>
    n.type === 'ai' ||
    n.data?.nodeType === 'ai' ||
    n.id === 'ai' ||
    n.id === '2'
  )
  return aiNode?.data?.[key]
}

export function extractAgentFieldsFromWorkflow(workflowJson: WorkflowJson): {
  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  systemMessage?: string
  vectorStoreId?: string | null
  effort?: string
  verbosity?: string
  summary?: string
  storeLogs?: boolean
} {
  const aiNode = workflowJson.nodes.find(n =>
    n.type === 'ai' ||
    n.data?.nodeType === 'ai' ||
    n.id === 'ai' ||
    n.id === '2'
  )

  if (!aiNode) {
    return {}
  }

  return {
    model: aiNode.data.model,
    temperature: aiNode.data.temperature,
    maxTokens: aiNode.data.maxTokens,
    topP: aiNode.data.topP,
    systemMessage: aiNode.data.systemMessage,
    vectorStoreId: aiNode.data.vectorStoreId || null,
    effort: aiNode.data.effort,
    verbosity: aiNode.data.verbosity,
    summary: aiNode.data.summary,
    storeLogs: aiNode.data.storeLogs,
  }
}

// ========================================
// ========================================

export interface WorkflowValidationResult {
  valid: boolean
  error?: string
}

export function validateWorkflow(
  workflowJson: WorkflowJson,
  options?: { strict?: boolean }
): WorkflowValidationResult {
  const { nodes, edges } = workflowJson
  const strict = options?.strict ?? true

  const hasStart = nodes.some(n =>
    n.type === 'start' ||
    n.data?.nodeType === 'start' ||
    n.id === 'start' ||
    n.id === '1'
  )
  const hasEnd = nodes.some(n =>
    n.type === 'end' ||
    n.data?.nodeType === 'end' ||
    n.id === 'end' ||
    n.id === '3'
  )

  if (!hasStart) {
    return { valid: false, error: 'Workflow must have a Start node' }
  }

  if (!hasEnd) {
    return { valid: false, error: 'Workflow must have an End node' }
  }

  const nodeIds = nodes.map(n => n.id)
  const uniqueNodeIds = new Set(nodeIds)
  if (nodeIds.length !== uniqueNodeIds.size) {
    return { valid: false, error: 'Workflow has duplicate node IDs' }
  }

  for (const edge of edges) {
    const sourceExists = nodes.some(n => n.id === edge.source)
    const targetExists = nodes.some(n => n.id === edge.target)

    if (!sourceExists) {
      return { valid: false, error: `Edge source node "${edge.source}" does not exist` }
    }

    if (!targetExists) {
      return { valid: false, error: `Edge target node "${edge.target}" does not exist` }
    }
  }

  if (hasCycle(nodes, edges)) {
    return { valid: false, error: 'Workflow contains a circular reference (infinite loop)' }
  }

  // ========================================
  // ========================================

  const logicNodes = nodes.filter(n => n.type !== 'tool')
  const flowEdges = edges.filter(e => e.sourceHandle !== 'tools' && e.sourceHandle !== 'miniapps')

  for (const node of logicNodes) {
    const nodeType = getNodeTypeForValidation(node)

    if (nodeType === 'condition' || nodeType === 'ifElse' || node.type === 'ifElse') {
      const conditions = node.data?.conditions || []

      if (conditions.length === 0) {
        return {
          valid: false,
          error: `If/else node "${node.data?.label || node.id}" has no conditions. Please add at least one condition.`
        }
      }

      if (strict) {
        for (const cond of conditions) {
          if (cond.type === 'else') continue

          const mode = cond.conditionMode || 'simple'

          if (mode === 'simple') {
            if (!cond.conditionField || cond.conditionField.trim() === '') {
              return {
                valid: false,
                error: `If/else node "${node.data?.label || node.id}" (Simple Mode) has an empty field. Please select a field.`
              }
            }
          } else if (mode === 'builder') {
            const subConditions = cond.conditions || []
            if (subConditions.length === 0) {
              return {
                valid: false,
                error: `If/else node "${node.data?.label || node.id}" (Builder Mode) has no conditions. Please add at least one condition.`
              }
            }
          } else if (mode === 'advanced' || mode === 'code') {
            if (!cond.customExpression || cond.customExpression.trim() === '') {
              return {
                valid: false,
                error: `If/else node "${node.data?.label || node.id}" (Code Mode) has an empty expression. Please enter a JavaScript expression.`
              }
            }
          }
        }
      }

      const ifHandles = conditions.map((c: any) => c.id)
      const elseHandle = 'else'
      const requiredHandles = [...ifHandles, elseHandle]

      for (const handle of requiredHandles) {
        const hasConnection = flowEdges.some(e =>
          e.source === node.id && e.sourceHandle === handle
        )

        if (!hasConnection) {
          const handleLabel = handle === 'else' ? 'else branch' : `condition "${handle}"`
          return {
            valid: false,
            error: `If/else node "${node.data?.label || node.id}": ${handleLabel} is not connected. Please connect all branches.`
          }
        }
      }
    }

    if (nodeType === 'ai') {
      const { model, systemMessage } = node.data || {}

      if (!model) {
        return {
          valid: false,
          error: `AI node "${node.data?.label || node.id}" has no model selected. Please select a model.`
        }
      }

      if (!systemMessage || systemMessage.trim() === '') {
        return {
          valid: false,
          error: `AI node "${node.data?.label || node.id}" has no system message. Please add instructions.`
        }
      }
    }

    // if (nodeType === 'web_search') { ... }
  }

  for (const node of logicNodes) {
    const nodeType = getNodeTypeForValidation(node)

    if (nodeType === 'start' || node.type === 'note') continue

    const hasIncomingEdge = flowEdges.some(e => e.target === node.id)
    if (!hasIncomingEdge) {
      return {
        valid: false,
        error: `Node "${node.data?.label || node.id}" is not connected. Please connect it to the workflow.`
      }
    }
  }

  for (const node of logicNodes) {
    const nodeType = getNodeTypeForValidation(node)

    if (nodeType === 'end' || node.type === 'note') continue

    const hasOutgoingEdge = flowEdges.some(e => e.source === node.id)
    if (!hasOutgoingEdge) {
      return {
        valid: false,
        error: `Node "${node.data?.label || node.id}" has no outgoing connection. Please connect it to the next step or End node.`
      }
    }
  }

  return { valid: true }
}

function getNodeTypeForValidation(node: any): string {
  if (node.data?.nodeType) return node.data.nodeType
  if (node.type === 'start' || node.type === 'ai' || node.type === 'end' || node.type === 'ifelse') return node.type
  if (node.id === 'start' || node.id === '1') return 'start'
  if (node.id === 'ai' || node.id === '2') return 'ai'
  if (node.id === 'end' || node.id === '3') return 'end'
  return node.type || 'unknown'
}

function hasCycle(nodes: WorkflowNode[], edges: any[]): boolean {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    if (recursionStack.has(nodeId)) {
      return true
    }

    if (visited.has(nodeId)) {
      return false
    }

    visited.add(nodeId)
    recursionStack.add(nodeId)

    const outgoingEdges = edges.filter(e => e.source === nodeId)

    for (const edge of outgoingEdges) {
      if (dfs(edge.target)) {
        return true
      }
    }

    recursionStack.delete(nodeId)
    return false
  }

  const startNode = nodes.find(n =>
    n.type === 'start' ||
    n.data?.nodeType === 'start' ||
    n.id === 'start' ||
    n.id === '1'
  )
  if (startNode) {
    return dfs(startNode.id)
  }

  return false
}

// ========================================
// ========================================

export function formatExecutionPath(nodeIds: string[]): string {
  return nodeIds.join('→')
}

// ========================================
// ========================================

function getValueFromPath(obj: any, path: string): any {
  if (!path) return undefined

  let normalizedPath = path
  if (normalizedPath.startsWith('context.')) {
    normalizedPath = normalizedPath.substring(8)
  }

  const keys = normalizedPath.split('.')
  let current = obj

  for (const key of keys) {
    if (current === undefined || current === null) {
      return undefined
    }
    current = current[key]
  }

  return current
}

export function evaluateCondition(context: Record<string, any>, conditionData: any): boolean {
  const mode = conditionData.conditionMode || 'simple'

  try {
    switch (mode) {
      case 'simple':
        return evaluateSimpleCondition(context, conditionData)
      case 'builder':
        return evaluateBuilderConditions(context, conditionData)
      case 'advanced':
      case 'code':
        return evaluateCustomExpression(context, conditionData)
      default:
        console.warn(`[Condition] Unknown condition mode: ${mode}`)
        return false
    }
  } catch (error) {
    console.error('[Condition] Evaluation error:', error)
    return false
  }
}

function readableConditionPath(context: Record<string, any>, field: unknown): string | null {
  if (typeof field !== 'string' || !field.trim()) return null
  const path = field.trim().startsWith('context.') ? field.trim().slice(8) : field.trim()
  if (canReadTemplatePath(context, path)) return path

  console.error(
    `[Condition] 🔒 허용되지 않은 컨텍스트 경로를 조건 필드로 썼다: "${field}" — 조건을 false 로 평가한다 (lib/workflow/template-scope.ts)`
  )
  return null
}

function evaluateSimpleCondition(context: Record<string, any>, conditionData: any): boolean {
  const { conditionField, conditionOperator, conditionValue } = conditionData

  if (!conditionField) return false
  const path = readableConditionPath(context, conditionField)
  if (path === null) return false

  const fieldValue = getValueFromPath(context, path)

  switch (conditionOperator) {
    case '==':
      return fieldValue == conditionValue
    case '!=':
      return fieldValue != conditionValue
    case '>':
      return Number(fieldValue) > Number(conditionValue)
    case '<':
      return Number(fieldValue) < Number(conditionValue)
    case '>=':
      return Number(fieldValue) >= Number(conditionValue)
    case '<=':
      return Number(fieldValue) <= Number(conditionValue)
    case 'contains':
      return String(fieldValue).includes(String(conditionValue))
    case 'startsWith':
      return String(fieldValue).startsWith(String(conditionValue))
    case 'endsWith':
      return String(fieldValue).endsWith(String(conditionValue))
    default:
      return false
  }
}

function evaluateBuilderConditions(context: Record<string, any>, conditionData: any): boolean {
  const conditions = conditionData.conditions || conditionData.builderConditions
  const { conditionLogic } = conditionData

  if (!Array.isArray(conditions) || conditions.length === 0) {
    return false
  }

  const results = conditions.map((cond: any) => {
    const path = readableConditionPath(context, cond?.field)
    if (path === null) return false
    const fieldValue = getValueFromPath(context, path)

    switch (cond.operator) {
      case '==':
        return fieldValue == cond.value
      case '!=':
        return fieldValue != cond.value
      case '>':
        return Number(fieldValue) > Number(cond.value)
      case '<':
        return Number(fieldValue) < Number(cond.value)
      case '>=':
        return Number(fieldValue) >= Number(cond.value)
      case '<=':
        return Number(fieldValue) <= Number(cond.value)
      case 'contains':
        return String(fieldValue).includes(String(cond.value))
      case 'startsWith':
        return String(fieldValue).startsWith(String(cond.value))
      case 'endsWith':
        return String(fieldValue).endsWith(String(cond.value))
      default:
        return false
    }
  })

  if (conditionLogic === 'any') {
    return results.some(r => r === true)
  } else {
    return results.every(r => r === true)
  }
}

function evaluateCustomExpression(context: Record<string, any>, conditionData: any): boolean {
  return evaluateSafeExpression(conditionData?.customExpression, context)
}
