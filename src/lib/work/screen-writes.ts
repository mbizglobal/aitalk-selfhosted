
import { cardFingerprint } from './confirm-card'
import { WorkError } from './errors'
import { findTemplate, splitFileIds, templateFileColumns, type SheetTemplate } from './sheet-templates'
import { deleteFileBlobs, readProjectFile, removeFileInTx, type WorkFileDeps } from './files'
import { docLinks } from './file-docs'
import { withProjectSheetWrite, type ProjectSheetWriter, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { calendarDateOf } from './sheet-columns'
import { dateInAny, type DateRange } from './sheet-periods'
import { FORM_FILE_SHAPE } from './myforms'
import { readAssembledForms } from './assembled'

interface Target { userId: string; projectId: string; sheetId: string; actor: SheetActor }

async function formFileShape(deps: WorkSheetDeps, t: Target): Promise<Pick<SheetTemplate, 'ui' | 'fileColumns'> | null> {
  if (await deps.db.workForm.count({ where: { sheetId: t.sheetId, userId: t.userId, deletedAt: null } })) return FORM_FILE_SHAPE
  const forms = await readAssembledForms(deps.db, await deps.dataKey(deps.db, t.userId), { userId: t.userId, projectId: t.projectId, sheetIds: [t.sheetId] })
  return forms.length ? FORM_FILE_SHAPE : null
}

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

function fileColumnOf(tpl: Pick<SheetTemplate, 'ui' | 'fileColumns'> | null, fileId: string | null | undefined, fileColumn?: string): string | null {
  if (fileId === undefined) return tpl?.ui?.file ?? null
  if (fileColumn !== undefined) {
    if (!tpl || !templateFileColumns(tpl).includes(fileColumn)) throw new WorkError('INVALID', `this sheet has no file column "${fileColumn.slice(0, 40)}"`)
    return fileColumn
  }
  if (!tpl?.ui?.file) throw new WorkError('INVALID', 'this sheet has no file column')
  return tpl.ui.file
}

async function checkFileBytes(deps: WorkSheetDeps, t: Target, tpl: SheetTemplate | null, data: Readonly<Record<string, unknown>>, col: string | null, fileId: string | null | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const [c, rule] of Object.entries(tpl?.fileRules ?? {})) {
    if (!rule.check) continue
    const id = c === col && fileId !== undefined ? fileId : data[c]
    if (typeof id !== 'string' || !id) continue
    if (!('blob' in deps)) throw new WorkError('UNAVAILABLE', 'file store unavailable')
    const meta = await deps.db.workFile.findFirst({ where: { id, projectId: t.projectId, userId: t.userId }, select: { mimeType: true, sizeBytes: true } })
    if (!meta) throw new WorkError('NOT_FOUND')
    if (!rule.mime.includes(meta.mimeType)) throw new WorkError('INVALID', `${c}: the file must be ${rule.mime.map((m) => m.replace(/^\w+\//, '').toUpperCase()).join(' or ')}`)
    if (meta.sizeBytes > rule.maxBytes) throw new WorkError('INVALID', `${c}: the file must be ${Math.floor(rule.maxBytes / 1024 / 1024)} MB or smaller`)
    const f = await readProjectFile(deps as WorkFileDeps, { userId: t.userId, fileId: id, actor: t.actor, mergeReadMs: 10 * 60_000 })
    const why = await rule.check(f.buffer)
    if (why) throw new WorkError('INVALID', `${c}: ${why}`)
    out.set(id, f.file.sha256)
  }
  return out
}

async function assertSameFiles(w: ProjectSheetWriter, checked: ReadonlyMap<string, string>): Promise<void> {
  for (const [id, sha] of checked) {
    if ((await w.projectFile(id)).sha256 !== sha) throw new WorkError('STALE', 'the file changed while it was checked — try again')
  }
}

