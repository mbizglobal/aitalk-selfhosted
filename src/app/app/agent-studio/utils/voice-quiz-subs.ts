
export interface VoiceQuizSubOption {
  id: string
  label: string
}

interface GraphNode {
  id: string
  type?: string
  data?: Record<string, any> | null
}

interface GraphEdge {
  source: string
  target: string
  sourceHandle?: string | null
}

export function voiceQuizSubOptions(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  quizNodeId: string,
): VoiceQuizSubOption[] {
  if (!quizNodeId) return []
  const parentEdge = edges.find((e) => e.target === quizNodeId && e.sourceHandle === 'miniapps')
  if (!parentEdge) return []
  const toolIds = edges
    .filter((e) => e.source === parentEdge.source && e.sourceHandle === 'tools')
    .map((e) => e.target)
  return nodes
    .filter((n) => toolIds.includes(n.id) && n.type === 'tool' && n.data?.toolType === 'subworkflow')
    .map((n) => ({
      id: typeof n.data?.subWorkflowId === 'string' ? n.data.subWorkflowId.trim() : '',
      label: typeof n.data?.label === 'string' ? n.data.label.trim() : '',
    }))
    .filter((o) => o.id)
    .filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i)
    .map((o) => ({ id: o.id, label: o.label || o.id }))
}
