'use client'

import React from 'react'
import { EdgeProps, getBezierPath, MarkerType } from 'reactflow'

export const DefaultEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd,
  selected,
}) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const arrowSize = selected ? 10.5 : 10

  return (
    <>
      <defs>
        <marker
          id={`arrow-${id}`}
          markerWidth={arrowSize}
          markerHeight={arrowSize}
          refX="6"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M0,2 L0,8 L7,5 z"
            fill={style?.stroke || '#666'}
          />
        </marker>
      </defs>
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
            stroke: '#666',
            strokeWidth: 2,
            fill: 'none',
            ...style
          }}
          className="react-flow__edge-path"
          d={edgePath}
          markerEnd={`url(#arrow-${id})`}
        />
      </g>
    </>
  )
}