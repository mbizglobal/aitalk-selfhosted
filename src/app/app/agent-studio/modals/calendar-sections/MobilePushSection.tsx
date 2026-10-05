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
}

export function MobilePushSection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const rows: Array<{ key: 'notifyOnBook' | 'notifyOnReschedule' | 'notifyOnCancel'; label: string }> = [
    { key: 'notifyOnBook', label: t.cal_adv_push_on_book || 'Booking created' },
    { key: 'notifyOnReschedule', label: t.cal_adv_push_on_reschedule || 'Booking rescheduled' },
    { key: 'notifyOnCancel', label: t.cal_adv_push_on_cancel || 'Booking cancelled' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1">
            🔔 {t.cal_adv_push_title || 'Mobile notifications'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_push_desc ||
              'Send a push notification to the account owner’s mobile app when a booking happens. Tapping it opens the calendar in the app.'}
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

      <div className="space-y-2">
        {rows.map((r) => (
          <label
            key={r.key}
            className="flex items-center gap-3 p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] cursor-pointer"
          >
            <input
              type="checkbox"
              checked={draft[r.key] === true}
              onChange={(e) => update({ [r.key]: e.target.checked })}
              className="rounded border-[#3A3A3A] bg-[#1F1F1F]"
            />
            <div className="text-sm font-medium text-gray-200">{r.label}</div>
          </label>
        ))}
      </div>

      <p className="text-xs text-gray-500 leading-relaxed">
        {t.cal_adv_push_hint ||
          'Notifications are sent only to owners who have installed the mobile app and enabled notifications. Customers are not notified here.'}
      </p>
    </div>
  )
}
