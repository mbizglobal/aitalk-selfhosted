'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

interface Position {
  x: number
  y: number
}

interface UseDraggableOptions {
  isOpen: boolean
}

interface UseDraggableReturn {
  position: Position
  isDragging: boolean
  handleDragStart: (e: React.MouseEvent) => void
  dragStyle: React.CSSProperties
}

export function useDraggable({ isOpen }: UseDraggableOptions): UseDraggableReturn {
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<Position>({ x: 0, y: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea')
    ) {
      return
    }

    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    }
  }, [position])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragStartRef.current.x
      const newY = e.clientY - dragStartRef.current.y
      setPosition({ x: newX, y: newY })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  useEffect(() => {
    if (!isOpen) {
      setPosition({ x: 0, y: 0 })
    }
  }, [isOpen])

  const dragStyle: React.CSSProperties = {
    transform: `translate(${position.x}px, ${position.y}px)`,
  }

  return {
    position,
    isDragging,
    handleDragStart,
    dragStyle,
  }
}
