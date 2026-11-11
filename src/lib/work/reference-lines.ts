
export type AppIdOf = (appNodeId: string) => string | undefined
type LineNode = { id?: unknown; type?: unknown; data?: Record<string, unknown> | null }
const isStepNode = (n: LineNode | undefined) => !!n && (n.type === 'workAppStep' || n.data?.nodeType === 'workAppStep')
const isCanvasAppNode = (n: LineNode | undefined) => !!n && n.data?.nodeType === 'workApp'
const isCanvasLinkNode = (n: LineNode | undefined) => !!n && n.data?.nodeType === 'workAppLink'
function lineEnd(n: LineNode | undefined, appIdOf: AppIdOf | undefined): string | null | false {
  if (isStepNode(n)) { const t = n!.data?.targetWorkflowId; return typeof t === 'string' && t ? t : null }
  if (isCanvasAppNode(n)) return appIdOf ? appIdOf(String(n!.id)) ?? null : `node:${String(n!.id)}`
  if (isCanvasLinkNode(n)) { const t = n!.data?.linkedAppWorkflowId; return typeof t === 'string' && t ? t : appIdOf ? null : `link:${String(n!.id)}` }
  return false
}

export function closesLongCycle(edges: ReadonlyArray<{ fromProjectId: string; toProjectId: string }>, from: string, to: string): boolean {
  if (from === to) return true
  const next = new Map<string, string[]>()
  for (const e of edges) next.set(e.fromProjectId, [...(next.get(e.fromProjectId) ?? []), e.toProjectId])
  const seen = new Set<string>([to])
  const stack = (next.get(to) ?? []).filter((n) => n !== from)
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === from) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(next.get(cur) ?? []))
  }
  return false
}

export interface ReferenceLine {
  edgeId: string
  readerWorkflowId: string
  sourceWorkflowId: string
  sheets: unknown
  includeUnconfirmed: boolean
}

export function referenceLinesOf(workflowJson: unknown, appIdOf?: AppIdOf): { lines: ReferenceLine[]; problems: Array<{ edgeId: string; message: string }> } {
  let json = workflowJson
  if (typeof json === 'string') { try { json = JSON.parse(json) } catch { return { lines: [], problems: [] } } }
  const nodes = ((json as { nodes?: unknown })?.nodes ?? []) as Array<{ id?: unknown; type?: unknown; data?: Record<string, unknown> | null }>
  const edges = ((json as { edges?: unknown })?.edges ?? []) as Array<{ id?: unknown; source?: unknown; target?: unknown; sourceHandle?: unknown; data?: Record<string, unknown> | null }>
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return { lines: [], problems: [] }
  const byId = new Map(nodes.filter((n) => n && typeof n.id === 'string').map((n) => [n.id as string, n]))
  const lines: ReferenceLine[] = []
  const problems: Array<{ edgeId: string; message: string }> = []
  const seen = new Set<string>()
  for (const e of edges) {
    if (!e || e.sourceHandle !== 'ref') continue
    const edgeId = typeof e.id === 'string' ? e.id : `${String(e.source)}->${String(e.target)}`
    const a = byId.get(String(e.source))
    const b = byId.get(String(e.target))
    const src = lineEnd(a, appIdOf)
    const reader = lineEnd(b, appIdOf)
    if (src === false || reader === false) { problems.push({ edgeId, message: 'a reference line must connect two work app nodes' }); continue }
    if (!src || !reader) { problems.push({ edgeId, message: 'both work app nodes of a reference line need a work app' }); continue }
    if (src === reader) { problems.push({ edgeId, message: 'a reference line cannot connect a work app to itself' }); continue }
    const pair = `${reader}<-${src}`
    if (seen.has(pair)) { problems.push({ edgeId, message: 'only one reference line per pair of work apps — choose several sheets on one line' }); continue }
    seen.add(pair)
    lines.push({ edgeId, readerWorkflowId: reader, sourceWorkflowId: src, sheets: e.data?.sheets, includeUnconfirmed: e.data?.includeUnconfirmed === true })
  }
  return { lines, problems }
}


export interface SendLine {
  edgeId: string
  fromWorkflowId: string
  toWorkflowId: string
  family: string
}

export function sendLinesOf(workflowJson: unknown, appIdOf?: AppIdOf): { lines: SendLine[]; problems: Array<{ edgeId: string; message: string }> } {
  let json = workflowJson
  if (typeof json === 'string') { try { json = JSON.parse(json) } catch { return { lines: [], problems: [] } } }
  const nodes = ((json as { nodes?: unknown })?.nodes ?? []) as Array<{ id?: unknown; type?: unknown; data?: Record<string, unknown> | null }>
  const edges = ((json as { edges?: unknown })?.edges ?? []) as Array<{ id?: unknown; source?: unknown; target?: unknown; sourceHandle?: unknown; data?: Record<string, unknown> | null }>
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return { lines: [], problems: [] }
  const byId = new Map(nodes.filter((n) => n && typeof n.id === 'string').map((n) => [n.id as string, n]))
  const lines: SendLine[] = []
  const problems: Array<{ edgeId: string; message: string }> = []
  const seen = new Set<string>()
  for (const e of edges) {
    if (!e || e.sourceHandle !== 'send') continue
    const edgeId = typeof e.id === 'string' ? e.id : `${String(e.source)}->${String(e.target)}`
    const a = byId.get(String(e.source))
    const b = byId.get(String(e.target))
    if (isCanvasLinkNode(a) || isCanvasLinkNode(b)) { problems.push({ edgeId, message: 'a linked work app takes reference lines only — send lines are drawn in its own workflow' }); continue }
    const from = lineEnd(a, appIdOf)
    const to = lineEnd(b, appIdOf)
    if (from === false || to === false) { problems.push({ edgeId, message: 'a send line must connect two work app nodes' }); continue }
    if (!from || !to) { problems.push({ edgeId, message: 'both work app nodes of a send line need a work app' }); continue }
    if (from === to) { problems.push({ edgeId, message: 'a send line cannot connect a work app to itself' }); continue }
    const family = typeof e.data?.inboxFamily === 'string' ? e.data.inboxFamily.trim() : ''
    const key = `${from}->${to}\0${family}`
    if (family && seen.has(key)) { problems.push({ edgeId, message: 'this send line is drawn twice — one line per work app pair and inbox' }); continue }
    seen.add(key)
    lines.push({ edgeId, fromWorkflowId: from, toWorkflowId: to, family })
  }
  return { lines, problems }
}
