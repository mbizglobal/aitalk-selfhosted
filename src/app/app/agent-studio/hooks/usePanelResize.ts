import { useState, useEffect } from 'react'
import type { PanelSizeState } from '../types'

export function usePanelResize() {
  const [panelSize, setPanelSize] = useState<PanelSizeState>({
    height: 45, // 45% of viewport height
    chatWidth: 34,
    stepsWidth: 22,
    detailsWidth: 22,
    isDraggingHeight: false,
    isDraggingChatWidth: false,
    isDraggingStepsWidth: false,
    isDraggingDetailsWidth: false
  })

  useEffect(() => {
    if (
      !panelSize.isDraggingHeight &&
      !panelSize.isDraggingChatWidth &&
      !panelSize.isDraggingStepsWidth &&
      !panelSize.isDraggingDetailsWidth
    ) {
      return
    }

    const handleMouseMove = (event: MouseEvent) => {
      setPanelSize(prev => {
        let next = { ...prev }

        if (prev.isDraggingHeight) {
          const windowHeight = window.innerHeight
          const newHeightPercent = ((windowHeight - event.clientY) / windowHeight) * 100
          next.height = Math.min(Math.max(20, newHeightPercent), 80)
        }

        if (prev.isDraggingChatWidth) {
          const containerWidth = window.innerWidth
          const newWidth = (event.clientX / containerWidth) * 100
          next.chatWidth = Math.min(Math.max(20, newWidth), 50)
        }

        if (prev.isDraggingStepsWidth) {
          const containerWidth = window.innerWidth
          const chatWidthPx = (prev.chatWidth / 100) * containerWidth
          const newStepsWidth = ((event.clientX - chatWidthPx) / containerWidth) * 100
          next.stepsWidth = Math.min(Math.max(10, newStepsWidth), 30)
        }

        if (prev.isDraggingDetailsWidth) {
          const containerWidth = window.innerWidth
          const chatWidthPx = (prev.chatWidth / 100) * containerWidth
          const stepsWidthPx = (prev.stepsWidth / 100) * containerWidth
          const newDetailsWidth = ((event.clientX - chatWidthPx - stepsWidthPx) / containerWidth) * 100
          next.detailsWidth = Math.min(Math.max(10, newDetailsWidth), 40)
        }

        return next
      })
    }

    const handleMouseUp = () => {
      setPanelSize(prev => ({
        ...prev,
        isDraggingHeight: false,
        isDraggingChatWidth: false,
        isDraggingStepsWidth: false,
        isDraggingDetailsWidth: false
      }))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    panelSize.isDraggingHeight,
    panelSize.isDraggingChatWidth,
    panelSize.isDraggingStepsWidth,
    panelSize.isDraggingDetailsWidth,
    panelSize.chatWidth,
    panelSize.stepsWidth
  ])

  return { panelSize, setPanelSize }
}
