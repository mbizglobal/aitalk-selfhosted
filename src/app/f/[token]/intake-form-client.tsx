'use client'

import React, { useState } from 'react'
import { INTAKE_TEXT, type IntakeLang } from './intake-text'

interface Col { key: string; label: string; kind: string; options?: string[]; required?: boolean; hint?: string }

const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500'

export function IntakeFormClient(props: { token: string; lang: IntakeLang; app: string; table: string; columns: Col[]; opened: string }) {
  const t = INTAKE_TEXT[props.lang]
  const [vals, setVals] = useState<Record<string, string>>({})
  const [trap, setTrap] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const set = (k: string, v: string) => setVals((x) => ({ ...x, [k]: v }))

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const missing = props.columns.filter((c) => c.required && !(vals[c.key] ?? '').trim()).map((c) => c.label)
    if (missing.length) { setMsg(t.missing.replace('{fields}', missing.join(', '))); return }
    const values: Record<string, string> = {}
    for (const c of props.columns) {
      const v = (vals[c.key] ?? '').trim()
      if (!v) continue
      values[c.key] = v
      if (c.kind === 'money') {
        const cur = (vals[`${c.key}_cur`] ?? c.options?.[0] ?? '').trim()
        if (cur) values[`${c.key}_cur`] = cur
      }
    }
    setBusy(true)
    try {
      const res = await fetch('/api/public/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: props.token, values, opened: props.opened, hp: trap }) })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setDone(true); return }
      const code = body?.error
      setMsg(code === 'INVALID' ? t.invalid.replace('{detail}', String(body?.detail ?? '')) : code === 'LIMIT' ? t.limit : code === 'TAKEN' ? t.taken : code === 'EXPIRED' ? t.expired : code === 'TOO_SOON' ? t.soon : code === 'NOT_FOUND' ? t.gone : t.error)
    } catch {
      setMsg(t.error)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-lg w-full bg-white rounded-xl shadow-sm border border-gray-200 p-6 self-start">
        <p className="text-sm font-medium text-gray-500">{props.app}</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">{props.table}</h1>
        <p className="mt-4 text-sm text-gray-700" role="status">{t.done}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 text-sm text-teal-700 underline">{t.again}</button>
      </div>
    )
  }

  return (
    <form onSubmit={send} className="max-w-lg w-full bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4 self-start" noValidate>
      <div>
        <p className="text-sm font-medium text-gray-500">{props.app}</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">{props.table}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.title}</p>
      </div>
      {props.columns.map((c) => (
        <div key={c.key} className="space-y-1">
          <label htmlFor={`f-${c.key}`} className="block text-sm font-medium text-gray-800">
            {c.label}{c.required && <span className="ml-1 text-xs text-red-600">({t.required})</span>}
          </label>
          {c.kind === 'longtext' ? (
            <textarea id={`f-${c.key}`} rows={4} className={input} value={vals[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} autoComplete="off" />
          ) : c.kind === 'choice' ? (
            <select id={`f-${c.key}`} className={input} value={vals[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)}>
              <option value="">{t.choose}</option>
              {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : c.kind === 'yesno' ? (
            <select id={`f-${c.key}`} className={input} value={vals[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)}>
              <option value="">{t.choose}</option>
              <option value="true">{t.yes}</option>
              <option value="false">{t.no}</option>
            </select>
          ) : c.kind === 'money' ? (
            <div className="flex gap-2">
              <input id={`f-${c.key}`} inputMode="decimal" className={input} value={vals[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} autoComplete="off" />
              {c.options && c.options.length > 1 ? (
                <select aria-label={t.currency} className={`${input} w-28`} value={vals[`${c.key}_cur`] ?? c.options[0]} onChange={(e) => set(`${c.key}_cur`, e.target.value)}>
                  {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : c.options?.length === 1 ? (
                <span className="self-center text-sm text-gray-600">{c.options[0]}</span>
              ) : (
                <input aria-label={t.currency} maxLength={3} placeholder="CHF" className={`${input} w-24 uppercase`} value={vals[`${c.key}_cur`] ?? ''} onChange={(e) => set(`${c.key}_cur`, e.target.value.toUpperCase())} autoComplete="off" />
              )}
            </div>
          ) : (
            <input id={`f-${c.key}`} type={c.kind === 'date' ? 'date' : c.kind === 'time' ? 'time' : 'text'} inputMode={c.kind === 'number' ? 'decimal' : undefined} className={input} value={vals[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} autoComplete="off" />
          )}
          {c.hint && <p className="text-xs text-gray-500">{c.hint}</p>}
        </div>
      ))}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <input id="f-hpq" name="hpq_x" tabIndex={-1} autoComplete="new-password" data-lpignore="true" data-1p-ignore value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>
      {msg && <p className="text-sm text-red-700" role="alert">{msg}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">{busy ? t.sending : t.send}</button>
      <p className="text-xs text-gray-400">{t.note}</p>
    </form>
  )
}
