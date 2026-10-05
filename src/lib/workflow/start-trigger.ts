
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
  return rows.find((r) => nodesOf(r.workflowJson) !== null && !isAppWorkflow(r.workflowJson)) ?? null
}
