'use client'

import React from 'react'
import { RotateCcw, Coffee, Plus, Trash2, Info } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
  max: number
  defaultMessage: string
}

type BreakItem = NonNullable<CalendarAdvancedSettings['breakTimes']>[number]

const HHMM_RE = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/

function isValidHHMM(v: string): boolean {
  return HHMM_RE.test(v)
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10))
  return h * 60 + m
}

export function BreakTimesSection({ draft, update, onReset, max, defaultMessage }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const breaks: BreakItem[] = draft.breakTimes ?? []

  const setBreaks = (next: BreakItem[]) => {
    update({ breakTimes: next })
  }

  const addBreak = () => {
    if (breaks.length >= max) return
    const last = breaks[breaks.length - 1]
    const start = last && isValidHHMM(last.end) ? last.end : '14:00'
    const endMin = Math.min(toMinutes(start) + 60, 23 * 60 + 59)
    const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
    setBreaks([...breaks, { start, end, message: defaultMessage }])
  }

  const updateBreak = (index: number, patch: Partial<BreakItem>) => {
    const next = breaks.map((b, i) => (i === index ? { ...b, ...patch } : b))
    setBreaks(next)
  }

  const removeBreak = (index: number) => {
    setBreaks(breaks.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
            ☕ {t.cal_adv_break_title || 'Break Times'}
          </h3>
          <p className="text-xs text-gray-500">
            {(t.cal_adv_break_desc ||
              'Define daily time windows when no bookings should be accepted (e.g. lunch break). The AI will refuse slots inside these windows with your message. Up to {max} entries.'
            ).replace('{max}', String(max))}
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

      {/* Empty state */}
      {breaks.length === 0 && (
        <div className="p-6 rounded border border-dashed border-[#3A3A3A] bg-[#1a1a1a] text-center">
          <Coffee className="w-6 h-6 text-gray-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400 mb-3">
            {t.cal_adv_break_empty || 'No break times defined — bookings are accepted throughout working hours.'}
          </p>
          <button
            type="button"
            onClick={addBreak}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-teal-700 bg-teal-900/20 text-teal-300 hover:bg-teal-900/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.cal_adv_break_add_first || 'Add a break'}
          </button>
        </div>
      )}

      {/* Break list */}
      {breaks.length > 0 && (
        <div className="space-y-3">
          {breaks.map((b, i) => {
            const startOk = isValidHHMM(b.start)
            const endOk = isValidHHMM(b.end)
            const rangeOk = startOk && endOk && toMinutes(b.start) < toMinutes(b.end)
            return (
              <div
                key={i}
                className="p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] space-y-3"
              >
                {/* Header: index + delete */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium text-gray-200">
                      {(t.cal_adv_break_item_label || 'Break {n}').replace('{n}', String(i + 1))}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeBreak(i)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
                    title={t.cal_adv_break_remove || 'Remove this break'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t.cal_adv_break_remove || 'Remove'}
                  </button>
                </div>

                {/* Time range */}
                <div className="flex items-end gap-3">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">
                      {t.cal_adv_break_from || 'From'}
                    </label>
                    <input
                      type="time"
                      value={b.start}
                      onChange={(e) => updateBreak(i, { start: e.target.value })}
                      className={`w-full bg-[#1e1e2e] border rounded px-3 py-2 text-sm text-gray-200 ${
                        startOk ? 'border-gray-700' : 'border-red-700'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">
                      {t.cal_adv_break_to || 'To'}
                    </label>
                    <input
                      type="time"
                      value={b.end}
                      onChange={(e) => updateBreak(i, { end: e.target.value })}
                      className={`w-full bg-[#1e1e2e] border rounded px-3 py-2 text-sm text-gray-200 ${
                        endOk && rangeOk ? 'border-gray-700' : 'border-red-700'
                      }`}
                    />
                  </div>
                </div>
                {!rangeOk && (
                  <p className="text-xs text-red-400">
                    {t.cal_adv_break_range_invalid ||
                      'End time must be after start time (same day).'}
                  </p>
                )}

                {/* Message */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    {t.cal_adv_break_message_label || 'Refusal message (spoken by the AI)'}
                  </label>
                  <textarea
                    value={b.message}
                    onChange={(e) => updateBreak(i, { message: e.target.value })}
                    rows={2}
                    placeholder={defaultMessage}
                    className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 resize-y"
                  />
                </div>
              </div>
            )
          })}

          {/* Add button */}
          {breaks.length < max ? (
            <button
              type="button"
              onClick={addBreak}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded border border-dashed border-[#3A3A3A] text-gray-400 hover:border-teal-700 hover:text-teal-300 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {(t.cal_adv_break_add_more || 'Add break ({count}/{max})')
                .replace('{count}', String(breaks.length))
                .replace('{max}', String(max))}
            </button>
          ) : (
            <p className="text-xs text-gray-500 text-center">
              {(t.cal_adv_break_max_reached || 'Maximum {max} breaks reached.').replace(
                '{max}',
                String(max)
              )}
            </p>
          )}
        </div>
      )}

      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 rounded border border-emerald-800/40 bg-emerald-900/10">
        <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-300 leading-relaxed">
          {t.cal_adv_break_active_note ||
            'Break times are interpreted in the calendar\'s timezone. They apply every day within working hours — weekly/one-off exceptions will be added in a future release. UI only for now — booking-time enforcement ships in a follow-up.'}
        </p>
      </div>
    </div>
  )
}
