
import { Prisma, type PrismaClient, type DataSheet } from '@prisma/client'
import { decryptJson, encryptJson } from './sealed'
import { WorkError } from './errors'
import {
  calendarDateOf,
  normalizeRow,
  uniqueKeyHash,
  validateSheetSchema,
  type ColumnDef,
  type SheetSchema,
} from './sheet-columns'
import { anyOverlap, changedDates, dateInAny, effectiveIntervals, rangesOverlap, type DateRange } from './sheet-periods'
import {
  assertColumnsOnlyAdded,
  findTemplate,
  templateId,
  templateSchema,
  validateTemplateRegistry,
  type SheetTemplate,
} from './sheet-templates'

export const MAX_SHEET_SIZE_BYTES = 50 * 1024 * 1024
const TX_TIMEOUT_MS = 30_000

export interface WorkSheetDeps {
  db: PrismaClient
  dataKey(db: PrismaClient, userId: string): Promise<Buffer>
  templates: readonly SheetTemplate[]
}

export async function defaultWorkSheetDeps(): Promise<WorkSheetDeps> {
  const [{ prisma }, { ensureUserDataKey }, { builtinSheetTemplates }] = await Promise.all([import('@/lib/prisma'), import('@/lib/user-data-key'), import('./registry')])
  return { db: prisma, dataKey: ensureUserDataKey, templates: builtinSheetTemplates() }
}

export type SheetActor =
  | { type: 'human'; memberId?: number }
  | { type: 'ai'; workflowId: string }
  | { type: 'module'; id: string; version: number }
  | { type: 'import'; id: string }

export function actorLabel(a: SheetActor): string {
  switch (a.type) {
    case 'human': return a.memberId === undefined ? 'human' : `member:${a.memberId}`
    case 'ai': return `ai:${a.workflowId}`
    case 'module': return `module:${a.id}@${a.version}`
    case 'import': return `import:${a.id}`
  }
}

type Tx = Prisma.TransactionClient

export interface LockedProject {
  status: string
  workflowId: string | null
  workflowLinkedAt: Date | null
}

export async function lockProjectForWrite(tx: Tx, userId: string, projectId: string): Promise<LockedProject> {
  const rows = await tx.$queryRaw<Array<{ status: string; workflow_id: string | null; workflow_linked_at: Date | null }>>(
    Prisma.sql`SELECT status, workflow_id, workflow_linked_at FROM work_project WHERE id = ${projectId} AND user_id = ${userId} FOR UPDATE`,
  )
  if (rows.length === 0) throw new WorkError('NOT_FOUND')
  return { status: rows[0].status, workflowId: rows[0].workflow_id, workflowLinkedAt: rows[0].workflow_linked_at }
}

export function isProjectDetached(p: Pick<LockedProject, 'workflowId' | 'workflowLinkedAt'>): boolean {
  return p.workflowLinkedAt !== null && p.workflowId === null
}

export function assertProjectWritable(p: LockedProject): void {
  if (p.status !== 'active' || isProjectDetached(p)) throw new WorkError('READ_ONLY')
}

export async function lockProjectForShare(tx: Tx, userId: string, projectId: string): Promise<LockedProject> {
  const rows = await tx.$queryRaw<Array<{ status: string; workflow_id: string | null; workflow_linked_at: Date | null }>>(
    Prisma.sql`SELECT status, workflow_id, workflow_linked_at FROM work_project WHERE id = ${projectId} AND user_id = ${userId} FOR SHARE`,
  )
  if (rows.length === 0) throw new WorkError('NOT_FOUND')
  return { status: rows[0].status, workflowId: rows[0].workflow_id, workflowLinkedAt: rows[0].workflow_linked_at }
}

export async function lockTaskForWrite(tx: Tx, userId: string, projectId: string, taskId: string): Promise<{ status: string }> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>(
    Prisma.sql`SELECT status FROM work_task WHERE id = ${taskId} AND project_id = ${projectId} AND user_id = ${userId} FOR UPDATE`,
  )
  if (rows.length === 0) throw new WorkError('NOT_FOUND')
  return { status: rows[0].status }
}

export async function submittedPeriods(tx: Tx | PrismaClient, userId: string, projectId: string): Promise<DateRange[]> {
  const tasks = await tx.workTask.findMany({
    where: { projectId, userId, status: { in: ['submitted', 'awaiting'] }, periodStart: { not: null }, periodEnd: { not: null } },
    select: { periodStart: true, periodEnd: true },
  })
  return tasks.map((t) => ({ start: t.periodStart!.toISOString().slice(0, 10), end: t.periodEnd!.toISOString().slice(0, 10) }))
}

