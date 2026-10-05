
import { WorkError } from './errors'
import { findTemplate, type SheetTemplate } from './sheet-templates'
import { withProjectSheetWrite, type ProjectSheetWriter, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { calendarDateOf } from './sheet-columns'
import { dateInAny, type DateRange } from './sheet-periods'

interface Target { userId: string; projectId: string; sheetId: string; actor: SheetActor }

async function templateOf(deps: WorkSheetDeps, t: Target): Promise<SheetTemplate | null> {
  const s = await deps.db.dataSheet.findFirst({ where: { id: t.sheetId, kind: 'project', projectId: t.projectId, userId: t.userId }, select: { template: true } })
  if (!s) throw new WorkError('NOT_FOUND')
  return s.template ? findTemplate(deps.templates, s.template) : null
}

function screenData(raw: unknown, tpl: SheetTemplate | null): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkError('INVALID', 'data must be an object')
  const hidden = new Set(tpl?.ui?.hidden ?? [])
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => !hidden.has(k)))
}

function fileColumnOf(tpl: SheetTemplate | null, fileId: string | null | undefined): string | null {
  if (fileId === undefined) return tpl?.ui?.file ?? null
  if (!tpl?.ui?.file) throw new WorkError('INVALID', 'this sheet has no file column')
  return tpl.ui.file
}

async function syncFile(w: ProjectSheetWriter, tpl: SheetTemplate | null, rowId: string, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>> | null) {
  if (!tpl?.ui?.file || !tpl.dateColumn) return
  await w.syncRowFile(rowId, tpl.ui.file, tpl.dateColumn, before, after)
}

export async function insertRowFromScreen(deps: WorkSheetDeps, t: Target, raw: unknown, confirm: boolean, fileId?: string | null) {
  const tpl = await templateOf(deps, t)
  if (tpl?.ui?.noManualRows) throw new WorkError('FORBIDDEN', 'rows of this sheet are added by a module')
  const col = fileColumnOf(tpl, fileId)
  const key = tpl?.manualRow ? await deps.dataKey(deps.db, t.userId) : null
  return withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [t.sheetId], actor: t.actor }, async (w) => {
    let data = screenData(raw, tpl)
    const file = fileId ? await w.projectFile(fileId) : null
    if (file && col) data[col] = file.id
    if (tpl?.manualRow) data = tpl.manualRow(key!, data, null, { fileSha256: file?.sha256 ?? null })
    const row = await w.insert(t.sheetId, data, { confirm })
    await syncFile(w, tpl, row.id, null, row.data)
    return row
  })
}

export async function updateRowFromScreen(deps: WorkSheetDeps, t: Target, rowId: string, raw: unknown, confirm: boolean, fileId?: string | null) {
  const tpl = await templateOf(deps, t)
  const col = fileColumnOf(tpl, fileId)
  const key = tpl?.manualRow ? await deps.dataKey(deps.db, t.userId) : null
  return withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [t.sheetId], actor: t.actor }, async (w) => {
    const patch = screenData(raw, tpl)
    const file = fileId ? await w.projectFile(fileId) : fileId
    if (file !== undefined && col) patch[col] = file ? file.id : null
    const before = col ? (await w.row(t.sheetId, rowId)).data : null
    let row
    if (!tpl?.manualRow) {
      row = await w.update(t.sheetId, rowId, patch, { confirm })
    } else {
      const cur = await w.row(t.sheetId, rowId)
      const merged: Record<string, unknown> = { ...cur.data, ...patch }
      for (const [k, v] of Object.entries(patch)) if (v === null) delete merged[k]
      let sha = file === undefined ? null : file?.sha256 ?? null
      const curFile = col ? cur.data[col] : undefined
      if (file === undefined && typeof curFile === 'string') sha = (await w.projectFile(curFile).catch(() => null))?.sha256 ?? null
      const next = tpl.manualRow(key!, merged, cur.data, { fileSha256: sha })
      const out: Record<string, unknown> = { ...next }
      for (const k of Object.keys(cur.data)) if (!(k in next)) out[k] = null
      row = await w.update(t.sheetId, rowId, out, { confirm, given: patch })
    }
    await syncFile(w, tpl, rowId, before, row.data)
    return row
  })
}

