'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Ban, Check, CheckCheck, Copy, Download, FileCheck2, FileText, FileUp, Filter, Link2, Loader2, Lock, Minus, Paperclip, Pencil, Play, Plus, ReceiptText, Send, Trash2, XCircle, MessageSquare, CalendarPlus } from 'lucide-react'
import { workStopText, workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type DerivedColumn, type ScreenRowResult, type SendView, type SheetImport, type SheetRow, type SheetScreen, type SheetSummary, type TaskSummary, type WorkApi, type WorkFiles } from '../lib/api'
import { SendCard } from './SendsPanel'
import { RowEditor } from './RowEditor'
import { EVIDENCE_COLUMN, sheetCellText as cell, sheetExportTable, sheetSortRows, sheetTableColumns, sheetTableLayout, sheetVisibleColumns, type ObjText } from '@/lib/work/sheet-text'
import { RowViewer } from './RowViewer'
import { MessageContent } from '@/components/chat/MessageContent'
import { ConfirmDialog } from './ConfirmDialog'
import { SelectSendDialog, type SelectSendItem } from './SelectSendDialog'
import { PairDialog } from './PairDialog'
import { ImportDialog } from './ImportDialog'
import { ImageBox } from './ImageBox'
import { useWorkPkg } from './work-pkg'
import { IntakeLinkButton } from './IntakeLinkButton'

interface Props {
  api: WorkApi
  files: WorkFiles
  lang: WorkLang
  projectId: string
  sheet: SheetSummary
  task: TaskSummary | null
  readOnly: boolean
  imports: SheetImport[]
  onActed?: () => void
  onAskAi?: (text: string) => void
}

export function errorText(lang: WorkLang, e: unknown, pkg?: string | null): string {
  if (e instanceof WorkApiError) {
    const base = workT(lang, `err_${e.code}`, workT(lang, 'err_INTERNAL', undefined, pkg), pkg)
    const stop = e.stop ? workStopText(lang, e.stop, pkg) : null
    if (stop) return `${base}\n${stop}`
    return e.detail ? `${base}\n(${e.detail})` : base
  }
  return workT(lang, 'err_INTERNAL', undefined, pkg)
}

const EVIDENCE_CLS: Record<string, string> = {
  attached: 'bg-emerald-500/15 text-emerald-300',
  needed: 'bg-orange-500/20 text-orange-300',
  explained: 'bg-sky-500/15 text-sky-300',
  not_needed: 'bg-gray-500/15 text-gray-400',
}

const EXPORT_MAX_ROWS = 5000

const DOT_CLS: Record<string, string> = { gray: 'bg-gray-500', yellow: 'bg-amber-400', green: 'bg-emerald-500', red: 'bg-red-500' }
const DOT_TEXT_CLS: Record<string, string> = { gray: 'text-gray-400', yellow: 'text-amber-300', green: 'text-emerald-300', red: 'text-red-300' }

const DERIVED_STATUS_CLS: Record<string, string> = {
  paid: 'bg-emerald-500/15 text-emerald-300',
  partial: 'bg-sky-500/15 text-sky-300',
  pending: 'bg-amber-500/20 text-amber-300',
  overdue: 'bg-red-500/15 text-red-300',
  overpaid: 'bg-orange-500/20 text-orange-300',
  none: 'bg-gray-500/15 text-gray-400',
}

const PICK_MAX = 500

