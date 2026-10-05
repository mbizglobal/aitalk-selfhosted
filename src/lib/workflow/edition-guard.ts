import { offFeatureFor, type EditionFeature } from '@/lib/edition-features'
import type { Edition } from '@/lib/edition'
import { getEdition } from '@/lib/edition'
import { resolveNodeType } from './engine/resolve-node-type'
import type { WorkflowNode } from './types'

export interface EditionOffPart {
  nodeId: string
  label: string
  feature: EditionFeature
}

type LooseNode = { id?: unknown; type?: unknown; data?: Record<string, unknown> | null }

export function editionOffFeatureForNode(node: LooseNode, edition: Edition = getEdition()): EditionFeature | null {
  if (edition !== 'selfhosted' || !node || typeof node !== 'object') return null
  const data = (node.data && typeof node.data === 'object' ? node.data : {}) as Record<string, unknown>
  const kind = resolveNodeType(node as unknown as WorkflowNode)
  return (
    offFeatureFor('nodeKinds', kind, edition) ??
    (kind === 'start' ? offFeatureFor('triggers', data.triggerType, edition) : null) ??
    offFeatureFor('toolTypes', data.toolType, edition) ??
    offFeatureFor('toolTypes', data.nodeType, edition) ??
    (data.nodeType === 'miniapp'
      ? offFeatureFor('miniApps', data.miniAppType, edition) ?? offFeatureFor('miniApps', 'quiz', edition)
      : null)
  )
}

export function findEditionOffParts(workflow: unknown, edition: Edition = getEdition()): EditionOffPart[] {
  if (edition !== 'selfhosted') return []
  let parsed = workflow
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return []
    }
  }
  const nodes = (parsed as { nodes?: unknown })?.nodes
  if (!Array.isArray(nodes)) return []
  const out: EditionOffPart[] = []
  for (const n of nodes as LooseNode[]) {
    const feature = editionOffFeatureForNode(n, edition)
    if (!feature) continue
    const label = typeof n.data?.label === 'string' && n.data.label ? n.data.label : String(n.id ?? '')
    out.push({ nodeId: String(n.id ?? ''), label, feature })
  }
  return out
}

export function editionOffMessage(parts: EditionOffPart[]): string {
  const names = [...new Set(parts.map((p) => p.feature.name))]
  const nodes = parts.map((p) => `"${p.label}"`).join(', ')
  return `This installation does not include ${names.join(', ')} (used by ${nodes}). Remove ${parts.length > 1 ? 'these nodes' : 'this node'} to continue.`
}
