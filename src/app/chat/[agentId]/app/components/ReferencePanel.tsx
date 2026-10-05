'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { ReferenceScreenItem, ReferenceScreenSheet, WorkApi } from '../lib/api'
import { errorText } from './SheetTable'

function cell(lang: WorkLang, v: unknown, options: string[] | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return options?.includes(v) ? workT(lang, `opt_${v}`, v) : v
  if (typeof v === 'boolean') return workT(lang, v ? 'yes' : 'no')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function ReadOnlyTable({ lang, sheet }: { lang: WorkLang; sheet: ReferenceScreenSheet }) {
  const t = (k: string, f?: string) => workT(lang, k, f)
  const cols = sheet.schema.columns.filter((c) => !sheet.hidden.includes(c.name))
  const rows = useMemo(() => {
    const col = sheet.dateColumn
    return col ? [...sheet.rows].sort((a, b) => String(b.data[col] ?? '').localeCompare(String(a.data[col] ?? ''))) : sheet.rows
  }, [sheet])
  if (rows.length === 0) return <p className="p-4 text-sm text-gray-500">{t('no_rows')}</p>
  const confirmable = rows.some((r) => r.confirmed !== null)
  return (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-[#171717] z-10">
          <tr className="text-left text-xs text-gray-400">
            {confirmable && <th className="px-3 py-2 font-normal w-10 whitespace-nowrap">{t('status')}</th>}
            {cols.map((c) => (
              <th key={c.name} className={`px-3 py-2 font-normal whitespace-nowrap ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right' : ''}`}>{t(`col_${c.name}`, c.name)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[#2A2A2A]">
              {confirmable && (
                <td className="px-3 py-2">
                  {r.confirmed ? <Check className="w-4 h-4 text-emerald-400" aria-label={t('confirmed')} /> : r.confirmed === false ? <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title={t('unconfirmed')} /> : null}
                </td>
              )}
              {cols.map((c) => (
                <td key={c.name} className={`px-3 py-2 text-gray-200 max-w-[16rem] truncate ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}>
                  {cell(lang, r.data[c.name], sheet.options[c.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ReferencePanel({ api, lang, projectId }: { api: WorkApi; lang: WorkLang; projectId: string }) {
  const t = (k: string, f?: string) => workT(lang, k, f)
  const [list, setList] = useState<ReferenceScreenItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<{ ref: string; sheet: string } | null>(null)

  useEffect(() => {
    let live = true
    api<{ references: ReferenceScreenItem[] }>('GET', `/projects/${projectId}/references`)
      .then((r) => { if (!live) return; setList(r.references); const f = r.references.find((x) => x.sheets.length); setPick(f ? { ref: f.referenceId, sheet: f.sheets[0].id } : null) })
      .catch((e) => { if (live) setError(errorText(lang, e)) })
    return () => { live = false }
  }, [api, projectId, lang])

  if (error) return <p className="p-4 text-sm text-red-400 whitespace-pre-line">{error}</p>
  if (!list) return <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
  if (list.length === 0) return <p className="p-6 text-sm text-gray-500">{t('ref_none')}</p>

  const sheetLabel = (s: { family: string; name: string; template: string | null }) => (s.template ? t(`sheet_${s.family}`, s.name) : s.name)
  const current = list.find((r) => r.referenceId === pick?.ref)?.sheets.find((s) => s.id === pick?.sheet) ?? null

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 py-3 border-b border-[#2A2A2A] space-y-3">
        <p className="text-xs text-gray-500">{t('ref_help')}</p>
        {list.map((r) => (
          <div key={r.referenceId} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-white font-medium">{r.sourceName}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.includeUnconfirmed ? 'bg-amber-900/50 text-amber-300' : 'bg-[#2A2A2A] text-gray-400'}`}>
                {r.includeUnconfirmed ? t('ref_include_unconfirmed') : t('ref_confirmed_only')}
              </span>
            </div>
            {r.revising.map((x) => (
              <p key={x.taskId} className="flex items-start gap-1 text-xs text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {t('ref_revising').replace('{task}', x.title)}
              </p>
            ))}
            <div className="flex flex-wrap gap-1">
              {r.sheets.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setPick({ ref: r.referenceId, sheet: s.id })}
                  className={`px-2.5 py-1 text-xs rounded-md ${pick?.ref === r.referenceId && pick.sheet === s.id ? 'bg-[#E07B53] text-white' : 'bg-[#2A2A2A] text-gray-300 hover:text-white'}`}
                >{sheetLabel(s)} <span className="tabular-nums opacity-70">{s.rows.length}</span></button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{current && <ReadOnlyTable key={`${pick!.ref}:${current.id}`} lang={lang} sheet={current} />}</div>
    </div>
  )
}
