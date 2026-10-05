'use client'

import { memo, useState, useRef, useEffect } from 'react'
import { NodeProps, Handle, Position } from 'reactflow'
import { Workflow } from 'lucide-react'

const defaultConditions = [{ id: 'if-0', type: 'if', condition: '', caseName: '' }]

export const IfElseNode = memo(({ data, selected, id }: NodeProps) => {
  const isValidIcon = data.icon && typeof data.icon === 'function'
  const IconComponent = isValidIcon ? data.icon : Workflow
  const nodeColor = data.color || 'bg-orange-500'
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(data.label || 'If / Else')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleLabelSave = () => {
    const newLabel = editLabel.trim() || 'If / Else'
    setEditLabel(newLabel)
    setIsEditing(false)
    if (data.onLabelChange) {
      data.onLabelChange(id, newLabel)
    }
  }

  const isLoopTool = data.isLoopTool || false

  const rawConditions = Array.isArray(data.conditions) && data.conditions.length ? data.conditions : defaultConditions
  const branchConditions = rawConditions.filter((cond: any) => cond.type !== 'else')
  const hasElse = rawConditions.some((cond: any) => cond.type === 'else')

  const lineHeight = 28
  const lineGap = 4 // space-y-1 = 4px
  const headerHeight = 41
  const contentPaddingY = 11

  const handleRightPosition = selected ? '-5.5px' : '-5px'
  const handleLeftPosition = selected ? '-4.5px' : '-4px'

  return (
    <div className={`relative bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : 'border-[#3A3A3A]'} rounded-xl shadow-lg hover:shadow-xl transition-all w-[180px]`}>
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
            border: '1px solid white'
          }}
        />
      )}

      {!isLoopTool && (
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
      )}

      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#3A3A3A]">
        <div className={`p-1.5 rounded-lg ${nodeColor}`}>
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
                setEditLabel(data.label || 'If / Else')
                setIsEditing(false)
              }
            }}
            className="text-sm font-medium text-white bg-transparent border-b border-yellow-500 outline-none flex-1"
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
            {data.label}
          </span>
        )}
      </div>

      <div className="px-3 py-2 space-y-1">
        {branchConditions.map((cond: any, index: number) => {
          const displayText = cond.caseName || cond.condition || '(empty)'

          return (
            <div
              key={cond.id}
              className="flex items-center px-2 py-1 bg-[#3A3A3A]/50 rounded text-xs text-gray-300 font-mono leading-5"
              style={{ height: '28px' }}
              title={displayText}
            >
              <span className="truncate block w-full">{displayText}</span>
            </div>
          )
        })}

        {hasElse && (
          <div className="flex items-center text-xs text-gray-400 leading-5 pt-1" style={{ height: '20px' }}>
            Else
          </div>
        )}
      </div>

      {branchConditions.map((cond: any, index: number) => {
        const topPosition = headerHeight + contentPaddingY + (index * (lineHeight + lineGap)) + (lineHeight / 2)

        return (
          <Handle
            key={cond.id}
            type="source"
            position={Position.Right}
            id={cond.id}
            className="before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              top: `${topPosition}px`,
              right: handleRightPosition,
              background: '#9CA3AF',
              border: '1px solid white',
              boxShadow: 'none',
            }}
          />
        )
      })}

      {hasElse && (
        <Handle
          type="source"
          position={Position.Right}
          id="else"
          className="before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            top: `${headerHeight + contentPaddingY + (branchConditions.length * (lineHeight + lineGap)) + lineGap + 4 + 10}px`,
            right: handleRightPosition,
            background: '#9CA3AF',
            border: '1px solid white',
            boxShadow: 'none',
          }}
        />
      )}
    </div>
  )
})

IfElseNode.displayName = 'IfElseNode'
