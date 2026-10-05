'use client'

import { memo, useState, useRef, useEffect } from 'react'
import { NodeProps, Handle, Position, useEdges, useNodes } from 'reactflow'
import { Database, Settings } from 'lucide-react'

export const DataSheetsNode = memo(({ data, selected, id }: NodeProps) => {
  const edges = useEdges()
  const nodes = useNodes()
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(data.label || 'Data Sheets')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleTopOffset = '-3px'

  const isLoopTool = data.isLoopTool || false

  const isConnectedAsToolTarget = isLoopTool || edges.some(edge =>
    edge.target === id && (edge.sourceHandle === 'tools' || edge.sourceHandle === 'loop' || edge.sourceHandle === 'loopTools')
  )

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
    const newLabel = editLabel.trim() || 'Data Sheets'
    setEditLabel(newLabel)
    setIsEditing(false)
    if (data.onLabelChange) {
      data.onLabelChange(id, newLabel)
    }
  }

  const sheetName = data.sheetName || null
  const operation = data.operation || 'read' // read, insert, update, delete

  const operationLabels: Record<string, string> = {
    read: 'Read',
    insert: 'Insert',
    'batch-insert': 'Batch Insert',
    update: 'Update',
    delete: 'Delete',
    upsert: 'Upsert',
    increment: 'Increment'
  }

  return (
    <div className={`px-3 py-2 bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : 'border-[#5A5A5A]'} rounded-xl shadow-lg hover:shadow-xl transition-all min-w-[160px]`}>
      {isConnectedAsToolTarget && (
        <Handle
          type="target"
          position={Position.Top}
          id="top"
          className="!bg-orange-400 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            top: handleTopOffset,
            border: '1px solid white'
          }}
        />
      )}

      {!isConnectedAsToolTarget && (
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          className="!bg-indigo-500 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            left: '-4px',
          }}
        />
      )}

      <div className="flex items-center gap-2.5">
        <div className="p-2 rounded bg-indigo-500 flex-shrink-0">
          <Database className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col">
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
                  setEditLabel(data.label || 'Data Sheets')
                  setIsEditing(false)
                }
              }}
              className="text-sm font-medium text-gray-200 bg-transparent border-b border-indigo-500 outline-none w-full"
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
              {data.label || 'Data Sheets'}
            </div>
          )}
          {sheetName && (
            <div className="text-xs text-gray-400 mt-0.5">
              {sheetName}
            </div>
          )}
          {operation && (
            <div className="text-xs text-indigo-400 mt-0.5">
              {operationLabels[operation] || operation}
            </div>
          )}
        </div>
      </div>

      {!isConnectedAsToolTarget && (
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className="!bg-indigo-500 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            right: '-4px',
          }}
        />
      )}

      {selected && (
        <button
          className="absolute top-1 right-1 p-1 hover:bg-gray-700 rounded"
          onClick={(e) => {
            e.stopPropagation()
            if (data.onSettingsClick) {
              data.onSettingsClick(id)
            }
          }}
        >
          <Settings className="w-3 h-3 text-gray-400" />
        </button>
      )}

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

DataSheetsNode.displayName = 'DataSheetsNode'
