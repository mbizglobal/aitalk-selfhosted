
export interface NodeDependency {
  nodeId: string
  nodeName: string
  nodeType: string
  fields: string[]
}

interface NodeData {
  nodeType?: string
  label?: string
  systemMessage?: string
  toEmail?: string
  subject?: string
  bodyTemplate?: string
  waitMessage?: string
  conditions?: Array<{ condition?: string }>
  customExpression?: string
  [key: string]: any
}

interface WorkflowNode {
  id: string
  type?: string
  data?: NodeData
}

function extractContextReferences(text: string | undefined): Array<{ nodeId: string; field: string }> {
  if (!text) return []

  const results: Array<{ nodeId: string; field: string }> = []

  const contextRegex = /\{\{context\.([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_]+))?\}\}/g
  let match
  while ((match = contextRegex.exec(text)) !== null) {
    const nodeId = match[1]
    const field = match[2] || 'output'
    results.push({ nodeId, field })
  }

  if (/\{\{message\}\}/.test(text)) {
    results.push({ nodeId: 'message', field: 'input' })
  }

  return results
}

function extractDependenciesFromNodeData(data: NodeData): Array<{ nodeId: string; field: string }> {
  const textFields = [
    'systemMessage',
    'toEmail',
    'subject',
    'bodyTemplate',
    'waitMessage',
    'customExpression',
    'prompt',
    'message',
    'query',
    'searchQuery',
  ]

  const allRefs: Array<{ nodeId: string; field: string }> = []

  for (const field of textFields) {
    const value = data[field]
    if (typeof value === 'string') {
      allRefs.push(...extractContextReferences(value))
    }
  }

  if (Array.isArray(data.conditions)) {
    for (const cond of data.conditions) {
      if (cond.condition) {
        allRefs.push(...extractContextReferences(cond.condition))
      }
    }
  }

  const uniqueRefs = new Map<string, { nodeId: string; field: string }>()
  for (const ref of allRefs) {
    const key = `${ref.nodeId}.${ref.field}`
    if (!uniqueRefs.has(key)) {
      uniqueRefs.set(key, ref)
    }
  }

  return Array.from(uniqueRefs.values())
}

export function analyzeNodeDependencies(
  node: WorkflowNode,
  allNodes: WorkflowNode[]
): NodeDependency[] {
  if (!node.data) return []

  const refs = extractDependenciesFromNodeData(node.data)
  if (refs.length === 0) return []

  const grouped = new Map<string, string[]>()
  for (const ref of refs) {
    const existing = grouped.get(ref.nodeId) || []
    if (!existing.includes(ref.field)) {
      existing.push(ref.field)
    }
    grouped.set(ref.nodeId, existing)
  }

  const dependencies: NodeDependency[] = []
  for (const [nodeId, fields] of grouped) {
    if (nodeId === 'message') {
      dependencies.push({
        nodeId: 'message',
        nodeName: 'User Message',
        nodeType: 'system',
        fields,
      })
      continue
    }

    const targetNode = allNodes.find(n => n.id === nodeId)
    if (targetNode) {
      dependencies.push({
        nodeId,
        nodeName: targetNode.data?.label || nodeId,
        nodeType: targetNode.data?.nodeType || targetNode.type || 'unknown',
        fields,
      })
    }
  }

  return dependencies
}

export function getNodeTypeEmoji(nodeType: string): string {
  switch (nodeType) {
    case 'ai':
      return '🤖'
    case 'start':
    case 'chat-widget':
      return '💬'
    case 'schedule':
      return '⏰'
    case 'wait':
      return '⏸️'
    case 'dataSheets':
    case 'data-sheets':
      return '📊'
    case 'ifelse':
    case 'if-else':
      return '⚡'
    case 'while':
      return '🔄'
    case 'tool':
    case 'source':
      return '📂'
    case 'mcp':
      return '🔌'
    case 'web-search':
      return '🌐'
    case 'sendgrid':
      return '📧'
    case 'end':
      return '🏁'
    case 'system':
      return '≡'
    default:
      return '≡'
  }
}

export function getNodeTypeColor(nodeType: string): string {
  switch (nodeType) {
    case 'ai':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
    case 'start':
    case 'chat-widget':
      return 'bg-green-500/20 text-green-300 border-green-500/30'
    case 'schedule':
      return 'bg-purple-500/20 text-purple-300 border-purple-500/30'
    case 'wait':
      return 'bg-orange-400/20 text-orange-300 border-orange-400/30'
    case 'dataSheets':
    case 'data-sheets':
      return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
    case 'ifelse':
    case 'if-else':
      return 'bg-orange-500/20 text-orange-300 border-orange-500/30'
    case 'while':
      return 'bg-orange-600/20 text-orange-300 border-orange-600/30'
    case 'tool':
    case 'source':
      return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
    case 'mcp':
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30'
    case 'web-search':
      return 'bg-green-500/20 text-green-300 border-green-500/30'
    case 'sendgrid':
      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
    case 'system':
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30'
    default:
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30'
  }
}

const VARIABLE_RENDER_REGEX = /(\{\{(?:context\.([a-zA-Z0-9_-]+)|message)\}\})/g

export interface VariableToken {
  type: 'text' | 'variable'
  value: string
  nodeId?: string
  nodeName?: string
  nodeType?: string
}

export function parseTextToTokens(
  text: string,
  nodes: Array<{ id: string; type?: string; data?: { label?: string; nodeType?: string } }>
): VariableToken[] {
  const tokens: VariableToken[] = []
  let lastIndex = 0
  let match

  const regex = new RegExp(VARIABLE_RENDER_REGEX.source, 'g')

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        value: text.substring(lastIndex, match.index)
      })
    }

    const fullMatch = match[1]
    const nodeId = match[2] || 'message'

    let nodeName = nodeId
    let nodeType = 'unknown'

    if (nodeId === 'message') {
      nodeName = 'User Message'
      nodeType = 'system'
    } else {
      const foundNode = nodes.find(n => n.id === nodeId)
      if (foundNode) {
        nodeName = foundNode.data?.label || nodeId
        nodeType = foundNode.data?.nodeType || foundNode.type || 'unknown'
      }
    }

    tokens.push({
      type: 'variable',
      value: fullMatch,
      nodeId,
      nodeName,
      nodeType
    })

    lastIndex = match.index + fullMatch.length
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      value: text.substring(lastIndex)
    })
  }

  return tokens
}
