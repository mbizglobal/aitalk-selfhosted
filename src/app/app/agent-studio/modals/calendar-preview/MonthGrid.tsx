'use client'

import React from 'react'
import type { DayStatus } from '@/lib/holidays/closed-day-status'
import { DayCell } from './DayCell'
import { buildMonthGrid } from './MonthGridUtil'

interface Props {
  year: number
  month: number // 1-based
  todayYmd: string
  selectedYmd: string | null
  getDayStatus: (ymd: string) => DayStatus
  eventsByDate?: Record<string, { count: number }>
  onDayClick: (ymd: string) => void
  weekdayHeaders?: string[]
}

const DEFAULT_WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function MonthGrid({
  year,
  month,
  todayYmd,
  selectedYmd,
  getDayStatus,
  eventsByDate,
  onDayClick,
  weekdayHeaders,
}: Props) {
  const cells = buildMonthGrid(year, month, todayYmd)
  const headers = weekdayHeaders || DEFAULT_WEEKDAY_HEADERS

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1 px-1">
        {headers.map((h) => (
          <div key={h} className="text-[11px] font-medium text-gray-400 text-center py-1">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => (
          <DayCell
            key={cell.ymd}
            ymd={cell.ymd}
            dayNum={cell.dayNum}
            isCurrentMonth={cell.isCurrentMonth}
            isToday={cell.isToday}
            isSelected={selectedYmd === cell.ymd}
            status={getDayStatus(cell.ymd)}
            eventCount={eventsByDate?.[cell.ymd]?.count}
            onClick={onDayClick}
          />
        ))}
      </div>
    </div>
  )
}
