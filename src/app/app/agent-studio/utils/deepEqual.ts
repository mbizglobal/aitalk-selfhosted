
import type { Node, Edge } from 'reactflow'

export function compareNodes(nodes1: Node[], nodes2: Node[]): boolean {
  if (nodes1.length !== nodes2.length) return false

  const sorted1 = [...nodes1].sort((a, b) => a.id.localeCompare(b.id))
  const sorted2 = [...nodes2].sort((a, b) => a.id.localeCompare(b.id))

  for (let i = 0; i < sorted1.length; i++) {
    const n1 = sorted1[i]
    const n2 = sorted2[i]

    if (n1.id !== n2.id) return false

    if (n1.type !== n2.type) return false

    const p1 = n1.position || { x: 0, y: 0 }
    const p2 = n2.position || { x: 0, y: 0 }
    const pos1 = { x: Math.round(p1.x), y: Math.round(p1.y) }
    const pos2 = { x: Math.round(p2.x), y: Math.round(p2.y) }
    if (pos1.x !== pos2.x || pos1.y !== pos2.y) return false

    const data1 = excludeFields(n1.data, ['selected', 'icon', 'hasToolsConnection', 'onAddTool'])
    const data2 = excludeFields(n2.data, ['selected', 'icon', 'hasToolsConnection', 'onAddTool'])
    if (!deepEqual(data1, data2)) return false

  }

  return true
}

export function compareEdges(edges1: Edge[], edges2: Edge[]): boolean {
  if (edges1.length !== edges2.length) return false

  const sorted1 = [...edges1].sort((a, b) => a.id.localeCompare(b.id))
  const sorted2 = [...edges2].sort((a, b) => a.id.localeCompare(b.id))

  for (let i = 0; i < sorted1.length; i++) {
    const e1 = excludeFields(sorted1[i], ['selected'])
    const e2 = excludeFields(sorted2[i], ['selected'])

    if (!deepEqual(e1, e2)) return false
  }

  return true
}

function excludeFields(obj: any, fields: string[]): any {
  if (!obj || typeof obj !== 'object') return obj

  const result: any = {}
  for (const key in obj) {
    if (!fields.includes(key)) {
      result[key] = obj[key]
    }
  }
  return result
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true

  if (a == null || b == null) return false

  if (typeof a !== typeof b) return false

  if (typeof a === 'function') return true

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a).filter(key => a[key] !== undefined)
    const keysB = Object.keys(b).filter(key => b[key] !== undefined)

    if (keysA.length !== keysB.length) return false

    for (const key of keysA) {
      if (!keysB.includes(key)) return false
      if (!deepEqual(a[key], b[key])) return false
    }

    return true
  }

  return a === b
}
