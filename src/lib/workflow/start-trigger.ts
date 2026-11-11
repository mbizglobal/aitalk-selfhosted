
import { resolveNodeType } from '@/lib/workflow/engine/resolve-node-type'

export const APP_TRIGGER = 'app'

type NodeLike = { type?: unknown; data?: { nodeType?: unknown; triggerType?: unknown } | null }

function nodesOf(workflowJson: unknown): NodeLike[] | null {
  let json = workflowJson
  if (typeof json === 'string') {
    try { json = JSON.parse(json) } catch { return null }
  }
  const nodes = (json as { nodes?: unknown } | null)?.nodes
  return Array.isArray(nodes) ? (nodes as NodeLike[]) : null
}

const isStart = (n: NodeLike) => resolveNodeType(n as never) === 'start'

export function isChatStartTrigger(triggerType: unknown): boolean {
  return triggerType === undefined || triggerType === null || triggerType === 'chatWidget'
}

export function isAppWorkflow(workflowJson: unknown): boolean {
  const nodes = nodesOf(workflowJson)
  return !!nodes && nodes.some((n) => isStart(n) && n?.data?.triggerType === APP_TRIGGER)
}

export function pickNonAppWorkflow<T extends { workflowJson: string | null }>(rows: readonly T[]): T | null {
  return rows.find((r) => nodesOf(r.workflowJson) !== null && !isAppWorkflow(r.workflowJson) && !isWorkEventWorkflow(r.workflowJson)) ?? null
}

export function isWorkEventWorkflow(workflowJson: unknown): boolean {
  const nodes = nodesOf(workflowJson)
  return !!nodes && nodes.some((n) => isStart(n) && n?.data?.triggerType === WORK_EVENT_TRIGGER)
}

export const WORK_EVENT_TRIGGER = 'workEvent'
export const WORK_EVENT_KINDS = ['sealed', 'resubmitted', 'unlocked', 'inbox_row'] as const

export function workEventStart(workflowJson: unknown): { appWorkflowId: string; events: string[] } | null {
  const nodes = nodesOf(workflowJson)
  if (!nodes) return null
  const starts = nodes.filter(isStart)
  if (starts.length !== 1) return null
  const d = (starts[0]?.data ?? {}) as { triggerType?: unknown; workEventWorkflowId?: unknown; workEvents?: unknown }
  if (d.triggerType !== WORK_EVENT_TRIGGER) return null
  if (typeof d.workEventWorkflowId !== 'string' || !d.workEventWorkflowId) return null
  const events = Array.isArray(d.workEvents) ? d.workEvents.filter((x): x is string => typeof x === 'string' && (WORK_EVENT_KINDS as readonly string[]).includes(x)) : []
  if (!events.length) return null
  return { appWorkflowId: d.workEventWorkflowId, events }
}
