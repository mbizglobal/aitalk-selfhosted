import type { Node, Edge } from 'reactflow'

const TOOL_TYPE_BY_FLAG = {
  source: 'source',
  mcp: 'mcp',
  webSearch: 'webSearch',
  functionCalling: 'functionCalling',
  sendgrid: 'sendgrid',
  telegram: 'telegram',
  sms: 'sms',
  smtp: 'smtp',
  googleCalendar: 'google_calendar',
  microsoftCalendar: 'microsoft_calendar',
  subworkflow: 'subworkflow',
  workApp: 'workApp',
} as const

export type DerivedToolFlag = keyof typeof TOOL_TYPE_BY_FLAG

export const DERIVED_TOOL_FLAGS = Object.keys(TOOL_TYPE_BY_FLAG) as DerivedToolFlag[]

const CARRIED_FLAGS = ['imageInput', 'pdfInput'] as const

export function isAiNode(node: any): boolean {
  return node?.data?.nodeType === 'ai' || node?.data?.label === 'AI'
}

export interface DerivedToolState {
  hasToolsConnection: boolean
  selectedTools: Record<string, boolean>
}

export function deriveToolFlags(aiNode: any, nodes: readonly any[], edges: readonly any[]): DerivedToolState {
  const connectedToolEdges = edges.filter(
    (edge) => edge.source === aiNode.id && edge.sourceHandle === 'tools'
  )
  const connectedToolNodeIds = connectedToolEdges.map((e) => e.target)
  const connectedToolNodes = nodes.filter(
    (n) => connectedToolNodeIds.includes(n.id) && n.type === 'tool' && n.data?.toolType
  )

  const selectedTools: Record<string, boolean> = {}
  for (const flag of DERIVED_TOOL_FLAGS) {
    const toolType = TOOL_TYPE_BY_FLAG[flag]
    selectedTools[flag] = connectedToolNodes.some((n) => n.data.toolType === toolType)
  }
  for (const flag of CARRIED_FLAGS) {
    selectedTools[flag] = aiNode.data?.selectedTools?.[flag] || aiNode.data?.[flag] || false
  }

  return { hasToolsConnection: connectedToolEdges.length > 0, selectedTools }
}

export function selectedToolsEqual(current: any, next: Record<string, boolean>): boolean {
  const currentTools = current || {}
  for (const flag of [...DERIVED_TOOL_FLAGS, ...CARRIED_FLAGS]) {
    if (currentTools[flag] !== next[flag]) return false
  }
  return true
}

export function applyDerivedToolFlags(nodes: Node[], edges: Edge[]): Node[] {
  return nodes.map((node) => {
    if (!isAiNode(node)) return node
    const { hasToolsConnection, selectedTools } = deriveToolFlags(node, nodes, edges)
    if (
      node.data?.hasToolsConnection === hasToolsConnection &&
      selectedToolsEqual(node.data?.selectedTools, selectedTools)
    ) {
      return node
    }
    return { ...node, data: { ...node.data, hasToolsConnection, selectedTools } }
  })
}
