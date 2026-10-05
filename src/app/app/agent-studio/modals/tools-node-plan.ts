
export type ToolPlanType =
  | 'source' | 'mcp' | 'webSearch'
  | 'sendgrid' | 'telegram' | 'sms' | 'smtp'
  | 'google_calendar' | 'microsoft_calendar'
  | 'subworkflow'
  | 'workApp'

export const MODAL_MANAGED_KEYS = [
  'label', 'icon', 'color', 'toolType', 'nodeType', 'isLoopTool', 'connectionId', 'mcpConnectionId',
  'subWorkflowId',
] as const

export const APPS_TOOL_TYPES: readonly ToolPlanType[] = [
  'sendgrid', 'telegram', 'sms', 'smtp', 'google_calendar', 'microsoft_calendar',
]

export const MODAL_TOOL_TYPES: ReadonlySet<string> = new Set<ToolPlanType>([
  'source', 'mcp', 'webSearch',
  'sendgrid', 'telegram', 'sms', 'smtp',
  'google_calendar', 'microsoft_calendar',
  'subworkflow',
  'workApp',
])

export function splitAttachedTools<T extends { data?: { toolType?: string } | undefined }>(
  attached: readonly T[],
): { managed: T[]; unmanaged: T[] } {
  const managed: T[] = []
  const unmanaged: T[] = []
  for (const n of attached) {
    ;(MODAL_TOOL_TYPES.has(n.data?.toolType as string) ? managed : unmanaged).push(n)
  }
  return { managed, unmanaged }
}

export interface PlanItem {
  id: string
  name: string
  type: ToolPlanType
  connectionId?: string
  mcpConnectionId?: string
  subWorkflowId?: string
  data?: Record<string, any>
}

export interface PlanNode {
  id: string
  position: { x: number; y: number }
}

export interface ToolPlanEntry {
  item: PlanItem
  nodeId: string
  keep: boolean
}

export interface ToolPlan {
  entries: ToolPlanEntry[]
  keptIds: Set<string>
  removedIds: string[]
}

export function planToolNodes(
  items: PlanItem[],
  attachedIds: Iterable<string>,
  newIdFor: (item: PlanItem, index: number) => string,
): ToolPlan {
  const attached = new Set(attachedIds)
  const entries = items.map((item, index) => {
    const keep = attached.has(item.id)
    return { item, keep, nodeId: keep ? item.id : newIdFor(item, index) }
  })
  const keptIds = new Set(entries.filter(e => e.keep).map(e => e.nodeId))
  return {
    entries,
    keptIds,
    removedIds: [...attached].filter(id => !keptIds.has(id)),
  }
}

function fallbackSlotOf(dx: number, dy: number, gridLength: number): number | null {
  if (Math.abs(dx) >= 1) return null
  const raw = (dy - 150) / 100
  const slot = Math.round(raw)
  if (Math.abs(raw - slot) > 1e-6) return null
  if (slot < gridLength) return null
  return slot
}

export function makeSlotAllocator(
  grid: ReadonlyArray<{ x: number; y: number }>,
  keptNodes: ReadonlyArray<PlanNode>,
  anchor: { x: number; y: number },
): () => { x: number; y: number } {
  const occupied = new Set<number>()
  for (const n of keptNodes) {
    const dx = n.position.x - anchor.x
    const dy = n.position.y - anchor.y
    const slot = grid.findIndex(g => Math.abs(g.x - dx) < 1 && Math.abs(g.y - dy) < 1)
    if (slot >= 0) { occupied.add(slot); continue }
    const fb = fallbackSlotOf(dx, dy, grid.length)
    if (fb !== null) occupied.add(fb)
  }
  let cursor = 0
  return () => {
    while (occupied.has(cursor)) cursor++
    const slot = cursor
    occupied.add(slot)
    return grid[slot] || { x: 0, y: 150 + (slot * 100) }
  }
}

export interface PlanEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  [k: string]: any
}

export function canonicalToolEdge(edge: PlanEdge, isLoopTool: any): PlanEdge {
  return {
    ...edge,
    type: 'toolEdge',
    targetHandle: undefined,
    className: undefined,
    animated: false,
    markerEnd: undefined,
    style: isLoopTool ? { stroke: '#f97316' } : undefined,
  }
}

export function reconcileToolEdges(
  edges: readonly PlanEdge[],
  opts: {
    aiNodeId: string
    keptIds: ReadonlySet<string>
    removedIds: readonly string[]
    isLoopTool: any
  },
): PlanEdge[] {
  const removed = new Set(opts.removedIds)
  const seenTargets = new Set<string>()
  const out: PlanEdge[] = []

  for (const e of edges) {
    if (removed.has(e.source) || removed.has(e.target)) continue

    const isKeptToolsEdge =
      e.source === opts.aiNodeId && e.sourceHandle === 'tools' && opts.keptIds.has(e.target)
    if (!isKeptToolsEdge) {
      out.push(e)
      continue
    }
    if (seenTargets.has(e.target)) continue
    seenTargets.add(e.target)
    out.push(canonicalToolEdge(e, opts.isLoopTool))
  }
  return out
}

export function buildManagedToolData(
  item: PlanItem,
  existing: Record<string, any>,
  opts: {
    icon: any
    color: string
    isLoopTool: any
    providerOf: (connectionId: string) => string | undefined
  },
): Record<string, any> {
  const smsProvider = item.connectionId ? opts.providerOf(item.connectionId) : undefined
  const appsNodeType =
    item.type !== 'sms'
      ? item.type
      : smsProvider === 'acs_sms'
        ? 'sms_acs'
        : smsProvider === 'infobip_sms'
          ? 'sms_infobip'
          : (typeof existing?.nodeType === 'string' ? existing.nodeType : 'sms_infobip')

  const data: Record<string, any> = { ...existing }
  for (const k of MODAL_MANAGED_KEYS) delete data[k]

  data.label = item.name
  data.icon = opts.icon
  data.color = opts.color
  data.toolType = item.type
  if (APPS_TOOL_TYPES.includes(item.type)) data.nodeType = appsNodeType
  data.isLoopTool = opts.isLoopTool
  if (item.connectionId) data.connectionId = item.connectionId
  if (item.mcpConnectionId) data.mcpConnectionId = item.mcpConnectionId
  if (item.subWorkflowId) data.subWorkflowId = item.subWorkflowId
  return data
}