async function syncFile(w: ProjectSheetWriter, tpl: SheetTemplate | null, rowId: string, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>> | null) {
  if (!tpl?.ui?.file || !tpl.dateColumn) return
  if (tpl.ui.moreFiles) {
    const main = tpl.ui.file
    const more = tpl.ui.moreFiles
    await w.syncRowFiles(rowId, (d) => [...new Set([...(typeof d[main] === 'string' && d[main] ? [d[main] as string] : []), ...splitFileIds(d[more])])], tpl.dateColumn, before, after)
    return
  }
  await w.syncRowFile(rowId, tpl.ui.file, tpl.dateColumn, before, after)
}

export async function insertRowFromScreen(deps: WorkSheetDeps, t: Target, raw: unknown, confirm: boolean, fileId?: string | null, fileColumn?: string) {
  return (await insertRowsFromScreen(deps, t, [{ raw, confirm, fileId }], fileColumn))[0]
}

export async function insertRowsFromScreen(deps: WorkSheetDeps, t: Target, items: ReadonlyArray<{ raw: unknown; confirm: boolean; fileId?: string | null }>, fileColumn?: string) {
  const tpl = await templateOf(deps, t)
  if (tpl?.ui?.noManualRows) throw new WorkError('FORBIDDEN', 'rows of this sheet are added by a module')
  const key = tpl?.manualRow ? await deps.dataKey(deps.db, t.userId) : null
  const prepared: Array<(typeof items)[number] & { col: ReturnType<typeof fileColumnOf>; checked: Awaited<ReturnType<typeof checkFileBytes>> }> = []
  for (const it of items) {
    const col = fileColumnOf(tpl ?? (await formFileShape(deps, t)), it.fileId, fileColumn)
    prepared.push({ ...it, col, checked: await checkFileBytes(deps, t, tpl, screenData(it.raw, tpl), col, it.fileId) })
  }
  return withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [t.sheetId], actor: t.actor }, async (w) => {
    const rows = []
    for (const it of prepared) {
      await assertSameFiles(w, it.checked)
      let data = screenData(it.raw, tpl)
      const file = it.fileId ? await w.projectFile(it.fileId) : null
      if (file && it.col) data[it.col] = file.id
      if (tpl?.manualRow) data = tpl.manualRow(key!, data, null, { fileSha256: file?.sha256 ?? null, actor: t.actor.type })
      const row = await w.insert(t.sheetId, data, { confirm: it.confirm })
      await syncFile(w, tpl, row.id, null, row.data)
      rows.push(row)
    }
    return rows
  })
}

