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

export function CallerQuestionsSection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const value = draft.bookingQuestions ?? ''
  const askMessage = draft.askBookingMessage === true
  const defaultPrompt = t.cal_adv_msg_prompt_default || "Is there anything you'd like to tell us? If not, we'll skip it."

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1">
            💬 {t.cal_adv_caller_questions || 'Caller Questions'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_caller_questions_desc || 'What the AI will ask the caller when booking an appointment.'}
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
          {t.calendar_booking_questions || 'Questions to Ask Caller'}
        </label>
        <textarea
          value={value}
          onChange={(e) => update({ bookingQuestions: e.target.value })}
          placeholder={t.calendar_booking_questions_placeholder ||
            'e.g. Full name, phone number, reason for visit, first-time or returning patient'}
          rows={6}
          className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 resize-y"
        />
        <p className="text-xs text-gray-500 mt-2">
          {t.calendar_booking_questions_hint ||
            'The AI will ask exactly these and nothing else. Leave empty to let the AI decide.'}
        </p>
      </div>

      <label className="flex items-start gap-3 p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] cursor-pointer">
        <input
          type="checkbox"
          checked={askMessage}
          onChange={(e) =>
            update({
              askBookingMessage: e.target.checked,
              ...(e.target.checked && !(draft.bookingMessagePrompt ?? '').trim() ? { bookingMessagePrompt: defaultPrompt } : {}),
            })
          }
          className="mt-0.5 rounded border-[#3A3A3A] bg-[#1F1F1F]"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-200">
            {t.cal_adv_msg_toggle || 'Ask for an optional message'}
          </div>
          <div className="text-xs text-gray-500 mt-1 leading-relaxed">
            {t.cal_adv_msg_desc ||
              'After the booking is saved, the AI asks once whether the caller wants to leave a message. It is added to the booking and can be read back or changed later. Phone, web voice and chat.'}
          </div>
        </div>
      </label>

      {askMessage && (
        <div>
          <label className="block text-sm font-medium text-gray-200 mb-2">
            {t.cal_adv_msg_prompt_label || 'What the AI asks'}
          </label>
          <input
            type="text"
            value={draft.bookingMessagePrompt ?? ''}
            onChange={(e) => update({ bookingMessagePrompt: e.target.value })}
            placeholder={defaultPrompt}
            maxLength={200}
            autoComplete="off"
            className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600"
          />
          <p className="text-xs text-gray-500 mt-2">
            {t.cal_adv_msg_prompt_hint || "The AI says this in the caller's own language."}
          </p>
        </div>
      )}
    </div>
  )
}
