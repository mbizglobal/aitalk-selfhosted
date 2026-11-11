import { createContext, useEffect, useState } from 'react'
import type { Edge, Node } from 'reactflow'
import { handoffRoutesOf } from '@/lib/work/app-canvas'

export type HandoffReadiness = Map<string, string>

export const HandoffReadinessContext = createContext<HandoffReadiness | null>(null)

export function useHandoffReadiness(canvasWorkflowId: string | null | undefined, status: string | null | undefined, savedTick?: unknown): HandoffReadiness | null {
  const [state, setState] = useState<{ key: string; map: HandoffReadiness } | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  useEffect(() => {
    const onFocus = () => setFocusTick((x) => x + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  useEffect(() => {
    if (!canvasWorkflowId) { setState(null); return }
    let alive = true
    fetch(`/api/agent-studio/work-app-nodes?workflowId=${encodeURIComponent(canvasWorkflowId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        const rows = d?.apps
        if (!Array.isArray(rows)) { setState(null); return }
        const map: HandoffReadiness = new Map(rows.filter((a: { nodeId?: unknown; handoff?: unknown }) => typeof a?.nodeId === 'string' && typeof a?.handoff === 'string').map((a: { nodeId: string; handoff: string }) => [a.nodeId, a.handoff]))
        for (const id of Array.isArray(d?.readyOnDeploy) ? d.readyOnDeploy : []) if (typeof id === 'string' && !map.has(id)) map.set(id, 'ready')
        setState({ key: canvasWorkflowId, map })
      })
      .catch(() => { if (alive) setState(null) })
    return () => { alive = false }
  }, [canvasWorkflowId, status, savedTick, focusTick])
  return state && state.key === canvasWorkflowId ? state.map : null
}

export function isHandoffTarget(nodeId: string, nodes: Node[], edges: Edge[]): boolean {
  return handoffRoutesOf({ nodes, edges }).routes.some((r) => r.toNodeId === nodeId)
}

export function handoffNotice(nodeId: string, readiness: HandoffReadiness | null, target: boolean): string | null {
  if (!readiness || !target) return null
  const v = readiness.get(nodeId) ?? 'not_set_up'
  return v === 'ready' ? null : v
}