export async function updateRowFromScreen(deps: WorkSheetDeps, t: Target, rowId: string, raw: unknown, confirm: boolean, fileId?: string | null, fileColumn?: string) {
  const tpl = await templateOf(deps, t)
  const col = fileColumnOf(tpl ?? (await formFileShape(deps, t)), fileId, fileColumn)
  const key = tpl?.manualRow ? await deps.dataKey(deps.db, t.userId) : null
  const checked = await checkFileBytes(deps, t, tpl, screenData(raw, tpl), col, fileId)
  return withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [t.sheetId], actor: t.actor }, async (w) => {
    await assertSameFiles(w, checked)
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
      const next = tpl.manualRow(key!, merged, cur.data, { fileSha256: sha, actor: t.actor.type })
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

export async function deleteDocumentFromFiles(deps: WorkFileDeps, t: { userId: string; projectId: string; actor: SheetActor }, fileId: string): Promise<{ rows: number; files: number }> {
  if (t.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person can delete files')
  const scope = async () => {
    const all = await deps.db.workFile.findMany({ where: { projectId: t.projectId, userId: t.userId, parentFileId: null }, select: { id: true } })
    if (!all.some((f) => f.id === fileId)) throw new WorkError('NOT_FOUND')
    const { groups, groupOf } = await docLinks(deps, { ...t, fileIds: all.map((f) => f.id) })
    const g = groupOf.get(fileId)
    const links = g ? groups.get(g) ?? [] : []
    const rows = [...new Map(links.map((a) => [a.rowId, { rowId: a.rowId, sheetId: a.sheetId, confirmed: a.confirmed === true }])).values()].sort((x, y) => x.rowId.localeCompare(y.rowId))
    const fileIds = (g ? [...groupOf].filter(([, x]) => x === g).map(([id]) => id) : [fileId]).sort()
    return { rows, fileIds, sign: JSON.stringify([rows.map((r) => r.rowId), fileIds]) }
  }
  const first = await scope()
  const sheetIds = [...new Set(first.rows.map((r) => r.sheetId))]
  const tpls = new Map(await Promise.all(sheetIds.map(async (sheetId) => [sheetId, await templateOf(deps, { ...t, sheetId })] as const)))
  const key = await deps.dataKey(deps.db, t.userId)
  const blobs = await withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds, actor: t.actor }, async (w) => {
    const now = await scope()
    if (now.sign !== first.sign) throw new WorkError('STALE', 'this document changed meanwhile')
    if (now.rows.some((r) => r.confirmed)) throw new WorkError('LOCKED', 'confirmed')
    const busy = await deps.db.workScanFile.count({ where: { owner: true, fileId: { in: now.fileIds }, scan: { OR: [{ status: { in: ['ready', 'sorting'] } }, { status: 'deferred', deferReason: 'BUSY' }] } } })
    if (busy > 0) throw new WorkError('STALE', 'the AI is reading this document')
    for (const r of now.rows) {
      const tpl = tpls.get(r.sheetId) ?? null
      const before = tpl?.ui?.file ? (await w.row(r.sheetId, r.rowId)).data : null
      await w.remove(r.sheetId, r.rowId)
      await syncFile(w, tpl, r.rowId, before, null)
    }
    return w.withTx(async (tx) => {
      const out: Array<{ blobRegion: string; blobPath: string }> = []
      for (const id of now.fileIds) out.push(...(await removeFileInTx(tx, deps, key, { ...t, fileId: id })))
      return out
    })
  })
  await deleteFileBlobs(deps, blobs)
  return { rows: first.rows.length, files: first.fileIds.length }
}

export async function confirmFromScreen(deps: WorkSheetDeps, t: Target, pick: { rowIds: string[]; fingerprint?: string } | { all: true; period?: DateRange }): Promise<{ confirmed: number; pairs: number; skippedLocked: number; skippedCheck: number }> {
  const tpl = 'all' in pick && pick.period ? await templateOf(deps, t) : null
  const cardKey = !('all' in pick) && pick.fingerprint !== undefined ? await deps.dataKey(deps.db, t.userId) : null
  return withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [], actor: t.actor }, async (w) => {
    const rows = await w.rows(t.sheetId)
    let inScope = (_r: (typeof rows)[number]) => true
    if ('all' in pick && pick.period && tpl?.dateColumn) {
      const col = (await w.sheetSchema(t.sheetId)).columns.find((c) => c.name === tpl.dateColumn)!
      const periods = [pick.period]
      inScope = (r) => { const d = calendarDateOf(col, r.data[tpl.dateColumn!]); return d !== null && dateInAny(d, periods) }
    }
    const want = 'all' in pick ? rows.filter((r) => r.confirmed === false && inScope(r)) : rows.filter((r) => pick.rowIds.includes(r.id))
    if (!('all' in pick) && want.length !== new Set(pick.rowIds).size) {
      if (cardKey) throw new WorkError('STALE', 'a row of the card is gone')
      throw new WorkError('NOT_FOUND')
    }
    if (cardKey && !('all' in pick) && cardFingerprint(cardKey, want) !== pick.fingerprint) throw new WorkError('STALE', 'the rows changed after the card was made')
    let ids = want.map((r) => r.id)
    if (cardKey) ids = ids.filter((id) => want.find((r) => r.id === id)?.confirmed === false)
    let skippedLocked = 0
    if ('all' in pick) {
      const open: string[] = []
      for (const r of want) (await w.isLocked(t.sheetId, r.id)) ? skippedLocked++ : open.push(r.id)
      ids = open
    }
    const done = await w.confirmRows(ids, { onFail: 'all' in pick ? 'skip' : 'throw' })
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
    return { confirmed: done.confirmed, pairs, skippedLocked, skippedCheck: done.skippedCheck }
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
