import { workT, type WorkLang } from '@/lib/translations/work'

export interface SheetTextScreen {
  schema: { columns: ReadonlyArray<{ name: string; type: string }> }
  hidden: readonly string[]
  options: Readonly<Record<string, readonly string[]>>
  countryColumns?: readonly string[]
  colLabels?: Readonly<Record<string, string>>
  labels?: Readonly<Record<string, string>>
  derived?: { columns: ReadonlyArray<SheetTextDerived>; cells: Record<string, Record<string, string | number | null>> } | null
  details?: { column: string; columns?: readonly string[]; money?: readonly string[]; booleans?: readonly string[]; label?: string; options?: Readonly<Record<string, readonly string[]>> } | null
  formId?: string
  dotFrom?: string | null
  dotWhyFrom?: string | null
  refRows?: Readonly<Record<string, ReadonlyArray<{ id: string; label: string | null; mark?: 'unconfirmed' | 'unreadable' }>>>
}
export interface SheetTextDerived { name: string; label: string; type: string; replaces?: string; after?: string | null }

export const EVIDENCE_COLUMN = 'evidence'

export function countryLabel(lang: string, code: string): string {
  try {
    const n = new Intl.DisplayNames([lang], { type: 'region' }).of(code)
    return n && n !== code ? `${n} (${code})` : code
  } catch {
    return code
  }
}

export type ObjText = { options: Readonly<Record<string, readonly string[]>>; label: (k: string) => string }

export function refCellText(lang: WorkLang, v: unknown, rows: ReadonlyArray<{ id: string; label: string | null; mark?: 'unconfirmed' | 'unreadable' }>, pkg: string | null): string {
  if (v === undefined || v === null || v === '') return ''
  if (rows.some((r) => r.mark === 'unreadable')) return workT(lang, 'ref_unreadable', '(cannot be read)', pkg)
  const hit = rows.find((r) => r.id === v)
  if (hit?.mark === 'unconfirmed') return workT(lang, 'ref_unconfirmed', '(not confirmed)', pkg)
  return hit ? hit.label ?? workT(lang, 'ref_noname', '(no name)', pkg) : workT(lang, 'ref_gone', '(deleted row)', pkg)
}

export function sheetCellText(lang: WorkLang, v: unknown, options: readonly string[] | undefined, pkg: string | null, col?: { name: string; country?: boolean; boolean?: boolean; ref?: ReadonlyArray<{ id: string; label: string | null; mark?: 'unconfirmed' | 'unreadable' }> }, obj?: ObjText): string {
  if (col?.ref) return refCellText(lang, v, col.ref, pkg)
  if (v === undefined || v === null) return col?.boolean ? workT(lang, `bool_${col.name}_empty`, '', pkg) : ''
  if (typeof v === 'boolean' && col) return workT(lang, `bool_${col.name}_${v}`, workT(lang, v ? 'yes' : 'no', String(v), pkg), pkg)
  if (typeof v === 'string' && col?.country) return countryLabel(lang, v)
  if (typeof v === 'string') return options?.includes(v) ? workT(lang, `opt_${v}`, v, pkg) : v
  if (typeof v === 'object' && obj && !Array.isArray(v) && Object.values(v as object).every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))) {
    return Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== '')
      .map(([k, x]) => `${obj.label(k)}: ${typeof x === 'string' && obj.options[k]?.includes(x) ? workT(lang, `opt_${x}`, x, pkg) : String(x)}`).join(' · ')
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function sheetVisibleColumns<S extends SheetTextScreen>(s: S): Array<S['schema']['columns'][number]> {
  const cols = s.schema.columns.filter((c) => !s.hidden.includes(c.name))
  const ev = cols.find((c) => c.name === EVIDENCE_COLUMN)
  return ev ? [ev, ...cols.filter((c) => c !== ev)] : cols
}

export function sheetTableColumns<C extends { name: string }>(s: SheetTextScreen, visible: readonly C[]): C[] {
  const replaced = new Set((s.derived?.columns ?? []).flatMap((c) => (c.replaces ? [c.replaces] : [])))
  if (s.details) replaced.add(s.details.column)
  return replaced.size ? visible.filter((c) => !replaced.has(c.name)) : [...visible]
}

export type SheetTableCol<C, D> = { kind: 'stored'; col: C } | { kind: 'derived'; col: D }

