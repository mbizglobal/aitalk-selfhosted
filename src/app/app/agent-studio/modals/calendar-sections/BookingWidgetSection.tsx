'use client'

import React, { useState } from 'react'
import { RotateCcw, Copy, Check, ExternalLink, AlertTriangle } from 'lucide-react'
import type { CalendarAdvancedSettings } from '../CalendarAdvancedSettingsModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { copyToClipboard } from '../../utils'

interface Props {
  draft: CalendarAdvancedSettings
  update: (patch: Partial<CalendarAdvancedSettings>) => void
  onReset: () => void
  agentId: string
  otherCalendarHasWidget: boolean
}

export const BOOKING_WIDGET_DEFAULTS = { title: '', defaultLang: '' as '' | 'en' | 'de' | 'fr' | 'ko', address: '', email: '', emailConfirm: false, confirmTtlMin: 30 as 15 | 30 | 60, onlineMaxParty: 0, hourlyLimit: 20 }

export function BookingWidgetSection({ draft, update, onReset, agentId, otherCalendarHasWidget }: Props) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const [copied, setCopied] = useState<string | null>(null)

  const ch = draft.enabledChannels ?? { pstn: true, webVoice: true, chatWidget: true, test: true }
  const enabled = ch.bookingWidget === true
  const bw = { ...BOOKING_WIDGET_DEFAULTS, ...(draft.bookingWidget ?? {}) }
  const setBw = (patch: Partial<typeof bw>) => update({ bookingWidget: { ...bw, ...patch } })

  const takesParty = draft.capacityMode === 'simple' || draft.capacityMode === 'tables'
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.aitalk.ch'
  const pageUrl = `${origin}/book/${agentId}`
  const embedCode = `<script src="${origin}/booking.min.js" data-agent-id="${agentId}" async></script>`

  const copy = async (value: string, key: string) => {
    if (await copyToClipboard(value)) {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    }
  }

  const box = 'w-full px-3 py-2 rounded border border-[#3A3A3A] bg-[#1F1F1F] text-sm text-gray-200'
  const selectBox = 'w-56 px-3 py-2 rounded border border-[#3A3A3A] bg-[#1F1F1F] text-sm text-gray-200'
  const calMax =
    draft.capacityMode === 'simple'
      ? Math.max(1, Math.floor(Number(draft.simpleCapacity) || 1))
      : Math.max(0, ...(draft.tableInventory ?? []).filter((tt) => tt.count > 0).map((tt) => tt.capacity))
  const autoMax = Math.min(calMax || 20, 20)
  const partyOptions = Array.from({ length: Math.min(Math.max(50, bw.onlineMaxParty || 0), 100) }, (_, i) => i + 1)
  const overCalendar = calMax > 0 && bw.onlineMaxParty > calMax
  const hourlyOptions = Array.from(new Set([5, 10, 20, 30, 50, 100, 200, bw.hourlyLimit])).sort((a, b) => a - b)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100 mb-1">🗓️ {t.cal_adv_bw_title || 'Booking widget'}</h3>
          <p className="text-xs text-gray-500">
            {t.cal_adv_bw_desc || 'A booking form guests use on your website (guests → date → time → contact). It uses the same rules as phone and chat bookings.'}
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
          checked={enabled}
          onChange={(e) => update({ enabledChannels: { ...ch, bookingWidget: e.target.checked } })}
          className="mt-0.5 rounded border-[#3A3A3A] bg-[#1F1F1F]"
        />
        <div>
          <div className="text-sm font-medium text-gray-200">{t.cal_adv_bw_enable || 'Turn on the booking widget'}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {t.cal_adv_bw_enable_desc || 'Works only when the workflow is deployed (production) and public. Each booking uses 5 CPA.'}
          </div>
        </div>
      </label>

      {enabled && otherCalendarHasWidget && (
        <div className="flex items-start gap-2 p-3 rounded border border-amber-800/40 bg-amber-900/10">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300 leading-relaxed">
            {t.cal_adv_bw_multi_warning || 'Another calendar in this workflow also has the booking widget on. For now the widget works with one calendar only — turn it off on the others.'}
          </p>
        </div>
      )}

      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-gray-400">{t.cal_adv_bw_name || 'Name shown on the widget'}</span>
          <input
            className={`${box} mt-1`}
            value={bw.title}
            maxLength={80}
            autoComplete="off"
            placeholder={t.cal_adv_bw_name_ph || 'Empty = agent name'}
            onChange={(e) => setBw({ title: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">{t.cal_adv_bw_lang || 'Default language'}</span>
          <select
            className={`${selectBox} mt-1`}
            value={bw.defaultLang}
            onChange={(e) => {
              const v = e.target.value
              setBw({ defaultLang: v === 'en' || v === 'de' || v === 'fr' || v === 'ko' ? v : '' })
            }}
          >
            <option value="">{t.cal_adv_bw_lang_auto || 'Auto (workflow language, else your account language)'}</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
            <option value="ko">한국어</option>
          </select>
          <span className="block text-xs text-gray-500 mt-1">
            {t.cal_adv_bw_lang_desc || 'The language the widget opens in. Guests can switch between EN · DE · FR · KO at the top right.'}
          </span>
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">{t.cal_adv_bw_address || 'Address (shown next to the form on wide screens)'}</span>
          <input
            className={`${box} mt-1`}
            value={bw.address}
            maxLength={160}
            autoComplete="off"
            placeholder={t.cal_adv_bw_address_ph || 'Street and number, postcode, city'}
            onChange={(e) => setBw({ address: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">{t.cal_adv_bw_email || 'Contact email (shown next to the form)'}</span>
          <input
            className={`${box} mt-1`}
            type="email"
            value={bw.email}
            maxLength={120}
            autoComplete="off"
            placeholder="contact@example.ch"
            onChange={(e) => setBw({ email: e.target.value })}
          />
        </label>

        {takesParty && (
          <label className="block">
            <span className="text-xs text-gray-400">{t.cal_adv_bw_max_party || 'Largest group bookable online'}</span>
            <select
              className={`${selectBox} mt-1`}
              value={bw.onlineMaxParty > 0 ? bw.onlineMaxParty : 0}
              onChange={(e) => setBw({ onlineMaxParty: Number(e.target.value) })}
            >
              <option value={0}>{(t.cal_adv_bw_max_party_auto_n || 'Auto (up to {n})').replace('{n}', String(autoMax))}</option>
              {partyOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            {overCalendar && (
              <span className="flex items-start gap-1.5 text-xs text-amber-300 mt-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {(t.cal_adv_bw_max_party_over || 'This calendar seats at most {n} per booking (largest table or total seats). Groups over {n} have no place to sit, so guests are asked to call you.').replace(/\{n\}/g, String(calMax))}
              </span>
            )}
            <span className="block text-xs text-gray-500 mt-1">
              {t.cal_adv_bw_max_party_desc || 'Bigger groups see “please call us” instead. Auto = up to your largest table or total seats (max 20). Tables are assigned automatically: the smallest table that fits.'}
            </span>
          </label>
        )}

        <label className="block">
          <span className="text-xs text-gray-400">{t.cal_adv_bw_limit || 'Max online bookings per hour'}</span>
          <select
            className={`${selectBox} mt-1`}
            value={bw.hourlyLimit}
            onChange={(e) => setBw({ hourlyLimit: Number(e.target.value) })}
          >
            {hourlyOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span className="block text-xs text-gray-500 mt-1">
            {t.cal_adv_bw_limit_desc || 'Stops fake bookings from filling your calendar. Attempts above this number in one hour are refused.'}
          </span>
        </label>

        <div className="p-3 rounded border border-[#3A3A3A] bg-[#1a1a1a] space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={bw.emailConfirm}
              onChange={(e) => setBw({ emailConfirm: e.target.checked })}
              className="mt-0.5 rounded border-[#3A3A3A] bg-[#1F1F1F]"
            />
            <div>
              <div className="text-sm font-medium text-gray-200">{t.cal_adv_bw_confirm || 'Confirm by email link'}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {t.cal_adv_bw_confirm_desc || 'Guests get an email and click the link to confirm. Stronger against fake bookings; the time is not held until they click.'}
              </div>
            </div>
          </label>
          {bw.emailConfirm && (
            <label className="flex items-center gap-2 pl-7 text-xs text-gray-400">
              {t.cal_adv_bw_confirm_ttl || 'Link valid for'}
              <select
                value={bw.confirmTtlMin}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setBw({ confirmTtlMin: n === 15 || n === 60 ? n : 30 })
                }}
                className="px-2 py-1 rounded border border-[#3A3A3A] bg-[#1F1F1F] text-gray-200"
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-gray-400">{t.cal_adv_bw_link || 'Booking page link'}</div>
          <div className="flex gap-2">
            <input className={box} readOnly value={pageUrl} />
            <button type="button" onClick={() => copy(pageUrl, 'url')} className="px-3 rounded border border-[#3A3A3A] text-gray-300 hover:text-white" title="Copy">
              {copied === 'url' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
            <a href={pageUrl} target="_blank" rel="noreferrer" className="px-3 flex items-center rounded border border-[#3A3A3A] text-gray-300 hover:text-white" title="Open">
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
          <div className="text-xs text-gray-400 pt-2">{t.cal_adv_bw_code || 'Code for your website'}</div>
          <div className="flex gap-2">
            <textarea className={`${box} font-mono text-xs min-h-[60px]`} readOnly value={embedCode} />
            <button type="button" onClick={() => copy(embedCode, 'code')} className="px-3 rounded border border-[#3A3A3A] text-gray-300 hover:text-white self-start py-2" title="Copy">
              {copied === 'code' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {t.cal_adv_bw_code_desc || 'Paste it where the form should appear. Add data-lang="de" to fix the language; otherwise the page language is used.'}
          </p>
        </div>
      </div>
    </div>
  )
}
