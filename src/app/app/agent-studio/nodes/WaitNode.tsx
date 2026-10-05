'use client'

import { memo, useState, useRef, useEffect } from 'react'
import { NodeProps, Handle, Position, useNodes } from 'reactflow'

export const WaitNode = memo(({ data, selected, id }: NodeProps) => {
  const nodes = useNodes()
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(data.label || 'Wait')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleLabelSave = () => {
    const newLabel = editLabel.trim() || 'Wait'
    setEditLabel(newLabel)
    setIsEditing(false)
    if (data.onLabelChange) {
      data.onLabelChange(id, newLabel)
    }
  }

  const IconComponent = data.icon && typeof data.icon === 'function' ? data.icon : null

  const waitMessage = data.waitMessage || 'Waiting for user input...'

  const isLoopTool = data.isLoopTool || false

  const hasIfElseInLoop = isLoopTool && nodes.some(node =>
    node.data?.isLoopTool && node.type === 'ifElse'
  )

  const handleRightPosition = selected ? '-5.5px' : '-5px'
  const handleLeftPosition = selected ? '-4.5px' : '-4px'

  if (isLoopTool) {
    return (
      <div className="relative">
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-orange-400 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            top: '-3px',
            left: '50%',
            transform: 'translateX(-50%)',
            border: '1px solid white'
          }}
        />

        <div className={`bg-[#2A2A2A] border-2 ${selected ? 'border-orange-500 shadow-orange-500/50' : 'border-[#3A3A3A]'} rounded-xl shadow-lg hover:shadow-xl transition-all px-4 py-2`}>
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${data.color || 'bg-orange-400'}`}>
              {IconComponent && <IconComponent className="w-4 h-4 text-white" />}
            </div>
            <span className="text-sm font-medium text-white">{data.label || 'Wait'}</span>
          </div>
        </div>

        {hasIfElseInLoop && (
          <Handle
            type="target"
            position={Position.Bottom}
            id="bottom"
            className="!bg-yellow-500 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
            style={{
              width: '10px',
              height: '6px',
              borderRadius: '2px',
              bottom: '-2px',
              left: '50%',
              transform: 'translateX(-50%)',
              border: '1px solid white'
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className={`relative bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : 'border-[#3A3A3A]'} rounded-xl shadow-lg hover:shadow-xl transition-all min-w-[180px] max-w-[280px]`}>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-gray-400 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
        style={{
          width: '6px',
          height: '10px',
          borderRadius: '2px',
          top: '50%',
          left: handleLeftPosition,
        }}
      />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#3A3A3A]">
        <div className={`p-1.5 rounded-lg ${data.color || 'bg-orange-400'}`}>
          {IconComponent && <IconComponent className="w-4 h-4 text-white" />}
        </div>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={handleLabelSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLabelSave()
              if (e.key === 'Escape') {
                setEditLabel(data.label || 'Wait')
                setIsEditing(false)
              }
            }}
            className="text-sm font-medium text-white bg-transparent border-b border-orange-500 outline-none flex-1"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="text-sm font-medium text-white cursor-text"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
            }}
          >
            {data.label || 'Wait'}
          </span>
        )}
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="px-2 py-1.5 bg-[#3A3A3A]/50 rounded">
          <div className="text-xs text-gray-400 mb-1">Message:</div>
          <div className="text-xs text-gray-200 break-words line-clamp-2">
            {waitMessage}
          </div>
        </div>

        <div className="flex justify-between items-center text-[10px] text-gray-500 pt-1">
          <span className="flex items-center gap-1">
            <span className="text-orange-400">⏸</span>
            <span>Paused</span>
          </span>
          <span className="flex items-center gap-1">
            <span>Resume</span>
            <span className="text-green-400">→</span>
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="resume"
        className="before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          top: '50%',
          right: handleRightPosition,
          background: '#10B981',
          border: '1px solid white',
          boxShadow: 'none',
        }}
      />
    </div>
  )
})

WaitNode.displayName = 'WaitNode'