export interface SheetMeta {
  id: string
  schema: SheetSchema
  template: SheetTemplate | null
  family: string
  byName: Map<string, ColumnDef>
}

export function sheetMeta(row: { id: string; schema: string; template: string | null; templateFamily: string | null }, templates: readonly SheetTemplate[]): SheetMeta {
  const schema = JSON.parse(row.schema) as SheetSchema
  const template = row.template ? findTemplate(templates, row.template) : null
  return {
    id: row.id,
    schema,
    template,
    family: row.templateFamily ?? `sheet:${row.id}`,
    byName: new Map(schema.columns.map((c) => [c.name, c])),
  }
}

export interface SheetRowView {
  id: string
  sheetId: string
  data: Record<string, unknown>
  confirmed: boolean | null
  confirmedBy: string | null
  createdAt: Date
  updatedAt: Date
}

export type DbRow = { id: string; sheetId: string; rowData: string; sealed: Uint8Array | null; confirmed: boolean | null; confirmedBy?: string | null; createdAt: Date; updatedAt: Date }

export function decodeRow(r: DbRow, key: Buffer): SheetRowView {
  const plain = JSON.parse(r.rowData) as Record<string, unknown>
  const sealed = r.sealed ? decryptJson<Record<string, unknown>>(r.sealed, key) : {}
  return { id: r.id, sheetId: r.sheetId, data: { ...plain, ...sealed }, confirmed: r.confirmed, confirmedBy: r.confirmed ? r.confirmedBy ?? null : null, createdAt: r.createdAt, updatedAt: r.updatedAt }
}

function rowBytes(rowData: string, sealed: Uint8Array | null): number {
  return Buffer.byteLength(rowData, 'utf8') + (sealed?.length ?? 0)
}

