'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, CheckCheck, FileUp, Link2, Loader2, Lock, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import { workStopText, workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type ScreenRowResult, type SheetImport, type SheetRow, type SheetScreen, type SheetSummary, type TaskSummary, type WorkApi, type WorkFiles } from '../lib/api'
import { RowEditor } from './RowEditor'
import { RowViewer } from './RowViewer'
import { MessageContent } from '@/components/chat/MessageContent'
import { ConfirmDialog } from './ConfirmDialog'
import { PairDialog } from './PairDialog'
import { ImportDialog } from './ImportDialog'

interface Props {
  api: WorkApi
  files: WorkFiles
  lang: WorkLang
  projectId: string
  sheet: SheetSummary
  task: TaskSummary | null
  readOnly: boolean
  imports: SheetImport[]
}

export function errorText(lang: WorkLang, e: unknown): string {
  if (e instanceof WorkApiError) {
    const base = workT(lang, `err_${e.code}`, workT(lang, 'err_INTERNAL'))
    const stop = e.stop ? workStopText(lang, e.stop) : null
    if (stop) return `${base}\n${stop}`
    return e.detail ? `${base}\n(${e.detail})` : base
  }
  return workT(lang, 'err_INTERNAL')
}

const EVIDENCE_CLS: Record<string, string> = {
  attached: 'bg-emerald-500/15 text-emerald-300',
  needed: 'bg-orange-500/20 text-orange-300',
  explained: 'bg-sky-500/15 text-sky-300',
  not_needed: 'bg-gray-500/15 text-gray-400',
}
const EVIDENCE_COLUMN = 'evidence'

