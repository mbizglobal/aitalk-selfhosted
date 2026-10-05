'use client'

import { memo, useState, useRef, useEffect } from 'react'
import { NodeProps, Handle, Position } from 'reactflow'

let globalAddLoopToolsHandler: ((whileNodeId: string) => void) | null = null

export function setGlobalAddLoopToolsHandler(handler: ((whileNodeId: string) => void) | null) {
  globalAddLoopToolsHandler = handler
}

export const WhileNode = memo(({ data, selected, id }: NodeProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(data.label || 'While Loop')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleLabelSave = () => {
    const newLabel = editLabel.trim() || 'While Loop'
    setEditLabel(newLabel)
    setIsEditing(false)
    if (data.onLabelChange) {
      data.onLabelChange(id, newLabel)
    }
  }

  const IconComponent = data.icon && typeof data.icon === 'function' ? data.icon : null

  const maxIterations = data.maxIterations || 10
  const conditionMode = data.conditionMode || 'simple'
  const conditionField = data.conditionField || ''
  const conditionOperator = data.conditionOperator || '=='
  const conditionValue = data.conditionValue !== undefined ? data.conditionValue : ''
  const customExpression = data.customExpression || ''
  const conditionLogic = data.conditionLogic || 'all'
  const conditions = data.conditions || []

  let conditionDisplay = ''
  if (conditionMode === 'simple') {
    if (conditionField) {
      const valueStr = typeof conditionValue === 'string'
        ? `"${conditionValue}"`
        : conditionValue
      conditionDisplay = `${conditionField} ${conditionOperator} ${valueStr}`
    } else {
      conditionDisplay = '""'
    }
  } else if (conditionMode === 'builder') {
    if (conditions.length > 0) {
      const logic = conditionLogic === 'all' ? ' && ' : ' || '
      conditionDisplay = conditions
        .map((c: any) => {
          const valueStr = typeof c.value === 'string' ? `"${c.value}"` : c.value
          return `${c.field} ${c.operator} ${valueStr}`
        })
        .join(logic)
    } else {
      conditionDisplay = '""'
    }
  } else if (conditionMode === 'advanced') {
    conditionDisplay = customExpression || '""'
  }

  const handleRightPosition = selected ? '-5.5px' : '-5px'
  const handleLeftPosition = selected ? '-4.5px' : '-4px'

  return (
    <div className={`relative bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : 'border-[#3A3A3A]'} rounded-xl shadow-lg hover:shadow-xl transition-all w-[180px]`}>
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
        <div className={`p-1.5 rounded-lg ${data.color}`}>
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
                setEditLabel(data.label || 'While Loop')
                setIsEditing(false)
              }
            }}
            className="text-sm font-medium text-white bg-transparent border-b border-purple-500 outline-none flex-1"
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

      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Max iterations:</span>
          <span className="text-gray-200 font-mono">{maxIterations}</span>
        </div>

        <div className="px-2 py-1.5 bg-[#3A3A3A]/50 rounded">
          <div className="text-xs text-gray-400 mb-1">Condition:</div>
          <div className="text-xs text-gray-200 font-mono truncate" title={conditionDisplay}>
            {conditionDisplay}
          </div>
        </div>

        <div className="flex justify-between items-center text-[10px] text-gray-500 pt-1">
          <span className="flex items-center gap-1">
            <span className="text-orange-400">↓</span>
            <span>Loop</span>
          </span>
          <span className="flex items-center gap-1">
            <span>Exit</span>
            <span className="text-green-400">→</span>
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="exit"
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

      <div
        className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center"
        style={{ bottom: '-14px' }}
      >
        <Handle
          type="source"
          position={Position.Bottom}
          id="loop"
          className="!bg-orange-500 before:content-[''] before:absolute before:inset-[-4px] before:bg-transparent !relative !left-0 !bottom-0 !transform-none"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            border: '1px solid white'
          }}
        />

        <div
          className="border-l border-orange-500"
          style={{ height: '8px', width: '1px' }}
        />

        <div
          className="flex items-center justify-center w-3 h-3 bg-[#1F2937] border border-[#F59E0B] rounded text-[#FCD34D] hover:bg-[#78350F] hover:border-[#FBBF24] hover:text-white transition-colors cursor-pointer"
          style={{
            fontSize: '8px',
            lineHeight: '1',
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20
          }}
          title="Add loop connection"
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
          onClick={(e) => {
            e.stopPropagation()
            const addLoopToolsHandler = data.onAddLoopTools || globalAddLoopToolsHandler
            addLoopToolsHandler?.(id)
          }}
        >
          +
        </div>
      </div>
    </div>
  )
})

WhileNode.displayName = 'WhileNode'
