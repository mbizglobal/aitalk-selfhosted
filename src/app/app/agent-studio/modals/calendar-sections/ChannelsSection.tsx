'use client'

import React from 'react'
import { RotateCcw, AlertTriangle } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
}

export function ChannelsSection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const ch = draft.enabledChannels ?? { pstn: true, webVoice: true, chatWidget: true, test: true }
  const isOn = (key: keyof typeof ch) => (key === 'bookingWidget' ? ch.bookingWidget === true : ch[key] !== false)

  const set = (key: keyof NonNullable<CalendarAdvancedSettings['enabledChannels']>, val: boolean) => {
    update({ enabledChannels: { ...ch, [key]: val } })
  }

  const testOff = ch.test === false

  const rows: Array<{ key: keyof typeof ch; title: string; desc: string }> = [
    { key: 'pstn', title: t.cal_adv_ch_pstn || 'PSTN (Phone Call)', desc: t.cal_adv_ch_pstn_desc || 'Inbound phone calls handled by the voice AI.' },
    { key: 'webVoice', title: t.cal_adv_ch_web_voice || 'Web Voice (Browser Call)', desc: t.cal_adv_ch_web_voice_desc || 'Browser calls from embedded voice buttons on customer websites.' },
    { key: 'chatWidget', title: t.cal_adv_ch_chat_widget || 'Chat Widget (Chatbot)', desc: t.cal_adv_ch_chat_widget_desc || 'Text-based chat embedded on customer websites.' },
    { key: 'test', title: t.cal_adv_ch_test || 'Agent Studio Test', desc: t.cal_adv_ch_test_desc || 'Playground and header Test buttons in Agent Studio. Keep ON to validate flows before deploying.' },
    { key: 'bookingWidget', title: t.cal_adv_ch_booking_widget || 'Booking widget (website form)', desc: t.cal_adv_ch_booking_widget_desc || 'A booking form on your website — no AI. Off by default; see the Booking widget section for the link and code.' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1">
            📡 {t.cal_adv_channels || 'Channels'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_channels_desc || 'Select which channels can use calendar booking. By default the feature is available everywhere.'}
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
        {rows.map(({ key, title, desc }) => (
          <label
            key={key}
            className="flex items-start gap-3 p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] hover:border-[#4A4A4A] transition-colors cursor-pointer"
          >
            <input
              type="checkbox"
              checked={isOn(key)}
              onChange={(e) => set(key, e.target.checked)}
              className="mt-0.5 rounded border-[#3A3A3A] bg-[#1F1F1F]"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-200">{title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
            </div>
          </label>
        ))}
      </div>

      {testOff && (
        <div className="flex items-start gap-2 p-3 rounded border border-amber-800/40 bg-amber-900/10">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300 leading-relaxed">
            {t.cal_adv_ch_test_warning || 'Turning this OFF disables calendar booking in Agent Studio Test and Playground. Turn back ON to test flows during development.'}
          </p>
        </div>
      )}
    </div>
  )
}