function checkTemplateRow(meta: SheetMeta, data: Record<string, unknown>): void {
  const why = meta.template?.checkRow?.(data)
  if (why) throw new WorkError('INVALID', why)
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function prismaCode(e: unknown): string | undefined {
  return e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined
}

export interface WriteOptions {
  confirm?: boolean
  given?: Record<string, unknown>
}

export class ProjectSheetWriter {
  private readonly metaCache = new Map<string, SheetMeta>()

  constructor(
    private readonly tx: Tx,
    private readonly deps: WorkSheetDeps,
    private readonly key: Buffer,
    private readonly userId: string,
    private readonly projectId: string,
    private readonly actor: SheetActor,
    private readonly lockedSheets: ReadonlySet<string>,
    private readonly periods: readonly DateRange[],
    private readonly taskId: string | null,
    private readonly exception: string | null,
  ) {}

  async sheetsOfFamily(family: string): Promise<Array<{ id: string; template: string }>> {
    const list = await this.tx.dataSheet.findMany({
      where: { kind: 'project', projectId: this.projectId, userId: this.userId, templateFamily: family },
      select: { id: true, template: true },
      orderBy: { id: 'asc' },
    })
    return list.map((x) => ({ id: x.id, template: x.template! }))
  }

  lockedPeriods(): readonly DateRange[] {
    return this.periods
  }

  async rows(sheetId: string): Promise<SheetRowView[]> {
    await this.meta(sheetId)
    const rows = await this.tx.dataSheetRow.findMany({
      where: { sheetId, kind: 'project', projectId: this.projectId, userId: this.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return rows.map((r) => decodeRow(r, this.key))
  }

  async sheetSchema(sheetId: string): Promise<SheetSchema> {
    return (await this.meta(sheetId)).schema
  }

  async insert(sheetId: string, data: Record<string, unknown>, opts: WriteOptions = {}): Promise<SheetRowView> {
    const meta = await this.writableMeta(sheetId)
    const { plain, sealed } = normalizeRow(meta.schema, data)
    const full = { ...plain, ...(sealed ?? {}) }
    checkTemplateRow(meta, full)
    await this.assertRowWritable(meta, { after: full })
    const confirmed = this.initialConfirmed(meta, opts, full, opts.given ?? data)
    const confirmedBy = confirmed ? actorLabel(this.actor) : null

    const rowData = JSON.stringify(plain)
    const sealedBytes = sealed ? encryptJson(sealed, this.key) : null
    await this.bumpLedger(meta.id, rowBytes(rowData, sealedBytes))
    const row = await this.tx.dataSheetRow.create({
      data: { sheetId, kind: 'project', projectId: this.projectId, userId: this.userId, rowData, sealed: sealedBytes, confirmed, confirmedBy },
    })
    if (meta.schema.unique) await this.putKey(meta, row.id, full, null)
    await this.recountRows(meta.id)
    await this.event('insert', meta.id, row.id, null, { data: full, confirmed })
    return decodeRow(row, this.key)
  }

  async update(sheetId: string, rowId: string, patch: Record<string, unknown>, opts: WriteOptions = {}): Promise<SheetRowView> {
    const meta = await this.writableMeta(sheetId)
    const cur = await this.loadRow(rowId, sheetId)
    const merged: Record<string, unknown> = { ...cur.data }
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (!meta.byName.has(k)) throw new WorkError('INVALID', `the sheet has no column "${k}"`)
      if (v === null) delete merged[k]
      else merged[k] = v
    }
    const { plain, sealed } = normalizeRow(meta.schema, merged)
    const full = { ...plain, ...(sealed ?? {}) }
    checkTemplateRow(meta, full)
    await this.assertRowWritable(meta, { before: cur.data, after: full, rowId })

    const calcChanged = (meta.template?.confirm?.calcColumns ?? []).some((c) => !sameValue(cur.data[c], full[c]))
    let confirmed = cur.confirmed
    let confirmedBy = cur.confirmedBy
    const anyChanged = meta.schema.columns.some((c) => !sameValue(cur.data[c.name], full[c.name]))
    if (opts.confirm) {
      this.assertMayConfirm(meta, full, opts.given ?? patch)
      if (!(cur.confirmed && !anyChanged)) {
        confirmed = true
        confirmedBy = actorLabel(this.actor)
      }
    } else if (calcChanged && meta.template?.confirm) {
      confirmed = false
      confirmedBy = null
    }
    const aiRule = meta.template?.confirm?.ai
    if (confirmed && confirmedBy?.startsWith('ai:') && aiRule) {
      const why = full[aiRule.reasonColumn]
      if (!(typeof why === 'string' && why.trim()) || aiRule.check?.(full)) {
        confirmed = false
        confirmedBy = null
      }
    }

    const old = await this.tx.dataSheetRow.findUniqueOrThrow({ where: { id: rowId }, select: { rowData: true, sealed: true } })
    const rowData = JSON.stringify(plain)
    const sealedBytes = sealed ? encryptJson(sealed, this.key) : null
    await this.bumpLedger(meta.id, rowBytes(rowData, sealedBytes) - rowBytes(old.rowData, old.sealed))
    const row = await this.tx.dataSheetRow.update({ where: { id: rowId }, data: { rowData, sealed: sealedBytes, confirmed, confirmedBy } })
    if (meta.schema.unique) await this.putKey(meta, rowId, full, cur.data)
    await this.event('update', meta.id, rowId, { data: cur.data, confirmed: cur.confirmed }, { data: full, confirmed })
    if (calcChanged) await this.unconfirmAlongPairs(rowId)
    return decodeRow(row, this.key)
  }

  async remove(sheetId: string, rowId: string): Promise<void> {
    const meta = await this.writableMeta(sheetId)
    const cur = await this.loadRow(rowId, sheetId)
    const paired = await this.tx.sheetRowPair.count({ where: { OR: [{ fromRowId: rowId }, { toRowId: rowId }] } })
    if (paired > 0) throw new WorkError('PAIRED')
    if (this.actor.type === 'ai' && cur.confirmed === true) throw new WorkError('FORBIDDEN', 'a confirmed row is removed only by a person')
    await this.assertRowWritable(meta, { before: cur.data, rowId })
    const old = await this.tx.dataSheetRow.findUniqueOrThrow({ where: { id: rowId }, select: { rowData: true, sealed: true } })
    await this.tx.dataSheetRow.delete({ where: { id: rowId } })
    await this.bumpLedger(meta.id, -rowBytes(old.rowData, old.sealed))
    await this.recountRows(meta.id)
    await this.event('delete', meta.id, rowId, { data: cur.data, confirmed: cur.confirmed }, null)
  }

  async confirmRows(rowIds: string[]): Promise<void> {
    this.assertHuman()
    for (const rowId of rowIds) {
      const cur = await this.loadRow(rowId)
      const meta = await this.meta(cur.sheetId)
      if (!meta.template?.confirm) throw new WorkError('INVALID', 'this sheet has no confirmation')
      if (cur.confirmed) continue
      if (await this.isRowLocked(meta, cur)) throw new WorkError('LOCKED')
      await this.tx.dataSheetRow.update({ where: { id: rowId }, data: { confirmed: true, confirmedBy: actorLabel(this.actor) } })
      await this.event('confirm', meta.id, rowId, { confirmed: false }, { confirmed: true })
    }
  }

  async pair(fromRowId: string, toRowId: string, kind: string): Promise<{ id: string }> {
    if (fromRowId === toRowId) throw new WorkError('INVALID', 'a row cannot pair with itself')
    const ctx = await this.pairContext(fromRowId, toRowId, kind)
    await this.assertPairWritable('pair', ctx)
    let created: { id: string }
    try {
      created = await this.tx.sheetRowPair.create({
        data: { projectId: this.projectId, userId: this.userId, fromRowId, toRowId, kind },
        select: { id: true },
      })
    } catch (e) {
      if (prismaCode(e) === 'P2002') throw new WorkError('DUPLICATE', 'pair')
      throw e
    }
    await this.event('pair', ctx.fromMeta.id, fromRowId, null, { toRowId, kind }, ctx.usedException)
    return created
  }

  async unpair(pairId: string): Promise<void> {
    const p = await this.tx.sheetRowPair.findFirst({ where: { id: pairId, projectId: this.projectId, userId: this.userId } })
    if (!p) throw new WorkError('NOT_FOUND')
    const ctx = await this.pairContext(p.fromRowId, p.toRowId, p.kind)
    await this.assertPairWritable('unpair', ctx)
    await this.tx.sheetRowPair.delete({ where: { id: pairId } })
    await this.event('unpair', ctx.fromMeta.id, p.fromRowId, { toRowId: p.toRowId, kind: p.kind, confirmed: p.confirmed }, null, ctx.usedException)
  }

  async confirmPair(pairId: string): Promise<void> {
    this.assertHuman()
    const p = await this.tx.sheetRowPair.findFirst({ where: { id: pairId, projectId: this.projectId, userId: this.userId } })
    if (!p) throw new WorkError('NOT_FOUND')
    if (p.confirmed) return
    const ctx = await this.pairContext(p.fromRowId, p.toRowId, p.kind)
    if (await this.isPairLockedCtx(ctx)) throw new WorkError('LOCKED')
    await this.tx.sheetRowPair.update({ where: { id: pairId }, data: { confirmed: true } })
    await this.event('confirm', ctx.fromMeta.id, p.fromRowId, { pairId, confirmed: false }, { pairId, confirmed: true })
  }

  private async meta(sheetId: string): Promise<SheetMeta> {
    const hit = this.metaCache.get(sheetId)
    if (hit) return hit
    const s = await this.tx.dataSheet.findFirst({
      where: { id: sheetId, kind: 'project', projectId: this.projectId, userId: this.userId },
      select: { id: true, schema: true, template: true, templateFamily: true },
    })
    if (!s) throw new WorkError('NOT_FOUND')
    const m = sheetMeta(s, this.deps.templates)
    this.metaCache.set(sheetId, m)
    return m
  }

  private async writableMeta(sheetId: string): Promise<SheetMeta> {
    if (!this.lockedSheets.has(sheetId)) throw new WorkError('INVALID', 'sheet was not locked for this write')
    const meta = await this.meta(sheetId)
    if (this.actor.type === 'ai' && meta.template?.aiWrite === false) throw new WorkError('FORBIDDEN', 'this sheet is written only by a person or a module')
    return meta
  }

  async isLocked(sheetId: string, rowId: string): Promise<boolean> {
    return this.isRowLocked(await this.meta(sheetId), await this.loadRow(rowId, sheetId))
  }

  async projectFile(fileId: string): Promise<{ id: string; sha256: string }> {
    const f = await this.tx.workFile.findFirst({ where: { id: fileId, projectId: this.projectId, userId: this.userId }, select: { id: true, sha256: true } })
    if (!f) throw new WorkError('NOT_FOUND')
    return f
  }

  private async openTaskAt(date: string): Promise<string | null> {
    const day = new Date(date)
    const t = await this.tx.workTask.findFirst({
      where: { projectId: this.projectId, userId: this.userId, status: 'open', periodStart: { lte: day }, periodEnd: { gte: day } },
      select: { id: true },
    })
    return t?.id ?? null
  }

  private async fileStillUsedIn(fileId: string, exceptRowId: string, taskId: string): Promise<boolean> {
    const task = await this.tx.workTask.findUniqueOrThrow({ where: { id: taskId }, select: { periodStart: true, periodEnd: true } })
    const period = { start: task.periodStart!.toISOString().slice(0, 10), end: task.periodEnd!.toISOString().slice(0, 10) }
    const sheets = await this.tx.dataSheet.findMany({ where: { kind: 'project', projectId: this.projectId, userId: this.userId, template: { not: null } }, select: { id: true, schema: true, template: true, templateFamily: true } })
    for (const s of sheets) {
      const meta = await this.meta(s.id)
      const fileCol = meta.template?.ui?.file
      const dateCol = meta.template?.dateColumn
      if (!fileCol || !dateCol) continue
      const rows = await this.tx.$queryRaw<Array<{ id: string; row_data: string }>>(Prisma.sql`
        SELECT id, row_data FROM data_sheet_rows
        WHERE sheet_id = ${s.id} AND project_id = ${this.projectId} AND user_id = ${this.userId} AND kind = 'project' AND id <> ${exceptRowId}
          AND (row_data::jsonb ->> ${fileCol}) = ${fileId}`)
      for (const r of rows) {
        const d = calendarDateOf(meta.byName.get(dateCol)!, (JSON.parse(r.row_data) as Record<string, unknown>)[dateCol])
        if (d && d >= period.start && d <= period.end) return true
      }
    }
    return false
  }

  async syncRowFile(rowId: string, fileCol: string, dateCol: string, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>> | null): Promise<void> {
    const pick = async (d: Readonly<Record<string, unknown>> | null) => {
      const fileId = d && typeof d[fileCol] === 'string' ? (d[fileCol] as string) : null
      const date = d && typeof d[dateCol] === 'string' ? (d[dateCol] as string).slice(0, 10) : null
      return { fileId, taskId: fileId && date ? await this.openTaskAt(date) : null }
    }
    const b = await pick(before)
    const a = await pick(after)
    if (b.fileId && b.taskId && (b.fileId !== a.fileId || b.taskId !== a.taskId) && !(await this.fileStillUsedIn(b.fileId, rowId, b.taskId))) {
      const n = await this.tx.workTaskFile.deleteMany({ where: { taskId: b.taskId, fileId: b.fileId } })
      if (n.count > 0) await this.tx.workEvent.create({ data: { userId: this.userId, projectId: this.projectId, taskId: b.taskId, fileId: b.fileId, actor: actorLabel(this.actor), action: 'file_detach', payload: null } })
    }
    if (a.fileId && a.taskId) {
      const had = await this.tx.workTaskFile.findUnique({ where: { taskId_fileId: { taskId: a.taskId, fileId: a.fileId } } })
      if (!had) {
        await this.tx.workTaskFile.create({ data: { taskId: a.taskId, fileId: a.fileId, projectId: this.projectId, userId: this.userId } })
        await this.tx.workEvent.create({ data: { userId: this.userId, projectId: this.projectId, taskId: a.taskId, fileId: a.fileId, actor: actorLabel(this.actor), action: 'file_attach', payload: null } })
      }
    }
  }

  async pairsFrom(fromRowIds: readonly string[] | null, pairId?: string): Promise<Array<{ id: string; fromRowId: string; toRowId: string; kind: string; confirmed: boolean }>> {
    if (fromRowIds && fromRowIds.length === 0) return []
    return this.tx.sheetRowPair.findMany({
      where: { projectId: this.projectId, userId: this.userId, ...(fromRowIds ? { fromRowId: { in: [...fromRowIds] } } : {}), ...(pairId ? { id: pairId } : {}) },
      select: { id: true, fromRowId: true, toRowId: true, kind: true, confirmed: true },
      orderBy: { id: 'asc' },
    })
  }

  async isPairLocked(pairId: string): Promise<boolean> {
    const p = await this.tx.sheetRowPair.findFirst({ where: { id: pairId, projectId: this.projectId, userId: this.userId } })
    if (!p) throw new WorkError('NOT_FOUND')
    return this.isPairLockedCtx(await this.pairContext(p.fromRowId, p.toRowId, p.kind))
  }

  async row(sheetId: string, rowId: string): Promise<SheetRowView> {
    return this.loadRow(rowId, sheetId)
  }

  private async loadRow(rowId: string, sheetId?: string): Promise<SheetRowView> {
    const r = await this.tx.dataSheetRow.findFirst({
      where: { id: rowId, kind: 'project', projectId: this.projectId, userId: this.userId, ...(sheetId ? { sheetId } : {}) },
    })
    if (!r) throw new WorkError('NOT_FOUND')
    return decodeRow(r, this.key)
  }

  private assertHuman(): void {
    if (this.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person can confirm')
  }

  private initialConfirmed(meta: SheetMeta, opts: WriteOptions, full: Record<string, unknown>, given: Record<string, unknown>): boolean | null {
    if (opts.confirm) {
      this.assertMayConfirm(meta, full, given)
      return true
    }
    return meta.template?.confirm ? false : null
  }

  private assertMayConfirm(meta: SheetMeta, full: Record<string, unknown>, given: Record<string, unknown>): void {
    if (!meta.template?.confirm) throw new WorkError('INVALID', 'this sheet has no confirmation')
    if (this.actor.type === 'human') return
    const ai = meta.template.confirm.ai
    if (this.actor.type !== 'ai' || !ai) throw new WorkError('FORBIDDEN', 'only a person can confirm rows of this sheet')
    const why = given[ai.reasonColumn]
    if (typeof why !== 'string' || !why.trim()) throw new WorkError('INVALID', `write why in "${ai.reasonColumn}" in the same write to confirm this row`)
    const bad = ai.check?.(full)
    if (bad) throw new WorkError('INVALID', bad)
  }

  private rowDate(meta: SheetMeta, column: string | undefined, data: Record<string, unknown>): string | null {
    if (!column) return null
    const col = meta.byName.get(column)!
    const d = calendarDateOf(col, data[column])
    if (!d) throw new WorkError('INVALID', `${column} must be a date`)
    return d
  }

  private async isRowLocked(meta: SheetMeta, row: { id: string; data: Record<string, unknown> }): Promise<boolean> {
    if (this.periods.length === 0 || !meta.template) return false
    if (meta.template.dateColumn) return dateInAny(this.rowDate(meta, meta.template.dateColumn, row.data)!, this.periods)
    const col = meta.template.effectiveFromColumn
    if (!col) return false
    const all = await this.rows(meta.id)
    const own = effectiveIntervals(all.map((r) => ({ id: r.id, start: this.rowDate(meta, col, r.data)! }))).get(row.id)
    return !!own && this.periods.some((p) => rangesOverlap(own, p))
  }

  private async assertRowWritable(meta: SheetMeta, w: { before?: Record<string, unknown>; after?: Record<string, unknown>; rowId?: string }): Promise<void> {
    const t = meta.template
    if (!t) return
    if (t.dateColumn) {
      for (const data of [w.before, w.after]) {
        if (data && this.periods.length > 0 && dateInAny(this.rowDate(meta, t.dateColumn, data)!, this.periods)) throw new WorkError('LOCKED')
      }
      return
    }
    if (!t.effectiveFromColumn) return
    const col = t.effectiveFromColumn
    const others = (await this.rows(meta.id)).filter((r) => r.id !== w.rowId)
    const base = others.map((r) => ({ id: r.id, start: this.rowDate(meta, col, r.data)! }))
    const target = w.rowId ?? '__new__'
    const beforeList = w.before ? [...base, { id: target, start: this.rowDate(meta, col, w.before)! }] : base
    const afterList = w.after ? [...base, { id: target, start: this.rowDate(meta, col, w.after)! }] : base
    let before: Map<string, DateRange>, after: Map<string, DateRange>
    try {
      before = effectiveIntervals(beforeList)
      after = effectiveIntervals(afterList)
    } catch {
      throw new WorkError('INVALID', `two rows cannot start on the same ${col}`)
    }
    if (this.periods.length === 0) return
    const contentChanged = !!w.before && !!w.after && Object.keys({ ...w.before, ...w.after }).some((k) => k !== col && !sameValue(w.before![k], w.after![k]))
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const changed = changedDates(before.get(id), after.get(id), id === target && contentChanged)
      if (anyOverlap(changed, this.periods)) throw new WorkError('LOCKED')
    }
  }

  private async putKey(meta: SheetMeta, rowId: string, after: Record<string, unknown>, before: Record<string, unknown> | null): Promise<void> {
    const unique = meta.schema.unique!
    const hash = uniqueKeyHash(unique, after)
    try {
      if (!before) {
        await this.tx.sheetRowKey.create({ data: { projectId: this.projectId, userId: this.userId, templateFamily: meta.family, keyHash: hash, rowId } })
      } else if (hash !== uniqueKeyHash(unique, before)) {
        await this.tx.sheetRowKey.update({ where: { rowId_templateFamily: { rowId, templateFamily: meta.family } }, data: { keyHash: hash } })
      }
    } catch (e) {
      if (prismaCode(e) === 'P2002') throw new WorkError('DUPLICATE', unique.join(','))
      throw e
    }
  }

  private async pairContext(fromRowId: string, toRowId: string, kind: string) {
    const from = await this.loadRow(fromRowId)
    const to = await this.loadRow(toRowId)
    const fromMeta = await this.meta(from.sheetId)
    const toMeta = await this.meta(to.sheetId)
    const def = fromMeta.template?.pairs?.find((p) => p.kind === kind)
    if (!def) throw new WorkError('INVALID', `sheet cannot pair "${kind}"`)
    if (toMeta.template?.family !== def.toFamily) throw new WorkError('INVALID', `a "${kind}" pair must point to ${def.toFamily}`)
    return { from, to, fromMeta, toMeta, def, kind, usedException: null as string | null }
  }

  private async isPairLockedCtx(ctx: Awaited<ReturnType<ProjectSheetWriter['pairContext']>>): Promise<boolean> {
    return ctx.def.periodSide === 'from' ? this.isRowLocked(ctx.fromMeta, ctx.from) : this.isRowLocked(ctx.toMeta, ctx.to)
  }

  private async assertPairWritable(action: 'pair' | 'unpair', ctx: Awaited<ReturnType<ProjectSheetWriter['pairContext']>>): Promise<void> {
    const fromLocked = await this.isRowLocked(ctx.fromMeta, ctx.from)
    const toLocked = await this.isRowLocked(ctx.toMeta, ctx.to)
    if (!fromLocked && !toLocked) return
    const judge = this.exception ? ctx.fromMeta.template?.exceptions?.[this.exception] : undefined
    if (!judge) throw new WorkError('LOCKED')
    const ok = await judge({
      tx: this.tx,
      projectId: this.projectId,
      userId: this.userId,
      action,
      kind: ctx.kind,
      from: { id: ctx.from.id, sheetId: ctx.from.sheetId, data: ctx.from.data, locked: fromLocked },
      to: { id: ctx.to.id, sheetId: ctx.to.sheetId, data: ctx.to.data, locked: toLocked },
      isDateLocked: (d) => dateInAny(d, this.periods),
    })
    if (!ok) throw new WorkError('LOCKED')
    ctx.usedException = this.exception
  }

  private async unconfirmAlongPairs(rowId: string): Promise<void> {
    const pairs = await this.tx.sheetRowPair.findMany({ where: { OR: [{ fromRowId: rowId }, { toRowId: rowId }] } })
    for (const p of pairs) {
      const ctx = await this.pairContext(p.fromRowId, p.toRowId, p.kind)
      if (await this.isPairLockedCtx(ctx)) continue
      if (p.confirmed) {
        await this.tx.sheetRowPair.update({ where: { id: p.id }, data: { confirmed: false } })
        await this.event('unconfirm', ctx.fromMeta.id, p.fromRowId, { pairId: p.id, confirmed: true }, { pairId: p.id, confirmed: false })
      }
      if (p.toRowId === rowId && ctx.from.confirmed && !(await this.isRowLocked(ctx.fromMeta, ctx.from))) {
        await this.tx.dataSheetRow.update({ where: { id: ctx.from.id }, data: { confirmed: false, confirmedBy: null } })
        await this.event('unconfirm', ctx.fromMeta.id, ctx.from.id, { confirmed: true }, { confirmed: false })
      }
    }
  }

  private async bumpLedger(sheetId: string, delta: number): Promise<void> {
    const s = await this.tx.dataSheet.findUniqueOrThrow({ where: { id: sheetId }, select: { sizeBytes: true } })
    const next = Math.max(0, Number(s.sizeBytes) + delta)
    if (delta > 0 && next > MAX_SHEET_SIZE_BYTES) throw new WorkError('INVALID', 'Storage limit exceeded. Maximum sheet size is 50MB.')
    await this.tx.dataSheet.update({ where: { id: sheetId }, data: { sizeBytes: BigInt(next) } })
  }

  private async recountRows(sheetId: string): Promise<void> {
    const n = await this.tx.dataSheetRow.count({ where: { sheetId } })
    await this.tx.dataSheet.update({ where: { id: sheetId }, data: { rowCount: n } })
  }

  private async event(action: string, sheetId: string, rowId: string, before: unknown, after: unknown, via: string | null = null): Promise<void> {
    await this.tx.workEvent.create({
      data: {
        userId: this.userId,
        projectId: this.projectId,
        sheetId,
        rowId,
        taskId: this.taskId,
        actor: via ? `exception:${via}` : actorLabel(this.actor),
        action,
        payload: encryptJson({ before, after, by: actorLabel(this.actor) }, this.key),
      },
    })
  }
}

export interface ProjectSheetWriteRequest {
  userId: string
  projectId: string
  sheetIds: string[]
  actor: SheetActor
  taskId?: string
  exception?: string
}

export async function assertAiMayWrite(tx: Tx, project: LockedProject, actor: SheetActor): Promise<void> {
  if (actor.type !== 'ai') return
  if (!project.workflowId || project.workflowId !== actor.workflowId) throw new WorkError('FORBIDDEN')
  const wf = await tx.workflow.findUnique({ where: { workflowId: project.workflowId }, select: { status: true } })
  if (!wf || wf.status === 'archived') throw new WorkError('FORBIDDEN')
}

export async function withProjectSheetWrite<T>(deps: WorkSheetDeps, req: ProjectSheetWriteRequest, fn: (w: ProjectSheetWriter) => Promise<T>): Promise<T> {
  validateTemplateRegistry(deps.templates)
  const key = await deps.dataKey(deps.db, req.userId)
  const sheetIds = [...new Set(req.sheetIds)].sort()
  return deps.db.$transaction(async (tx) => {
    const project = await lockProjectForWrite(tx, req.userId, req.projectId)
    assertProjectWritable(project)
    await assertAiMayWrite(tx, project, req.actor)
    if (req.taskId) await lockTaskForWrite(tx, req.userId, req.projectId, req.taskId)
    if (sheetIds.length > 0) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM data_sheets
        WHERE id IN (${Prisma.join(sheetIds)}) AND kind = 'project' AND project_id = ${req.projectId} AND user_id = ${req.userId}
        ORDER BY id FOR UPDATE`)
      if (locked.length !== sheetIds.length) throw new WorkError('NOT_FOUND')
    }
    const periods = await submittedPeriods(tx, req.userId, req.projectId)
    const w = new ProjectSheetWriter(tx, deps, key, req.userId, req.projectId, req.actor, new Set(sheetIds), periods, req.taskId ?? null, req.exception ?? null)
    return fn(w)
  }, { timeout: TX_TIMEOUT_MS })
}

export async function readProjectSheet(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string; sheetId: string; workflowId?: string },
): Promise<{ schema: SheetSchema; rows: SheetRowView[] }> {
  const sheet = await deps.db.dataSheet.findFirst({
    where: { id: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId },
    select: { schema: true, project: { select: { workflowId: true } } },
  })
  if (!sheet) throw new WorkError('NOT_FOUND')
  if (q.workflowId !== undefined && (!sheet.project?.workflowId || sheet.project.workflowId !== q.workflowId)) throw new WorkError('FORBIDDEN')
  const key = await deps.dataKey(deps.db, q.userId)
  const rows = await deps.db.dataSheetRow.findMany({
    where: { sheetId: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return { schema: JSON.parse(sheet.schema) as SheetSchema, rows: rows.map((r) => decodeRow(r, key)) }
}

export interface CreateProjectSheetInput {
  userId: string
  projectId: string
  name: string
  description?: string | null
  template?: string
  schema?: SheetSchema
}

export async function createProjectSheet(deps: WorkSheetDeps, input: CreateProjectSheetInput): Promise<DataSheet> {
  validateTemplateRegistry(deps.templates)
  if (!input.name || input.name.trim() === '') throw new WorkError('INVALID', 'name is required')
  let schema: SheetSchema
  let template: SheetTemplate | null = null
  if (input.template) {
    if (input.schema) throw new WorkError('INVALID', 'a template sheet takes its columns from the template')
    template = findTemplate(deps.templates, input.template)
    schema = templateSchema(template)
  } else {
    schema = validateSheetSchema(input.schema as SheetSchema)
  }
  return deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, input.projectId))
    try {
      return await tx.dataSheet.create({
        data: {
          kind: 'project',
          userId: input.userId,
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? null,
          schema: JSON.stringify(schema),
          template: template ? templateId(template) : null,
          templateFamily: template?.family ?? null,
        },
      })
    } catch (e) {
      if (prismaCode(e) === 'P2002') throw new WorkError('DUPLICATE', 'sheet name')
      throw e
    }
  }, { timeout: TX_TIMEOUT_MS })
}

export async function setProjectSheetColumns(deps: WorkSheetDeps, input: { userId: string; projectId: string; sheetId: string; schema: SheetSchema }): Promise<void> {
  const next = validateSheetSchema(input.schema)
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, input.projectId))
    const rows = await tx.$queryRaw<Array<{ schema: string; template: string | null }>>(Prisma.sql`
      SELECT schema, template FROM data_sheets
      WHERE id = ${input.sheetId} AND kind = 'project' AND project_id = ${input.projectId} AND user_id = ${input.userId} FOR UPDATE`)
    if (rows.length === 0) throw new WorkError('NOT_FOUND')
    if (rows[0].template) throw new WorkError('TEMPLATE_LOCKED', 'template sheet columns are locked')
    const cur = JSON.parse(rows[0].schema) as SheetSchema
    assertColumnsOnlyAdded(cur.columns, next.columns, 'sheet')
    if (JSON.stringify(cur.unique ?? null) !== JSON.stringify(next.unique ?? null)) throw new WorkError('TEMPLATE_LOCKED', 'unique key cannot change')
    await tx.dataSheet.update({ where: { id: input.sheetId }, data: { schema: JSON.stringify(next) } })
  }, { timeout: TX_TIMEOUT_MS })
}
