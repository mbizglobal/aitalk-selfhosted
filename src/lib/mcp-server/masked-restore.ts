
import { isDeepStrictEqual } from 'node:util'
import { maskSecrets, MASK } from './mask'

export interface MaskRestoreIssue {
  nodeId: string
  message: string
}

const EDITED_MASKED_NODE =
  'contains masked values (***masked***) and has been modified (any field of the node, including type/position). ' +
  'A node holding secrets can only be sent back exactly as returned by get_workflow. ' +
  'To change it: send the real secret values, use patch_workflow_params (template workflows), or edit it in Agent Studio.'
const NO_STORED_NODE =
  'contains masked values (***masked***) but no stored node with this id exists — masked placeholders cannot be resolved for a new node. Use real values.'

function containsMaskDeep(v: unknown): boolean {
  if (typeof v === 'string') return v.includes(MASK)
  if (Array.isArray(v)) return v.some(containsMaskDeep)
  if (typeof v === 'object' && v !== null) return Object.values(v as Record<string, unknown>).some(containsMaskDeep)
  return false
}

type RawNode = { id: string; [k: string]: unknown }

export function restoreMaskedSecrets(
  incoming: { nodes: RawNode[] },
  stored: { nodes: RawNode[] },
): MaskRestoreIssue[] {
  const issues: MaskRestoreIssue[] = []
  const storedById = new Map(stored.nodes.map(n => [n.id, n]))

  incoming.nodes.forEach((node, i) => {
    if (!containsMaskDeep(node)) return

    const storedNode = storedById.get(node.id)
    if (!storedNode) {
      issues.push({ nodeId: node.id, message: NO_STORED_NODE })
      return
    }
    if (!isDeepStrictEqual(node, maskSecrets(storedNode))) {
      issues.push({ nodeId: node.id, message: EDITED_MASKED_NODE })
      return
    }
    incoming.nodes[i] = structuredClone(storedNode)
  })
  return issues
}
