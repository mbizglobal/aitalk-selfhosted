'use client'

import { use, useEffect, useRef, useState } from 'react'
import { normalizeWidgetLang, WIDGET_TEXT, BCP47, type WidgetLang } from '@/lib/booking-widget/i18n'
import type { PublicBookingConfig } from '@/lib/booking-widget/public-config'

type State =
  | { kind: 'working' }
  | { kind: 'done'; start: string; partySize: number | null; email: string | null }
  | { kind: 'failed'; code: string }

export default function BookingConfirmPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const [lang, setLang] = useState<WidgetLang>('en')
  const [config, setConfig] = useState<PublicBookingConfig | null>(null)
  const [state, setState] = useState<State>({ kind: 'working' })
  const sent = useRef(false)
  const t = WIDGET_TEXT[lang]

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const forced = normalizeWidgetLang(q.get('lang'))
    if (forced) setLang(forced)
    const token = q.get('t')
    fetch(`/api/booking/${encodeURIComponent(agentId)}/config`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c) return
        setConfig(c)
        if (!forced && c.defaultLang) setLang(c.defaultLang)
      })
      .catch(() => {})
    if (sent.current) return
    sent.current = true
    const ask = (tries: number) =>
      fetch(`/api/booking/${encodeURIComponent(agentId)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j.ok && typeof j.start === 'string') setState({ kind: 'done', start: j.start, partySize: j.partySize ?? null, email: j.email ?? null })
          else if (j.code === 'busy' && tries < 20) setTimeout(() => void ask(tries + 1), 1500)
          else setState({ kind: 'failed', code: j.code === 'busy' ? 'unavailable' : j.code || 'unavailable' })
        })
        .catch(() => setState({ kind: 'failed', code: 'network' }))
    void ask(0)
  }, [agentId])

  const whenLabel = (iso: string) =>
    new Intl.DateTimeFormat(BCP47[lang], {
      timeZone: config?.timezone || 'Europe/Zurich',
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))

  return (
    <div className="flex min-h-screen items-start justify-center bg-white md:items-center">
      <div className="w-full bg-white md:w-[460px] md:rounded-2xl md:shadow-[0_8px_40px_rgba(0,0,0,0.10)]">
        <div className="px-6 pb-4 pt-7 text-center">
          <div className="text-2xl uppercase tracking-wide text-gray-700">{config?.title || ' '}</div>
          <div className="mt-2 text-xs uppercase tracking-wider text-gray-600">{t.onlineBooking}</div>
        </div>
        <div className="px-6 pb-8 pt-2 text-center">
          {state.kind === 'working' && <div className="py-6 text-[15px] text-gray-600">{t.confirming}</div>}
          {state.kind === 'done' && (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600" aria-hidden>✓</div>
              <div className="text-xl text-gray-900">{t.doneTitle}</div>
              <div className="mt-3 text-[16px] text-gray-800">{t.doneBody(whenLabel(state.start), state.partySize)}</div>
              {state.email && <div className="mt-4 text-sm text-gray-500">{t.doneEmail(state.email)}</div>}
              <div className="mt-1 text-sm text-gray-500">{config?.contactPhone ? t.contactToChangePhone(config.contactPhone) : t.contactToChange}</div>
            </>
          )}
          {state.kind === 'failed' && (
            <>
              <div className="rounded-lg bg-red-50 px-3 py-3 text-[15px] text-red-700" role="alert">{t.errors[state.code] || t.errors.unavailable}</div>
              <a href={`/book/${encodeURIComponent(agentId)}?lang=${lang}`} className="mt-5 inline-block rounded-lg bg-violet-600 px-6 py-2.5 text-[15px] font-medium text-white hover:bg-violet-700">
                {t.bookAgain}
              </a>
            </>
          )}
        </div>
        <div className="border-t border-gray-200 px-6 py-4 text-sm font-semibold text-gray-500">{t.poweredBy}</div>
      </div>
    </div>
  )
}
