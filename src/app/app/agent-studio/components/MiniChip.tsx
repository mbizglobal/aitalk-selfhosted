'use client'

import { memo } from 'react'
import { getNodeTypeEmoji, getNodeTypeColor } from '../utils/analyzeDependencies'

interface MiniChipProps {
  nodeId: string
  nodeName: string
  nodeType: string
  onClick?: () => void
}

export const MiniChip = memo(({ nodeId, nodeName, nodeType, onClick }: MiniChipProps) => {
  const emoji = getNodeTypeEmoji(nodeType)
  const colorClass = getNodeTypeColor(nodeType)

  const displayName = nodeName.length > 12 ? nodeName.substring(0, 10) + '...' : nodeName

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className={`
        inline-flex items-center gap-1 px-1.5 py-0.5
        text-xs rounded border cursor-pointer
        transition-all duration-150
        hover:scale-105 hover:shadow-sm
        ${colorClass}
      `}
      title={`${nodeName} (${nodeType})\nClick to focus`}
    >
      <span className="text-[10px]">{emoji}</span>
      <span className="truncate max-w-[80px]">{displayName}</span>
    </button>
  )
})

MiniChip.displayName = 'MiniChip'
