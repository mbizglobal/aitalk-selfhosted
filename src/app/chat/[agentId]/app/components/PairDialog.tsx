'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Lock, Unlink, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type PairTargetRow, type SheetRow, type SheetScreen, type WorkApi } from '../lib/api'
import { fieldInputCls } from './AppTemplateFields'
import { errorText } from './SheetTable'

interface Props {
  api: WorkApi
  lang: WorkLang
  projectId: string
  sheet: SheetScreen
  row: SheetRow
  readOnly: boolean
  onChanged: () => void
  onClose: () => void
}

function summaryText(lang: WorkLang, s: PairTargetRow['summary']): string {
  return s
    .map(([, v]) => (v === null || v === undefined || v === '' ? null : typeof v === 'string' ? workT(lang, `opt_${v}`, v) : String(v)))
    .filter(Boolean)
    .join(' · ')
}

export function PairDialog({ api, lang, projectId, sheet, row, readOnly, onChanged, onClose }: Props) {
  const t = (k: string, f?: string) => workT(lang, k, f)
  const base = `/projects/${projectId}/sheets/${sheet.id}/pairs`
  const mine = sheet.pairs.filter((p) => p.fromRowId === row.id)
  const [kind, setKind] = useState(sheet.pairDefs[0]?.kind ?? '')
  const def = sheet.pairDefs.find((d) => d.kind === kind)
  const [targets, setTargets] = useState<Record<string, PairTargetRow[]>>({})
  const [filter, setFilter] = useState('')
  const [confirmToo, setConfirmToo] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockedTry, setLockedTry] = useState<{ action: 'pair'; toRowId: string } | { action: 'unpair'; pairId: string } | null>(null)

  const families = useMemo(() => [...new Set([...sheet.pairDefs.filter((d) => d.kind === kind || mine.some((p) => p.kind === d.kind)).map((d) => d.toFamily)])], [sheet.pairDefs, kind, mine])
  useEffect(() => {
    for (const f of families) {
      if (targets[f]) continue
      void api<{ rows: PairTargetRow[] }>('GET', `/projects/${projectId}/pair-targets?family=${encodeURIComponent(f)}`)
        .then((r) => setTargets((x) => ({ ...x, [f]: r.rows })))
        .catch((e) => setError(errorText(lang, e)))
    }
  }, [families, targets, api, projectId, lang])

  const labelOf = (toRowId: string, k: string) => {
    const fam = sheet.pairDefs.find((d) => d.kind === k)?.toFamily
    const hit = fam ? targets[fam]?.find((r) => r.id === toRowId) : undefined
    return hit ? summaryText(lang, hit.summary) : '…'
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn(); onChanged() } catch (e) {
      if (e instanceof WorkApiError && e.code === 'LOCKED' && sheet.exceptions.length > 0) setError(`${errorText(lang, e)}\n${t('pair_exception_hint')}`)
      else setError(errorText(lang, e))
      throw e
    } finally { setBusy(false) }
  }
  const pair = (toRowId: string, exception?: string) => run(async () => {
    setLockedTry(null)
    await api('POST', base, { fromRowId: row.id, toRowId, kind, confirm: confirmToo, ...(exception ? { exception } : {}) })
  }).catch((e) => { if (e instanceof WorkApiError && e.code === 'LOCKED' && !exception && sheet.exceptions.length > 0) setLockedTry({ action: 'pair', toRowId }) })
  const unpair = (pairId: string, exception?: string) => run(async () => {
    setLockedTry(null)
    await api('DELETE', `${base}/${pairId}${exception ? `?exception=${encodeURIComponent(exception)}` : ''}`)
  }).catch((e) => { if (e instanceof WorkApiError && e.code === 'LOCKED' && !exception && sheet.exceptions.length > 0) setLockedTry({ action: 'unpair', pairId }) })
  const confirmPair = (pairId: string) => run(async () => { await api('POST', `${base}/${pairId}/confirm`) }).catch(() => undefined)

  const taken = new Set(mine.filter((p) => p.kind === kind).map((p) => p.toRowId))
  const list = (def ? targets[def.toFamily] ?? null : null)?.filter((r) => !taken.has(r.id) && (!filter.trim() || summaryText(lang, r.summary).toLowerCase().includes(filter.trim().toLowerCase())))

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col rounded-t-xl sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
          <h2 className="text-white font-medium">{t('pairs_title')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label={t('close')}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-4">
          <section className="space-y-1">
            {mine.length === 0 ? <p className="text-sm text-gray-500">{t('no_pairs')}</p> : mine.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                {p.confirmed ? <Check className="w-4 h-4 text-emerald-400 shrink-0" aria-label={t('confirmed')} /> : <span className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0" title={t('unconfirmed')} />}
                <span className="text-gray-400 shrink-0">{t(`pair_${p.kind}`, p.kind)}</span>
                <span className="text-gray-200 truncate flex-1">{labelOf(p.toRowId, p.kind)}</span>
                {p.locked ? <Lock className="w-4 h-4 text-gray-500 shrink-0" aria-label={t('locked')} /> : null}
                {!readOnly && !p.confirmed && !p.locked && (
                  <button onClick={() => void confirmPair(p.id)} disabled={busy} className="p-1 text-gray-400 hover:text-emerald-400" title={t('confirm')}><Check className="w-4 h-4" /></button>
                )}
                {!readOnly && (
                  <button onClick={() => void unpair(p.id)} disabled={busy} className="p-1 text-gray-400 hover:text-red-400" title={t('unpair')}><Unlink className="w-4 h-4" /></button>
                )}
              </div>
            ))}
          </section>

          {!readOnly && sheet.pairDefs.length > 0 && (
            <section className="space-y-2 border-t border-[#2A2A2A] pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">{t('pair_add')}</span>
                <select value={kind} onChange={(e) => { setKind(e.target.value); setFilter('') }} className={`${fieldInputCls} w-auto`}>
                  {sheet.pairDefs.map((d) => <option key={d.kind} value={d.kind}>{t(`pair_${d.kind}`, d.kind)}</option>)}
                </select>
                <label className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <input type="checkbox" checked={confirmToo} onChange={(e) => setConfirmToo(e.target.checked)} className="accent-[#E07B53]" /> {t('pair_confirm_too')}
                </label>
              </div>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('search')} className={fieldInputCls} autoComplete="off" />
              {list === null || list === undefined ? <Loader2 className="w-4 h-4 animate-spin text-gray-500" /> : list.length === 0 ? (
                <p className="text-sm text-gray-500">{t('no_rows')}</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto scrollbar-thin divide-y divide-[#2A2A2A]">
                  {list.length > 200 && <li className="px-2 py-2 text-xs text-amber-300">{t('pair_more').replace('{n}', String(list.length - 200))}</li>}
                  {list.slice(0, 200).map((r) => (
                    <li key={r.id}>
                      <button onClick={() => void pair(r.id)} disabled={busy} className="w-full flex items-center gap-2 px-2 py-2 text-left text-sm text-gray-200 hover:bg-[#232323]">
                        {r.locked && <Lock className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                        <span className="truncate">{summaryText(lang, r.summary)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
          {lockedTry && sheet.exceptions.map((name) => (
            <button
              key={name}
              onClick={() => void (lockedTry.action === 'pair' ? pair(lockedTry.toRowId, name) : unpair(lockedTry.pairId, name))}
              disabled={busy}
              className="px-3 py-2 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]"
            >{t(`exc_${name}`, name)}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
