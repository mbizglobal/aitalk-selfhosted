'use client'

import React, { useState } from 'react'
import { FileUp, Loader2, Paperclip, Plus, Trash2, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { ColumnDef, SheetRow } from '../lib/api'
import { useWorkPkg } from './work-pkg'
import { countryLabel, refCellText } from '@/lib/work/sheet-text'

interface Props {
  lang: WorkLang
  title: string
  columns: ColumnDef[]
  options: Record<string, string[]>
  refOptions: Record<string, string[]>
  refRows?: Record<string, Array<{ id: string; label: string | null; mark?: 'unconfirmed' | 'unreadable' }>>
  timeColumns?: string[]
  row: SheetRow | null
  confirmable: boolean
  confirmLabel?: string
  busy: boolean
  error: string | null
  fileColumn: string | null
  onUpload: (file: File) => Promise<string>
  onOpenFile: (fileId: string) => void
  onSave: (data: Record<string, unknown>, confirm: boolean, fileChange: string | null | undefined) => void
  onClose: () => void
  inline?: { groups: ReadonlyArray<{ name: string; columns: readonly string[] }>; note: string | null; readOnly: boolean }
  countryColumns?: readonly string[]
  noFirst?: readonly string[]
  details?: { column: string; columns: readonly string[]; money?: readonly string[]; sumOf?: string; sumTo?: string; newItem?: Readonly<Record<string, unknown>>; options?: Readonly<Record<string, readonly string[]>>; booleans?: readonly string[] } | null
  choices?: Readonly<Record<string, ReadonlyArray<{ value: string; label?: string; hints?: readonly string[] }>>>
  follow?: Readonly<Record<string, { from: string; fillEmpty?: true }>>
  colLabels?: Readonly<Record<string, string>>
  labels?: Readonly<Record<string, string>>
  fileHelp?: string | null
  stageMoves?: { column: string; start: string; next: Readonly<Record<string, readonly string[]>> } | null
  onlyItems?: readonly string[] | null
}

type Choices = Readonly<Record<string, ReadonlyArray<{ value: string; label?: string; hints?: readonly string[] }>>>
export function followedValue(choices: Choices, column: string, source: unknown): string | null {
  if (typeof source !== 'string' || !source) return null
  return (choices[column] ?? []).find((o) => o.hints?.includes(`opt_${source}`))?.value ?? null
}
export function followChange(choices: Choices, column: string, current: unknown, before: unknown, after: unknown): string | undefined {
  const cur = current === undefined || current === null ? '' : String(current)
  const old = followedValue(choices, column, before)
  if (cur !== '' && cur !== old) return undefined
  const next = followedValue(choices, column, after) ?? ''
  return next === cur ? undefined : next
}

export const isItems = (v: unknown): v is Array<Record<string, unknown>> => Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && !Array.isArray(x))
export function sumMoney(items: ReadonlyArray<Record<string, unknown>>, key: string): number | null {
  let cents = 0
  for (const it of items) {
    const v = it[key]
    if (v === undefined || v === null || v === '') continue
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(v).trim())
    if (!m) return null
    cents += (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0')))
  }
  return cents
}
const fmtCents = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`
export function newItemId(items: ReadonlyArray<Record<string, unknown>>): string {
  const taken = new Set(items.map((it) => it.id))
  for (;;) {
    const id = `m${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
    if (!taken.has(id)) return id
  }
}
export function tidyItems(items: ReadonlyArray<Record<string, unknown>>, keys: readonly string[], numeric: ReadonlyMap<unknown, ReadonlySet<string>> = new Map()): Array<Record<string, unknown>> {
  return items.map((it) => {
    const o: Record<string, unknown> = { ...it }
    for (const k of keys) {
      if (typeof o[k] !== 'string') continue
      const x = (o[k] as string).trim()
      if (x === '') delete o[k]
      else if (k === 'no' ? /^\d+$/.test(x) : !!numeric.get(it.id)?.has(k) && /^-?\d+(\.\d+)?$/.test(x)) o[k] = Number(x)
      else o[k] = x
    }
    return o
  })
}
export function numericKeys(items: unknown): Map<unknown, Set<string>> {
  const m = new Map<unknown, Set<string>>()
  if (!Array.isArray(items)) return m
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const set = m.get(o.id) ?? new Set<string>()
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') set.add(k)
    m.set(o.id, set)
  }
  return m
}

