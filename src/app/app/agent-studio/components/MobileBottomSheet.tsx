'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

interface MobileBottomSheetProps {
  isOpen: boolean
  onClose: () => void
  onDelete?: () => void
  deleteConfirmMessage?: string
  title?: string
  children: React.ReactNode
  height?: 'small' | 'medium' | 'large' | 'full'
  showHandle?: boolean
  showHeader?: boolean
  className?: string
}

const heightMap = {
  small: '30vh',
  medium: '50vh',
  large: '70vh',
  full: '90vh'
}

export function MobileBottomSheet({
  isOpen,
  onClose,
  onDelete,
  deleteConfirmMessage = 'Delete this node?',
  title,
  children,
  height = 'medium',
  showHandle = true,
  showHeader = true,
  className = ''
}: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const [currentHeight, setCurrentHeight] = useState(height)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const initialHeight = useRef(0)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const handleDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    setIsDragging(true)
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    dragStartY.current = clientY
    if (sheetRef.current) {
      initialHeight.current = sheetRef.current.getBoundingClientRect().height
    }
  }, [])

  const handleDragMove = useCallback((e: TouchEvent | MouseEvent) => {
    if (!isDragging || !sheetRef.current) return

    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const deltaY = dragStartY.current - clientY
    const newHeight = initialHeight.current + deltaY
    const windowHeight = window.innerHeight
    const heightPercent = (newHeight / windowHeight) * 100

    if (heightPercent >= 20 && heightPercent <= 90) {
      sheetRef.current.style.height = `${heightPercent}vh`
    }

    if (heightPercent < 15) {
      onClose()
    }
  }, [isDragging, onClose])

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('touchmove', handleDragMove)
      document.addEventListener('mousemove', handleDragMove)
      document.addEventListener('touchend', handleDragEnd)
      document.addEventListener('mouseup', handleDragEnd)
    }

    return () => {
      document.removeEventListener('touchmove', handleDragMove)
      document.removeEventListener('mousemove', handleDragMove)
      document.removeEventListener('touchend', handleDragEnd)
      document.removeEventListener('mouseup', handleDragEnd)
    }
  }, [isDragging, handleDragMove, handleDragEnd])

  const toggleHeight = useCallback(() => {
    setCurrentHeight(prev => prev === 'medium' ? 'large' : 'medium')
  }, [])

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 bg-[#1A1A1A] rounded-t-2xl z-50
          transform transition-transform duration-300 ease-out flex flex-col
          ${isOpen ? 'translate-y-0' : 'translate-y-full'}
          ${className}`}
        style={{
          height: heightMap[currentHeight],
          maxHeight: '90vh'
        }}
      >
        {showHandle && (
          <div
            className="flex-shrink-0 flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
            onTouchStart={handleDragStart}
            onMouseDown={handleDragStart}
          >
            <div className="w-12 h-1 bg-gray-600 rounded-full" />
          </div>
        )}

        {showHeader && (
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-[#3A3A3A]">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <div className="flex items-center gap-1">
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (confirm(deleteConfirmMessage)) {
                      onDelete()
                    }
                  }}
                  className="p-2 hover:bg-red-500/20 active:bg-red-500/30 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              )}
              <button
                onClick={toggleHeight}
                className="p-1.5 hover:bg-[#3A3A3A] rounded-lg transition-colors"
              >
                {currentHeight === 'large' ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onCloseRef.current()
                }}
                className="p-2.5 -mr-1 hover:bg-[#3A3A3A] active:bg-[#4A4A4A] rounded-lg transition-colors z-[60]"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>
        )}

        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {children}
        </div>
      </div>
    </>
  )
}
