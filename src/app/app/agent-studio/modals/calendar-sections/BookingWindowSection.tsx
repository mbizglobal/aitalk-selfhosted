'use client'

import React from 'react'
import { RotateCcw, CalendarClock } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
}

export function BookingWindowSection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const days = draft.bookingWindowDays ?? 90

  const options: Array<{ value: number; label: string }> = [
    { value: 30, label: t.cal_adv_bw_30 || 'Next 30 days' },
    { value: 60, label: t.cal_adv_bw_60 || 'Next 60 days' },
    { value: 90, label: t.cal_adv_bw_90 || 'Next 90 days' },
    { value: 200, label: t.cal_adv_bw_200 || 'Next 200 days (~6 months)' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
            📅 {t.cal_adv_booking_window || 'Booking Window'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_booking_window_desc ||
              'How far into the future can callers book an appointment? Blocks misunderstood far-future dates (e.g. caller says "two years from now" by mistake).'}
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

      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
          <CalendarClock className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          {t.cal_adv_booking_window_range || 'Maximum advance booking'}
        </label>
        <select
          value={days}
          onChange={(e) => update({ bookingWindowDays: Number(e.target.value) })}
          className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-2">
          {t.cal_adv_booking_window_hint ||
            'Anything beyond this window will be politely refused by the AI. Match this to your real scheduling horizon — 30 days for salons, 90 days for most clinics, 200 days for practices with semi-annual checkups.'}
        </p>
      </div>

      <div className="flex items-start gap-2 p-3 rounded border border-emerald-800/40 bg-emerald-900/10">
        <CalendarClock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-300 leading-relaxed">
          {t.cal_adv_booking_window_active ||
            'Active — the AI will refuse any booking beyond this window. The caller will hear a polite request to suggest a closer date.'}
        </p>
      </div>
    </div>
  )
}
