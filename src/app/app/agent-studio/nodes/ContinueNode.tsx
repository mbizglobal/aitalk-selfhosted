'use client'

import { memo, useState, useRef, useEffect } from 'react'
import { NodeProps, Handle, Position, useNodes } from 'reactflow'
import { RotateCw } from 'lucide-react'

export const ContinueNode = memo(({ data, selected, id }: NodeProps) => {
  const IconComponent = data.icon || RotateCw
  const isLoopTool = data.isLoopTool || false
  const nodes = useNodes()
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(data.label || 'Continue')
  const inputRef = useRef<HTMLInputElement>(null)

  const hasIfElseInLoop = isLoopTool && nodes.some(node =>
    node.data?.isLoopTool && node.type === 'ifElse'
  )

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleLabelSave = () => {
    const newLabel = editLabel.trim() || 'Continue'
    setEditLabel(newLabel)
    setIsEditing(false)
    if (data.onLabelChange) {
      data.onLabelChange(id, newLabel)
    }
  }

  return (
    <div className="relative">
      {isLoopTool && (
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
      )}

      <div className={`px-3 py-2 bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : 'border-[#3A3A3A]'} rounded-xl shadow-lg hover:shadow-xl transition-all`}>
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded ${data.color || 'bg-green-500'} flex-shrink-0`}>
            <IconComponent className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col flex-1">
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
                    setEditLabel(data.label || 'Continue')
                    setIsEditing(false)
                  }
                }}
                className="text-sm font-medium text-gray-200 bg-transparent border-b border-green-500 outline-none w-full"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div
                className="text-sm font-medium text-gray-200 whitespace-nowrap cursor-text"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setIsEditing(true)
                }}
              >
                {data.label || 'Continue'}
              </div>
            )}
            <div className="text-xs text-gray-400 mt-0.5">
              Skip to next iteration
            </div>
          </div>
        </div>
      </div>

      {isLoopTool && hasIfElseInLoop && (
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
})

ContinueNode.displayName = 'ContinueNode'
