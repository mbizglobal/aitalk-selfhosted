'use client'

import React, { useMemo } from 'react'
import { Plane, Plus, Trash2, RotateCcw } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
  maxClosedRanges: number
}

type ClosedRange = NonNullable<CalendarAdvancedSettings['closedRanges']>[number]

const MAX_DAYS_AHEAD = 730

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function maxDateIso(): string {
  const d = new Date(Date.now() + MAX_DAYS_AHEAD * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ClosedRangesSection({ draft, update, onReset, maxClosedRanges }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const closedRanges: ClosedRange[] = useMemo(
    () => (draft.closedRanges ?? []).slice().sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [draft.closedRanges]
  )

  const setClosedRanges = (next: ClosedRange[]) => {
    update({ closedRanges: next })
  }

  const updateAt = (index: number, patch: Partial<ClosedRange>) => {
    const next = closedRanges.map((r, i) => (i === index ? { ...r, ...patch } : r))
    setClosedRanges(next)
  }

  const removeAt = (index: number) => {
    setClosedRanges(closedRanges.filter((_, i) => i !== index))
  }

  const addRange = () => {
    if (closedRanges.length >= maxClosedRanges) return
    const start = new Date(Date.now() + 30 * 86400000)
    const end = new Date(Date.now() + 44 * 86400000)
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setClosedRanges([
      ...closedRanges,
      { startDate: fmt(start), endDate: fmt(end), name: '' },
    ])
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
            <Plane className="w-4 h-4" />
            {t.cal_adv_closed_ranges_title || 'Closed Ranges'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_closed_ranges_desc ||
              'Block bookings across a date range — useful for summer vacation, conferences, or seminar absences (commonly 2–3 weeks for senior practitioners).'}
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

      {closedRanges.length === 0 && (
        <div className="p-6 rounded border border-dashed border-[#3A3A3A] bg-[#1a1a1a] text-center">
          <Plane className="w-6 h-6 text-gray-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400 mb-3">
            {t.cal_adv_closed_ranges_empty || 'No closed ranges defined.'}
          </p>
          <button
            type="button"
            onClick={addRange}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-teal-700 bg-teal-900/20 text-teal-300 hover:bg-teal-900/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.cal_adv_closed_ranges_add_first || 'Add a closed range'}
          </button>
        </div>
      )}

      {closedRanges.length > 0 && (
        <div className="space-y-2">
          {closedRanges.map((r, i) => {
            const startOk =
              /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) &&
              r.startDate >= todayIso() &&
              r.startDate <= maxDateIso()
            const endOk =
              /^\d{4}-\d{2}-\d{2}$/.test(r.endDate) &&
              r.endDate >= r.startDate &&
              r.endDate <= maxDateIso()
            return (
              <div
                key={`${r.startDate}-${r.endDate}-${i}`}
                className="p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Plane className="w-4 h-4 text-amber-400 shrink-0" />
                  <input
                    type="text"
                    value={r.name}
                    onChange={(e) => updateAt(i, { name: e.target.value })}
                    placeholder={
                      t.cal_adv_closed_ranges_name_placeholder ||
                      'e.g. Summer vacation, Cardiology seminar in Berlin'
                    }
                    className="flex-1 min-w-0 bg-[#1e1e2e] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600"
                  />
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1"
                    title={t.cal_adv_holidays_remove || 'Remove'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[11px] text-gray-400 mb-1">
                      {t.cal_adv_closed_ranges_start_label || 'Start date'}
                    </label>
                    <input
                      type="date"
                      value={r.startDate}
                      min={todayIso()}
                      max={maxDateIso()}
                      onChange={(e) => updateAt(i, { startDate: e.target.value })}
                      className={`w-full bg-[#1e1e2e] border rounded px-2 py-1 text-xs text-gray-200 ${
                        startOk ? 'border-gray-700' : 'border-red-700'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-[11px] text-gray-400 mb-1">
                      {t.cal_adv_closed_ranges_end_label || 'End date'}
                    </label>
                    <input
                      type="date"
                      value={r.endDate}
                      min={r.startDate || todayIso()}
                      max={maxDateIso()}
                      onChange={(e) => updateAt(i, { endDate: e.target.value })}
                      className={`w-full bg-[#1e1e2e] border rounded px-2 py-1 text-xs text-gray-200 ${
                        endOk ? 'border-gray-700' : 'border-red-700'
                      }`}
                    />
                  </div>
                </div>
                {!endOk && (
                  <p className="text-[11px] text-red-400">
                    {t.cal_adv_closed_ranges_invalid ||
                      'End date must be the same as or after the start date.'}
                  </p>
                )}
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">
                    {t.cal_adv_closed_ranges_message_label || 'Refusal message (optional)'}
                  </label>
                  <textarea
                    value={r.message || ''}
                    onChange={(e) => updateAt(i, { message: e.target.value })}
                    rows={2}
                    placeholder={(t.cal_adv_closed_ranges_default_message ||
                      'We are closed from {start} to {end} ({name}). Please choose a date outside this range.')
                      .replace('{start}', r.startDate)
                      .replace('{end}', r.endDate)
                      .replace('{name}', r.name || '...')}
                    className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600 resize-y"
                  />
                </div>
              </div>
            )
          })}

          {closedRanges.length < maxClosedRanges ? (
            <button
              type="button"
              onClick={addRange}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded border border-dashed border-[#3A3A3A] text-gray-400 hover:border-teal-700 hover:text-teal-300 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {(t.cal_adv_closed_ranges_add_more || 'Add another range ({count}/{max})')
                .replace('{count}', String(closedRanges.length))
                .replace('{max}', String(maxClosedRanges))}
            </button>
          ) : (
            <p className="text-xs text-gray-500 text-center">
              {(t.cal_adv_closed_ranges_max_reached || 'Maximum {max} closed ranges reached.').replace(
                '{max}',
                String(maxClosedRanges)
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
