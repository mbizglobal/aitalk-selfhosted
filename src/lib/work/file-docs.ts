import { decodeRow } from './sheet-gate'
import { findTemplate } from './sheet-templates'
import { fileRows } from './file-decisions'
import { currencyKey, type FormInfo } from './myforms'
import { readAnyForms } from './assembled'
import type { WorkFileDeps } from './files'
import { describeCaughtError } from '@/lib/log-mask'

export interface FileDoc {
  key: string
  title?: string
  detail?: string
  rows: number
  toConfirm: number
}

const TITLE_MAX = 120
const text = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  return s ? s : null
}
const joinDetail = (date: string | null, cur: string | null, amount: string | null) =>
  [date, amount ? (cur ? `${cur} ${amount}` : amount) : null].filter(Boolean).join(' · ') || undefined

export function templateDocText(
  summary: readonly string[], types: ReadonlyMap<string, string>, skip: ReadonlySet<string>, data: Readonly<Record<string, unknown>>,
): { title?: string; detail?: string } {
  const of = (want: (t: string, c: string) => boolean) => summary.find((c) => want(types.get(c) ?? '', c) && text(data[c]) !== null)
  const t = of((ty, c) => (ty === 'string' || ty === 'text') && !skip.has(c) && !/Key$/.test(c) && c !== 'currency')
  const d = of((ty) => ty === 'date')
  const m = of((ty) => ty === 'money')
  return { title: t ? text(data[t])!.slice(0, TITLE_MAX) : undefined, detail: joinDetail(d ? text(data[d]) : null, text(data.currency), m ? text(data[m]) : null) }
}

export function formDocText(info: FormInfo, data: Readonly<Record<string, unknown>>): { title?: string; detail?: string } {
  const cols = info.columns.filter((c) => !c.hidden)
  const of = (kind: string) => cols.find((c) => c.kind === kind && text(data[c.key]) !== null)
  const t = of('text'), d = of('date'), m = of('money')
  return { title: t ? text(data[t.key])!.slice(0, TITLE_MAX) : undefined, detail: joinDetail(d ? text(data[d.key]) : null, m ? text(data[currencyKey(m.key)]) : null, m ? text(data[m.key]) : null) }
}

export async function docLinks(deps: WorkFileDeps, q: { userId: string; projectId: string; fileIds: readonly string[] }) {
  const links = await fileRows(deps, q)
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const rowFile = new Map<string, string>()
  for (const [fileId, list] of links) {
    if (!parent.has(fileId)) parent.set(fileId, fileId)
    for (const a of list) {
      const other = rowFile.get(a.rowId)
      if (other) parent.set(find(fileId), find(other))
      else rowFile.set(a.rowId, fileId)
    }
  }
  const groups = new Map<string, Array<(typeof links extends Map<string, infer L> ? L : never)[number]>>()
  const groupOf = new Map<string, string>()
  for (const [fileId, list] of links) {
    const g = find(fileId)
    groupOf.set(fileId, g)
    groups.set(g, [...(groups.get(g) ?? []), ...list])
  }
  return { links, groups, groupOf }
}

export async function fileDocs(deps: WorkFileDeps, q: { userId: string; projectId: string; fileIds: readonly string[] }): Promise<Map<string, FileDoc>> {
  const { links, groups, groupOf } = await docLinks(deps, q)
  const headOf = new Map<string, { rowId: string; sheetId: string }>()
  for (const [g, list] of groups) {
    const sorted = [...list].sort((a, b) => (a.role === b.role ? a.rowId.localeCompare(b.rowId) : a.role === 'main' ? -1 : 1))
    if (sorted[0]) headOf.set(g, sorted[0])
  }
  const titles = await readTitles(deps, q, [...headOf.values()])
  const out = new Map<string, FileDoc>()
  for (const [fileId] of links) {
    const g = groupOf.get(fileId)!
    const list = groups.get(g) ?? []
    const rows = new Map(list.map((a) => [a.rowId, a.confirmed === true]))
    if (rows.size === 0) continue
    const head = headOf.get(g)!
    const t = titles.get(head.rowId)
    out.set(fileId, {
      key: [...rows.keys()].sort()[0],
      ...(t?.title ? { title: t.title } : {}),
      ...(t?.detail ? { detail: t.detail } : {}),
      rows: rows.size,
      toConfirm: [...rows.values()].filter((ok) => !ok).length,
    })
  }
  return out
}

async function readTitles(deps: WorkFileDeps, q: { userId: string; projectId: string }, heads: ReadonlyArray<{ rowId: string; sheetId: string }>) {
  const out = new Map<string, { title?: string; detail?: string }>()
  if (!heads.length) return out
  const sheetIds = [...new Set(heads.map((h) => h.sheetId))]
  const [sheets, rows, key] = await Promise.all([
    deps.db.dataSheet.findMany({ where: { id: { in: sheetIds }, kind: 'project', projectId: q.projectId, userId: q.userId }, select: { id: true, schema: true, template: true } }),
    deps.db.dataSheetRow.findMany({ where: { id: { in: heads.map((h) => h.rowId) }, kind: 'project', projectId: q.projectId, userId: q.userId } }),
    deps.dataKey(deps.db, q.userId),
  ])
  const formOf = new Map((await readAnyForms(deps.db, key, { userId: q.userId, sheetIds: sheets.filter((s) => !s.template).map((s) => s.id) })).map((f) => [f.sheetId, f.info]))
  const sheetOf = new Map(sheets.map((s) => [s.id, s]))
  for (const r of rows) {
    try {
      const data = decodeRow(r, key).data
      const s = sheetOf.get(r.sheetId)
      if (!s) continue
      const tpl = s.template ? findTemplate(deps.templates, s.template) : null
      if (tpl?.ui?.summary) {
        const types = new Map((JSON.parse(s.schema) as { columns: Array<{ name: string; type: string }> }).columns.map((c) => [c.name, c.type]))
        const skip = new Set([...Object.keys(tpl.ui.options ?? {}), ...(tpl.ui.hidden ?? [])])
        out.set(r.id, templateDocText(tpl.ui.summary, types, skip, data))
      } else {
        const info = formOf.get(r.sheetId)
        if (info) out.set(r.id, formDocText(info, data))
      }
    } catch (e) {
      console.warn(`[work] file doc title unreadable ${r.id}: ${describeCaughtError(e)}`)
    }
  }
  return out
}
