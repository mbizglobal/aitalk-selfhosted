
import type { Edge } from 'reactflow'

export function normalizeEdge(edge: Edge): Edge {
  const isToolEdge = edge.sourceHandle === 'tools' || edge.sourceHandle === 'miniapps' || edge.className === 'tool-edge-no-arrow'
  return {
    ...edge,
    type: 'default',
    className: isToolEdge ? (edge.className ?? 'tool-edge-no-arrow') : edge.className,
    style: edge.style ?? (isToolEdge
      ? { stroke: '#666', strokeWidth: 2, strokeDasharray: '5,5' }
      : { stroke: '#666', strokeWidth: 2 }),
    markerEnd: isToolEdge ? undefined : (edge.markerEnd ?? { type: 'arrowclosed', color: '#666' })
  }
}