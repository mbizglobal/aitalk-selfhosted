
import { WorkError } from './errors'
import type { WorkFileDeps } from './files'
import { readSheetScreen, type SheetPageQuery, type SheetScreen } from './views'
import { EVIDENCE_COLUMN, sheetCellText, sheetExportTable, sheetLabels, sheetSortRows, sheetTableColumns, sheetTableLayout, sheetVisibleColumns } from './sheet-text'
import type { WorkLang } from '@/lib/translations/work'

export const EXPORT_MAX_ROWS = 5000
const MAX_PAGES = 1000

type Rows = SheetScreen['rows']
type ScreenRow = Rows[number] & { virtual?: true }

export async function readAllRows(deps: WorkFileDeps, t: { userId: string; projectId: string }, sheetId: string, page: SheetPageQuery, only: Set<string> | null, onCap: 'throw' | 'stop' = 'throw') {
  let screen: SheetScreen = await readSheetScreen(deps, { userId: t.userId, projectId: t.projectId, sheetId, page })
  const first = screen
  const keep = (rows: Rows) => (only ? rows.filter((r) => only.has(r.id)) : rows)
  let list = keep(screen.rows)
  let cells = { ...(screen.derived?.cells ?? {}) }
  let pages = 1
  let cut = false
  while (screen.paging?.next && (only ? list.length < only.size : list.length <= EXPORT_MAX_ROWS)) {
    if (++pages > MAX_PAGES) {
      if (onCap === 'throw') throw new WorkError('INVALID', 'this sheet is too large to search — choose a period')
      cut = true
      break
    }
    screen = await readSheetScreen(deps, { userId: t.userId, projectId: t.projectId, sheetId, page: { ...page, after: screen.paging.next } })
    const have = new Set(list.map((r) => r.id))
    list = [...list, ...keep(screen.rows).filter((r) => !have.has(r.id))]
    cells = { ...cells, ...(screen.derived?.cells ?? {}) }
  }
  return { first, list, cells, cut: cut || (!!only && list.length < only.size) }
}

export function webScreenRows<R extends Rows[number]>(lang: WorkLang, pkg: string | null, s: SheetScreen, rows: readonly R[], q: { period?: { start: string; end: string }; showHidden?: boolean; evidence?: string; sort?: { col: string; dir: 'asc' | 'desc' } | null }): R[] {
  if (s.paging) return [...rows]
  let list = [...rows]
  if (q.period && s.dateColumn) {
    const c = s.dateColumn
    list = list.filter((r) => { const d = String(r.data[c] ?? '').slice(0, 10); return d >= q.period!.start && d <= q.period!.end })
  }
  const dateCol = s.dateColumn ?? s.effectiveFromColumn
  if (dateCol) list.sort((a, b) => String(b.data[dateCol] ?? '').localeCompare(String(a.data[dateCol] ?? '')))
  if (s.hideWhen && !q.showHidden) { const h = s.hideWhen; list = list.filter((r) => { const v = r.data[h]; return v === undefined || v === null || v === '' }) }
  if (q.evidence !== undefined) list = list.filter((r) => (typeof r.data[EVIDENCE_COLUMN] === 'string' ? r.data[EVIDENCE_COLUMN] : '') === q.evidence)
  const sort = q.sort ?? (s.sortBy ? { col: s.sortBy.column, dir: s.sortBy.dir } : null)
  return sort ? sheetSortRows(lang, pkg, s, list, sort) : list
}

export function appSheetView(lang: WorkLang, pkg: string | null, readOnly: boolean, first: SheetScreen, list: readonly ScreenRow[], cells: NonNullable<SheetScreen['derived']>['cells'], opts: { screen?: boolean } = {}) {
  const { colLabel, t } = sheetLabels(lang, pkg, first)
  const table = sheetExportTable(lang, pkg, first, list, cells)
  const layout = sheetTableLayout(first, sheetTableColumns(first, sheetVisibleColumns(first)))
  const fxCols = opts.screen ? first.fxShownColumns : null
  if (fxCols) list.forEach((r, i) => {
    const fx = r.virtual ? undefined : first.fxShown[r.id]
    if (!fx) return
    layout.forEach((x, k) => {
      if (table.rows[i][k] !== '') return
      if (x.col.name === fxCols.rate) table.rows[i][k] = fx.rate
      else if (x.col.name === fxCols.unit) table.rows[i][k] = String(fx.unit)
    })
  })
  const edit = sheetVisibleColumns(first).filter((c) => !first.viewOnly.includes(c.name))
  const country = (n: string) => first.countryColumns.includes(n)
  const has = <T,>(m: Record<string, T>) => Object.fromEntries(edit.filter((c) => m[c.name] !== undefined).map((c) => [c.name, m[c.name]]))
  const editLocked = (d: Record<string, unknown>) => { const v = first.lockEditWhen ? d[first.lockEditWhen] : null; return !(v === undefined || v === null || v === '') }
  const det = first.details
  const itemsOf = (d: Record<string, unknown>) => {
    const v = det ? d[det.column] : null
    if (!det || !Array.isArray(v) || v.length === 0) return null
    const text = (c: string, x: unknown) => (x === undefined || x === null || x === '' ? '' : det.booleans?.includes(c) ? (x === true ? '✓' : '—') : typeof x === 'object' ? JSON.stringify(x) : String(x))
    return { label: first.labels?.[det.label] ?? t(det.label), header: det.columns.map((c) => colLabel(c)), rows: v.map((it) => det.columns.map((c) => text(c, (it as Record<string, unknown>)?.[c]))) }
  }
  return {
    columns: layout.map((x, i) => ({ name: x.col.name, label: table.header[i], type: x.col.type, derived: x.kind === 'derived', align: table.align[i] })),
    edit: {
      columns: edit.map((c) => ({ name: c.name, label: colLabel(c.name), type: c.type, ...(c.required ? { required: true } : {}) })),
      options: Object.fromEntries(edit.filter((c) => first.options[c.name]).map((c) => [c.name, first.options[c.name].map((v) => ({ value: v, label: sheetCellText(lang, v, first.options[c.name], pkg, { name: c.name, country: country(c.name) }) }))])),
      choices: has(first.choices),
      refOptions: has(first.refOptions),
      viewOnly: first.viewOnly,
    },
    rows: list.map((r, i) => ({
      rowId: r.id, data: r.data, cells: table.rows[i], confirmed: r.confirmed ?? null, locked: r.locked,
      ...(r.virtual ? { virtual: true } : {}),
      ...((() => { const it = itemsOf(r.data); return it ? { items: it } : {} })()),
      editable: !r.virtual && !readOnly && !r.locked && !first.moduleOnly && !editLocked(r.data),
    })),
  }
}
