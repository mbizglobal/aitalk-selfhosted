'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { packageOfFamily, workT, type WorkLang } from '@/lib/translations/work'

interface SourceSheet { selector: string; family: string | null; name: string }
interface Source { id: string; name: string; kind: string; sheets: SourceSheet[] }
interface Ref { id: string; toProjectId: string; toName: string; sheets: string[]; includeUnconfirmed: boolean }

async function failText(res: Response, t: (k: string) => string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
  if (j.error === 'INVALID' && j.detail?.includes('cycle')) return t('work_ref_err_cycle')
  if (j.error === 'INVALID' && j.detail?.includes('at least one sheet')) return t('work_ref_err_no_sheet')
  if (j.error === 'DUPLICATE') return t('work_ref_err_duplicate')
  if (j.error === 'READ_ONLY') return t('work_ref_err_read_only')
  return t('work_error')
}

function SheetChecks({ lang, sheets, value, onChange, idPrefix, disabled }: { lang: WorkLang; sheets: SourceSheet[]; value: string[]; onChange: (v: string[]) => void; idPrefix: string; disabled: boolean }) {
  if (sheets.length === 0) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {sheets.map((s) => {
        const id = `${idPrefix}-${s.selector}`
        return (
          <label key={s.selector} htmlFor={id} className="inline-flex items-center gap-1.5 text-sm">
            <input id={id} type="checkbox" disabled={disabled} checked={value.includes(s.selector)} onChange={(e) => onChange(e.target.checked ? [...value, s.selector] : value.filter((x) => x !== s.selector))} />
            {s.family ? workT(lang, `sheet_${s.family}`, s.name, packageOfFamily(s.family)) : s.name}
          </label>
        )
      })}
    </div>
  )
}

export function ReferenceEditor({ projectId, lang }: { projectId: string; lang: WorkLang }) {
  const { t } = useLanguage()
  const [refs, setRefs] = useState<Ref[] | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [edits, setEdits] = useState<Record<string, { sheets: string[]; includeUnconfirmed: boolean }>>({})
  const [to, setTo] = useState('')
  const [newSheets, setNewSheets] = useState<string[]>([])
  const [newUnconfirmed, setNewUnconfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/work-projects/${projectId}/references`
  const load = useCallback(async () => {
    const res = await fetch(base, { cache: 'no-store' })
    if (!res.ok) { setError(await failText(res, t)); return }
    const j = (await res.json()) as { references: Ref[]; sources: Source[] }
    setRefs(j.references)
    setSources(j.sources)
    setEdits(Object.fromEntries(j.references.map((r) => [r.id, { sheets: r.sheets, includeUnconfirmed: r.includeUnconfirmed }])))
  }, [base, t])
  useEffect(() => { void load() }, [load])

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      if (!res.ok) { setError(await failText(res, t)); return false }
      await load()
      return true
    } catch {
      setError(t('work_error'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (await call(base, 'POST', { toProjectId: to, sheets: newSheets, includeUnconfirmed: newUnconfirmed })) { setTo(''); setNewSheets([]); setNewUnconfirmed(false) }
  }

  if (!refs) return error ? <p className="text-sm text-red-500">{error}</p> : <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />

  const taken = new Set(refs.map((r) => r.toProjectId))
  const candidates = sources.filter((s) => !taken.has(s.id))
  const picked = sources.find((s) => s.id === to)

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('work_ref_desc')}</p>
      {refs.length === 0 ? <p className="text-sm text-muted-foreground">{t('work_ref_none')}</p> : (
        <ul className="space-y-3">
          {refs.map((r) => {
            const e = edits[r.id] ?? { sheets: r.sheets, includeUnconfirmed: r.includeUnconfirmed }
            const src = sources.find((s) => s.id === r.toProjectId)
            const dirty = e.includeUnconfirmed !== r.includeUnconfirmed || [...e.sheets].sort().join() !== [...r.sheets].sort().join()
            return (
              <li key={r.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium flex-1 min-w-0 truncate">→ {r.toName}</span>
                  <button onClick={() => void call(`${base}/${r.id}`, 'DELETE')} disabled={busy} className="inline-flex items-center gap-1 text-sm text-red-500 hover:underline disabled:opacity-50">
                    <Trash2 className="w-4 h-4" /> {t('work_ref_remove')}
                  </button>
                </div>
                <SheetChecks lang={lang} sheets={src?.sheets ?? []} value={e.sheets} onChange={(v) => setEdits((x) => ({ ...x, [r.id]: { ...e, sheets: v } }))} idPrefix={`ref-${r.id}`} disabled={busy} />
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input type="checkbox" disabled={busy} checked={e.includeUnconfirmed} onChange={(ev) => setEdits((x) => ({ ...x, [r.id]: { ...e, includeUnconfirmed: ev.target.checked } }))} />
                  {t('work_ref_include_unconfirmed')}
                </label>
                {dirty && (
                  <div>
                    <button onClick={() => void call(`${base}/${r.id}`, 'PATCH', e)} disabled={busy || e.sheets.length === 0} className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50">{t('work_ref_save')}</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="rounded-md border border-dashed p-3 space-y-2">
          <p className="text-sm font-medium">{t('work_ref_add')}</p>
          <select value={to} disabled={busy} onChange={(e) => { setTo(e.target.value); setNewSheets([]) }} className="rounded-md border bg-background px-2 py-1 text-sm max-w-full">
            <option value="">{t('work_ref_choose_project')}</option>
            {candidates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {picked && (
            <>
              {picked.sheets.length === 0 ? <p className="text-sm text-muted-foreground">{t('work_ref_no_sheets')}</p> : (
                <SheetChecks lang={lang} sheets={picked.sheets} value={newSheets} onChange={setNewSheets} idPrefix={`new-${projectId}`} disabled={busy} />
              )}
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input type="checkbox" disabled={busy} checked={newUnconfirmed} onChange={(e) => setNewUnconfirmed(e.target.checked)} />
                {t('work_ref_include_unconfirmed')}
              </label>
              <p className="text-xs text-muted-foreground">{t('work_ref_unconfirmed_help')}</p>
              <div>
                <button onClick={() => void add()} disabled={busy || newSheets.length === 0} className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50">{t('work_ref_create')}</button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