export async function deleteRowFromScreen(deps: WorkSheetDeps, t: Target, rowId: string) {
  const tpl = await templateOf(deps, t)
  await withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [t.sheetId], actor: t.actor }, async (w) => {
    const before = tpl?.ui?.file ? (await w.row(t.sheetId, rowId)).data : null
    await w.remove(t.sheetId, rowId)
    await syncFile(w, tpl, rowId, before, null)
  })
}

export async function confirmFromScreen(deps: WorkSheetDeps, t: Target, pick: { rowIds: string[] } | { all: true; period?: DateRange }): Promise<{ confirmed: number; pairs: number; skippedLocked: number }> {
  const tpl = 'all' in pick && pick.period ? await templateOf(deps, t) : null
  return withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [], actor: t.actor }, async (w) => {
    const rows = await w.rows(t.sheetId)
    let inScope = (_r: (typeof rows)[number]) => true
    if ('all' in pick && pick.period && tpl?.dateColumn) {
      const col = (await w.sheetSchema(t.sheetId)).columns.find((c) => c.name === tpl.dateColumn)!
      const periods = [pick.period]
      inScope = (r) => { const d = calendarDateOf(col, r.data[tpl.dateColumn!]); return d !== null && dateInAny(d, periods) }
    }
    const want = 'all' in pick ? rows.filter((r) => r.confirmed === false && inScope(r)) : rows.filter((r) => pick.rowIds.includes(r.id))
    if (!('all' in pick) && want.length !== new Set(pick.rowIds).size) throw new WorkError('NOT_FOUND')
    let ids = want.map((r) => r.id)
    let skippedLocked = 0
    if ('all' in pick) {
      const open: string[] = []
      for (const r of want) (await w.isLocked(t.sheetId, r.id)) ? skippedLocked++ : open.push(r.id)
      ids = open
    }
    await w.confirmRows(ids)
    let pairs = 0
    if ('all' in pick) {
      const scoped = rows.filter((r) => inScope(r)).map((r) => r.id)
      for (const p of await w.pairsFrom(scoped)) {
        if (p.confirmed) continue
        if (await w.isPairLocked(p.id)) { skippedLocked++; continue }
        await w.confirmPair(p.id)
        pairs++
      }
    }
    return { confirmed: ids.length, pairs, skippedLocked }
  })
}

export async function pairFromScreen(deps: WorkSheetDeps, t: Target, a: { fromRowId: string; toRowId: string; kind: string; confirm: boolean; exception?: string }) {
  return withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [], actor: t.actor, exception: a.exception }, async (w) => {
    await w.row(t.sheetId, a.fromRowId)
    const p = await w.pair(a.fromRowId, a.toRowId, a.kind)
    if (a.confirm) await w.confirmPair(p.id)
    return p
  })
}

export async function unpairFromScreen(deps: WorkSheetDeps, t: Target, a: { pairId: string; exception?: string }) {
  await withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [], actor: t.actor, exception: a.exception }, async (w) => {
    const p = await w.pairsFrom(null, a.pairId)
    if (p.length !== 1) throw new WorkError('NOT_FOUND')
    await w.row(t.sheetId, p[0].fromRowId)
    await w.unpair(a.pairId)
  })
}

export async function confirmPairFromScreen(deps: WorkSheetDeps, t: Target, pairId: string) {
  await withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [], actor: t.actor }, async (w) => {
    const p = await w.pairsFrom(null, pairId)
    if (p.length !== 1) throw new WorkError('NOT_FOUND')
    await w.row(t.sheetId, p[0].fromRowId)
    await w.confirmPair(pairId)
  })
}
