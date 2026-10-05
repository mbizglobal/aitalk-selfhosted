'use client'

import React from 'react'
import { RotateCcw, Info } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
}

export function VisitorIdentitySection({ draft, update, onReset }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const on = draft.storeVisitorIdentity === true

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1">
            🪪 {t.cal_adv_visitor_identity || 'Visitor Identity'}
            <span className="ml-2 text-xs font-normal text-gray-500">({t.cal_adv_visitor_identity_scope || 'Web Voice only'})</span>
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_visitor_identity_desc ||
              'Phone calls are already identified by caller number. For browser voice calls, you can also store a visitor ID on the browser to recognize returning visitors.'}
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

      <label className="flex items-start gap-3 p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] cursor-pointer">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => update({ storeVisitorIdentity: e.target.checked })}
          className="mt-0.5 rounded border-[#3A3A3A] bg-[#1F1F1F]"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-200">
            {t.cal_adv_visitor_identity_toggle || 'Store a visitor ID on their browser'}
          </div>
          <div className="text-xs text-gray-500 mt-1 leading-relaxed">
            {on
              ? (t.cal_adv_visitor_identity_on_hint ||
                 'An anonymous ID is saved in the browser on aitalk.ch. When the same visitor calls again, the AI can greet them back by name and skip re-asking their phone/email. Past bookings on this device are reachable for modify/cancel requests.')
              : (t.cal_adv_visitor_identity_off_hint ||
                 'Every web voice call is treated as a brand-new visitor. No identifier is stored. Most privacy-friendly option.')}
          </div>
        </div>
      </label>

      <div className="flex items-start gap-2 p-3 rounded border border-blue-900/40 bg-blue-900/10">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-200 leading-relaxed">
          {t.cal_adv_visitor_identity_gdpr_note ||
            'Turning this ON may require a cookie / tracking-consent banner on your website under GDPR / CCPA. The ID stays on your customer\'s browser only — it can be cleared anytime.'}
        </p>
      </div>
    </div>
  )
}