function cell(lang: WorkLang, v: unknown, options: string[] | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return options?.includes(v) ? workT(lang, `opt_${v}`, v) : v
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function SheetTable({ api, files, lang, projectId, sheet, task, readOnly, imports }: Props) {
  const t = (k: string, f?: string) => workT(lang, k, f)
  const [data, setData] = useState<SheetScreen | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SheetRow | 'new' | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SheetRow | null>(null)
  const [pairing, setPairing] = useState<SheetRow | null>(null)
  const [importing, setImporting] = useState<SheetImport | null>(null)
  const [evidenceFilter, setEvidenceFilter] = useState<string | null>(null)

  const base = `/projects/${projectId}/sheets/${sheet.id}`
  const load = useCallback(async () => {
    try {
      setLoadError(null)
      setData(await api<SheetScreen>('GET', base))
    } catch (e) {
      setLoadError(errorText(lang, e))
    }
  }, [api, base, lang])

  useEffect(() => { setData(null); setNotice(null); setEvidenceFilter(null); setSort(null); void load() }, [load])

  const visible = useMemo(() => {
    if (!data) return []
    const cols = data.schema.columns.filter((c) => !data.hidden.includes(c.name))
    const ev = cols.find((c) => c.name === EVIDENCE_COLUMN)
    return ev ? [ev, ...cols.filter((c) => c !== ev)] : cols
  }, [data])

  const allRows = useMemo<SheetRow[]>(() => !data ? [] : [
    ...data.rows,
    ...(data.screenRows?.virtual ?? []).map((v) => ({ id: `virtual:${v.key}`, data: v.data, confirmed: null, locked: true, virtual: true })),
  ], [data])
  const resultOf = (r: SheetRow): ScreenRowResult | null =>
    (r.virtual ? data?.screenRows?.virtual.find((v) => `virtual:${v.key}` === r.id) : data?.screenRows?.notes[r.id]) ?? null
  const viewing = viewingId ? allRows.find((r) => r.id === viewingId) ?? null : null

  const fxHint = (rowId: string, col: string): { text: string; title: string } | null => {
    const cols = data?.fxShownColumns
    const fx = cols ? data?.fxShown[rowId] : undefined
    if (!cols || !fx || (col !== cols.rate && col !== cols.unit)) return null
    const title = t(`fx_shown_${fx.source}`).replace('{date}', fx.source === 'estv-monthly' ? fx.validFor.slice(0, 7) : fx.validFor)
    return { text: col === cols.rate ? fx.rate : String(fx.unit), title }
  }

  const periodRows = useMemo(() => {
    if (!data) return []
    let list = allRows
    if (task?.periodStart && task.periodEnd && data.dateColumn) {
      const col = data.dateColumn
      list = list.filter((r) => { const d = String(r.data[col] ?? '').slice(0, 10); return d >= task.periodStart! && d <= task.periodEnd! })
    }
    const sortCol = data.dateColumn ?? data.effectiveFromColumn
    return sortCol ? [...list].sort((a, b) => String(b.data[sortCol] ?? '').localeCompare(String(a.data[sortCol] ?? ''))) : list
  }, [data, allRows, task])
  const evidenceOptions = data?.options[EVIDENCE_COLUMN] ?? null
  const evidenceCounts = useMemo(() => {
    if (!evidenceOptions) return null
    const m = new Map<string, number>()
    for (const r of periodRows) { const v = typeof r.data[EVIDENCE_COLUMN] === 'string' ? r.data[EVIDENCE_COLUMN] as string : ''; m.set(v, (m.get(v) ?? 0) + 1) }
    return m
  }, [periodRows, evidenceOptions])
  const rows = useMemo(() => {
    const list = evidenceFilter === null ? periodRows : periodRows.filter((r) => (typeof r.data[EVIDENCE_COLUMN] === 'string' ? r.data[EVIDENCE_COLUMN] : '') === evidenceFilter)
    const col = sort && data?.schema.columns.find((c) => c.name === sort.col)
    if (!sort || !col || !data) return list
    const numeric = col.type === 'money' || col.type === 'decimal' || col.type === 'number'
    const key = (r: SheetRow): number | string | null => {
      const v = r.data[col.name]
      if (v === undefined || v === null || v === '') return null
      if (!numeric) return cell(lang, v, data.options[col.name])
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const x = key(a), y = key(b)
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
      return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), lang, { numeric: true }))
    })
  }, [periodRows, evidenceFilter, sort, data, lang])
  const toggleSort = (name: string) => setSort((cur) => (cur?.col !== name ? { col: name, dir: 'asc' } : cur.dir === 'asc' ? { col: name, dir: 'desc' } : null))
  const rowNo = useMemo(() => new Map(periodRows.filter((r) => !r.virtual).map((r, i) => [r.id, i + 1])), [periodRows])

  const visibleIds = new Set(rows.map((r) => r.id))
  const unconfirmed = rows.filter((r) => r.confirmed === false && !r.locked).length
    + (evidenceFilter !== null ? 0 : data?.pairs.filter((p) => !p.confirmed && !p.locked && visibleIds.has(p.fromRowId)).length ?? 0)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try { await fn() } catch (e) { setNotice(errorText(lang, e)) } finally { setBusy(false) }
  }

  const save = async (values: Record<string, unknown>, confirm: boolean, fileChange: string | null | undefined) => {
    setBusy(true)
    setEditError(null)
    try {
      const file = fileChange === undefined ? {} : { fileId: fileChange }
      if (editing === 'new') await api('POST', `${base}/rows`, { data: values, confirm, ...file })
      else if (editing) await api('PATCH', `${base}/rows/${editing.id}`, { data: values, confirm, ...file })
      setEditing(null)
      await load()
    } catch (e) {
      setEditError(errorText(lang, e))
    } finally {
      setBusy(false)
    }
  }

  const remove = (row: SheetRow) => run(async () => { setDeleting(null); await api('DELETE', `${base}/rows/${row.id}`); await load() })

  const confirmOne = (row: SheetRow) => run(async () => { await api('POST', `${base}/confirm`, { rowIds: [row.id] }); await load() })

  const filteredByTask = !!(task?.periodStart && task.periodEnd && data?.dateColumn)
  const confirmAll = () => run(async () => {
    const body = evidenceFilter !== null
      ? { rowIds: rows.filter((x) => x.confirmed === false && !x.locked).map((x) => x.id) }
      : filteredByTask ? { all: true, period: { start: task!.periodStart, end: task!.periodEnd } } : { all: true }
    const r = await api<{ confirmed: number; pairs: number; skippedLocked: number }>('POST', `${base}/confirm`, body)
    await load()
    setNotice([t('confirm_all_done').replace('{n}', String(r.confirmed)), r.pairs ? t('confirm_all_pairs').replace('{n}', String(r.pairs)) : '', r.skippedLocked ? t('confirm_all_skipped').replace('{n}', String(r.skippedLocked)) : ''].filter(Boolean).join(' · '))
  })

  if (loadError) return <p className="p-4 text-sm text-red-400 whitespace-pre-line">{loadError}</p>
  if (!data) return <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[#2A2A2A]">
        <span className="text-xs text-gray-400">
          {rows.filter((r) => !r.virtual).length} {t('rows')}{data.confirmable && unconfirmed > 0 ? ` · ${unconfirmed} ${t('to_confirm')}` : ''}
        </span>
        {evidenceCounts && evidenceOptions && (
          <div className="flex flex-wrap items-center gap-1">
            <button onClick={() => setEvidenceFilter(null)} className={`px-2 py-0.5 text-xs rounded-full ${evidenceFilter === null ? 'bg-[#3A3A3A] text-white' : 'text-gray-400 hover:text-white'}`}>{t('evidence_all')}</button>
            {[...evidenceOptions, ''].filter((v) => (evidenceCounts.get(v) ?? 0) > 0).map((v) => (
              <button key={v || 'none'} onClick={() => setEvidenceFilter(evidenceFilter === v ? null : v)}
                className={`px-2 py-0.5 text-xs rounded-full tabular-nums ${v ? EVIDENCE_CLS[v] ?? '' : 'text-gray-400'} ${evidenceFilter === v ? 'ring-1 ring-white/60' : ''}`}>
                {v ? t(`opt_${v}`, v) : t('evidence_unset')} {evidenceCounts.get(v)}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {data.confirmable && !readOnly && (
          <button onClick={confirmAll} disabled={busy || unconfirmed === 0} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40">
            <CheckCheck className="w-4 h-4" /> {t('confirm_all')}
          </button>
        )}
        {!readOnly && imports.map((im) => (
          <button key={im.module} onClick={() => { setNotice(null); setImporting(im) }} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40">
            <FileUp className="w-4 h-4" /> {t(`mod_${im.module}`, im.module)}
          </button>
        ))}
        {!readOnly && data.manualRows && (
          <button onClick={() => { setEditError(null); setEditing('new') }} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
            <Plus className="w-4 h-4" /> {t('add_row')}
          </button>
        )}
      </div>
      {notice && <p className="px-4 py-2 text-sm text-amber-300 whitespace-pre-line border-b border-[#2A2A2A]">{notice}</p>}

      <div className="flex-1 min-h-0 overflow-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">{t('no_rows')}</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-[#171717] z-10">
              <tr className="text-left text-xs text-gray-400">
                <th className="px-2 py-2 font-normal w-8 text-right">#</th>
                {data.confirmable && <th className="px-3 py-2 font-normal w-10 whitespace-nowrap">{t('status')}</th>}
                <th className="px-3 py-2 font-normal w-24 whitespace-nowrap">{t('actions')}</th>
                {visible.map((c) => {
                  const on = sort?.col === c.name ? sort.dir : null
                  return (
                    <th key={c.name} aria-sort={on === 'asc' ? 'ascending' : on === 'desc' ? 'descending' : 'none'} className={`px-3 py-2 font-normal whitespace-nowrap ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right' : ''}`}>
                      <button type="button" onClick={() => toggleSort(c.name)} title={t('sort_by')} className={`inline-flex items-center gap-1 hover:text-white ${on ? 'text-white' : ''}`}>
                        {t(`col_${c.name}`, c.name)}
                        {on === 'asc' ? <ArrowUp className="w-3 h-3" /> : on === 'desc' ? <ArrowDown className="w-3 h-3" /> : null}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} tabIndex={0}
                  onClick={(e) => { if (!(e.target as HTMLElement).closest('button,a,input,label')) setViewingId(r.id) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setViewingId(r.id) }}
                  className="border-t border-[#2A2A2A] hover:bg-[#232323] cursor-pointer focus:outline-none focus-visible:bg-[#232323]">
                  <td className="px-2 py-2 text-right text-xs text-gray-500 tabular-nums select-none">{rowNo.get(r.id)}</td>
                  {data.confirmable && (
                    <td className="px-3 py-2">
                      {r.confirmed && r.confirmedByAi ? (
                        <span className="inline-flex items-center gap-0.5 text-sky-300" title={`${t('confirmed_by_ai')}${typeof r.data.aiReason === 'string' && r.data.aiReason ? ` — ${r.data.aiReason}` : ''}`}>
                          <Check className="w-4 h-4" /><span className="text-[10px] font-medium">AI</span>
                        </span>
                      ) : r.confirmed ? <Check className="w-4 h-4 text-emerald-400" aria-label={t('confirmed')} /> : <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title={t('unconfirmed')} />}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex gap-1 items-center">
                      {resultOf(r) && (() => {
                        const res = resultOf(r)!
                        const cls = res.status === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : res.status === 'mismatch' ? 'bg-red-500/15 text-red-300' : 'bg-gray-500/15 text-gray-400'
                        return (
                          <span className={`px-2 py-0.5 text-[11px] rounded-full whitespace-nowrap ${cls}`} title={r.virtual ? t('bal_virtual_title') : undefined}>
                            {t(`bal_${res.status}`, res.status).replace('{diff}', res.diff ?? '')}
                          </span>
                        )
                      })()}
                      {!r.virtual && data.fileColumn && typeof r.data[data.fileColumn] === 'string' && (
                        <button onClick={() => void files.open(projectId, r.data[data.fileColumn!] as string).catch((e) => setNotice(errorText(lang, e)))} className="p-1 text-gray-300 hover:text-white" title={t('file_open')}>
                          <Paperclip className="w-4 h-4" />
                        </button>
                      )}
                      {!r.virtual && data.pairDefs.length > 0 && (() => {
                        const ps = data.pairs.filter((p) => p.fromRowId === r.id)
                        const open = ps.some((p) => !p.confirmed)
                        return (
                          <button onClick={() => setPairing(r)} className={`p-1 inline-flex items-center gap-0.5 ${open ? 'text-amber-300' : ps.length ? 'text-gray-300' : 'text-gray-500'} hover:text-white`} title={t('pairs_title')}>
                            <Link2 className="w-4 h-4" />{ps.length > 0 && <span className="text-[10px] tabular-nums">{ps.length}</span>}
                          </button>
                        )
                      })()}
                      {r.virtual ? null : r.locked ? (
                        <Lock className="w-4 h-4 text-gray-500" aria-label={t('locked')}><title>{t('locked')}</title></Lock>
                      ) : !readOnly && (
                        <>
                          {data.confirmable && r.confirmed === false && (
                            <button onClick={() => void confirmOne(r)} disabled={busy} className="p-1 text-gray-400 hover:text-emerald-400" title={t('confirm')}><Check className="w-4 h-4" /></button>
                          )}
                          <button onClick={() => { setEditError(null); setEditing(r) }} disabled={busy} className="p-1 text-gray-400 hover:text-white" title={t('edit')}><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setDeleting(r)} disabled={busy} className="p-1 text-gray-400 hover:text-red-400" title={t('delete')}><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </td>
                  {visible.map((c) => (
                    <td key={c.name} title={typeof r.data[c.name] === 'string' && (r.data[c.name] as string).length > 30 ? r.data[c.name] as string : undefined}
                      className={`px-3 py-2 ${r.virtual ? 'text-gray-500' : 'text-gray-200'} max-w-[16rem] truncate ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}>
                      {c.name === EVIDENCE_COLUMN && typeof r.data[c.name] === 'string' && EVIDENCE_CLS[r.data[c.name] as string]
                        ? <span className={`px-2 py-0.5 text-xs rounded-full ${EVIDENCE_CLS[r.data[c.name] as string]}`}>{cell(lang, r.data[c.name], data.options[c.name])}</span>
                        : r.data[c.name] == null && fxHint(r.id, c.name)
                          ? <span className="text-gray-500" title={fxHint(r.id, c.name)!.title}>{fxHint(r.id, c.name)!.text}</span>
                          : cell(lang, r.data[c.name], data.options[c.name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.help && (
          <div className="mx-4 my-6 max-w-3xl rounded-lg border border-[#2A2A2A] bg-[#1C1C1C] px-5 py-4 prose prose-invert prose-sm">
            <MessageContent content={t(data.help)} role="assistant" theme="dark" size="sm" enableJsonTable={false} />
          </div>
        )}
      </div>

      {importing && (
        <ImportDialog
          api={api}
          files={files}
          lang={lang}
          projectId={projectId}
          spec={importing}
          accounts={data.refOptions[importing.accountColumn] ?? []}
          onDone={(n) => { setImporting(null); setNotice(t('import_done').replace('{n}', String(n))); void load() }}
          onClose={() => setImporting(null)}
        />
      )}
      {pairing && (
        <PairDialog api={api} lang={lang} projectId={projectId} sheet={data} row={pairing} readOnly={readOnly} onChanged={() => void load()} onClose={() => setPairing(null)} />
      )}
      {deleting && (
        <ConfirmDialog message={t('delete_row_confirm')} okLabel={t('delete')} cancelLabel={t('cancel')} busy={busy} onOk={() => void remove(deleting)} onCancel={() => setDeleting(null)} />
      )}
      {viewing && (
        <RowViewer
          key={viewing.id}
          lang={lang}
          columns={visible}
          row={viewing}
          format={(c, v) => cell(lang, v, data.options[c.name])}
          hint={(c) => fxHint(viewing.id, c.name)}
          fileColumn={data.fileColumn}
          onOpenFile={(id) => { const from = viewing.id; void files.open(projectId, id).catch((e) => { setViewingId((cur) => (cur === from ? null : cur)); setNotice(errorText(lang, e)) }) }}
          onEdit={readOnly || viewing.locked ? null : () => { const r = viewing; setViewingId(null); setEditError(null); setEditing(r) }}
          onClose={() => setViewingId(null)}
        />
      )}
      {editing && (
        <RowEditor
          lang={lang}
          title={editing === 'new' ? t('add_row') : t('edit')}
          columns={visible}
          options={data.options}
          refOptions={data.refOptions}
          row={editing === 'new' ? null : editing}
          confirmable={data.confirmable}
          busy={busy}
          error={editError}
          fileColumn={data.fileColumn}
          onUpload={async (f) => {
            try { return (await files.upload(projectId, f, 'receipt')).id } catch (e) { throw new Error(errorText(lang, e)) }
          }}
          onOpenFile={(id) => void files.open(projectId, id).catch((e) => setEditError(errorText(lang, e)))}
          onSave={(v, c, fc) => void save(v, c, fc)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
