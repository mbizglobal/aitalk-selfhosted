'use client'

import { memo, useRef, useCallback } from 'react'
import React from 'react'
import { NodeProps, useReactFlow } from 'reactflow'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

export const NoteNode = memo(({ id, data, selected }: NodeProps) => {
  const { setNodes, getNode, getViewport } = useReactFlow()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const backgroundColor = data.backgroundColor || '#fef3c7'
  const noteText = data.noteText || ''
  const width = data.width || 200
  const height = data.height || 150
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null)

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, noteText: e.target.value } }
          : node
      )
    )
  }

  const handleResizeStart = useCallback((e: React.MouseEvent, corner: string) => {
    e.stopPropagation()
    e.preventDefault()

    const node = getNode(id)
    if (!node) return

    const startWidth = node.data?.width || 200
    const startHeight = node.data?.height || 150

    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth,
      startHeight
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return

      const { zoom } = getViewport()
      const deltaX = (moveEvent.clientX - resizeRef.current.startX) / zoom
      const deltaY = (moveEvent.clientY - resizeRef.current.startY) / zoom

      let newWidth = resizeRef.current.startWidth
      let newHeight = resizeRef.current.startHeight

      if (corner.includes('e')) newWidth = Math.max(100, resizeRef.current.startWidth + deltaX)
      if (corner.includes('w')) newWidth = Math.max(100, resizeRef.current.startWidth - deltaX)
      if (corner.includes('s')) newHeight = Math.max(80, resizeRef.current.startHeight + deltaY)
      if (corner.includes('n')) newHeight = Math.max(80, resizeRef.current.startHeight - deltaY)

      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, width: newWidth, height: newHeight } }
            : node
        )
      )
    }

    const handleMouseUp = () => {
      resizeRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [id, getNode, setNodes, getViewport])

  return (
    <div
      className={`relative rounded-md shadow-md hover:shadow-lg transition-all border-t-[6px] border-l-2 border-r-2 border-b-2 ${selected ? 'border-green-500 shadow-green-500/50' : 'border-gray-400'}`}
      style={{
        backgroundColor,
        width,
        height,
      }}
    >
      <textarea
        value={noteText}
        onChange={handleTextChange}
        placeholder={t.note_placeholder}
        className="nodrag px-4 py-4 text-sm text-black bg-transparent border-none outline-none resize-none leading-relaxed"
        style={{
          fontFamily: 'ui-sans-serif, system-ui',
          width: '100%',
          height: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      />

      {selected && (
        <>
          <div
            className="nodrag absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-se-resize z-50"
            onMouseDown={(e) => handleResizeStart(e, 'se')}
          />
          <div
            className="nodrag absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-sw-resize z-50"
            onMouseDown={(e) => handleResizeStart(e, 'sw')}
          />
          <div
            className="nodrag absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-ne-resize z-50"
            onMouseDown={(e) => handleResizeStart(e, 'ne')}
          />
          <div
            className="nodrag absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-nw-resize z-50"
            onMouseDown={(e) => handleResizeStart(e, 'nw')}
          />

          <div
            className="nodrag absolute top-1/2 -right-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-e-resize z-50 -translate-y-1/2"
            onMouseDown={(e) => handleResizeStart(e, 'e')}
          />
          <div
            className="nodrag absolute top-1/2 -left-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-w-resize z-50 -translate-y-1/2"
            onMouseDown={(e) => handleResizeStart(e, 'w')}
          />
          <div
            className="nodrag absolute -bottom-1.5 left-1/2 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-s-resize z-50 -translate-x-1/2"
            onMouseDown={(e) => handleResizeStart(e, 's')}
          />
          <div
            className="nodrag absolute -top-1.5 left-1/2 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-n-resize z-50 -translate-x-1/2"
            onMouseDown={(e) => handleResizeStart(e, 'n')}
          />
        </>
      )}
    </div>
  )
})

NoteNode.displayName = 'NoteNode'
