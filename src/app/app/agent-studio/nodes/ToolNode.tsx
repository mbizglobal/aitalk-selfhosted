'use client'

import { memo, useMemo } from 'react'
import { NodeProps, Handle, Position, useEdges, useNodes } from 'reactflow'
import { generateNodeSummary } from '../utils/generateNodeSummary'

export const ToolNode = memo(({ data, selected, id }: NodeProps) => {
  const IconComponent = data.icon
  const isLoopTool = data.isLoopTool === true
  const edges = useEdges()
  const handleTopOffset = '-3px'

  const summary = useMemo(() => {
    return generateNodeSummary('tool', data)
  }, [data])

  const isConnectedToAI = edges.some(edge =>
    edge.target === id && edge.sourceHandle === 'tools'
  )
  const isConnectedAsMiniApp = edges.some(edge =>
    edge.target === id && edge.sourceHandle === 'miniapps'
  )

  const handleColor = isLoopTool ? '!bg-orange-400'
    : isConnectedAsMiniApp ? '!bg-purple-500'
    : isConnectedToAI ? '!bg-blue-500'
    : '!bg-gray-400'

  return (
    <div className="relative">
      <div className={`px-3 py-2 bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : 'border-[#5A5A5A]'} rounded-xl shadow-lg hover:shadow-xl transition-all`}>
        <Handle
          type="target"
          position={Position.Top}
          className={`${handleColor} before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent`}
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            top: handleTopOffset,
            border: isLoopTool ? '1px solid white' : undefined
          }}
        />
        <div className="flex items-center gap-2.5">
          {IconComponent && (
            <div className={`p-2 rounded ${data.color || 'bg-purple-500'} flex-shrink-0`}>
              <IconComponent className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-200 whitespace-nowrap">
              {data.label}
            </div>
            {summary && (
              <div className="text-xs text-gray-500 truncate max-w-[150px] mt-0.5" title={summary}>
                {summary}
              </div>
            )}
          </div>
        </div>
      </div>


    </div>
  )
})

ToolNode.displayName = 'ToolNode'