import type { PrismaClient, Prisma } from '@prisma/client'
import { accountToday, computeRow, crossTargetProblem, NUMBER_COLUMN, readSpec, specSheetName, STATUS_COLUMN, type RefItem, type SpecTable } from './assembled'
import type { ReferenceSheetView } from './references'
import type { SheetRowView } from './sheet-gate'

type Db = PrismaClient | Prisma.TransactionClient

export interface AssembledSourceSheet {
  name: string
  columns: Array<{ key: string; label: string; kind: string }>
  rows: Array<{ id: string; confirmed: boolean | null; data: Record<string, unknown> }>
  refRows: Record<string, RefItem[]>
}

const UNREADABLE: RefItem[] = [{ id: '', label: null, mark: 'unreadable' }]

export async function assembledSourceSheets(db: Db, key: Buffer, q: { userId: string; sourceProjectId: string; sheets: readonly ReferenceSheetView[]; rowsOf: (sheetId: string) => readonly SheetRowView[] }): Promise<Map<string, AssembledSourceSheet> | null> {
  const p = await db.workProject.findFirst({ where: { id: q.sourceProjectId, userId: q.userId }, select: { kind: true } })
  if (p?.kind !== 'assembled') return null
  const sp = await readSpec(db, key, { userId: q.userId, projectId: q.sourceProjectId })
  const out = new Map<string, AssembledSourceSheet>()
  if (!sp) return out
  const today = await accountToday(db, q.userId)
  const tableOf = (sheetName: string) => sp.spec.tables.find((t) => specSheetName(t.key) === sheetName)
  const picked = new Map(q.sheets.flatMap((s) => { const t = tableOf(s.name); return t && !t.hidden ? [[t.key, s] as const] : [] }))
  const targetItems = async (t: SpecTable, show: string, wanted: ReadonlySet<string>): Promise<RefItem[]> => {
    const sh = picked.get(t.key)
    if (!sh) return UNREADABLE
    const seen = q.rowsOf(sh.id)
    const shown = new Set(seen.map((r) => r.id))
    const ask = [...wanted].filter((id) => !shown.has(id))
    const hidden = ask.length ? await db.dataSheetRow.findMany({ where: { id: { in: ask }, sheetId: sh.id, projectId: q.sourceProjectId, userId: q.userId }, select: { id: true } }) : []
    return [
      ...seen.map((r): RefItem => { const v = r.data[show]; return { id: r.id, label: v === undefined || v === null || v === '' ? null : String(v) } }),
      ...hidden.map((r): RefItem => ({ id: r.id, label: null, mark: 'unconfirmed' })),
    ]
  }
  for (const [tk, sh] of picked) {
    const t = sp.spec.tables.find((x) => x.key === tk)!
    const cols: AssembledSourceSheet['columns'] = [
      ...(t.number ? [{ key: NUMBER_COLUMN, label: 'No.', kind: 'number_block' }] : []),
      ...(t.status ? [{ key: STATUS_COLUMN, label: t.status.label ?? 'Status', kind: 'status' }] : []),
      ...t.columns.filter((c) => !c.hidden).map((c) => ({ key: c.key, label: c.label, kind: c.kind })),
    ]
    const refRows: Record<string, RefItem[]> = {}
    for (const c of t.columns) {
      if (c.kind !== 'ref' || c.hidden || !c.ref) continue
      if (c.ref.app) { refRows[c.key] = UNREADABLE; continue }
      const target = sp.spec.tables.find((x) => x.key === c.ref!.table)
      const wanted = new Set(q.rowsOf(sh.id).map((r) => r.data[c.key]).filter((v): v is string => typeof v === 'string' && v !== ''))
      refRows[c.key] = target && !crossTargetProblem(sp.spec, c.ref) ? await targetItems(target, c.ref.show, wanted) : UNREADABLE
    }
    const keys = new Set(cols.map((c) => c.key))
    const rows = q.rowsOf(sh.id).map((r) => {
      const comp = computeRow(t, r.data, today)
      const data: Record<string, unknown> = {}
      for (const k of keys) data[k] = k in comp ? comp[k] : k === STATUS_COLUMN && (r.data[k] === undefined || r.data[k] === null || r.data[k] === '') ? t.status?.start ?? null : r.data[k] ?? null
      for (const c of t.columns) if (c.kind === 'money' && !c.hidden && r.data[`${c.key}_cur`]) data[`${c.key}_cur`] = r.data[`${c.key}_cur`]
      return { id: r.id, confirmed: r.confirmed ?? null, data }
    })
    out.set(sh.id, { name: t.name, columns: cols, rows, refRows })
  }
  return out
}
