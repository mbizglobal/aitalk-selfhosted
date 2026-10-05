'use client'

import React from 'react'
import { EdgeProps, getBezierPath } from 'reactflow'

export const LoopEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <g className="react-flow__edge">
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={15}
        className="react-flow__edge-interaction"
      />
      <path
        id={id}
        style={{
          stroke: '#F59E0B',
          strokeWidth: 2,
          strokeDasharray: '5, 5',
          fill: 'none',
          ...style
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd=""
      />
    </g>
  )
}