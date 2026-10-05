'use client'

import React from 'react'
import { RotateCcw } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
  workingHoursEnd: string
}

const OPTIONS = [15, 30, 45, 60, 90]

function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}
function toHhmm(min: number): string {
  const t = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function LastCallSection({ draft, update, onReset, workingHoursEnd }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const close = typeof draft.lastCallMin === 'number' && draft.lastCallMin > 0 ? draft.lastCallMin : 0
  const brk = typeof draft.lastCallBreakMin === 'number' && draft.lastCallBreakMin > 0 ? draft.lastCallBreakMin : 0

  const duration = draft.capacityMode === 'tables' ? Number(draft.mealDurationMin) || 90 : Number(draft.defaultDurationMin) || 30
  const endRaw = toMin(workingHoursEnd || '18:00')
  const closeAt = endRaw === 0 ? 1440 : endRaw
  const breakStarts = (draft.breakTimes ?? []).map((b) => toMin(b.start)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  const hasBreak = breakStarts.length > 0
  const breakAt = hasBreak ? breakStarts[0] : NaN

  const select = (value: number, onChange: (n: number) => void) => (
    <select
      className="mt-1 w-72 px-3 py-2 rounded border border-[#3A3A3A] bg-[#1F1F1F] text-sm text-gray-200"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    >
      <option value={0}>{t.cal_adv_lastcall_off || 'Off — the whole booking must end in time'}</option>
      {OPTIONS.map((n) => (
        <option key={n} value={n}>{(t.cal_adv_lastcall_opt || '{n} minutes before').replace('{n}', String(n))}</option>
      ))}
    </select>
  )

  const example = (endMin: number, n: number) => {
    if (!Number.isFinite(endMin)) return ''
    const last = n ? endMin - n : endMin - duration
    const stay = n ? Math.min(n, duration) : duration
    return (t.cal_adv_lastcall_example || 'Ends {end}, each booking {dur} min → last booking {last}, staying until {until} ({stay} min).')
      .replace('{end}', toHhmm(endMin))
      .replace('{dur}', String(duration))
      .replace('{last}', toHhmm(last))
      .replace('{until}', toHhmm(Math.min(last + duration, endMin)))
      .replace('{stay}', String(stay))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1">⏰ {t.cal_adv_lastcall_title || 'Last booking time'}</h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_lastcall_desc || 'How close to closing you still accept bookings. Late guests get a shorter stay — their booking ends at closing.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-amber-300 transition-colors shrink-0"
          title={t.cal_adv_reset_section_hint || 'Reset this section to defaults'}
        >
          <RotateCcw className="w-3 h-3" />
          {t.cal_adv_reset_button || 'Reset'}
        </button>
      </div>

      {hasBreak && (
        <div className="space-y-1">
          <label className="block">
            <span className="text-xs text-gray-400">{t.cal_adv_lastcall_break_label || 'Before the break (e.g. lunch)'}</span>
            {select(brk, (n) => update({ lastCallBreakMin: n }))}
          </label>
          <p className="text-xs text-gray-500">{example(breakAt, brk)}</p>
        </div>
      )}

      <div className="space-y-1">
        <label className="block">
          <span className="text-xs text-gray-400">
            {hasBreak ? t.cal_adv_lastcall_close_label || 'Before closing (e.g. dinner)' : t.cal_adv_lastcall_label || 'Accept bookings until (before closing)'}
          </span>
          {select(close, (n) => update({ lastCallMin: n }))}
        </label>
        <p className="text-xs text-gray-500">{example(closeAt, close)}</p>
      </div>

      <p className="text-xs text-gray-500">
        {t.cal_adv_lastcall_channels || 'Phone, chat and the booking widget all follow this. Off = the whole booking must end in time (as before).'}
      </p>
    </div>
  )
}
