'use client'

import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  year: number
  month: number // 1-based
  onChange: (year: number, month: number) => void
  onToday: () => void
  todayLabel?: string
}

export function MonthNav({ year, month, onChange, onToday, todayLabel }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const prev = () => {
    const total = year * 12 + (month - 1) - 1
    onChange(Math.floor(total / 12), (total % 12) + 1)
  }
  const next = () => {
    const total = year * 12 + (month - 1) + 1
    onChange(Math.floor(total / 12), (total % 12) + 1)
  }

  const label = (() => {
    try {
      const fmt = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' })
      return fmt.format(new Date(Date.UTC(year, month - 1, 15)))
    } catch {
      return `${year}-${String(month).padStart(2, '0')}`
    }
  })()

  return (
    <div className="flex items-center justify-between gap-2 px-1 py-2">
      <button
        type="button"
        onClick={prev}
        className="p-1.5 rounded hover:bg-[#2A2A2A] text-gray-300"
        aria-label={t.cal_preview_prev_month || 'Previous month'}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-200">{label}</span>
        <button
          type="button"
          onClick={onToday}
          className="px-2 py-0.5 text-xs rounded border border-[#3A3A3A] text-gray-300 hover:bg-[#2A2A2A]"
        >
          {todayLabel || t.cal_preview_today || 'Today'}
        </button>
      </div>
      <button
        type="button"
        onClick={next}
        className="p-1.5 rounded hover:bg-[#2A2A2A] text-gray-300"
        aria-label={t.cal_preview_next_month || 'Next month'}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}
