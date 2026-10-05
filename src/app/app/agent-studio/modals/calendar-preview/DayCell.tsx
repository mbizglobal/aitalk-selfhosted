'use client'

import React from 'react'
import type { DayStatus } from '@/lib/holidays/closed-day-status'

interface Props {
  ymd: string
  dayNum: number
  isCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  status: DayStatus
  eventCount?: number
  onClick: (ymd: string) => void
}

export function DayCell({
  ymd,
  dayNum,
  isCurrentMonth,
  isToday,
  isSelected,
  status,
  eventCount,
  onClick,
}: Props) {
  const styling = stylingForStatus(status, !!eventCount)
  const opacity = isCurrentMonth ? '' : 'opacity-40'
  const ring = isSelected
    ? 'ring-2 ring-teal-400'
    : isToday
      ? 'ring-1 ring-teal-500/60'
      : ''

  return (
    <button
      type="button"
      onClick={() => onClick(ymd)}
      className={`relative flex flex-col items-start justify-start gap-0.5 p-1.5 rounded border min-h-[60px] text-left transition-colors ${styling.bg} ${styling.border} hover:bg-opacity-80 ${ring} ${opacity}`}
    >
      <div className="flex items-center justify-between w-full">
        <span className={`text-xs font-medium ${styling.text}`}>{dayNum}</span>
        {styling.icon}
      </div>
      {eventCount && eventCount > 0 ? (
        <span className="text-[10px] font-semibold text-blue-300 bg-blue-500/20 rounded px-1">
          {eventCount}
        </span>
      ) : null}
      {styling.label && (
        <span className={`text-[10px] leading-tight ${styling.text} truncate w-full`}>
          {styling.label}
        </span>
      )}
    </button>
  )
}

function stylingForStatus(status: DayStatus, hasEvents: boolean): {
  bg: string
  border: string
  text: string
  icon: React.ReactNode | null
  label?: string
} {
  switch (status.kind) {
    case 'holiday':
      return {
        bg: 'bg-red-500/15',
        border: 'border-red-500/40',
        text: 'text-red-200',
        icon: <span className="text-xs">🎉</span>,
        label: status.name,
      }
    case 'range':
      return {
        bg: 'bg-purple-500/15',
        border: 'border-purple-500/40',
        text: 'text-purple-200',
        icon: <span className="text-xs">✈️</span>,
        label: status.name,
      }
    case 'weekly':
      return {
        bg: 'bg-gray-500/20',
        border: 'border-gray-500/40',
        text: 'text-gray-400',
        icon: <span className="text-xs">🚫</span>,
      }
    case 'partial':
      return {
        bg: 'bg-yellow-500/15',
        border: 'border-yellow-500/40',
        text: 'text-yellow-200',
        icon: <span className="text-xs">🟡</span>,
        label: `${status.openStart}–${status.openEnd}`,
      }
    case 'open':
    default:
      return {
        bg: hasEvents ? 'bg-blue-500/10' : 'bg-[#1a1a1a]',
        border: hasEvents ? 'border-blue-500/30' : 'border-[#3A3A3A]',
        text: 'text-gray-300',
        icon: null,
      }
  }
}
