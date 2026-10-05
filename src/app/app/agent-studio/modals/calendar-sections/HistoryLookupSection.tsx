'use client'

import React from 'react'
import { RotateCcw, Clock } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
}

export function HistoryLookupSection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const days = draft.historyLookupDays ?? 90

  const options: Array<{ value: number; label: string }> = [
    { value: 30, label: t.cal_adv_hist_30 || 'Last 30 days' },
    { value: 60, label: t.cal_adv_hist_60 || 'Last 60 days' },
    { value: 90, label: t.cal_adv_hist_90 || 'Last 90 days' },
    { value: 200, label: t.cal_adv_hist_200 || 'Last 200 days (~6 months)' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
            🕑 {t.cal_adv_history_lookup || 'History Lookup'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_history_lookup_desc ||
              'When a returning caller wants to modify or cancel a booking, how far back should the AI search their past appointments?'}
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
          <Clock className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          {t.cal_adv_history_lookup_window || 'Lookup window'}
        </label>
        <select
          value={days}
          onChange={(e) => update({ historyLookupDays: Number(e.target.value) })}
          className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-2">
          {t.cal_adv_history_lookup_hint ||
            'Shorter windows are faster and reduce false matches. Longer windows catch annual or rare appointments. Default 90 days.'}
        </p>
      </div>

      <div className="flex items-start gap-2 p-3 rounded border border-emerald-800/40 bg-emerald-900/10">
        <Clock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-300 leading-relaxed">
          {t.cal_adv_history_lookup_active ||
            'Active — the AI can now look up a caller\'s existing appointments via the lookup_appointments function. Useful for "When is my next appointment?" or reschedule/cancel requests.'}
        </p>
      </div>
    </div>
  )
}
