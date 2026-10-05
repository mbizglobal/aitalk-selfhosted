'use client'

import React from 'react'
import { CalendarOff, RotateCcw } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
}

type WeeklyCfg = NonNullable<CalendarAdvancedSettings['weeklyClosedDays']>
type WeekdayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

const HHMM_RE = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/

export function WeeklyClosedDaysSection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const weekly: WeeklyCfg = draft.weeklyClosedDays ?? {}

  const setWeekday = (day: WeekdayKey, patch: Partial<NonNullable<WeeklyCfg[WeekdayKey]>>) => {
    const next: WeeklyCfg = { ...weekly }
    next[day] = { closed: false, ...next[day], ...patch }
    update({ weeklyClosedDays: next })
  }

  const togglePartial = (day: WeekdayKey, on: boolean) => {
    if (on) {
      setWeekday(day, {
        partialOpenStart: weekly[day]?.partialOpenStart || '09:00',
        partialOpenEnd: weekly[day]?.partialOpenEnd || '13:00',
      })
    } else {
      const next: WeeklyCfg = { ...weekly }
      const cur = next[day]
      if (cur) {
        const { partialOpenStart, partialOpenEnd, ...rest } = cur
        next[day] = rest
      }
      update({ weeklyClosedDays: next })
    }
  }

  const renderWeekdayRow = (day: WeekdayKey, label: string) => {
    const cfg = weekly[day]
    const closed = !!cfg?.closed
    const partialOn = closed && !!cfg?.partialOpenStart && !!cfg?.partialOpenEnd
    const startOk = !partialOn || (typeof cfg?.partialOpenStart === 'string' && HHMM_RE.test(cfg!.partialOpenStart!))
    const endOk =
      !partialOn ||
      (typeof cfg?.partialOpenEnd === 'string' &&
        HHMM_RE.test(cfg!.partialOpenEnd!) &&
        cfg!.partialOpenStart! < cfg!.partialOpenEnd!)
    return (
      <div key={day} className="p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] space-y-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={closed}
            onChange={(e) => setWeekday(day, { closed: e.target.checked })}
            className="w-4 h-4 accent-teal-500"
          />
          <span className="text-sm font-medium text-gray-200">{label}</span>
        </label>

        {closed && (
          <div className="pl-6 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={partialOn}
                onChange={(e) => togglePartial(day, e.target.checked)}
                className="w-4 h-4 accent-teal-500"
              />
              <span className="text-xs text-gray-300">
                {t.cal_adv_weekly_closed_partial_label || 'Allow partial opening hours'}
              </span>
            </label>

            {partialOn && (
              <>
                <p className="text-xs text-gray-500">
                  {t.cal_adv_weekly_closed_partial_hint ||
                    'e.g. Saturday morning 09:00–13:00. Bookings inside this range are accepted; outside is refused.'}
                </p>
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">
                      {t.cal_adv_weekly_closed_from || 'Open from'}
                    </label>
                    <input
                      type="time"
                      value={cfg?.partialOpenStart || ''}
                      onChange={(e) => setWeekday(day, { partialOpenStart: e.target.value })}
                      className={`w-full bg-[#1e1e2e] border rounded px-3 py-2 text-sm text-gray-200 ${
                        startOk ? 'border-gray-700' : 'border-red-700'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">
                      {t.cal_adv_weekly_closed_to || 'Open until'}
                    </label>
                    <input
                      type="time"
                      value={cfg?.partialOpenEnd || ''}
                      onChange={(e) => setWeekday(day, { partialOpenEnd: e.target.value })}
                      className={`w-full bg-[#1e1e2e] border rounded px-3 py-2 text-sm text-gray-200 ${
                        endOk ? 'border-gray-700' : 'border-red-700'
                      }`}
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {t.cal_adv_weekly_closed_message_label || 'Refusal message'}
              </label>
              <textarea
                value={cfg?.message || ''}
                onChange={(e) => setWeekday(day, { message: e.target.value })}
                rows={2}
                placeholder={(
                  t.cal_adv_weekly_closed_default_message ||
                  'We are closed on {weekday}. Please choose another day.'
                ).replace('{weekday}', label)}
                className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 resize-y"
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
            <CalendarOff className="w-4 h-4" />
            {t.cal_adv_weekly_closed_title || 'Weekly Closed Days'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_weekly_closed_partial_morning_hint ||
              'Useful for "morning-only" or "afternoon-only" practice days (e.g. Korean clinics with Wednesday afternoon closure).'}
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

      <div className="space-y-3">
        {renderWeekdayRow('saturday', t.cal_adv_weekday_saturday || 'Saturday')}
        {renderWeekdayRow('sunday', t.cal_adv_weekday_sunday || 'Sunday')}
        {renderWeekdayRow('monday', t.cal_adv_weekday_monday || 'Monday')}
        {renderWeekdayRow('tuesday', t.cal_adv_weekday_tuesday || 'Tuesday')}
        {renderWeekdayRow('wednesday', t.cal_adv_weekday_wednesday || 'Wednesday')}
        {renderWeekdayRow('thursday', t.cal_adv_weekday_thursday || 'Thursday')}
        {renderWeekdayRow('friday', t.cal_adv_weekday_friday || 'Friday')}
      </div>
    </div>
  )
}
