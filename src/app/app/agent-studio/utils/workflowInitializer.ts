import type { Node, Edge } from 'reactflow'
import { restoreNodesWithIcons } from './nodeUtils'
import { MCPLogo } from '../nodes'
import { initialNodes as defaultNodes, initialEdges as defaultEdges } from '../constants/initialData'

export function resolveInitialWorkflow(initialAgent: any | null) {
  const baseNodes = restoreNodesWithIcons(normalizeNodes(deepClone(defaultNodes), initialAgent))
  const base = {
    nodes: baseNodes,
    edges: normalizeEdges(deepClone(defaultEdges))
  }

  return base
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T
  }

  if (value && typeof value === 'object') {
    const cloned: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const current = (value as Record<string, unknown>)[key]
      cloned[key] =
        typeof current === 'function' || typeof current === 'symbol'
          ? current
          : deepClone(current as any)
    }
    return cloned as T
  }

  return value
}

export function normalizeEdges(edges: Edge[]): Edge[] {
  return edges.map((edge) => {
    const isToolEdge = edge.sourceHandle === 'tools' || edge.className === 'tool-edge-no-arrow'

    return {
      ...edge,
      type: 'default',
      className: isToolEdge ? 'tool-edge-no-arrow' : edge.className,
      style: edge.style ?? (isToolEdge
        ? { stroke: '#666', strokeWidth: 2, strokeDasharray: '5, 5' }
        : { stroke: '#666', strokeWidth: 2 }),
      markerEnd: isToolEdge ? undefined : (edge.markerEnd ?? { type: 'arrowclosed', color: '#666' })
    }
  })
}

export function normalizeNodes(nodes: Node[], initialAgent?: any | null): Node[] {
  return nodes.map((node) => {
    if (node.data?.nodeType === 'start' || node.type === 'start' || node.id === 'start' || node.id === '1') {
      return {
        ...node,
        data: {
          ...node.data,
          accessMode: node.data?.accessMode || initialAgent?.accessMode || 'public'
        }
      }
    }

    if (isIfElseNode(node)) {
      const conditions =
        Array.isArray(node.data?.conditions) && node.data.conditions.length
          ? ensureElseBlock(node.data.conditions)
          : defaultConditions()
      return {
        ...node,
        type: 'ifElse',
        data: {
          ...node.data,
          label: node.data?.label || 'If / else',
          nodeType: 'branch',
          conditions
        }
      }
    }
    if (node.type === 'ifelse') {
      return {
        ...node,
        type: 'ifElse'
      }
    }
    if (node.type === 'tool' && !node.data?.icon) {
      if (node.data?.toolType === 'mcp') {
        return {
          ...node,
          data: {
            ...node.data,
            icon: MCPLogo
          }
        }
      }
    }
    return node
  })
}

function isIfElseNode(node: Node) {
  return node.type === 'ifElse' || node.type === 'ifelse' || node.data?.label === 'If / else'
}

function defaultConditions() {
  return [
    { id: 'if-0', type: 'if', caseName: '', condition: '' },
    { id: 'else', type: 'else', caseName: '', condition: '' }
  ]
}

function ensureElseBlock(list: any[]) {
  const filtered = list.filter((cond) => cond?.type !== 'else')
  const elseBlock = list.find((cond) => cond?.type === 'else') || { id: 'else', type: 'else', caseName: '', condition: '' }
  return [...filtered, elseBlock]
}
