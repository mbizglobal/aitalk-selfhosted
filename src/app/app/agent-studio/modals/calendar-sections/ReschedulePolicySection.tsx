'use client'

import React from 'react'
import { RotateCcw, RefreshCw, Info } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
}

const CUTOFF_OPTIONS = [
  { hours: 1, labelKey: 'cal_adv_cancel_1h', fallback: '1 hour before appointment' },
  { hours: 6, labelKey: 'cal_adv_cancel_6h', fallback: '6 hours before appointment' },
  { hours: 12, labelKey: 'cal_adv_cancel_12h', fallback: '12 hours before appointment' },
  { hours: 24, labelKey: 'cal_adv_cancel_24h', fallback: '24 hours before appointment' },
  { hours: 48, labelKey: 'cal_adv_cancel_48h', fallback: '2 days before appointment' },
  { hours: 72, labelKey: 'cal_adv_cancel_72h', fallback: '3 days before appointment' },
  { hours: 96, labelKey: 'cal_adv_cancel_96h', fallback: '4 days before appointment' },
  { hours: 120, labelKey: 'cal_adv_cancel_120h', fallback: '5 days before appointment' },
]

export function ReschedulePolicySection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const policy = draft.reschedulePolicy ?? {
    enabled: false,
    cutoffHours: 24,
    refuseMessage: '',
  }

  const setField = <K extends keyof NonNullable<CalendarAdvancedSettings['reschedulePolicy']>>(
    key: K,
    val: NonNullable<CalendarAdvancedSettings['reschedulePolicy']>[K]
  ) => {
    update({ reschedulePolicy: { ...policy, [key]: val } })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
            🔄 {t.cal_adv_reschedule_title || 'Reschedule Policy'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_reschedule_desc ||
              'Set how close to the current appointment the AI can still move it to a new time. Keeping reschedules open longer than cancellations often reduces no-shows.'}
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

      {/* Enable toggle */}
      <label className="flex items-start gap-3 p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] cursor-pointer">
        <input
          type="checkbox"
          checked={policy.enabled === true}
          onChange={(e) => setField('enabled', e.target.checked)}
          className="mt-0.5 rounded border-[#3A3A3A] bg-[#1F1F1F]"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-200">
            {t.cal_adv_reschedule_enable || 'Enable reschedule policy'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {policy.enabled
              ? (t.cal_adv_reschedule_on_hint || 'Active — reschedule requests within the cutoff window will be refused by the AI.')
              : (t.cal_adv_reschedule_off_hint || 'Off — any future appointment can be rescheduled (independent of cancellation policy).')}
          </div>
        </div>
      </label>

      <div className={policy.enabled ? '' : 'opacity-50 pointer-events-none'}>
        {/* Cutoff window */}
        <div>
          <label className="block text-sm font-medium text-gray-200 mb-2">
            <RefreshCw className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            {t.cal_adv_reschedule_cutoff || 'Reschedule cutoff'}
          </label>
          <select
            value={policy.cutoffHours ?? 24}
            onChange={(e) => setField('cutoffHours', Number(e.target.value))}
            disabled={!policy.enabled}
            className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
          >
            {CUTOFF_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {t[o.labelKey] || o.fallback}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-2">
            {t.cal_adv_reschedule_cutoff_hint ||
              'Reschedule requests arriving within this window before the CURRENT appointment time will be refused.'}
          </p>
        </div>

        {/* Refuse message */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-200 mb-2">
            {t.cal_adv_reschedule_refuse_label || 'Refusal message (spoken by the AI)'}
          </label>
          <textarea
            value={policy.refuseMessage ?? ''}
            onChange={(e) => setField('refuseMessage', e.target.value)}
            disabled={!policy.enabled}
            rows={3}
            placeholder={t.cal_adv_reschedule_refuse_placeholder ||
              'e.g. I\'m sorry, appointments cannot be rescheduled within 24 hours of the scheduled time.'}
            className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 resize-y"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t.cal_adv_reschedule_refuse_hint ||
              'Use natural spoken language — avoid markdown, asterisks, or lists. The AI will paraphrase in the caller\'s language if needed.'}
          </p>
        </div>
      </div>

      {/* Info banner — separation note */}
      <div className="flex items-start gap-2 p-3 rounded border border-emerald-800/40 bg-emerald-900/10">
        <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-300 leading-relaxed">
          {t.cal_adv_reschedule_separation_note ||
            'This policy is independent of the cancellation policy. Common setup: keep reschedule cutoff shorter (e.g. 12h) than cancellation cutoff (e.g. 24h) so customers can move an appointment instead of cancelling outright.'}
        </p>
      </div>
    </div>
  )
}