export function sheetTableLayout<C extends { name: string }, D extends SheetTextDerived>(s: { derived?: { columns: ReadonlyArray<D> } | null; dotFrom?: string | null; dotWhyFrom?: string | null }, tableCols: readonly C[]): Array<SheetTableCol<C, D>> {
  const ds = (s.derived?.columns ?? []).filter((d) => d.name !== s.dotFrom && d.name !== s.dotWhyFrom)
  const names = new Set(tableCols.map((c) => c.name))
  const placed = (d: D) => d.after === null || (typeof d.after === 'string' && names.has(d.after))
  const out: Array<SheetTableCol<C, D>> = ds.filter((d) => d.after === null).map((col) => ({ kind: 'derived', col }))
  for (const c of tableCols) {
    out.push({ kind: 'stored', col: c })
    for (const d of ds) if (d.after === c.name) out.push({ kind: 'derived', col: d })
  }
  for (const d of ds) if (!placed(d)) out.push({ kind: 'derived', col: d })
  return out
}

export function sheetLabels(lang: WorkLang, pkg: string | null, s: SheetTextScreen) {
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const colLabel = (n: string) => s.labels?.[n] ?? t(s.colLabels?.[n] ?? `col_${n}`, n)
  const derivedText = (c: { label: string; type: string }, v: string) => (c.type === 'status' ? t(`${c.label}_${v}`, v) : v)
  const objText: ObjText = { options: s.options, label: (k) => colLabel(k) }
  return { t, colLabel, derivedText, objText }
}

export interface SheetExportItems { label: string; header: string[]; align: Array<'left' | 'right'>; rows: string[][][] }

export function sheetExportTable(lang: WorkLang, pkg: string | null, s: SheetTextScreen, rows: ReadonlyArray<{ id: string; data: Readonly<Record<string, unknown>>; virtual?: boolean }>, derivedCells: Record<string, Record<string, string | number | null>> = s.derived?.cells ?? {}): { header: string[]; rows: string[][]; align: Array<'left' | 'right'>; items?: SheetExportItems } {
  const { t, colLabel, derivedText, objText } = sheetLabels(lang, pkg, s)
  const layout = sheetTableLayout(s, sheetTableColumns(s, sheetVisibleColumns(s)))
  const numeric = (type: string) => type === 'money' || type === 'decimal' || type === 'number'
  const det = s.formId && s.details?.columns?.length ? s.details : null
  const items: SheetExportItems | undefined = det ? {
    label: colLabel(det.label ?? det.column),
    header: det.columns!.map((c) => colLabel(c)),
    align: det.columns!.map((c) => (det.money?.includes(c) ? 'right' : 'left')),
    rows: rows.map((r) => {
      const v = r.data[det.column]
      return Array.isArray(v) ? v.filter((it) => !!it && typeof it === 'object' && !Array.isArray(it)).map((it) => det.columns!.map((c) => {
        const x = (it as Record<string, unknown>)[c]
        if (x === undefined || x === null || x === '') return ''
        if (typeof x === 'boolean') return t(x ? 'yes' : 'no', String(x))
        return sheetCellText(lang, x, det.options?.[c] ?? s.options[c], pkg)
      })) : []
    }),
  } : undefined
  return {
    ...(items ? { items } : {}),
    header: layout.map((x) => (x.kind === 'derived' ? t(x.col.label) : colLabel(x.col.name))),
    align: layout.map((x) => (numeric(x.col.type) ? 'right' : 'left')),
    rows: rows.map((r) => layout.map((x) => {
      if (x.kind === 'derived') { const v = r.virtual ? undefined : derivedCells[r.id]?.[x.col.name]; return v === undefined || v === null || v === '' ? '' : derivedText(x.col, String(v)) }
      return sheetCellText(lang, r.data[x.col.name], s.options[x.col.name], pkg, { name: x.col.name, country: (s.countryColumns ?? []).includes(x.col.name), boolean: x.col.type === 'boolean', ref: s.refRows?.[x.col.name] }, objText)
    })),
  }
}

export function sheetSortRows<R extends { data: Readonly<Record<string, unknown>> }>(lang: WorkLang, pkg: string | null, s: SheetTextScreen, rows: readonly R[], sort: { col: string; dir: 'asc' | 'desc' } | null): R[] {
  const col = sort && s.schema.columns.find((c) => c.name === sort.col)
  if (!sort || !col) return [...rows]
  const { objText } = sheetLabels(lang, pkg, s)
  const numeric = col.type === 'money' || col.type === 'decimal' || col.type === 'number'
  const key = (r: R): number | string | null => {
    const v = r.data[col.name]
    if (v === undefined || v === null || v === '') return null
    if (!numeric) return sheetCellText(lang, v, s.options[col.name], pkg, { name: col.name, country: (s.countryColumns ?? []).includes(col.name), boolean: col.type === 'boolean', ref: s.refRows?.[col.name] }, objText)
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = key(a), y = key(b)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), lang, { numeric: true }))
  })
}
