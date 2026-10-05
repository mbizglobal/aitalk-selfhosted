
export function isAiNodeRaw(node: any): boolean {
  if (!node) return false
  const nt = node?.data?.nodeType
  if (nt === 'ai' || nt === 'openai') return true
  if (node.type === 'ai') return true
  const label = node?.data?.label
  if (typeof label === 'string') {
    const lower = label.toLowerCase()
    if (lower.startsWith('ai:') || lower.startsWith('ai ') || lower === 'ai') return true
  }
  if (node.id === 'ai' || node.id === '2') return true
  return false
}

export function findFirstAiNodeFromWorkflow(
  startNodeId: string,
  nodes: any[] | undefined | null,
  edges: any[] | undefined | null
): any | null {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null
  const visited = new Set<string>()
  const queue: string[] = [startNodeId]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    const outgoing = edges.filter((e) => e?.source === currentId)
    for (const edge of outgoing) {
      const target = nodes.find((n) => n?.id === edge?.target)
      if (!target) continue
      if (isAiNodeRaw(target)) return target
      queue.push(target.id)
    }
  }
  return null
}

export function isRealtimeModelId(model: string | undefined | null): boolean {
  return typeof model === 'string' && (/^gpt-realtime/i.test(model) || isGptLiveModelId(model))
}

export function isGptLiveModelId(model: string | undefined | null): boolean {
  return model === 'gpt-live-1'
}