export function SheetTable({ api, files, lang, projectId, sheet, task, readOnly, imports, onActed, onAskAi }: Props) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [data, setData] = useState<SheetScreen | null>(null)
  const objText: ObjText = { options: data?.options ?? {}, label: (k) => data?.labels?.[k] ?? t(data?.colLabels?.[k] ?? `col_${k}`, k) }
  const cw = (k: 'confirm' | 'confirm_all' | 'confirmed' | 'unconfirmed' | 'to_confirm') => (data?.confirmAs === 'approve' ? t(`approve_${k}`, t(k)) : t(k))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SheetRow | 'new' | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [userSort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [docBusy, setDocBusy] = useState<string | null>(null)
  const [appCard, setAppCard] = useState<SendView | null>(null)
  const [deleting, setDeleting] = useState<SheetRow | null>(null)
  const [pairing, setPairing] = useState<SheetRow | null>(null)
  const [importing, setImporting] = useState<SheetImport | null>(null)
  const [evidenceFilter, setEvidenceFilter] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [asking, setAsking] = useState<{ row: SheetRow; action: SheetScreen['rowActions'][number]; text: string } | null>(null)
  const [closing, setClosing] = useState<{ row: SheetRow; action: { column: string; kind: 'reason' | 'today'; label: string }; text: string } | null>(null)

  const [pq, setPq] = useState<{ year?: number | 'all'; sort?: { col: string; dir: 'asc' | 'desc' }; showHidden?: boolean; filters?: Record<number, string> }>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickAsking, setPickAsking] = useState(false)
  const [pickDoc, setPickDoc] = useState<string | null>(null)
  const pickSeq = useRef(0)
  const pickFrozen = useRef<SheetRow[]>([])
  const sendRows = () => (data?.select?.preview ? pickFrozen.current : rows.filter((r) => picked.has(r.id)))
  useEffect(() => () => { pickSeq.current++ }, [])
  useEffect(() => () => { if (pickDoc) URL.revokeObjectURL(pickDoc) }, [pickDoc])
  useEffect(() => { setPicked(new Set()) }, [pq, evidenceFilter, showHidden, sheet.id, task?.id])
  const seq = useRef(0)

  const base = `/projects/${projectId}/sheets/${sheet.id}`
  const periodStart = task?.periodStart ?? null
  const periodEnd = task?.periodEnd ?? null
  const url = useCallback((after?: string) => {
    const sp = new URLSearchParams()
    if (periodStart && periodEnd) { sp.set('from', periodStart); sp.set('to', periodEnd) } else if (pq.year !== undefined) sp.set('year', typeof pq.year === 'number' ? String(pq.year).padStart(4, '0') : pq.year)
    if (pq.sort) sp.set('sort', `${pq.sort.col}:${pq.sort.dir}`)
    if (pq.showHidden) sp.set('hidden', '1')
    for (const [i, v] of Object.entries(pq.filters ?? {})) if (v) sp.set(`f${i}`, v)
    if (after) sp.set('after', after)
    const q = sp.toString()
    return q ? `${base}?${q}` : base
  }, [base, periodStart, periodEnd, pq])
  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      setLoadError(null)
      const d = await api<SheetScreen>('GET', url())
      if (my === seq.current) setData(d)
    } catch (e) {
      if (my === seq.current) setLoadError(errorText(lang, e, pkg))
    }
  }, [api, url, lang, pkg])

  useEffect(() => { setData(null); setNotice(null); setEvidenceFilter(null); setSort(null); setPq((c) => (Object.keys(c).length ? {} : c)) }, [base])
  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => (data ? sheetVisibleColumns(data) : []), [data])

  const allRows = useMemo<SheetRow[]>(() => !data ? [] : [
    ...data.rows,
    ...(data.screenRows?.virtual ?? []).map((v) => ({ id: `virtual:${v.key}`, data: v.data, confirmed: null, locked: true, virtual: true })),
  ], [data])
  const resultOf = (r: SheetRow): ScreenRowResult | null =>
    (r.virtual ? data?.screenRows?.virtual.find((v) => `virtual:${v.key}` === r.id) : data?.screenRows?.notes[r.id]) ?? null
  const viewing = viewingId ? allRows.find((r) => r.id === viewingId) ?? null : null

  const derivedCols = data?.derived?.columns ?? []
  const tableCols = useMemo(() => (data ? sheetTableColumns(data, visible) : visible), [data, visible])
  const derivedValue = (r: SheetRow, c: DerivedColumn): string | null => {
    const v = r.virtual ? undefined : data?.derived?.cells[r.id]?.[c.name]
    return v === undefined || v === null || v === '' ? null : String(v)
  }
  const derivedText = (c: DerivedColumn, v: string) => (c.type === 'status' ? t(`${c.label}_${v}`, v) : v)
  const tableLayout = useMemo(() => (data ? sheetTableLayout(data, tableCols) : []), [data, tableCols])

  const fxHint = (rowId: string, col: string): { text: string; title: string } | null => {
    const cols = data?.fxShownColumns
    const fx = cols ? data?.fxShown[rowId] : undefined
    if (!cols || !fx || (col !== cols.rate && col !== cols.unit)) return null
    const title = t(`fx_shown_${fx.source}`).replace('{date}', fx.source === 'estv-monthly' ? fx.validFor.slice(0, 7) : fx.validFor)
    return { text: col === cols.rate ? fx.rate : String(fx.unit), title }
  }

  const periodRows = useMemo(() => {
    if (!data) return []
    if (data.paging) return allRows
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
    if (data?.paging) return periodRows
    const shown = data?.hideWhen && !showHidden ? periodRows.filter((r) => { const v = r.data[data.hideWhen!]; return v === undefined || v === null || v === '' }) : periodRows
    const list = evidenceFilter === null ? shown : shown.filter((r) => (typeof r.data[EVIDENCE_COLUMN] === 'string' ? r.data[EVIDENCE_COLUMN] : '') === evidenceFilter)
    const sort = userSort ?? (data?.sortBy ? { col: data.sortBy.column, dir: data.sortBy.dir } : null)
    return data ? sheetSortRows(lang, pkg, data, list, sort) : list
  }, [periodRows, evidenceFilter, userSort, data, lang, pkg, showHidden])
  const toggleSort = (name: string) => {
    const paging = data?.paging
    if (!paging) return setSort((given) => {
      const cur = given ?? (data?.sortBy ? { col: data.sortBy.column, dir: data.sortBy.dir } : null)
      return cur?.col !== name ? { col: name, dir: 'asc' } : cur.dir === 'asc' ? { col: name, dir: 'desc' } : null
    })
    if (!paging.sortable.includes(name)) return
    setPq((cur) => ({ ...cur, sort: cur.sort?.col !== name ? { col: name, dir: 'asc' } : cur.sort.dir === 'asc' ? { col: name, dir: 'desc' } : undefined }))
  }
  const loadMore = () => run(async () => {
    const next = data?.paging?.next
    if (!next) return
    const my = seq.current
    const d = await api<SheetScreen>('GET', url(next))
    if (my !== seq.current) return
    setData((cur) => {
      if (!cur) return cur
      const have = new Set(cur.rows.map((r) => r.id))
      return {
        ...cur,
        rows: [...cur.rows, ...d.rows.filter((r) => !have.has(r.id))],
        pairs: [...cur.pairs, ...d.pairs.filter((p) => !have.has(p.fromRowId))],
        fxShown: { ...cur.fxShown, ...d.fxShown },
        derived: cur.derived && d.derived ? { ...cur.derived, cells: { ...cur.derived.cells, ...d.derived.cells } } : d.derived ?? cur.derived,
        paging: d.paging,
      }
    })
  })
  const downloadSheet = (format: 'xlsx' | 'csv' | 'pdf') => run(async () => {
    if (!data) return
    let list = rows
    let derivedCells = data.derived?.cells ?? {}
    if (data.paging) {
      const my = seq.current
      let next = data.paging.next
      while (next) {
        if (list.length > EXPORT_MAX_ROWS) break
        const d = await api<SheetScreen>('GET', url(next))
        if (my !== seq.current) return
        const have = new Set(list.map((r) => r.id))
        list = [...list, ...d.rows.filter((r) => !have.has(r.id))]
        derivedCells = { ...derivedCells, ...(d.derived?.cells ?? {}) }
        next = d.paging?.next ?? null
      }
    }
    list = list.filter((r) => !r.virtual)
    if (list.length > EXPORT_MAX_ROWS) { setNotice(t('sheet_download_too_many').replace('{n}', EXPORT_MAX_ROWS.toLocaleString(lang))); return }
    await saveTable(format, sheetExportTable(lang, pkg, data, list, derivedCells), sheet.name || 'sheet')
  })
  const saveTable = async (format: 'xlsx' | 'csv' | 'pdf', table: { header: string[]; rows: string[][]; align: string[] }, name: string) => {
    const blob = await files.exportTable(projectId, format, table)
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    a.href = href; a.download = `${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}-${stamp}.${format}`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 30_000)
  }

  const rowNo = useMemo(() => new Map(periodRows.filter((r) => !r.virtual).map((r, i) => [r.id, i + 1])), [periodRows])

  const visibleIds = new Set(rows.map((r) => r.id))
  const unconfirmed = data?.paging ? data.paging.unconfirmed : rows.filter((r) => r.confirmed === false && !r.locked).length
    + (evidenceFilter !== null ? 0 : data?.pairs.filter((p) => !p.confirmed && !p.locked && visibleIds.has(p.fromRowId)).length ?? 0)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try { await fn() } catch (e) { setNotice(errorText(lang, e, pkg)) } finally { setBusy(false) }
  }

  const save = async (values: Record<string, unknown>, confirm: boolean, fileChange: string | null | undefined) => {
    setBusy(true)
    setEditError(null)
    try {
      const file = fileChange === undefined ? {} : { fileId: fileChange }
      const after = editing && editing !== 'new' && confirm ? primaryOf(editing) : undefined
      if (editing === 'new') await api('POST', `${base}/rows`, { data: values, confirm, ...file })
      else if (editing) await api('PATCH', `${base}/rows/${editing.id}`, { data: values, confirm: after ? false : confirm, ...file })
      const row = editing !== 'new' ? editing : null
      setEditing(null)
      await load()
      if (after && row) { if (after.ask) setAsking({ row, action: after, text: '' }); else void rowAction(after, row) }
    } catch (e) {
      setEditError(errorText(lang, e, pkg))
    } finally {
      setBusy(false)
    }
  }

  const formRow = data?.form ? data.rows[0] ?? null : null
  const formColumns = useMemo(() => {
    if (!data?.form) return []
    const names = new Set(data.form.groups.flatMap((g) => g.columns))
    return visible.filter((c) => names.has(c.name))
  }, [data, visible])
  const saveForm = async (values: Record<string, unknown>, confirm: boolean) => {
    setBusy(true)
    setEditError(null)
    try {
      if (formRow) await api('PATCH', `${base}/rows/${formRow.id}`, { data: values, confirm })
      else await api('POST', `${base}/rows`, { data: values, confirm })
      await load()
    } catch (e) {
      setEditError(errorText(lang, e, pkg))
    } finally {
      setBusy(false)
    }
  }

  const remove = (row: SheetRow) => run(async () => { setDeleting(null); await api('DELETE', `${base}/rows/${row.id}`); await load(); onActed?.() })

  const rowAction = (a: SheetScreen['rowActions'][number], row: SheetRow, reason?: string) => {
    const w = a.result === 'pdf' ? window.open('', '_blank') : null
    return run(async () => {
      let msg: string | null = null
      try {
        const r = await api<{ output?: { pdfBase64?: unknown; message?: unknown; count?: unknown } }>('POST', `/projects/${projectId}/modules/${encodeURIComponent(a.module)}`, { input: { ...(a.input ?? {}), [a.inputKey]: row.id, ...(reason !== undefined ? { reason } : {}), ...(a.result === 'pdf' || a.withLang ? { lang } : {}) } })
        if (a.result === 'pdf') {
          const b64 = typeof r?.output?.pdfBase64 === 'string' ? r.output.pdfBase64 : ''
          if (!b64) throw new Error('no pdf')
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
          if (w) w.location.href = url
          else if (!window.open(url, '_blank')) setNotice(t('module_run_preview_open'))
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
          return
        }
        msg = typeof r?.output?.message === 'string' && t(r.output.message, '') ? t(r.output.message).replace('{n}', String(typeof r.output.count === 'number' ? r.output.count : '')) : null
      } catch (e) {
        w?.close()
        throw e
      }
      setAsking(null)
      await load()
      onActed?.()
      setNotice(msg ?? t(`${a.label}_done`))
    })
  }
  const [sheetAsking, setSheetAsking] = useState<SheetScreen['sheetActions'][number] | null>(null)
  const sheetAction = (a: SheetScreen['sheetActions'][number]) => run(async () => {
    const r = await api<{ output?: { message?: unknown; count?: unknown } }>('POST', `/projects/${projectId}/modules/${encodeURIComponent(a.module)}`, { input: { ...(a.input ?? {}) } })
    setSheetAsking(null)
    await load()
    onActed?.()
    const key = typeof r?.output?.message === 'string' ? r.output.message : `${a.label}_done`
    setNotice(t(key).replace('{n}', String(typeof r?.output?.count === 'number' ? r.output.count : '')))
  })
  const sel = data?.select ?? null
  const pickable = (r: SheetRow) => !!sel && !r.virtual && sel.when.in.includes(String(data?.derived?.cells[r.id]?.[sel.when.cell] ?? ''))
  const hide = (k: 'confirm' | 'confirmAll' | 'edit' | 'delete' | 'add' | 'editConfirm' | 'rowFile') => (data?.hideCommon ?? []).includes(k)
  const editLocked = (r: SheetRow) => { const v = data?.lockEditWhen ? r.data[data.lockEditWhen] : null; return !(v === undefined || v === null || v === '') }
  const onlyItemsOf = (r: SheetRow) => (editLocked(r) && data?.lockEditOnly && !(data.lockEditOnly.exceptWhen && actionShown({ when: data.lockEditOnly.exceptWhen }, r)) ? data.lockEditOnly.items : null)
  const actionsCol = !data || !data.moduleOnly || data.confirmable || data.rowActions.length > 0 || (data.closeActions ?? []).length > 0
    || !!data.fileColumn || (data.openFiles ?? []).length > 0 || data.pairDefs.length > 0 || !!data.screenRows
  const pickedSummary = () => {
    const ids = sendRows()
    if (!sel?.summary) return String(ids.length)
    return t('select_summary').replace('{n}', String(ids.length)).replace('{totals}', pickedTotals().join(' · ') || '—')
  }
  const cellOf = (r: SheetRow, col: string): string => {
    const v = r.data[col] ?? data?.derived?.cells[r.id]?.[col]
    const s = v === undefined || v === null ? '' : String(v)
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : s
  }
  const pickedItems = (): SelectSendItem[] => {
    const sum = sel?.summary
    if (!sum) return []
    return sendRows().map((r) => ({
      title: sum.title ? cellOf(r, sum.title) : '',
      details: (sum.details ?? []).map((c) => ({ label: colLabel(c), value: cellOf(r, c) })).filter((d) => d.value),
      flags: (sum.flags ?? []).filter((c) => r.data[c] === true).map((c) => colLabel(c)),
      amount: String(r.data[sum.amount] ?? ''),
      currency: String(r.data[sum.currency] ?? ''),
    }))
  }
  const pickedTotals = (): string[] => {
    const ids = sendRows()
    if (!sel?.summary) return []
    const by = new Map<string, bigint>()
    let unread = 0
    for (const r of ids) {
      const m = /^(-?)(\d{1,15})(?:\.(\d{1,2}))?$/.exec(String(r.data[sel.summary.amount] ?? '').trim())
      const c = String(r.data[sel.summary.currency] ?? '')
      if (!m || !c) { unread++; continue }
      const cents = BigInt(m[2]) * BigInt(100) + BigInt((m[3] ?? '').padEnd(2, '0') || '0')
      by.set(c, (by.get(c) ?? BigInt(0)) + (m[1] ? -cents : cents))
    }
    const show = (v: bigint) => { const neg = v < BigInt(0); const a = neg ? -v : v; return `${neg ? '-' : ''}${(a / BigInt(100)).toString()}.${(a % BigInt(100)).toString().padStart(2, '0')}` }
    return [...[...by].sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => `${c} ${show(v)}`), ...(unread ? [`? ×${unread}`] : [])]
  }
  const openPick = () => {
    setPickAsking(true)
    const pv = data?.select?.preview
    const my = ++pickSeq.current
    if (!pv) return
    setPickDoc(null)
    pickFrozen.current = rows.filter((r) => picked.has(r.id))
    void api<{ output?: { pdfBase64?: unknown } }>('POST', `/projects/${projectId}/modules/${encodeURIComponent(pv.module)}`, { input: { [pv.inputKey]: pickFrozen.current.map((r) => r.id), lang } })
      .then((r) => {
        const b64 = typeof r?.output?.pdfBase64 === 'string' ? r.output.pdfBase64 : ''
        if (!b64) throw new Error('no pdf')
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        if (my === pickSeq.current) setPickDoc(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })))
      })
      .catch(() => { if (my === pickSeq.current) setPickDoc('') })
  }
  const sendPicked = () => run(async () => {
    if (!sel) return
    pickSeq.current++
    const ids = sendRows().map((r) => r.id)
    if (!ids.length) { setPickAsking(false); return }
    if (ids.length > PICK_MAX) { setPickAsking(false); setNotice(t('select_too_many').replace('{n}', String(PICK_MAX))); return }
    await api('POST', `/projects/${projectId}/modules/${encodeURIComponent(sel.module)}`, { input: { ...(sel.input ?? {}), [sel.inputKey]: ids } })
    setPickAsking(false)
    setPicked(new Set())
    await load()
    onActed?.()
    setNotice(t(`${sel.label}_done`))
  })
  const actionShown = (a: { when?: { cell: string; in: readonly string[] } | null }, r: SheetRow) => !a.when || a.when.in.includes(String(data?.derived?.cells[r.id]?.[a.when.cell] ?? ''))
  const colLabel = (n: string) => data?.labels?.[n] ?? t(data?.colLabels?.[n] ?? `col_${n}`, n)
  const textBtn = 'px-2 py-0.5 text-xs rounded-md border border-white/15 text-gray-200 hover:bg-white/10 whitespace-nowrap disabled:opacity-40'
  const primaryOf = (r: SheetRow) => (readOnly || r.virtual ? undefined : data?.rowActions.find((a) => a.primary && actionShown(a, r)))
  const primaryAlert = (r: SheetRow, a: SheetScreen['rowActions'][number]) => {
    const cells = data?.derived?.cells[r.id] ?? {}
    const col = a.when ? derivedCols.find((c) => c.name === a.when!.cell) : undefined
    const head = col && cells[col.name] ? derivedText(col, String(cells[col.name])) : ''
    const note = a.note && cells[a.note] ? `${t('review_reason')}: ${cells[a.note]}` : ''
    return [head, note].filter(Boolean).join('\n') || null
  }

  const confirmOne = (row: SheetRow) => run(async () => { await api('POST', `${base}/confirm`, { rowIds: [row.id] }); await load() })
  const closeRow = (c: NonNullable<typeof closing>) => run(async () => {
    const d = new Date()
    const value = c.action.kind === 'today' ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : c.text.trim()
    await api('PATCH', `${base}/rows/${c.row.id}`, { data: { [c.action.column]: value }, confirm: true })
    setClosing(null)
    await load()
  })
  const hiddenCount = data?.paging ? data.paging.hidden : data?.hideWhen ? periodRows.filter((r) => { const v = r.data[data.hideWhen!]; return !(v === undefined || v === null || v === '') }).length : 0

  const filteredByTask = !!(task?.periodStart && task.periodEnd && data?.dateColumn)
  const pageYear = !filteredByTask && typeof data?.paging?.year === 'number' ? data.paging.year : null
  const confirmAll = () => run(async () => {
    const body = evidenceFilter !== null || data?.paging?.filters?.some((f) => f.value)
      ? { rowIds: rows.filter((x) => x.confirmed === false && !x.locked).map((x) => x.id) }
      : filteredByTask ? { all: true, period: { start: task!.periodStart, end: task!.periodEnd } }
        : pageYear !== null ? { all: true, period: { start: `${String(pageYear).padStart(4, '0')}-01-01`, end: `${String(pageYear).padStart(4, '0')}-12-31` } } : { all: true }
    const r = await api<{ confirmed: number; pairs: number; skippedLocked: number; skippedCheck?: number }>('POST', `${base}/confirm`, body)
    await load()
    setNotice([t('confirm_all_done').replace('{n}', String(r.confirmed)), r.pairs ? t('confirm_all_pairs').replace('{n}', String(r.pairs)) : '', r.skippedLocked ? t('confirm_all_skipped').replace('{n}', String(r.skippedLocked)) : '', r.skippedCheck ? t('confirm_all_skipped_check').replace('{n}', String(r.skippedCheck)) : ''].filter(Boolean).join(' · '))
  })

  if (loadError) return <p className="p-4 text-sm text-red-400 whitespace-pre-line">{loadError}</p>
  if (!data) return <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[#2A2A2A]">
        {data.paging && !data.paging.period && (
          <select value={String(data.paging.year)} title={t('page_year_title')} disabled={busy}
            onChange={(e) => setPq((cur) => ({ ...cur, year: e.target.value === 'all' ? 'all' : Number(e.target.value) }))}
            className="px-2 py-1 text-xs rounded-md bg-[#2A2A2A] text-white border border-[#3A3A3A]">
            {[...new Set([...(typeof data.paging.year === 'number' ? [data.paging.year] : []), ...data.paging.years])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
            <option value="all">{t('page_all_years')}</option>
          </select>
        )}
        {(data.paging?.filters ?? []).filter((f) => f.options.length > 0).map((f) => (
          <select key={f.index} value={f.value ?? ''} disabled={busy}
            onChange={(e) => setPq((cur) => ({ ...cur, filters: { ...(cur.filters ?? {}), [f.index]: e.target.value } }))}
            className="px-2 py-1 text-xs rounded-md bg-[#2A2A2A] text-white border border-[#3A3A3A] max-w-[16rem]">
            <option value="">{t(f.label)}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        <span className="text-xs text-gray-400">
          {data.paging
            ? t('page_shown_of').replace('{shown}', rows.length.toLocaleString(lang)).replace('{total}', `${data.paging.matched.toLocaleString(lang)}${data.paging.matchedMore ? '+' : ''}`)
            : `${rows.filter((r) => !r.virtual).length} ${t('rows')}`}
          {data.confirmable && !hide('confirm') && unconfirmed > 0 ? ` · ${unconfirmed.toLocaleString(lang)}${data.paging?.unconfirmedMore ? '+' : ''} ${cw('to_confirm')}` : ''}
        </span>
        {hiddenCount > 0 && (
          <label className="inline-flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={data.paging ? data.paging.showHidden : showHidden} disabled={busy}
              onChange={(e) => (data.paging ? setPq((cur) => ({ ...cur, showHidden: e.target.checked })) : setShowHidden(e.target.checked))} className="accent-[#E07B53]" />
            {t('show_hidden_rows').replace('{n}', String(hiddenCount))}
          </label>
        )}
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
        {!readOnly && sel && picked.size > 0 && (
          <button onClick={() => (picked.size > PICK_MAX ? setNotice(t('select_too_many').replace('{n}', String(PICK_MAX))) : openPick())} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
            <Send className="w-4 h-4" /> {t(sel.label)} ({picked.size})
          </button>
        )}
        {!readOnly && (data.sheetActions ?? []).map((a) => (
          <button key={a.module + a.label} onClick={() => (a.ask ? setSheetAsking(a) : void sheetAction(a))} disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40">
            {a.icon === 'send' ? <Send className="w-4 h-4" /> : <RowActionIcon icon={a.icon} />} {t(a.label)}
          </button>
        ))}
        {data.confirmable && !readOnly && !hide('confirm') && !hide('confirmAll') && !(data.paging?.filters?.some((f) => f.value) && data.paging.next) && (
          <button onClick={confirmAll} disabled={busy || unconfirmed === 0} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40">
            <CheckCheck className="w-4 h-4" /> {cw('confirm_all')}
          </button>
        )}
        {!readOnly && <IntakeLinkButton key={`${projectId}:${sheet.id}`} api={api} projectId={projectId} sheetId={sheet.id} t={t} />}
        {!readOnly && <IntakeLinkButton key={`${projectId}:${sheet.id}:hook`} api={api} projectId={projectId} sheetId={sheet.id} t={t} kind="webhook" />}
        {!readOnly && imports.map((im) => (
          <button key={im.module} onClick={() => { setNotice(null); setImporting(im) }} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40">
            <FileUp className="w-4 h-4" /> {t(`mod_${im.module}`, im.module)}
          </button>
        ))}
        {!readOnly && data.manualRows && !data.moduleOnly && !data.form && !hide('add') && (
          <button onClick={() => { setEditError(null); setEditing('new') }} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
            <Plus className="w-4 h-4" /> {t('add_row')}
          </button>
        )}
      </div>
      {notice && <p className="px-4 py-2 text-sm text-amber-300 whitespace-pre-line border-b border-[#2A2A2A]">{notice}</p>}

      <div className="flex-1 min-h-0 overflow-auto">
        {data.form ? null : rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">{t('no_rows')}</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-[#171717] z-10">
              <tr className="text-left text-xs text-gray-400">
                {sel && !readOnly && (() => {
                  const can = rows.filter(pickable)
                  const all = can.length > 0 && can.slice(0, PICK_MAX).every((r) => picked.has(r.id))
                  return (
                    <th className="px-2 py-2 font-normal w-8">
                      <input type="checkbox" checked={all} disabled={busy || can.length === 0} aria-label={t('select_all')} title={t('select_all')}
                        onChange={() => setPicked(all ? new Set() : new Set(can.slice(0, PICK_MAX).map((r) => r.id)))} className="accent-[#E07B53] w-4 h-4" />
                    </th>
                  )
                })()}
                <th className="px-2 py-2 font-normal w-8 text-right">#</th>
                {data.confirmable && <th className="px-3 py-2 font-normal w-10 whitespace-nowrap">{t('status')}</th>}
                {actionsCol && <th className="px-3 py-2 font-normal w-24 whitespace-nowrap">{t('actions')}</th>}
                {tableLayout.map((x) => {
                  if (x.kind === 'derived') {
                    const c = x.col
                    return <th key={`derived:${c.name}`} className={`px-3 py-2 font-normal whitespace-nowrap ${c.type === 'money' ? 'text-right' : ''}`}>{t(c.label)}</th>
                  }
                  const c = x.col
                  const shownSort = userSort ?? (data.sortBy ? { col: data.sortBy.column, dir: data.sortBy.dir } : null)
                  const on = data.paging ? (data.paging.sort.col === c.name ? data.paging.sort.dir : null) : shownSort?.col === c.name ? shownSort.dir : null
                  if (data.paging && !data.paging.sortable.includes(c.name)) {
                    return (
                      <th key={c.name} title={t('page_sort_server_only')} className={`px-3 py-2 font-normal whitespace-nowrap ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right' : ''}`}>
                        {colLabel(c.name)}
                      </th>
                    )
                  }
                  return (
                    <th key={c.name} aria-sort={on === 'asc' ? 'ascending' : on === 'desc' ? 'descending' : 'none'} className={`px-3 py-2 font-normal whitespace-nowrap ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right' : ''}`}>
                      <button type="button" onClick={() => toggleSort(c.name)} title={t('sort_by')} className={`inline-flex items-center gap-1 hover:text-white ${on ? 'text-white' : ''}`}>
                        {colLabel(c.name)}
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
                  {sel && !readOnly && (
                    <td className="px-2 py-2">
                      {pickable(r) && (
                        <input type="checkbox" checked={picked.has(r.id)} disabled={busy} aria-label={t('select_row')}
                          onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} className="accent-[#E07B53] w-4 h-4" />
                      )}
                    </td>
                  )}
                  <td className="px-2 py-2 text-right text-xs text-gray-500 tabular-nums select-none">{rowNo.get(r.id)}</td>
                  {data.confirmable && (
                    <td className="px-3 py-2">
                      {data.dotFrom && !r.virtual ? (() => {
                        const v = derivedValue(r, { name: data.dotFrom } as DerivedColumn) ?? 'gray'
                        const why = data.dotWhyFrom ? derivedValue(r, { name: data.dotWhyFrom } as DerivedColumn) : null
                        const dot = <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${DOT_CLS[v] ?? DOT_CLS.gray}`} title={`${t(`dot_${v}`, v)} · ${r.confirmed ? cw('confirmed') : cw('unconfirmed')}`} />
                        if (!why) return dot
                        return <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${DOT_TEXT_CLS[v] ?? DOT_TEXT_CLS.gray}`}>{dot}{t(`dotwhy_${why}`, why)}</span>
                      })() : r.confirmed && r.confirmedByAi ? (
                        <span className="inline-flex items-center gap-0.5 text-sky-300" title={`${t('confirmed_by_ai')}${typeof r.data.aiReason === 'string' && r.data.aiReason ? ` — ${r.data.aiReason}` : ''}`}>
                          <Check className="w-4 h-4" /><span className="text-[10px] font-medium">AI</span>
                        </span>
                      ) : r.confirmed ? <Check className="w-4 h-4 text-emerald-400" aria-label={cw('confirmed')} /> : <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title={cw('unconfirmed')} />}
                    </td>
                  )}
                  {actionsCol && (
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
                      {!r.virtual && data.fileColumn && !hide('rowFile') && typeof r.data[data.fileColumn] === 'string' && (
                        <button onClick={() => void files.open(projectId, r.data[data.fileColumn!] as string).catch((e) => setNotice(errorText(lang, e, pkg)))} className="p-1 text-gray-300 hover:text-white" title={t('file_open')}>
                          <Paperclip className="w-4 h-4" />
                        </button>
                      )}
                      {!r.virtual && (data.openFiles ?? []).map((f) => typeof r.data[f.column] === 'string' && r.data[f.column] ? (
                        <button key={f.column} onClick={() => void files.open(projectId, r.data[f.column] as string).catch((e) => setNotice(errorText(lang, e, pkg)))} className={data.textButtons ? textBtn : 'p-1 text-emerald-300 hover:text-white'} title={t(f.label)}>
                          {data.textButtons ? t(f.label) : <FileCheck2 className="w-4 h-4" />}
                        </button>
                      ) : null)}
                      {!r.virtual && (data.specDocs ?? []).map((d) => (
                        <button key={`doc:${d.key}`} disabled={docBusy === `${r.id}:${d.key}`} className={textBtn} title={t('doc_make', 'Make the PDF of this row')}
                          onClick={() => {
                            setDocBusy(`${r.id}:${d.key}`)
                            void api<{ fileId: string }>('POST', `/projects/${projectId}/spec-doc`, { sheetId: sheet.id, rowId: r.id, doc: d.key })
                              .then((x) => files.open(projectId, x.fileId))
                              .catch((e) => setNotice(errorText(lang, e, pkg)))
                              .finally(() => setDocBusy((cur) => (cur === `${r.id}:${d.key}` ? null : cur)))
                          }}>
                          <span className="inline-flex items-center gap-1">{docBusy === `${r.id}:${d.key}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}{d.label}</span>
                        </button>
                      ))}
                      {!r.virtual && (data.specAppSends ?? []).map((x) => {
                        const m = data.appSendMarks?.[r.id]?.[x.key]
                        if (m?.status === 'sent') return (
                          <span key={`as:${x.key}`} className="px-2 py-0.5 text-[11px] rounded-full whitespace-nowrap bg-emerald-500/15 text-emerald-300">
                            {`${x.label} → ${m.to ?? ''}${m.number ? ` ${m.number}` : ''}${m.at ? ` · ${m.at.slice(0, 10)}` : ''}`}
                          </span>
                        )
                        if (m) return (
                          <button key={`as:${x.key}`} className="px-2 py-0.5 text-[11px] rounded-full whitespace-nowrap bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                            onClick={() => void api<{ sends: SendView[] }>('GET', `/projects/${projectId}/sends?ids=${encodeURIComponent(m.sendId)}`).then((y) => { if (y.sends[0]) setAppCard(y.sends[0]) }).catch((e) => setNotice(errorText(lang, e, pkg)))}>
                            {t('app_send_waiting', '{label}: card waiting').split('{label}').join(x.label)}
                          </button>
                        )
                        const st = typeof r.data.status === 'string' && r.data.status ? r.data.status : x.start
                        if (readOnly || (x.allowWhen?.status && !(st && x.allowWhen.status.includes(st))) || (x.allowWhen?.confirmed && r.confirmed !== true)) return null
                        return (
                          <button key={`as:${x.key}`} disabled={docBusy === `${r.id}:as:${x.key}`} className={textBtn} title={t('app_send_make', 'Send this row to the other app')}
                            onClick={() => {
                              setDocBusy(`${r.id}:as:${x.key}`)
                              void api<{ send: SendView }>('POST', `/projects/${projectId}/spec-send`, { sheetId: sheet.id, rowId: r.id, send: x.key })
                                .then((y) => setAppCard(y.send))
                                .catch((e) => setNotice(errorText(lang, e, pkg)))
                                .finally(() => setDocBusy((cur) => (cur === `${r.id}:as:${x.key}` ? null : cur)))
                            }}>
                            <span className="inline-flex items-center gap-1">{docBusy === `${r.id}:as:${x.key}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}{x.label}</span>
                          </button>
                        )
                      })}
                      {!r.virtual && !readOnly && (data.specHttpSends ?? []).map((x) => {
                        const st = typeof r.data.status === 'string' && r.data.status ? r.data.status : x.start
                        if ((x.allowWhen?.status && !(st && x.allowWhen.status.includes(st))) || (x.allowWhen?.confirmed && r.confirmed !== true)) return null
                        const cal = x.via === 'calendar'
                        const cm = cal ? data.calSentMarks?.[r.id]?.[x.key] : undefined
                        if (cm) return (
                          <button key={`hs:${x.key}`} className="px-2 py-0.5 text-[11px] rounded-full whitespace-nowrap bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                            onClick={() => void api<{ sends: SendView[] }>('GET', `/projects/${projectId}/sends?ids=${encodeURIComponent(cm.sendId)}`).then((y) => { if (y.sends[0]) setAppCard(y.sends[0]) }).catch((e) => setNotice(errorText(lang, e, pkg)))}>
                            {t('cal_in_calendar', '{label}: in the calendar').split('{label}').join(x.label)}
                          </button>
                        )
                        const busy = docBusy === `${r.id}:hs:${x.key}`
                        return (
                          <button key={`hs:${x.key}`} disabled={busy} className={textBtn} title={cal ? t('cal_send_make', 'Make a card that puts this row into the calendar') : x.via === 'sms' ? t('sms_send_make', 'Make a card that texts the customer of this row') : t('http_send_make', 'Make a card that sends this row to the other system')}
                            onClick={() => {
                              setDocBusy(`${r.id}:hs:${x.key}`)
                              void api<{ send: SendView }>('POST', `/projects/${projectId}/spec-send`, { sheetId: sheet.id, rowId: r.id, send: x.key, via: cal ? 'calendar' : x.via === 'sms' ? 'sms' : 'http' })
                                .then((y) => setAppCard(y.send))
                                .catch((e) => setNotice(errorText(lang, e, pkg)))
                                .finally(() => setDocBusy((cur) => (cur === `${r.id}:hs:${x.key}` ? null : cur)))
                            }}>
                            <span className="inline-flex items-center gap-1">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : cal ? <CalendarPlus className="w-3 h-3" /> : x.via === 'sms' ? <MessageSquare className="w-3 h-3" /> : <Send className="w-3 h-3" />}{x.label}</span>
                          </button>
                        )
                      })}
                      {!r.virtual && data.pairDefs.length > 0 && (() => {
                        const ps = data.pairs.filter((p) => p.fromRowId === r.id)
                        const open = ps.some((p) => !p.confirmed)
                        return (
                          <button onClick={() => setPairing(r)} className={`p-1 inline-flex items-center gap-0.5 ${open ? 'text-amber-300' : ps.length ? 'text-gray-300' : 'text-gray-500'} hover:text-white`} title={t('pairs_title')}>
                            <Link2 className="w-4 h-4" />{ps.length > 0 && <span className="text-[10px] tabular-nums">{ps.length}</span>}
                          </button>
                        )
                      })()}
                      {!r.virtual && !readOnly && data.rowActions.filter((a) => actionShown(a, r)).map((a) => (
                        <button key={a.module + a.inputKey + a.label} onClick={() => (a.ask ? setAsking({ row: r, action: a, text: '' }) : void rowAction(a, r))} disabled={busy} className={data.textButtons ? textBtn : 'p-1 text-gray-400 hover:text-white'} title={t(a.label)}>{data.textButtons ? t(a.label) : <RowActionIcon icon={a.icon} />}</button>
                      ))}
                      {r.virtual ? null : r.locked ? (
                        <Lock className="w-4 h-4 text-gray-500" aria-label={t('locked')}><title>{t('locked')}</title></Lock>
                      ) : !readOnly && (
                        <>
                          {data.confirmable && r.confirmed === false && !hide('confirm') && actionShown({ when: data.confirmWhen }, r) && (
                            <button onClick={() => void confirmOne(r)} disabled={busy} className={data.textButtons ? textBtn : 'p-1 text-gray-400 hover:text-emerald-400'} title={cw('confirm')}>{data.textButtons ? cw('confirm') : <Check className="w-4 h-4" />}</button>
                          )}
                          {(data.closeActions ?? []).length > 0 && (data.closeActions ?? []).every((a) => r.data[a.column] === undefined || r.data[a.column] === null || r.data[a.column] === '') && (data.closeActions ?? []).filter((a) => actionShown(a, r)).map((a) => (
                            <button key={a.column} onClick={() => setClosing({ row: r, action: a, text: '' })} disabled={busy} className={data.textButtons ? textBtn : 'p-1 text-gray-400 hover:text-red-400'} title={t(a.label)}>
                              {data.textButtons ? t(a.label) : a.kind === 'reason' ? <Ban className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            </button>
                          ))}
                          {!data.moduleOnly && (
                            <>
                              {!hide('edit') && (!editLocked(r) || !!onlyItemsOf(r)) && (() => { const lbl = onlyItemsOf(r) ? t(data.lockEditOnly!.label) : t('edit'); return <button onClick={() => { setEditError(null); setEditing(r) }} disabled={busy} className={data.textButtons ? textBtn : 'p-1 text-gray-400 hover:text-white'} title={lbl}>{data.textButtons ? lbl : <Pencil className="w-4 h-4" />}</button> })()}
                              {!hide('delete') && !editLocked(r) && <button onClick={() => setDeleting(r)} disabled={busy} className={data.textButtons ? textBtn : 'p-1 text-gray-400 hover:text-red-400'} title={t('delete')}>{data.textButtons ? t('delete') : <Trash2 className="w-4 h-4" />}</button>}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                  )}
                  {tableLayout.map((x) => {
                    if (x.kind === 'derived') {
                      const c = x.col
                      const v = derivedValue(r, c)
                      return (
                        <td key={`derived:${c.name}`} className={`px-3 py-2 text-gray-200 whitespace-nowrap ${c.type === 'money' ? 'text-right tabular-nums' : ''}`}>
                          {v === null ? '' : c.type === 'status'
                            ? <span className={`px-2 py-0.5 text-xs rounded-full ${DERIVED_STATUS_CLS[v] ?? 'bg-gray-500/15 text-gray-300'}`}>{derivedText(c, v)}</span>
                            : derivedText(c, v)}
                        </td>
                      )
                    }
                    const c = x.col
                    return (
                    <td key={c.name} title={typeof r.data[c.name] === 'string' && (r.data[c.name] as string).length > 30 ? r.data[c.name] as string : undefined}
                      className={`px-3 py-2 ${r.virtual ? 'text-gray-500' : 'text-gray-200'} max-w-[16rem] truncate ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}>
                      {c.name === EVIDENCE_COLUMN && typeof r.data[c.name] === 'string' && EVIDENCE_CLS[r.data[c.name] as string]
                        ? <span className={`px-2 py-0.5 text-xs rounded-full ${EVIDENCE_CLS[r.data[c.name] as string]}`}>{cell(lang, r.data[c.name], data.options[c.name], pkg, { name: c.name, country: (data.countryColumns ?? []).includes(c.name), boolean: c.type === 'boolean', ref: data.refRows?.[c.name] }, objText)}</span>
                        : r.data[c.name] == null && fxHint(r.id, c.name)
                          ? <span className="text-gray-500" title={fxHint(r.id, c.name)!.title}>{fxHint(r.id, c.name)!.text}</span>
                          : cell(lang, r.data[c.name], data.options[c.name], pkg, { name: c.name, country: (data.countryColumns ?? []).includes(c.name), boolean: c.type === 'boolean', ref: data.refRows?.[c.name] }, objText)}
                    </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.paging?.next && (
          <div className="flex justify-center py-3">
            <button onClick={() => void loadMore()} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDown className="w-4 h-4" />}
              {t('page_load_more').replace('{n}', String(data.paging.matchedMore ? 50 : Math.min(50, Math.max(1, data.paging.matched - rows.length))))}
            </button>
          </div>
        )}
        {data.download && !data.form && rows.some((r) => !r.virtual) && (
          <div className="flex items-center justify-center gap-1.5 py-3 text-xs text-gray-400">
            <Download className="w-3.5 h-3.5" /> <span className="mr-1">{t('sheet_download')}</span>
            {(['xlsx', 'csv', 'pdf'] as const).map((f) => (
              <button key={f} type="button" onClick={() => void downloadSheet(f)} disabled={busy} className="px-2 py-0.5 rounded border border-[#3A3A3A] hover:text-[#E07B53] hover:border-[#E07B53] disabled:opacity-40">
                {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        {data.image && data.rows.length <= 1 && (
          <ImageBox
            key={data.rows[0]?.id ?? 'none'}
            api={api}
            files={files}
            lang={lang}
            projectId={projectId}
            base={base}
            image={data.image}
            row={data.rows[0] ?? null}
            readOnly={readOnly || data.moduleOnly || !!data.rows[0]?.locked}
            onChanged={load}
          />
        )}
        {data.form && (
          <RowEditor
            key={formRow ? `${formRow.id}:${JSON.stringify(formColumns.map((c) => formRow.data[c.name] ?? null))}` : 'new'}
            lang={lang}
            title=""
            columns={formColumns}
            options={data.options}
            countryColumns={data.countryColumns ?? []}
            noFirst={data.noFirst ?? []}
            refOptions={data.refOptions}
            row={formRow}
            confirmable={false}
            busy={busy}
            error={editError}
            fileColumn={null}
            onUpload={async () => { throw new Error('no file here') }}
            onOpenFile={() => {}}
            onSave={(v, c) => void saveForm(v, c)}
            onClose={() => {}}
            inline={{ groups: data.form.groups, note: data.form.note, readOnly: readOnly || data.moduleOnly || !!formRow?.locked }}
          />
        )}
        {(data.sums ?? []).length > 0 && (
          <div className="mx-4 mt-4 mb-2 flex flex-wrap gap-3">
            {(data.sums ?? []).map((sm) => (
              <div key={sm.key} className="min-w-[12rem] max-w-md rounded-lg border border-[#2A2A2A] bg-[#1C1C1C] px-4 py-3">
                <div className="text-xs text-gray-400 mb-1.5">{sm.label}</div>
                {sm.groups.length === 0 ? <div className="text-sm text-gray-500">—</div> : (
                  <table className="text-sm w-full">
                    <tbody>
                      {sm.groups.map((g) => (
                        <tr key={`${g.group}|${g.currency ?? ''}`}>
                          <td className="pr-4 py-0.5 text-gray-300">{g.gone || g.mark ? <span className="text-gray-500 italic">{t(g.mark === 'unreadable' ? 'ref_unreadable' : g.mark === 'unconfirmed' ? 'ref_unconfirmed' : 'ref_gone')}</span> : g.label !== undefined ? (g.label || <span className="text-gray-500 italic">{t('ref_noname')}</span>) : g.group === 'all' ? t('sum_all') : g.group === '' ? '—' : g.group}</td>
                          <td className="py-0.5 text-right tabular-nums text-gray-100">{g.currency ? `${g.currency} ` : ''}{g.total}</td>
                          <td className="pl-3 py-0.5 text-right text-xs text-gray-500">{g.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {sm.cut && <div className="text-xs text-gray-500 mt-1">…</div>}
              </div>
            ))}
          </div>
        )}
        {data.help && (
          <div className="mx-4 my-6 max-w-3xl rounded-lg border border-[#2A2A2A] bg-[#1C1C1C] px-5 py-4 prose prose-invert prose-sm">
            <MessageContent content={t(data.help)} role="assistant" theme="dark" size="sm" enableJsonTable={false} remoteImages={false} />
          </div>
        )}
        {!readOnly && onAskAi && (data.askButtons ?? []).length > 0 && allRows.length > 0 && (
          <div className="mx-4 -mt-3 mb-6 max-w-3xl flex flex-wrap gap-2">
            {(data.askButtons ?? []).map((b) => (
              <button key={b.label} onClick={() => onAskAi(t(b.ask))} className="px-3 py-1.5 text-sm rounded-lg border border-[#3A3A3A] text-gray-200 hover:border-[#E07B53] hover:text-white inline-flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />{t(b.label)}
              </button>
            ))}
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
      {appCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setAppCard(null); void load() }}>
          <div className="w-full max-w-lg space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-gray-200">{appCard.kind === 'http' ? t('http_send_card_title', 'Send to another system') : appCard.kind === 'calendar' ? t('cal_send_card_title', 'Add to calendar') : appCard.kind === 'sms' ? t('sms_send_card_title', 'Text the customer') : t('app_send_card_title', 'Send to another app')}</p>
            <SendCard send={appCard} api={api} lang={lang} projectId={projectId} readOnly={readOnly} onChanged={(next) => { setAppCard(next); void load() }} />
            <div className="flex justify-end"><button className={textBtn} onClick={() => { setAppCard(null); void load() }}>{t('close', 'Close')}</button></div>
          </div>
        </div>
      )}
      {pairing && (
        <PairDialog api={api} lang={lang} projectId={projectId} sheet={data} row={pairing} readOnly={readOnly} onChanged={() => void load()} onClose={() => setPairing(null)} />
      )}
      {pickAsking && sel && (sel.summary ? (() => {
        const items = pickedItems()
        const flagged = items.filter((x) => x.flags.length).length
        return (
          <SelectSendDialog title={t(sel.label)} explain={t(`${sel.label}_ask`)} countLabel={t('select_count')} totalLabel={t('select_total')}
            items={items} totals={pickedTotals()} {...(flagged ? { note: t('select_flagged', '').replace('{n}', String(flagged)) } : {})}
            okLabel={`${t(sel.label)} (${items.length})`} cancelLabel={t('cancel')} busy={busy} {...(sel.preview ? { docUrl: pickDoc } : {})}
            onOk={() => void sendPicked()} onCancel={() => { pickSeq.current++; setPickAsking(false) }} />
        )
      })() : (
        <ConfirmDialog message={`${t(`${sel.label}_ask`)}\n\n${pickedSummary()}`} okLabel={t(sel.label)} cancelLabel={t('cancel')} busy={busy} tone="primary"
          onOk={() => void sendPicked()} onCancel={() => setPickAsking(false)} />
      ))}
      {sheetAsking && (
        <ConfirmDialog message={t(`${sheetAsking.label}_ask`)} okLabel={t(sheetAsking.label)} cancelLabel={t('cancel')} busy={busy} tone="primary"
          onOk={() => void sheetAction(sheetAsking)} onCancel={() => setSheetAsking(null)} />
      )}
      {asking && (
        <ConfirmDialog
          message={t(`${asking.action.label}_ask`)}
          okLabel={t(asking.action.label)}
          cancelLabel={t('cancel')}
          busy={busy}
          {...(asking.action.ask === 'reason' ? { input: { value: asking.text, onChange: (v: string) => setAsking({ ...asking, text: v }) } } : {})}
          onOk={() => { if (asking.action.ask !== 'reason' || asking.text.trim()) void rowAction(asking.action, asking.row, asking.action.ask === 'reason' ? asking.text.trim() : undefined) }}
          onCancel={() => setAsking(null)}
        />
      )}
      {closing && (
        <ConfirmDialog
          message={t(`${closing.action.label}_ask`)}
          okLabel={t(closing.action.label)}
          cancelLabel={t('cancel')}
          busy={busy}
          {...(closing.action.kind === 'reason' ? { input: { value: closing.text, onChange: (v: string) => setClosing({ ...closing, text: v }) } } : {})}
          onOk={() => void closeRow(closing)}
          onCancel={() => setClosing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog message={t('delete_row_confirm')} okLabel={t('delete')} cancelLabel={t('cancel')} busy={busy} onOk={() => void remove(deleting)} onCancel={() => setDeleting(null)} />
      )}
      {viewing && (
        <RowViewer
          key={viewing.id}
          lang={lang}
          colLabels={data.colLabels}
          labels={data.labels}
          {...(onlyItemsOf(viewing) ? { editLabel: t(data.lockEditOnly!.label) } : {})}
          columns={tableCols}
          row={viewing}
          format={(c, v) => cell(lang, v, data.options[c.name], pkg, { name: c.name, country: (data.countryColumns ?? []).includes(c.name), boolean: c.type === 'boolean', ref: data.refRows?.[c.name] }, objText)}
          hint={(c) => fxHint(viewing.id, c.name)}
          derived={derivedCols.filter((c) => !(data?.dotWhyFrom && c.name === data.dotFrom)).flatMap((c) => { const v = derivedValue(viewing, c); return v === null ? [] : [{ name: c.name, label: t(c.label), text: derivedText(c, v) }] })}
          fileColumn={data.fileColumn}
          details={data.details ?? null}
          onDownloadDetails={data.details?.download ? (format, table) => { void run(() => saveTable(format, table, `${sheet.name || 'sheet'}-${cellOf(viewing, data.summary?.[0] ?? '') || 'details'}`)) } : null}
          moreFilesColumn={data.moreFiles ?? null}
          onOpenFile={(id) => { const from = viewing.id; void files.open(projectId, id).catch((e) => { setViewingId((cur) => (cur === from ? null : cur)); setNotice(errorText(lang, e, pkg)) }) }}
          onEdit={readOnly || viewing.locked || data.moduleOnly || (editLocked(viewing) && !onlyItemsOf(viewing)) ? null : () => { const r = viewing; setViewingId(null); setEditError(null); setEditing(r) }}
          onClose={() => setViewingId(null)}
          {...(() => {
            const a = primaryOf(viewing)
            if (!a) return {}
            const r = viewing
            return {
              alert: primaryAlert(r, a),
              actions: [{ key: a.label, label: t(a.label), onClick: () => { setViewingId(null); if (a.ask) setAsking({ row: r, action: a, text: '' }); else void rowAction(a, r) } }],
              onDelete: r.locked || data.moduleOnly || hide('delete') || editLocked(r) ? null : () => { setViewingId(null); setDeleting(r) },
            }
          })()}
        />
      )}
      {editing && (
        <RowEditor
          lang={lang}
          colLabels={data.colLabels}
          labels={data.labels}
          onlyItems={editing === 'new' ? null : onlyItemsOf(editing)}
          title={editing === 'new' ? t('add_row') : onlyItemsOf(editing) ? t(data.lockEditOnly!.label) : t('edit')}
          columns={(data.viewOnly ?? []).length ? visible.filter((c) => !(data.viewOnly ?? []).includes(c.name)) : visible}
          options={data.options}
          countryColumns={data.countryColumns ?? []}
            noFirst={data.noFirst ?? []}
          details={data.details ?? null}
          choices={data.choices ?? {}}
          follow={data.choicesFollow ?? {}}
          refOptions={data.refOptions}
          refRows={data.refRows ?? {}}
          timeColumns={data.timeColumns ?? []}
          row={editing === 'new' ? null : editing}
          confirmable={!hide('editConfirm') && (data.confirmable || (editing !== 'new' && !!primaryOf(editing)))}
          confirmLabel={editing !== 'new' && primaryOf(editing) ? t(`${primaryOf(editing)!.label}_save`) : data.confirmAs === 'approve' ? t('approve_save_confirm', t('save_confirm')) : undefined}
          busy={busy}
          error={editError}
          fileColumn={data.fileColumn}
          fileHelp={data.fileHelp ?? null}
          stageMoves={data.stageMoves ?? null}
          onUpload={async (f) => {
            try { return (await files.upload(projectId, f, 'receipt')).id } catch (e) { throw new Error(errorText(lang, e, pkg)) }
          }}
          onOpenFile={(id) => void files.open(projectId, id).catch((e) => setEditError(errorText(lang, e, pkg)))}
          onSave={(v, c, fc) => void save(v, c, fc)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RowActionIcon({ icon }: { icon?: string }) {
  const c = 'w-4 h-4'
  switch (icon) {
    case 'receipt': return <ReceiptText className={c} />
    case 'play': return <Play className={c} />
    case 'check': return <Check className={c} />
    case 'ban': return <Ban className={c} />
    case 'plus': return <Plus className={c} />
    case 'minus': return <Minus className={c} />
    case 'trash': return <Trash2 className={c} />
    case 'filter': return <Filter className={c} />
    case 'send': return <Send className={c} />
    default: return <Copy className={c} />
  }
}
