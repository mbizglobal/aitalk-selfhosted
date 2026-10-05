'use client'

import React from 'react'
import { RotateCcw, Ban, Info, AlertTriangle } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
  staffTransferNumber?: string
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

export function CancellationPolicySection({ draft, update, onReset, staffTransferNumber }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const policy = draft.cancellationPolicy ?? {
    enabled: false,
    cutoffHours: 24,
    refuseMessage: '',
    offerTransfer: false,
    transferMessage: '',
  }

  const setField = <K extends keyof NonNullable<CalendarAdvancedSettings['cancellationPolicy']>>(
    key: K,
    val: NonNullable<CalendarAdvancedSettings['cancellationPolicy']>[K]
  ) => {
    update({ cancellationPolicy: { ...policy, [key]: val } })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
            🚫 {t.cal_adv_cancel_title || 'Cancellation Policy'}
          </h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_cancel_desc ||
              'Set how close to the appointment cancellations are still allowed. The AI will refuse late cancellations with your message.'}
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
            {t.cal_adv_cancel_enable || 'Enable cancellation policy'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {policy.enabled
              ? (t.cal_adv_cancel_on_hint || 'Active — late cancellations will be refused by the AI.')
              : (t.cal_adv_cancel_off_hint || 'Off — all cancellation requests are accepted as long as the event exists.')}
          </div>
        </div>
      </label>

      <div className={policy.enabled ? '' : 'opacity-50 pointer-events-none'}>
        {/* Cutoff window */}
        <div>
          <label className="block text-sm font-medium text-gray-200 mb-2">
            <Ban className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            {t.cal_adv_cancel_cutoff || 'Cancellation cutoff'}
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
            {t.cal_adv_cancel_cutoff_hint ||
              'Requests arriving within this window before the appointment will be refused.'}
          </p>
        </div>

        {/* Refuse message */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-200 mb-2">
            {t.cal_adv_cancel_refuse_label || 'Refusal message (spoken by the AI)'}
          </label>
          <textarea
            value={policy.refuseMessage ?? ''}
            onChange={(e) => setField('refuseMessage', e.target.value)}
            disabled={!policy.enabled}
            rows={3}
            placeholder={t.cal_adv_cancel_refuse_placeholder ||
              'e.g. I\'m sorry, appointments cannot be cancelled within 24 hours of the scheduled time.'}
            className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 resize-y"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t.cal_adv_cancel_refuse_hint ||
              'Use natural spoken language — avoid markdown, asterisks, or lists. The AI will paraphrase in the caller\'s language if needed.'}
          </p>
        </div>

        {/* Offer transfer — PSTN only */}
        <div className="mt-6 p-3 rounded border border-blue-900/40 bg-blue-900/10">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={policy.offerTransfer === true}
              onChange={(e) => setField('offerTransfer', e.target.checked)}
              disabled={!policy.enabled}
              className="mt-0.5 rounded border-[#3A3A3A] bg-[#1F1F1F]"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-200 flex items-center gap-2">
                {t.cal_adv_cancel_offer_transfer || 'Offer to transfer to staff'}
                <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#2A2A2A] text-gray-400 border border-gray-700">
                  {t.cal_adv_cancel_pstn_only || 'PSTN only'}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                {t.cal_adv_cancel_offer_transfer_hint ||
                  'When a cancellation is refused on a PSTN call, the AI will offer to connect the caller to a staff member. Requires a Staff Transfer Number in the PSTN Start node (Advanced Settings → Staff Transfer).'}
              </div>
            </div>
          </label>

          {policy.offerTransfer && (
            <>
              {!staffTransferNumber?.trim() && (
                <div className="mt-3 ml-6 p-3 rounded border border-red-800/50 bg-red-900/15 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300 leading-relaxed">
                    {t.cal_adv_cancel_staff_missing ||
                      'Staff transfer number is not set. Configure it in the PSTN Start node → Advanced Settings → Staff Transfer. Until then, the AI will refuse late cancellations but will NOT offer a transfer to staff.'}
                  </p>
                </div>
              )}

              <div className="mt-3 ml-6">
                <label className="block text-xs text-gray-400 mb-1">
                  {t.cal_adv_cancel_transfer_message_label || 'Transfer offer message'}
                </label>
                <textarea
                  value={policy.transferMessage ?? ''}
                  onChange={(e) => setField('transferMessage', e.target.value)}
                  disabled={!policy.enabled}
                  rows={2}
                  placeholder={t.cal_adv_cancel_transfer_message_placeholder ||
                    'e.g. Would you like me to transfer you to a staff member?'}
                  className="w-full bg-[#1e1e2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 resize-y"
                />
                {staffTransferNumber?.trim() && (
                  <p className="text-xs text-emerald-400 mt-1">
                    {(t.cal_adv_cancel_staff_ok || 'Will transfer to: {number}').replace('{number}', staffTransferNumber.trim())}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded border border-emerald-800/40 bg-emerald-900/10">
        <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-300 leading-relaxed">
          {t.cal_adv_cancel_active_note ||
            'Time-based refusal applies to all channels (PSTN, Web Voice, Chat Widget). Staff transfer offer applies to PSTN calls only.'}
        </p>
      </div>
    </div>
  )
}