export { countryLabel }

function toValue(col: ColumnDef, raw: string | boolean): unknown {
  if (col.type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : undefined
  const s = String(raw).trim()
  if (s === '') return undefined
  if (col.type === 'number') return Number(s)
  if (col.type === 'json') { try { return JSON.parse(s) } catch { return s } }
  if (col.type === 'datetime') { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toISOString() }
  return s
}

function toRaw(col: ColumnDef, v: unknown): string | boolean {
  if (col.type === 'boolean') return v === true ? 'true' : v === false ? 'false' : ''
  if (v === undefined || v === null) return ''
  if (col.type === 'json') return JSON.stringify(v, null, 2)
  if (col.type === 'datetime' && typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
  return String(v)
}

export function RowEditor({ lang, title, columns, options, refOptions, refRows = {}, timeColumns = [], row, confirmable, confirmLabel, busy, error, fileColumn, onUpload, onOpenFile, onSave, onClose, inline, countryColumns = [], noFirst = [], details = null, choices = {}, follow = {}, colLabels = {}, labels = {}, onlyItems = null, fileHelp = null, stageMoves = null }: Props) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const initialRaw = React.useMemo(() => Object.fromEntries(columns.map((c) => [c.name, toRaw(c, row?.data[c.name])])), [columns, row])
  const startRaw = React.useMemo(() => {
    if (!details) return initialRaw
    const fills = Object.entries(follow).filter(([col, f]) => f.fillEmpty && details.columns.includes(col))
    const v = row?.data[details.column]
    if (!fills.length || !isItems(v)) return initialRaw
    let changed = false
    const items = v.map((it) => {
      const o = { ...it }
      for (const [col, f] of fills) {
        if (o[col] !== undefined && o[col] !== null && o[col] !== '') continue
        const x = followedValue(choices, col, o[f.from])
        if (x) { o[col] = x; changed = true }
      }
      return o
    })
    return changed ? { ...initialRaw, [details.column]: JSON.stringify(items, null, 2) } : initialRaw
  }, [initialRaw, details, follow, choices, row])
  const [raw, setRaw] = useState<Record<string, string | boolean>>(startRaw)
  const dirty = columns.some((c) => raw[c.name] !== initialRaw[c.name])

  const initialFile = fileColumn && typeof row?.data[fileColumn] === 'string' ? (row.data[fileColumn] as string) : null
  const [fileId, setFileId] = useState<string | null>(initialFile)
  const [uploading, setUploading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const uploadSeq = React.useRef(0)
  const pickFile = async (f: File | undefined) => {
    if (!f) return
    const seq = ++uploadSeq.current
    setUploading(true); setFileError(null)
    try {
      const id = await onUpload(f)
      if (seq === uploadSeq.current) setFileId(id)
    } catch (e) {
      if (seq === uploadSeq.current) setFileError(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === uploadSeq.current) setUploading(false)
    }
  }
  const removeFile = () => { uploadSeq.current++; setUploading(false); setFileId(null) }

  const submit = (confirm: boolean) => {
    if (busy || uploading) return
    if (onlyItems && details) {
      const orig = row?.data[details.column]
      const edited = toValue(columns.find((c) => c.name === details.column)!, raw[details.column])
      if (isItems(orig) && isItems(edited) && orig.length === edited.length) {
        const tidy = tidyItems(edited, onlyItems, numericKeys(orig))
        const merged = orig.map((o, i) => {
          const n: Record<string, unknown> = { ...o }
          for (const k of onlyItems) { if (tidy[i][k] === undefined) delete n[k]; else n[k] = tidy[i][k] }
          return n
        })
        onSave({ [details.column]: merged }, confirm, undefined)
      }
      return
    }
    const data: Record<string, unknown> = {}
    for (const c of columns) {
      const v0 = toValue(c, raw[c.name])
      const v = details?.column === c.name && isItems(v0) ? tidyItems(v0, details.columns, numericKeys(row?.data[c.name])) : v0
      if (v !== undefined) data[c.name] = v
      else if (row && row.data[c.name] !== undefined && row.data[c.name] !== null) data[c.name] = null
    }
    onSave(data, confirm, fileId === initialFile ? undefined : fileId)
  }

  const inputCls = 'w-full rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E07B53]'

  const choiceSelect = (name: string, v: string, set: (x: string) => void, cls: string) => {
    const list = choices[name] ?? []
    const shown = list.some((o) => o.value === v) || !v ? list : [...list, { value: v, label: v }]
    return (
      <select value={v} onChange={(e) => set(e.target.value)} className={cls}>
        <option value="">{t('choose')}</option>
        {shown.map((o) => <option key={o.value} value={o.value}>{`${o.label ?? o.value}${'hints' in o && o.hints?.length ? ` — ${o.hints.map((h) => t(h, h)).join(' · ')}` : ''}`}</option>)}
      </select>
    )
  }

  const itemsEditor = (c: ColumnDef, v: string, set: (x: string) => void) => {
    let parsed: unknown = []
    try { parsed = v.trim() === '' ? [] : JSON.parse(v) } catch { return null }
    if (!details || !isItems(parsed)) return null
    const items = parsed
    const write = (next: Array<Record<string, unknown>>) => set(JSON.stringify(next, null, 2))
    const setCell = (i: number, key: string, x: string) => write(items.map((it, k) => {
      if (k !== i) return it
      const o = { ...it }
      if (x === '') delete o[key]
      else if (details.booleans?.includes(key)) o[key] = x === 'true'
      else o[key] = x
      for (const [col, f] of Object.entries(follow)) {
        if (f.from !== key || !details.columns.includes(col)) continue
        const next = followChange(choices, col, it[col], it[key], o[key])
        if (next === '') delete o[col]
        else if (next !== undefined) o[col] = next
      }
      return o
    }))
    const money = details.money ?? []
    const sum = details.sumOf ? sumMoney(items, details.sumOf) : null
    const target = details.sumTo ? /^-?\d+(\.\d{1,2})?$/.test(String(raw[details.sumTo] ?? '').trim()) ? sumMoney([{ v: String(raw[details.sumTo]).trim() }], 'v') : null : null
    return (
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={`${i}:${typeof it.id === 'string' ? it.id : ''}`} className="rounded-md border border-[#3A3A3A] bg-[#232323] p-2">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-400">
              <span className="min-w-0 truncate">#{i + 1}{typeof it.merchant === 'string' && it.merchant ? ` · ${it.merchant}` : ''}</span>
              {!onlyItems && <button type="button" onClick={() => write(items.filter((_, k) => k !== i))} className="inline-flex shrink-0 items-center gap-1 hover:text-red-400" aria-label={`${t('item_remove')} #${i + 1}`}><Trash2 className="w-3.5 h-3.5" /> {t('item_remove')}</button>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {details.columns.map((k) => (
                <fieldset key={k} disabled={!!onlyItems && !onlyItems.includes(k)} className={`contents ${onlyItems && !onlyItems.includes(k) ? '[&_input]:opacity-50 [&_select]:opacity-50' : ''}`}>
                <label className={`block min-w-0 ${choices[k]?.length ? 'col-span-2 sm:col-span-3 md:col-span-6' : k === 'merchant' ? 'col-span-2 sm:col-span-3 md:col-span-2' : k === 'date' ? 'md:col-span-2' : ''}`}>
                  <span className="block text-[11px] text-gray-500 mb-0.5">{labels[k] ?? t(`col_${k}`, k)}</span>
                  {choices[k]?.length ? (
                    choiceSelect(k, it[k] === undefined || it[k] === null ? '' : String(it[k]), (x) => setCell(i, k, x), `${inputCls} min-w-0 px-2 py-1.5`)
                  ) : details.booleans?.includes(k) ? (
                    <select value={it[k] === true ? 'true' : it[k] === false ? 'false' : ''} onChange={(e) => setCell(i, k, e.target.value)} className={`${inputCls} min-w-0 px-2 py-1.5`}>
                      <option value="">{t('choose')}</option>
                      <option value="true">{t(`bool_${k}_true`, t('yes', 'Yes'))}</option>
                      <option value="false">{t(`bool_${k}_false`, t('no', 'No'))}</option>
                    </select>
                  ) : details.options?.[k] ? (
                    <select value={it[k] === undefined || it[k] === null ? '' : String(it[k])} onChange={(e) => setCell(i, k, e.target.value)} className={`${inputCls} min-w-0 px-2 py-1.5`}>
                      <option value="">{t('choose')}</option>
                      {[...new Set([...details.options[k], ...(typeof it[k] === 'string' && it[k] ? [it[k] as string] : [])])].map((o) => <option key={o} value={o}>{t(`opt_${o}`, o)}</option>)}
                    </select>
                  ) : (
                  <input
                    type={k === 'date' ? 'date' : 'text'}
                    inputMode={money.includes(k) || k === 'claimRate' ? 'decimal' : undefined}
                    value={it[k] === undefined || it[k] === null ? '' : String(it[k])}
                    onChange={(e) => setCell(i, k, e.target.value)}
                    className={`${inputCls} min-w-0 px-2 py-1.5 ${money.includes(k) || k === 'claimRate' ? 'text-right tabular-nums' : ''}`}
                    autoComplete="off"
                  />
                  )}
                </label>
                </fieldset>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!onlyItems && <button type="button" onClick={() => write([...items, { id: newItemId(items), ...(details.newItem ?? {}) }])} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]"><Plus className="w-4 h-4" /> {t('item_add')}</button>}
          {details.sumOf && sum === null && <span role="status" className="text-xs text-amber-300">{t('items_total_bad')}</span>}
          {sum !== null && (
            <span role="status" className={`text-xs tabular-nums ${target !== null && target !== sum ? 'text-amber-300' : 'text-gray-400'}`}>
              {t('items_total', 'Total')} {fmtCents(sum)}{target !== null && target !== sum ? ` — ${t('items_total_differs', 'differs from {col} {n}').replace('{col}', t(`col_${details.sumTo}`, details.sumTo ?? '')).replace('{n}', fmtCents(target))}` : ''}
            </span>
          )}
        </div>
      </div>
    )
  }

  const field = (c: ColumnDef) => {
    const label = labels[c.name] ?? t(colLabels[c.name] ?? `col_${c.name}`, c.name)
    const items = c.type === 'json' && details?.column === c.name ? itemsEditor(c, String(raw[c.name]), (x) => setRaw((r) => ({ ...r, [c.name]: x }))) : null
    if (items) return (
      <fieldset key={c.name} className="block min-w-0">
        <legend className="block text-xs text-gray-400 mb-1">{label}{c.required && <span className="text-[#E07B53]"> *</span>}</legend>
        {items}
      </fieldset>
    )
    const cur = row ? String(row.data[c.name] ?? '') : ''
    const opts = stageMoves && c.name === stageMoves.column
      ? (row ? [...new Set([cur || stageMoves.start, ...(stageMoves.next[cur || stageMoves.start] ?? [])])] : [stageMoves.start])
      : options[c.name]
    const refs = refOptions[c.name]
    const v = raw[c.name]
    const set = (x: string | boolean) => setRaw((r) => {
      const next = { ...r, [c.name]: x }
      for (const [col, f] of Object.entries(follow)) {
        if (f.from !== c.name || !(col in r)) continue
        const n = followChange(choices, col, r[col], r[c.name], x)
        if (n !== undefined) next[col] = n
      }
      return next
    })
    return (
      <label key={c.name} className="block">
        <span className="block text-xs text-gray-400 mb-1">
          {label}{c.required && <span className="text-[#E07B53]"> *</span>}
        </span>
        {choices[c.name]?.length ? (
          choiceSelect(c.name, String(v), (x) => set(x), inputCls)
        ) : c.type === 'boolean' ? (
          <select value={String(v)} onChange={(e) => set(e.target.value)} className={inputCls}>
            <option value="">{t(`bool_${c.name}_empty`, t('choose'))}</option>
            {(noFirst.includes(c.name) ? ['false', 'true'] : ['true', 'false']).map((b) => <option key={b} value={b}>{t(`bool_${c.name}_${b}`, t(b === 'true' ? 'yes' : 'no'))}</option>)}
          </select>
        ) : countryColumns.includes(c.name) && opts ? (
          <select value={String(v)} onChange={(e) => set(e.target.value)} className={inputCls}>
            <option value="">{t('choose')}</option>
            {[...new Set([...opts, ...(String(v) ? [String(v)] : [])])].map((o) => ({ o, label: countryLabel(lang, o) })).sort((a, b) => a.label.localeCompare(b.label, lang)).map(({ o, label }) => <option key={o} value={o}>{label}</option>)}
          </select>
        ) : refRows[c.name] ? (
          <>
            <select value={String(v)} onChange={(e) => set(e.target.value)} className={inputCls}>
              <option value="">{t('choose')}</option>
              {refRows[c.name].filter((o) => !o.mark).map((o) => <option key={o.id} value={o.id}>{o.label ?? t('ref_noname')}</option>)}
              {String(v) && !refRows[c.name].some((o) => !o.mark && o.id === String(v)) && <option value={String(v)}>{refCellText(lang, String(v), refRows[c.name], pkg)}</option>}
            </select>
            {refRows[c.name].some((o) => o.mark === 'unreadable')
              ? <span className="block mt-1 text-xs text-amber-300">{t('ref_unreadable')}</span>
              : !refRows[c.name].some((o) => !o.mark) && <span className="block mt-1 text-xs text-amber-300">{t(refRows[c.name].some((o) => o.mark === 'unconfirmed') ? 'ref_none_confirmed' : 'ref_empty')}</span>}
          </>
        ) : refs ? (
          <>
            <select value={String(v)} onChange={(e) => set(e.target.value)} className={inputCls}>
              <option value="">{t('choose')}</option>
              {[...new Set([...refs, ...(String(v) ? [String(v)] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {refs.length === 0 && <span className="block mt-1 text-xs text-amber-300">{t('ref_empty')}</span>}
          </>
        ) : opts ? (
          <select value={String(v)} onChange={(e) => set(e.target.value)} className={inputCls}>
            <option value="">{t('choose')}</option>
            {[...new Set([...opts, ...(String(v) ? [String(v)] : [])])].map((o) => <option key={o} value={o}>{t(`opt_${o}`, o)}</option>)}
          </select>
        ) : c.type === 'text' || c.type === 'json' ? (
          <textarea value={String(v)} onChange={(e) => set(e.target.value)} rows={c.type === 'json' ? 5 : 3} className={`${inputCls} ${c.type === 'json' ? 'font-mono text-xs' : ''}`} autoComplete="off" />
        ) : (
          <input
            type={c.type === 'date' ? 'date' : c.type === 'datetime' ? 'datetime-local' : c.type === 'number' ? 'number' : timeColumns.includes(c.name) ? 'time' : 'text'}
            inputMode={c.type === 'money' || c.type === 'decimal' ? 'decimal' : undefined}
            value={String(v)}
            onChange={(e) => set(e.target.value)}
            className={`${inputCls} ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}
            autoComplete="off"
          />
        )}
      </label>
    )
  }

  if (inline) {
    const byName = new Map(columns.map((c) => [c.name, c]))
    return (
      <div className="mx-4 my-6 max-w-3xl rounded-lg border border-[#2A2A2A] bg-[#1C1C1C] px-5 py-4">
        <form className="space-y-6" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (dirty && !inline.readOnly) submit(false) }}>
          <fieldset disabled={inline.readOnly || busy} className="space-y-6 disabled:opacity-70">
          {inline.groups.map((g) => {
            const cols = g.columns.map((n) => byName.get(n)).filter((c): c is ColumnDef => !!c)
            if (!cols.length) return null
            return (
              <section key={g.name}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{t(`form_group_${g.name}`, g.name)}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{cols.map(field)}</div>
              </section>
            )
          })}
          </fieldset>
          {inline.note && <p className="text-xs text-gray-500">{t(inline.note)}</p>}
          <button type="submit" className="hidden" />
        </form>
        {error && <p role="alert" className="mt-4 text-sm text-red-400 whitespace-pre-line">{error}</p>}
        {!inline.readOnly && <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={() => submit(false)} disabled={busy || !dirty} className="inline-flex items-center gap-1 px-4 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t('save')}
          </button>
          {dirty && <span className="text-xs text-gray-400">{t('design_unsaved')}</span>}
        </div>}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className={`w-full ${details && columns.some((c) => c.name === details.column) ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[90dvh] flex flex-col rounded-t-xl sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
          <h2 className="text-white font-medium">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label={t('close')}><X className="w-5 h-5" /></button>
        </div>
        <form className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); submit(false) }}>
          {columns.map((c) => (onlyItems && details?.column !== c.name ? <fieldset key={c.name} disabled className="contents [&_input]:opacity-50 [&_select]:opacity-50 [&_textarea]:opacity-50">{field(c)}</fieldset> : field(c)))}
          {fileColumn && (
            <div>
              <span className="block text-xs text-gray-400 mb-1">{t('file')}</span>
              <div className="flex flex-wrap items-center gap-2">
                {fileId && (
                  <button type="button" onClick={() => onOpenFile(fileId)} className="inline-flex items-center gap-1 text-sm text-[#E07B53] hover:underline">
                    <Paperclip className="w-4 h-4" /> {t('file_open')}
                  </button>
                )}
                {!onlyItems && <label className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] cursor-pointer">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} {fileId ? t('file_replace') : t('file_upload')}
                  <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" capture="environment" className="hidden" disabled={uploading || busy} onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = '' }} />
                </label>}
                {!onlyItems && (fileId || uploading) && <button type="button" onClick={removeFile} className="text-xs text-gray-400 hover:text-red-400">{t('file_remove')}</button>}
              </div>
              <p className="mt-1 text-xs text-gray-500">{t(fileHelp ?? 'file_help')}</p>
              {fileError && <p className="mt-1 text-xs text-red-400 whitespace-pre-line">{fileError}</p>}
            </div>
          )}
          <button type="submit" className="hidden" />
        </form>
        {error && <p role="alert" className="px-4 pt-3 text-sm text-red-400 whitespace-pre-line border-t border-[#2A2A2A]">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end px-4 py-3 border-t border-[#2A2A2A]">
          <button onClick={onClose} disabled={busy} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>
          <button onClick={() => submit(false)} disabled={busy || uploading} className={`px-3 py-2 text-sm rounded-md text-white disabled:opacity-50 ${confirmable ? 'bg-[#2A2A2A] hover:bg-[#3A3A3A]' : 'bg-[#E07B53] hover:opacity-90'}`}>{t('save')}</button>
          {confirmable && (
            <button onClick={() => submit(true)} disabled={busy || uploading} className="px-3 py-2 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-50">{confirmLabel ?? t('save_confirm')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
