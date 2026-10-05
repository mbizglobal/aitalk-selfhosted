'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { computeDayStatus } from '@/lib/holidays/closed-day-status'
import { normalizeWidgetLang, WIDGET_LANGS, WIDGET_TEXT, BCP47, type WidgetLang } from '@/lib/booking-widget/i18n'
import type { PublicBookingConfig } from '@/lib/booking-widget/public-config'

type Step = 'pick' | 'contact' | 'check_email' | 'done'
type Slot = { start: string; label: string }

const COUNTRY_CODES = ['+41', '+49', '+43', '+33', '+39', '+44', '+1', '+82']

function todayYmd(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function ymdParts(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  return { y, m, d }
}

export default function BookingWidgetPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const [lang, setLang] = useState<WidgetLang>('en')
  const t = WIDGET_TEXT[lang]

  const [config, setConfig] = useState<PublicBookingConfig | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [step, setStep] = useState<Step>('pick')
  const [party, setParty] = useState(2)
  const [date, setDate] = useState<string>('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState<string>('') // 'YYYY-MM-01'
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotsNote, setSlotsNote] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Slot | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [countryCode, setCountryCode] = useState('+41')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const renderedAt = useRef<number>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [booked, setBooked] = useState<{ start: string; partySize: number | null } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [embedded, setEmbedded] = useState(false)
  useEffect(() => {
    let inFrame = false
    try { inFrame = window.self !== window.top } catch { inFrame = true }
    setEmbedded(inFrame)
    if (inFrame) document.body.style.background = 'transparent'
  }, [])

  const forcedLang = useRef<WidgetLang | null>(null)
  const [langReady, setLangReady] = useState(false)
  useEffect(() => {
    forcedLang.current = normalizeWidgetLang(new URLSearchParams(window.location.search).get('lang'))
    if (forcedLang.current) {
      setLang(forcedLang.current)
      setLangReady(true)
    }
  }, [])

  useEffect(() => {
    if (!rootRef.current || window.parent === window) return
    const el = rootRef.current
    const post = () => window.parent.postMessage({ type: 'AITALK_BOOKING_HEIGHT', agentId, h: Math.ceil(el.getBoundingClientRect().height) }, '*')
    const ro = new ResizeObserver(post)
    ro.observe(el)
    post()
    return () => ro.disconnect()
  }, [agentId, loadState])

  useEffect(() => {
    let alive = true
    fetch(`/api/booking/${encodeURIComponent(agentId)}/config`, { cache: 'no-store' })
      .then(async (r) => {
        if (!alive) return
        if (!r.ok) return setLoadState('missing')
        const c: PublicBookingConfig = await r.json()
        setConfig(c)
        if (!forcedLang.current) {
          setLang(c.defaultLang || 'en')
          setLangReady(true)
        }
        if (c.party) setParty(Math.min(2, c.party.max))
        setLoadState('ready')
      })
      .catch(() => alive && setLoadState('missing'))
    return () => {
      alive = false
    }
  }, [agentId])

  const tz = config?.timezone || 'Europe/Zurich'
  const today = useMemo(() => (config ? todayYmd(tz) : ''), [config, tz])
  const lastDay = useMemo(() => (config && config.bookingWindowDays > 0 ? addDays(today, config.bookingWindowDays) : ''), [config, today])

  const isDayOpen = useCallback(
    (ymd: string) => {
      if (!config || !today) return false
      if (ymd < today) return false
      if (lastDay && ymd > lastDay) return false
      const s = computeDayStatus(ymd, config.closed)
      return s.kind === 'open' || s.kind === 'partial'
    },
    [config, today, lastDay],
  )

  useEffect(() => {
    if (!config || date) return
    let d = today
    for (let i = 0; i < 400 && !isDayOpen(d); i++) d = addDays(d, 1)
    setDate(d)
    setViewMonth(d.slice(0, 8) + '01')
  }, [config, today, date, isDayOpen])

  const loadSlots = useCallback(async () => {
    if (!config || !date) return
    setSlots(null)
    setSlotsNote(null)
    setChosen(null)
    const q = new URLSearchParams({ date })
    if (config.party) q.set('party', String(party))
    try {
      const r = await fetch(`/api/booking/${encodeURIComponent(agentId)}/slots?${q}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) {
        setSlots(j.times || [])
      } else {
        setSlots([])
        setSlotsNote(j.reason === 'party_too_large' && config.party ? t.largeGroup(config.party.max, config.contactPhone) : t.errors[j.reason] || t.errors.unavailable)
      }
    } catch {
      setSlots([])
      setSlotsNote(t.errors.network)
    }
  }, [agentId, config, date, party, t])

  useEffect(() => {
    if (step === 'pick') void loadSlots()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, party, config])

  const dateLabel = useMemo(() => {
    if (!date) return ''
    if (date === today) return t.today
    if (date === addDays(today, 1)) return t.tomorrow
    const { y, m, d } = ymdParts(date)
    return new Intl.DateTimeFormat(BCP47[lang], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  }, [date, today, lang, t])

  const whenLabel = (iso: string) =>
    new Intl.DateTimeFormat(BCP47[lang], { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  const fullPhone = () => {
    const raw = phoneLocal.trim()
    if (raw.startsWith('+')) return raw
    return `${countryCode} ${raw.replace(/^0+/, '')}`
  }

  const validateContact = (): boolean => {
    const e: Record<string, string> = {}
    if (!firstName.trim()) e.firstName = t.required
    if (!lastName.trim()) e.lastName = t.required
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email.trim())) e.email = t.invalidEmail
    const digits = fullPhone().replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) e.phone = t.invalidPhone
    setFieldErrors(e)
    return Object.keys(e).length === 0
  }

  const goContact = () => {
    if (!chosen) return
    setError(null)
    renderedAt.current = Date.now()
    setStep('contact')
  }

  const reserve = async () => {
    if (!chosen || !config) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/booking/${encodeURIComponent(agentId)}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: chosen.start,
          party: config.party ? party : null,
          firstName,
          lastName,
          email: email.trim(),
          phone: fullPhone(),
          message: config.askMessage ? message : '',
          website,
          renderedAt: renderedAt.current,
          lang,
        }),
      })
      const j = await r.json().catch(() => ({ ok: false, code: 'unavailable' }))
      if (j.ok && j.pending) {
        setStep('check_email')
        return
      }
      if (j.ok) {
        setBooked({ start: chosen.start, partySize: j.partySize ?? (config.party ? party : null) })
        setStep('done')
        return
      }
      const code: string = j.code || 'unavailable'
      setError(t.errors[code] || t.errors.unavailable)
      if (code === 'slot_taken' || code === 'closed') {
        setStep('pick')
        void loadSlots()
      }
    } catch {
      setError(t.errors.network)
    } finally {
      setBusy(false)
    }
  }

  const submitContact = async () => {
    if (!validateContact() || !config) return
    await reserve()
  }

  const monthCells = useMemo(() => {
    if (!viewMonth) return []
    const { y, m } = ymdParts(viewMonth)
    const first = new Date(Date.UTC(y, m - 1, 1))
    const lead = (first.getUTCDay() + 6) % 7
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const cells: Array<string | null> = Array(lead).fill(null)
    for (let d = 1; d <= days; d++) cells.push(`${viewMonth.slice(0, 8)}${String(d).padStart(2, '0')}`)
    return cells
  }, [viewMonth])
  const weekdayHeads = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(BCP47[lang], { weekday: 'short', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 0, 5 + i))))
  }, [lang])
  const monthTitle = useMemo(() => {
    if (!viewMonth) return ''
    const { y, m } = ymdParts(viewMonth)
    return new Intl.DateTimeFormat(BCP47[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
  }, [viewMonth, lang])
  const shiftMonth = (n: number) => {
    const { y, m } = ymdParts(viewMonth)
    setViewMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10))
  }
  const canPrevMonth = !!viewMonth && !!today && viewMonth > today.slice(0, 8) + '01'
  const canNextMonth = !!viewMonth && (!lastDay || viewMonth < lastDay.slice(0, 8) + '01')

  const underline = 'w-full border-0 border-b border-gray-300 bg-white px-1 py-2 text-[16px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-violet-600'
  const labelCls = 'block text-[13px] text-gray-500'
  const primaryBtn = 'rounded-lg bg-violet-600 px-6 py-2.5 text-[15px] font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300'
  const dropdown = 'flex h-12 w-full items-center justify-between rounded-xl border border-gray-300 bg-white px-4 text-[16px] text-violet-700'

  const weekdayShort = (wd: string) => {
    const idx = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(wd)
    return new Intl.DateTimeFormat(BCP47[lang], { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 5 + idx)))
  }
  const hourRows = useMemo(() => {
    const days = config?.info?.openingHours ?? []
    const rows: Array<{ label: string; hours: string }> = []
    let i = 0
    while (i < days.length) {
      const key = JSON.stringify(days[i].ranges)
      let j = i
      while (j + 1 < days.length && JSON.stringify(days[j + 1].ranges) === key) j++
      if (days[i].ranges.length) {
        rows.push({
          label: i === j ? weekdayShort(days[i].weekday) : `${weekdayShort(days[i].weekday)} – ${weekdayShort(days[j].weekday)}`,
          hours: days[i].ranges.map(([a, b]) => `${a} – ${b}`).join(', '),
        })
      }
      i = j + 1
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, lang])

  const infoPanel = config && (
    <div className="hidden flex-1 border border-violet-300 py-10 pl-10 pr-28 md:block">
      <div className="inline-block rounded-md bg-violet-600 px-6 py-3 text-lg uppercase tracking-wide text-white">{config.title}</div>
      {hourRows.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 text-xl text-gray-700"><span aria-hidden>🕒</span>{t.openingTimes}</div>
          <table className="mt-3 text-[15px] text-gray-700">
            <tbody>
              {hourRows.map((r) => (
                <tr key={r.label}><td className="py-1 pl-8 pr-10">{r.label}</td><td className="py-1">{r.hours}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-8 space-y-3 text-[15px] text-gray-700">
        {config.info?.address && <div className="flex gap-2"><span aria-hidden>📍</span>{config.info.address}</div>}
        {config.contactPhone && <div className="flex gap-2"><span aria-hidden>📞</span><a className="text-violet-600" href={`tel:${config.contactPhone}`}>{config.contactPhone}</a></div>}
        {config.info?.email && <div className="flex gap-2"><span aria-hidden>✉️</span><a className="text-violet-600" href={`mailto:${config.info.email}`}>{config.info.email}</a></div>}
      </div>
    </div>
  )

  const footerBar = (left: ReactNode, right: ReactNode) => (
    <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">{left}{right}</div>
  )
  const brand = <span className="text-sm font-semibold text-gray-500">{t.poweredBy}</span>

  const card = (
    <div className={`flex w-full flex-col bg-white ${embedded ? 'rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)]' : 'min-h-screen md:min-h-0 md:w-[460px] md:shrink-0 md:rounded-2xl md:shadow-[0_8px_40px_rgba(0,0,0,0.10)]'} ${!embedded ? 'md:-ml-20' : ''}`}>
      <div className="relative px-6 pb-4 pt-9 text-center">
        {langReady && (
          <div className="absolute right-4 top-3 flex gap-1 text-xs" role="group" aria-label="Language">
            {WIDGET_LANGS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={`rounded px-1.5 py-0.5 uppercase ${lang === l ? 'bg-violet-600 text-white' : 'text-gray-500 hover:text-violet-700'}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <div className="text-2xl uppercase tracking-wide text-gray-700">
          {step === 'contact' ? t.checkout : config?.title || ' '}
        </div>
        {step === 'pick' && <div className="mt-2 text-xs uppercase tracking-wider text-gray-600">{t.onlineBooking}</div>}
      </div>

      {loadState === 'loading' && <div className="px-6 pb-10 pt-4 text-center text-sm text-gray-500">{langReady ? t.loading : '…'}</div>}

      {(loadState === 'missing' || (config && !config.available)) && (
        <div className="px-6 pb-10 pt-4 text-center">
          <div className="font-medium text-gray-800">{t.unavailableTitle}</div>
          <div className="mt-1 text-sm text-gray-500">{config?.contactPhone ? t.contactToChangePhone(config.contactPhone) : t.unavailableBody}</div>
        </div>
      )}

      {config && config.available && (
        <>
          {error && <div className="mx-6 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

          {step === 'pick' && (
            <>
              <div className="px-6">
                <div className={`grid gap-3 ${config.party ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {config.party && (
                    <div className="relative">
                      <select
                        aria-label={t.guestsLabel}
                        value={party}
                        onChange={(e) => setParty(Number(e.target.value))}
                        className={`${dropdown} appearance-none`}
                      >
                        {Array.from({ length: config.party.max }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{t.guests(n)}</option>
                        ))}
                      </select>
                      <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-violet-600">⌄</span>
                    </div>
                  )}
                  <button type="button" onClick={() => setCalendarOpen((v) => !v)} aria-expanded={calendarOpen} className={dropdown}>
                    <span>{dateLabel}</span>
                    <span aria-hidden className="text-violet-600">{calendarOpen ? '⌃' : '⌄'}</span>
                  </button>
                </div>
                {config.party && (
                  <div className="mt-2 text-xs text-gray-500">{t.largeGroup(config.party.max, config.contactPhone)}</div>
                )}

                {calendarOpen && (
                  <div className="mt-3 rounded-2xl bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,0.10)]">
                    <div className="mb-3 flex items-center justify-between">
                      <button type="button" disabled={!canPrevMonth} onClick={() => shiftMonth(-1)} className="px-2 text-xl text-violet-600 disabled:text-gray-300" aria-label="previous month">‹</button>
                      <div className="text-[15px] text-violet-700">{monthTitle}</div>
                      <button type="button" disabled={!canNextMonth} onClick={() => shiftMonth(1)} className="px-2 text-xl text-violet-600 disabled:text-gray-300" aria-label="next month">›</button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-sm text-gray-500">
                      {weekdayHeads.map((w) => <div key={w} className="py-1">{w}</div>)}
                      {monthCells.map((ymd, i) => {
                        if (!ymd) return <div key={`e${i}`} />
                        const open = isDayOpen(ymd)
                        const selected = ymd === date
                        return (
                          <button
                            key={ymd}
                            type="button"
                            disabled={!open}
                            onClick={() => {
                              setDate(ymd)
                              setCalendarOpen(false)
                            }}
                            className={`h-10 rounded-lg text-[15px] ${selected ? 'border border-violet-600 text-gray-900' : open ? 'text-gray-900 hover:bg-violet-50' : 'text-gray-300'}`}
                          >
                            {Number(ymd.slice(8))}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className={`mt-2 overflow-y-auto px-6 pb-4 ${embedded ? 'max-h-[380px]' : 'flex-1 md:max-h-[420px] md:flex-none'}`}>
                {slots === null && <div className="py-8 text-center text-sm text-gray-500">{t.loading}</div>}
                {slots !== null && slots.length === 0 && (
                  <div className="py-8 text-center text-sm text-gray-500">{slotsNote || t.noTimes}</div>
                )}
                {slots !== null && slots.length > 0 && (
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                    {slots.map((s) => (
                      <button
                        key={s.start}
                        type="button"
                        onClick={() => setChosen(s)}
                        className={`rounded-lg py-3 text-[18px] ${chosen?.start === s.start ? 'bg-violet-600 text-white' : 'text-gray-700 hover:bg-violet-50'}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {footerBar(brand, <button type="button" disabled={!chosen} onClick={goContact} className={primaryBtn}>{t.next}</button>)}
            </>
          )}

          {(step === 'contact' || step === 'check_email') && chosen && (
            <div className="mx-6 mb-5 grid grid-cols-3 rounded-2xl border border-gray-300 py-4 text-center">
              <div><div className="text-sm text-violet-600">{t.date}</div><div className="mt-1 text-[17px] text-violet-700">{dateLabel}</div></div>
              <div><div className="text-sm text-violet-600">{t.time}</div><div className="mt-1 text-[17px] text-violet-700">{chosen.label}</div></div>
              <div><div className="text-sm text-violet-600">{t.guestsLabel}</div><div className="mt-1 text-[17px] text-violet-700">{config.party ? party : '–'}</div></div>
            </div>
          )}

          {step === 'contact' && (
            <>
              <div className="space-y-5 px-6 pb-5">
                <div className="grid grid-cols-2 gap-4">
                  <label className={labelCls}>{t.firstName} *
                    <input className={underline} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={60} />
                    {fieldErrors.firstName && <span className="text-xs text-red-600">{fieldErrors.firstName}</span>}
                  </label>
                  <label className={labelCls}>{t.lastName} *
                    <input className={underline} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" maxLength={60} />
                    {fieldErrors.lastName && <span className="text-xs text-red-600">{fieldErrors.lastName}</span>}
                  </label>
                </div>
                <label className={labelCls}>{t.email} *
                  <input className={underline} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} placeholder="name@example.com" />
                  {fieldErrors.email && <span className="text-xs text-red-600">{fieldErrors.email}</span>}
                </label>
                <label className={labelCls}>{t.phone} *
                  <div className="flex items-end gap-3">
                    <select aria-label="country code" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="border-0 border-b border-gray-300 bg-white py-2 text-[16px] text-gray-900 outline-none focus:border-violet-600">
                      {COUNTRY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className={underline} type="tel" value={phoneLocal} onChange={(e) => setPhoneLocal(e.target.value)} autoComplete="tel-national" maxLength={24} placeholder="79 123 45 67" />
                  </div>
                  {fieldErrors.phone && <span className="text-xs text-red-600">{fieldErrors.phone}</span>}
                </label>
                {config.askMessage && (
                  <label className={labelCls}>{t.messageLabel}
                    <textarea className={`${underline} min-h-[64px] resize-none`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder={t.messagePlaceholder} />
                  </label>
                )}
                <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                  <label>{t.honeypotLabel}<input tabIndex={-1} autoComplete="off" name="website-url" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
                </div>
              </div>
              <p className="border-t border-gray-200 px-6 pt-3 text-xs text-gray-500">{t.consent}</p>
              <div className="flex items-center justify-between px-6 py-4">
                <button type="button" onClick={() => { setError(null); setStep('pick') }} className="text-[16px] text-violet-600">‹ {t.back}</button>
                <button type="button" disabled={busy} onClick={submitContact} className={primaryBtn}>{busy ? t.loading : t.confirm}</button>
              </div>
            </>
          )}

          {step === 'check_email' && (
            <>
              <div className="px-6 pb-8 pt-2 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-3xl" aria-hidden>✉️</div>
                <div className="text-xl text-gray-900">{t.checkEmailTitle}</div>
                <p className="mt-3 text-[15px] text-gray-600">{t.checkEmailBody(email.trim(), config.confirmTtlMin)}</p>
              </div>
              {footerBar(
                <button type="button" onClick={() => { setError(null); setStep('contact') }} className="text-[16px] text-violet-600">‹ {t.back}</button>,
                <span />,
              )}
            </>
          )}

          {step === 'done' && booked && (
            <>
              <div className="px-6 pb-8 pt-2 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600" aria-hidden>✓</div>
                <div className="text-xl text-gray-900">{t.doneTitle}</div>
                <div className="mt-3 text-[16px] text-gray-800">{t.doneBody(whenLabel(booked.start), booked.partySize)}</div>
                <div className="mt-4 text-sm text-gray-500">{t.doneEmail(email.trim())}</div>
                <div className="mt-1 text-sm text-gray-500">{config.contactPhone ? t.contactToChangePhone(config.contactPhone) : t.contactToChange}</div>
              </div>
              {footerBar(brand, <span />)}
            </>
          )}
        </>
      )}
    </div>
  )

  return (
    <div ref={rootRef} className={embedded ? 'mx-auto w-full max-w-[480px] p-2' : 'min-h-screen bg-white'}>
      {embedded ? (
        card
      ) : (
        <div className="mx-auto flex w-full max-w-5xl items-center md:min-h-screen md:px-8 md:py-10">
          {infoPanel}
          {card}
        </div>
      )}
    </div>
  )
}
