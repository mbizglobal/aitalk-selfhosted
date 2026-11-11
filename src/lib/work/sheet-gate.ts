
import { FORM_FILE_SHAPE, formRuleLocked, prepareFormRow, type FormRule } from './myforms'
import { accountToday, authorityColumnsOf, crossLine, crossTargetProblem, type AppSpec, lowerSpecPeople, nextSpecNumber, NUMBER_COLUMN, readAssembledForms, specRuleLocked, specSheetName, specTeam, STATUS_COLUMN, teamEmails, TIME_RE, decimalCompare, docFileColumn, docFpColumn, type ConfirmBy, type SpecCheck, type SpecRule, type SpecTeam } from './assembled'
import { amountOf, checkTouched, DEC0, decAdd, decText, isCounted, limitBroken, limitGroup, normValue, overlapSpan, spansOverlap, type Dec } from './assembled-checks'
import { Prisma, type PrismaClient, type DataSheet } from '@prisma/client'
import { decryptJson, encryptJson } from './sealed'
import { moduleNoticeOf, writeWorkNotice, type WorkNotice } from './notices'
import { WorkError } from './errors'
import { HANDOFF_FAMILY } from './handoff-core'
import { moduleStop } from './module-stop'
import { fingerprint as fingerprintOf } from './fingerprint'
import type { PreparedWorkFile } from './files'
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
  rowFileIds,
  templateFileColumns,
  templateId,
  templateSchema,
  validateTemplateRegistry,
  type ConfirmCheckCtx,
  type ConfirmCheckRow,
  type ConfirmProblem,
  type SheetTemplate,
} from './sheet-templates'
import { computeSearchCopy, searchKeyOf } from './search-copy'
import { assertScanWrite, noteScanRowInserted } from './scan-fence'

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
  | { type: 'ai'; workflowId: string; requestedBy?: WorkRequester }
  | { type: 'module'; id: string; version: number; person?: { memberId?: number }; requestedBy?: WorkRequester }
  | { type: 'import'; id: string }
  | { type: 'flow'; workflowId: string }
  | { type: 'channel'; workflowId: string }
  | { type: 'app'; workflowId: string }
  | { type: 'handoff'; workflowId: string }
  | { type: 'intake_form'; linkId: string }
  | { type: 'webhook'; hookId: string }

const insertOnly = (a: SheetActor) => a.type === 'channel' || a.type === 'app' || a.type === 'handoff' || a.type === 'intake_form' || a.type === 'webhook'
const outsideActor = (a: SheetActor) => a.type === 'channel' || a.type === 'intake_form' || a.type === 'webhook'

export interface WorkRequester { memberId?: number }
const requesterTail = (r: WorkRequester | undefined) => (r ? `${REQUESTER_MARK}${r.memberId === undefined ? 'human' : `member:${r.memberId}`}` : '')
export const REQUESTER_MARK = '|by:'

export function actorLabel(a: SheetActor): string {
  switch (a.type) {
    case 'human': return a.memberId === undefined ? 'human' : `member:${a.memberId}`
    case 'ai': return `ai:${a.workflowId}${requesterTail(a.requestedBy)}`
    case 'module': return `module:${a.id}@${a.version}${requesterTail(a.requestedBy)}`
    case 'import': return `import:${a.id}`
    case 'flow': return `flow:${a.workflowId}`
    case 'channel': return `channel:${a.workflowId}`
    case 'app': return `app:${a.workflowId}`
    case 'handoff': return `handoff:${a.workflowId}`
    case 'intake_form': return `intake_form:${a.linkId}`
    case 'webhook': return `webhook:${a.hookId}`
  }
}

export const actorBase = (label: string): string => {
  const i = label.indexOf(REQUESTER_MARK)
  return i < 0 ? label : label.slice(0, i)
}
export const actorRequester = (label: string): string | null => {
  const i = label.indexOf(REQUESTER_MARK)
  return i < 0 ? null : label.slice(i + REQUESTER_MARK.length)
}

export interface WorkPerson { owner: boolean; memberId?: number }
function assertSpecIntake(t: SpecRule['table'], actor: SheetActor, data: Readonly<Record<string, unknown>>, appSendColumns?: readonly string[]): void {
  if (actor.type === 'app') {
    if (!appSendColumns?.length) throw new WorkError('FORBIDDEN', 'rows of an assembled app table come from another work app only through a send of that app\'s spec')
    const allowed = new Set(appSendColumns)
    const outside = Object.keys(data).filter((k) => data[k] !== undefined && !allowed.has(k))
    if (outside.length) throw new WorkError('FORBIDDEN', `only these columns can be filled from that app: ${appSendColumns.join(', ')} — not ${outside.join(', ')}`)
    return
  }
  if (actor.type !== 'channel' && actor.type !== 'intake_form' && actor.type !== 'webhook') throw new WorkError('FORBIDDEN', 'rows of an assembled app table cannot be sent from another work app')
  const ik = t.intake
  if (!ik) throw new WorkError('FORBIDDEN', 'this table does not take rows from outside')
  if (actor.type === 'webhook' && !ik.webhook) throw new WorkError('FORBIDDEN', 'this table does not take rows from a webhook')
  const allowed = new Set<string>()
  for (const k of ik.columns) {
    allowed.add(k)
    if (t.columns.find((c) => c.key === k)?.kind === 'money') allowed.add(`${k}_cur`)
  }
  const outside = Object.keys(data).filter((k) => data[k] !== undefined && !allowed.has(k))
  if (outside.length) throw new WorkError('INVALID', `only these columns can be filled: ${ik.columns.join(', ')} — not ${outside.join(', ')}`)
}

export function personOf(a: SheetActor): WorkPerson | null {
  const p = a.type === 'human' ? a : a.type === 'module' ? a.person : undefined
  if (!p) return null
  return p.memberId === undefined ? { owner: true } : { owner: false, memberId: p.memberId }
}
export async function estvMonthlyFx(db: Pick<Tx, 'vatFxRate'>, currency: string, date: string): Promise<{ rate: string; unit: number } | null> {
  if (currency === 'CHF') return { rate: '1', unit: 1 }
  if (!/^[A-Z]{3}$/.test(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const r = await db.vatFxRate.findFirst({ where: { kind: 'monthly', currency, validFor: new Date(`${date.slice(0, 7)}-01T00:00:00Z`) }, orderBy: { version: 'desc' }, select: { rate: true, unit: true } })
  return r ? { rate: r.rate.toFixed(6), unit: r.unit } : null
}

export interface WorkMember { id: number; email: string; name: string | null; active: boolean; title?: string | null }
export async function projectMembersTx(db: Pick<Tx, 'workProject' | 'agentMember' | 'user'>, userId: string, projectId: string): Promise<WorkMember[]> {
  const p = await db.workProject.findFirst({ where: { id: projectId, userId }, select: { agentId: true, workflowId: true } })
  if (!p?.agentId || !p.workflowId) return []
  const rows = await db.agentMember.findMany({ where: { agentAgentId: p.agentId, access: { some: { workflowId: p.workflowId } } }, select: { id: true, email: true, displayName: true, jobTitle: true, status: true }, orderBy: { id: 'asc' } })
  const owner = (await db.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email?.toLowerCase() ?? null
  return rows.filter((m) => m.email.toLowerCase() !== owner).map((m) => ({ id: m.id, email: m.email.toLowerCase(), name: m.displayName, active: m.status === 'active', title: m.jobTitle }))
}

const isV7Template = (t: SheetTemplate | null | undefined) => !!(t?.confirm?.byModule || t?.deleteRule)
const moduleIdOf = (a: SheetActor) => (a.type === 'module' ? a.id : null)

const personLabel = (p: WorkPerson) => (p.owner ? 'human' : `member:${p.memberId}`)

type Tx = Prisma.TransactionClient

export interface LockedProject {
  status: string
  workflowId: string | null
  workflowLinkedAt: Date | null
  appClosed?: boolean
}

export async function lockProjectForWrite(tx: Tx, userId: string, projectId: string): Promise<LockedProject> {
  const rows = await tx.$queryRaw<Array<{ status: string; workflow_id: string | null; workflow_linked_at: Date | null }>>(
    Prisma.sql`SELECT status, workflow_id, workflow_linked_at FROM work_project WHERE id = ${projectId} AND user_id = ${userId} FOR UPDATE`,
  )
  if (rows.length === 0) throw new WorkError('NOT_FOUND')
  return { status: rows[0].status, workflowId: rows[0].workflow_id, workflowLinkedAt: rows[0].workflow_linked_at, appClosed: await appClosedOf(tx, rows[0].workflow_id) }
}

async function appClosedOf(tx: Tx, workflowId: string | null): Promise<boolean> {
  if (!workflowId) return false
  const w = await tx.$queryRaw<Array<{ kind: string; status: string }>>(Prisma.sql`SELECT kind, status FROM workflows WHERE "workflowId" = ${workflowId}`)
  return w[0]?.kind === 'app' && w[0].status !== 'production'
}

export function isProjectDetached(p: Pick<LockedProject, 'workflowId' | 'workflowLinkedAt'>): boolean {
  return p.workflowLinkedAt !== null && p.workflowId === null
}

export function assertProjectWritable(p: LockedProject): void {
  if (p.status !== 'active' || isProjectDetached(p)) throw new WorkError('READ_ONLY')
  if (p.appClosed) throw new WorkError('APP_CLOSED')
}

export async function lockProjectForShare(tx: Tx, userId: string, projectId: string): Promise<LockedProject> {
  const rows = await tx.$queryRaw<Array<{ status: string; workflow_id: string | null; workflow_linked_at: Date | null }>>(
    Prisma.sql`SELECT status, workflow_id, workflow_linked_at FROM work_project WHERE id = ${projectId} AND user_id = ${userId} FOR SHARE`,
  )
  if (rows.length === 0) throw new WorkError('NOT_FOUND')
  return { status: rows[0].status, workflowId: rows[0].workflow_id, workflowLinkedAt: rows[0].workflow_linked_at, appClosed: await appClosedOf(tx, rows[0].workflow_id) }
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
  form?: FormRule | null
  spec?: SpecRule | null
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

const fileShapeOf = (meta: SheetMeta): Pick<SheetTemplate, 'ui' | 'fileColumns'> | null => meta.template ?? (meta.form ? FORM_FILE_SHAPE : null)

function checkTemplateRow(meta: SheetMeta, data: Record<string, unknown>): void {
  const why = meta.template?.checkRow?.(data)
  if (why) throw new WorkError('INVALID', why)
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

async function assertFileRules(tx: Prisma.TransactionClient, meta: SheetMeta, q: { userId: string; projectId: string }, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>>): Promise<void> {
  for (const [col, rule] of Object.entries(meta.template?.fileRules ?? {})) {
    const id = after[col]
    if (typeof id !== 'string' || (before && before[col] === id)) continue
    const f = await tx.workFile.findFirst({ where: { id, projectId: q.projectId, userId: q.userId }, select: { mimeType: true, sizeBytes: true } })
    if (!f) throw new WorkError('NOT_FOUND')
    if (!rule.mime.includes(f.mimeType)) throw new WorkError('INVALID', `${col}: the file must be ${rule.mime.map((m) => m.replace(/^\w+\//, '').toUpperCase()).join(' or ')}`)
    if (f.sizeBytes > rule.maxBytes) throw new WorkError('INVALID', `${col}: the file must be ${Math.floor(rule.maxBytes / 1024 / 1024)} MB or smaller`)
  }
}

function prismaCode(e: unknown): string | undefined {
  return e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined
}

export interface WriteOptions {
  confirm?: boolean
  given?: Record<string, unknown>
  channelKey?: string | null
  appSendColumns?: readonly string[]
}

export class ProjectSheetWriter {
  private readonly metaCache = new Map<string, SheetMeta>()
  private readonly touched = new Map<string, Map<string, Readonly<Record<string, unknown>> | null>>()
  private readonly touchedConfirmed = new Map<string, Map<string, boolean>>()
  private readonly pendingConfirm = new Map<string, Set<string>>()
  private refReader: Promise<import('./references').ReferenceReader> | null = null
  private checksManaged = false
  private readonly checkedBatch = new Map<string, string>()
  private readonly notices: WorkNotice[] = []

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

  async countChannelInserts(since: Date): Promise<number> {
    return this.tx.workEvent.count({ where: { userId: this.userId, projectId: this.projectId, action: 'insert', OR: [{ actor: { startsWith: 'channel:' } }, { actor: { startsWith: 'intake_form:' } }, { actor: { startsWith: 'webhook:' } }], createdAt: { gt: since } } })
  }

  async countIntakeFormInserts(linkId: string, since: Date): Promise<number> {
    return this.tx.workEvent.count({ where: { userId: this.userId, projectId: this.projectId, action: 'insert', actor: `intake_form:${linkId}`, createdAt: { gt: since } } })
  }

  async countWebhookInserts(hookId: string, since: Date): Promise<number> {
    return this.tx.workEvent.count({ where: { userId: this.userId, projectId: this.projectId, action: 'insert', actor: `webhook:${hookId}`, createdAt: { gt: since } } })
  }

  async countAppInserts(since: Date): Promise<number> {
    return this.tx.workEvent.count({ where: { userId: this.userId, projectId: this.projectId, action: 'insert', actor: { startsWith: 'app:' }, createdAt: { gt: since } } })
  }

  async withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn(this.tx)
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
    if (opts.channelKey != null && this.actor.type !== 'channel') throw new WorkError('FORBIDDEN', 'only a channel insert carries a channel key')
    if (insertOnly(this.actor) && opts.confirm) throw new WorkError('FORBIDDEN', 'a channel row is never confirmed')
    const meta = await this.writableMeta(sheetId)
    if (this.actor.type === 'handoff' && meta.template?.family !== HANDOFF_FAMILY) throw new WorkError('FORBIDDEN', 'a handoff writes only the handoff sheet')
    if (this.actor.type !== 'handoff' && meta.template?.family === HANDOFF_FAMILY) throw new WorkError('FORBIDDEN', 'handoff rows come only from the previous step — they cannot be added by hand')
    if (!meta.spec && (this.actor.type === 'intake_form' || this.actor.type === 'webhook')) throw new WorkError('FORBIDDEN', 'this sheet does not take rows from outside')
    if (meta.spec) {
      if (insertOnly(this.actor)) {
        assertSpecIntake(meta.spec.table, this.actor, data, opts.appSendColumns)
        data = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      }
      data = await this.prepareSpecInsert(meta.spec, data)
    }
    const { plain, sealed } = normalizeRow(meta.schema, meta.form ? prepareFormRow(meta.form, meta.spec ? lowerSpecPeople(meta.spec, data) : data) : data)
    const full = { ...plain, ...(sealed ?? {}) }
    checkTemplateRow(meta, full)
    await assertFileRules(this.tx, meta, { userId: this.userId, projectId: this.projectId }, null, full)
    const shape = fileShapeOf(meta)
    if (shape) await assertScanWrite(this.tx, rowFileIds(shape, full))
    await this.assertRowWritable(meta, { after: full })
    const confirmed = this.initialConfirmed(meta, opts, full, opts.given ?? data)
    this.applyWriteRule(meta, null, full, null, confirmed)
    await this.applySpecRule(meta, null, null, full, opts.confirm === true)
    const confirmedBy = confirmed ? this.confirmerLabel() : null

    const rowData = JSON.stringify(plain)
    const sealedBytes = sealed ? encryptJson(sealed, this.key) : null
    await this.bumpLedger(meta.id, rowBytes(rowData, sealedBytes), 1)
    const row = await this.tx.dataSheetRow.create({
      data: { sheetId, kind: 'project', projectId: this.projectId, userId: this.userId, rowData, sealed: sealedBytes, confirmed, confirmedBy, channelKey: opts.channelKey ?? null, ...this.searchData(meta, full) },
    })
    if (meta.schema.unique) await this.putKey(meta, row.id, full, null)
    noteScanRowInserted(row.id)
    await this.event('insert', meta.id, row.id, null, { data: full, confirmed })
    if (meta.spec?.table.status && meta.spec.table.moveAlerts?.length) await this.fireSpecMove(meta.spec, row.id, null, full)
    this.noteRow(meta, 'insert', null, full)
    this.noteWrite(meta, row.id, null, confirmed === true, true, false)
    return decodeRow(row, this.key)
  }

  async update(sheetId: string, rowId: string, patch: Record<string, unknown>, opts: WriteOptions = {}): Promise<SheetRowView> {
    const handoffRetire = this.actor.type === 'handoff' && !opts.confirm && Object.keys(patch ?? {}).length === 1 && patch?.current === false
    if (!handoffRetire) this.assertNotChannel()
    const meta = await this.writableMeta(sheetId)
    if (handoffRetire && meta.template?.family !== HANDOFF_FAMILY) throw new WorkError('FORBIDDEN', 'a handoff writes only the handoff sheet')
    if (!handoffRetire && meta.template?.family === HANDOFF_FAMILY && Object.keys(patch ?? {}).some((k) => k !== 'memo')) throw new WorkError('FORBIDDEN', 'only the memo of a handoff row can be changed')
    const cur = await this.loadRow(rowId, sheetId)
    const merged: Record<string, unknown> = { ...cur.data }
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (!meta.byName.has(k)) throw new WorkError('INVALID', `the sheet has no column "${k}"`)
      if (v === null) delete merged[k]
      else merged[k] = v
    }
    const { plain, sealed } = normalizeRow(meta.schema, meta.form ? prepareFormRow(meta.form, meta.spec ? lowerSpecPeople(meta.spec, merged) : merged) : merged)
    const full = { ...plain, ...(sealed ?? {}) }
    checkTemplateRow(meta, full)
    await assertFileRules(this.tx, meta, { userId: this.userId, projectId: this.projectId }, cur.data, full)
    const shape = fileShapeOf(meta)
    if (shape) {
      const was = rowFileIds(shape, cur.data)
      const now = rowFileIds(shape, full)
      const kept = now.filter((id) => was.includes(id))
      const fileCols = new Set([...templateFileColumns(shape), ...(shape.ui?.moreFiles ? [shape.ui.moreFiles] : [])])
      const touchedRow = meta.schema.columns.some((c) => !fileCols.has(c.name) && !sameValue(cur.data[c.name], full[c.name]))
      await assertScanWrite(this.tx, [...now.filter((id) => !was.includes(id)), ...was.filter((id) => !now.includes(id)), ...(touchedRow ? kept : [])], kept)
    }
    await this.assertRowWritable(meta, { before: cur.data, after: full, rowId })

    const proj = meta.template?.confirm?.calcProject ?? {}
    const calcChanged = (meta.template?.confirm?.calcColumns ?? []).some((c) => (proj[c] ? !sameValue(proj[c](cur.data[c]), proj[c](full[c])) : !sameValue(cur.data[c], full[c])))
    let confirmed = cur.confirmed
    let confirmedBy = cur.confirmedBy
    const anyChanged = meta.schema.columns.some((c) => !sameValue(cur.data[c.name], full[c.name]))
    if (opts.confirm) {
      this.assertMayConfirm(meta, full, opts.given ?? patch)
      if (!(cur.confirmed && !anyChanged)) {
        confirmed = true
        confirmedBy = this.confirmerLabel()
      }
    } else if ((calcChanged && meta.template?.confirm) || (meta.form && anyChanged)) {
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

    this.applyWriteRule(meta, cur.data, full, cur.confirmed, confirmed)
    await this.applySpecRule(meta, rowId, cur.data, full, opts.confirm === true)
    const old = await this.tx.dataSheetRow.findUniqueOrThrow({ where: { id: rowId }, select: { rowData: true, sealed: true } })
    const rowData = JSON.stringify(plain)
    const sealedBytes = sealed ? encryptJson(sealed, this.key) : null
    await this.bumpLedger(meta.id, rowBytes(rowData, sealedBytes) - rowBytes(old.rowData, old.sealed))
    const row = await this.tx.dataSheetRow.update({ where: { id: rowId }, data: { rowData, sealed: sealedBytes, confirmed, confirmedBy, ...this.searchData(meta, full) } })
    if (meta.schema.unique) await this.putKey(meta, rowId, full, cur.data)
    await this.event('update', meta.id, rowId, { data: cur.data, confirmed: cur.confirmed }, { data: full, confirmed })
    const st = meta.spec?.table.status
    if (st && meta.spec!.table.moveAlerts?.length) {
      const blank = (v: unknown) => v === undefined || v === null || v === ''
      const from = blank(cur.data[STATUS_COLUMN]) ? st.start : String(cur.data[STATUS_COLUMN])
      if (!blank(full[STATUS_COLUMN]) && String(full[STATUS_COLUMN]) !== from) await this.fireSpecMove(meta.spec!, rowId, from, full)
    }
    this.noteRow(meta, cur.confirmed !== true && confirmed === true ? 'confirm' : 'update', cur.data, full)
    if (calcChanged) await this.unconfirmAlongPairs(rowId)
    this.noteWrite(meta, rowId, cur.data, confirmed === true, anyChanged || !cur.confirmed, cur.confirmed === true)
    return decodeRow(row, this.key)
  }

  async remove(sheetId: string, rowId: string): Promise<void> {
    this.assertNotChannel()
    const meta = await this.writableMeta(sheetId)
    const cur = await this.loadRow(rowId, sheetId)
    const paired = await this.tx.sheetRowPair.count({ where: { OR: [{ fromRowId: rowId }, { toRowId: rowId }] } })
    if (paired > 0) throw new WorkError('PAIRED')
    const del = meta.template?.deleteRule?.({ before: cur.data, confirmed: cur.confirmed ?? null, actor: this.actor.type, who: personOf(this.actor), module: moduleIdOf(this.actor) })
    if (del) throw moduleStop(del.code, `delete rule: ${del.code}`, del.params ?? {})
    const lockedAs = this.specLockedStatus(meta, cur.data)
    if (lockedAs) throw new WorkError('FORBIDDEN', `the row is "${lockedAs}" — it cannot be deleted`)
    if (meta.spec?.pointedBy.length) await this.assertNotPointedTo(meta.spec, rowId)
    if (meta.spec?.table.checks?.length) await this.assertSpecChecks(meta, rowId, cur.data, null)
    if (this.actor.type === 'ai' && cur.confirmed === true) throw new WorkError('FORBIDDEN', 'a confirmed row is removed only by a person')
    if (this.actor.type === 'ai') {
      const me = actorLabel(this.actor)
      const events = await this.tx.workEvent.findMany({ where: { userId: this.userId, projectId: this.projectId, rowId }, select: { actor: true, action: true } })
      const aiOnly = events.some((e) => e.action === 'insert') && events.every((e) => actorBase(e.actor) === actorBase(me))
      if (!aiOnly) throw new WorkError('FORBIDDEN', 'only rows you inserted and no one else touched can be removed by you — ask the person to remove this row')
    }
    await this.assertRowWritable(meta, { before: cur.data, rowId })
    const old = await this.tx.dataSheetRow.findUniqueOrThrow({ where: { id: rowId }, select: { rowData: true, sealed: true } })
    await this.tx.dataSheetRow.delete({ where: { id: rowId } })
    this.touched.get(meta.id)?.delete(rowId)
    this.touchedConfirmed.get(meta.id)?.delete(rowId)
    this.pendingConfirm.get(meta.id)?.delete(rowId)
    this.checkedBatch.clear()
    await this.bumpLedger(meta.id, -rowBytes(old.rowData, old.sealed), -1)
    await this.event('delete', meta.id, rowId, { data: cur.data, confirmed: cur.confirmed }, null)
  }

  async confirmRows(rowIds: string[], opts: { onFail?: 'throw' | 'skip' } = {}): Promise<{ confirmed: number; skippedCheck: number }> {
    if (this.actor.type !== 'human' && !(this.actor.type === 'module' && this.actor.person)) throw new WorkError('FORBIDDEN', 'only a person can confirm')
    this.checkedBatch.clear()
    const todo: Array<{ cur: SheetRowView; meta: SheetMeta }> = []
    for (const rowId of rowIds) {
      const cur = await this.loadRow(rowId)
      const meta = await this.meta(cur.sheetId)
      if (!meta.template?.confirm && !meta.form) throw new WorkError('INVALID', 'this sheet has no confirmation')
      if (this.actor.type === 'module' && !meta.template?.confirm?.byModule) throw new WorkError('FORBIDDEN', 'only a person can confirm rows of this sheet')
      if (cur.confirmed) continue
      if (await this.isRowLocked(meta, cur)) throw new WorkError('LOCKED')
      if (meta.spec) await this.assertSpecConfirmer(meta, cur.data)
      if (todo.some((x) => x.cur.id === rowId)) continue
      if (meta.template?.confirm?.before && !this.checksManaged) throw new WorkError('FORBIDDEN', 'confirming rows of a checked sheet needs withProjectSheetWrite')
      todo.push({ cur, meta })
    }
    let skippedCheck = 0
    const pass = new Set(todo.map((x) => x.cur.id))
    for (const sheetId of [...new Set(todo.map((x) => x.meta.id))]) {
      const meta = todo.find((x) => x.meta.id === sheetId)!.meta
      const check = meta.template?.confirm?.before
      if (!check) continue
      let left = todo.filter((x) => x.meta.id === sheetId).map((x) => x.cur)
      while (left.length > 0) {
        const touched = this.touched.get(sheetId) ?? new Map<string, Readonly<Record<string, unknown>> | null>()
        const leftIds = new Set(left.map((r) => r.id))
        const others = await this.othersOf(sheetId, leftIds)
        const tc = this.touchedConfirmed.get(sheetId)
        const problems = await this.runCheck(meta, check, left.map((r) => ({ id: r.id, data: r.data, before: touched.has(r.id) ? touched.get(r.id) ?? null : r.data, confirmedBefore: tc?.get(r.id) ?? false })), others)
        if (problems.length === 0) { this.checkedBatch.set(sheetId, batchKey(left.map((r) => r.id), others.map((r) => r.id))); break }
        if (opts.onFail !== 'skip') throw this.checkStop(problems[0])
        const bad = new Set(problems.map((x) => left[x.index].id))
        for (const id of bad) pass.delete(id)
        skippedCheck += bad.size
        left = left.filter((r) => !bad.has(r.id))
      }
    }
    let confirmed = 0
    for (const { cur, meta } of todo) {
      if (!pass.has(cur.id)) continue
      await this.tx.dataSheetRow.update({ where: { id: cur.id }, data: { confirmed: true, confirmedBy: this.confirmerLabel() } })
      await this.event('confirm', meta.id, cur.id, { confirmed: false }, { confirmed: true })
      this.noteRow(meta, 'confirm', cur.data, cur.data)
      confirmed++
      if (meta.template?.confirm?.before && this.checksManaged) {
        const t = this.touched.get(meta.id) ?? new Map()
        if (!t.has(cur.id)) t.set(cur.id, cur.data)
        this.touched.set(meta.id, t)
        const tc = this.touchedConfirmed.get(meta.id) ?? new Map<string, boolean>()
        if (!tc.has(cur.id)) tc.set(cur.id, false)
        this.touchedConfirmed.set(meta.id, tc)
        const p = this.pendingConfirm.get(meta.id) ?? new Set<string>()
        p.add(cur.id)
        this.pendingConfirm.set(meta.id, p)
      }
    }
    if (new Set(todo.map((x) => x.meta.id)).size > 1) this.checkedBatch.clear()
    return { confirmed, skippedCheck }
  }

  private noteWrite(meta: SheetMeta, rowId: string, before: Readonly<Record<string, unknown>> | null, confirmedNow: boolean, changed: boolean, confirmedBefore: boolean): void {
    this.checkedBatch.clear()
    const t = this.touched.get(meta.id) ?? new Map()
    if (!t.has(rowId)) t.set(rowId, before)
    this.touched.set(meta.id, t)
    const tc = this.touchedConfirmed.get(meta.id) ?? new Map<string, boolean>()
    if (!tc.has(rowId)) tc.set(rowId, confirmedBefore)
    this.touchedConfirmed.set(meta.id, tc)
    const p = this.pendingConfirm.get(meta.id) ?? new Set<string>()
    if (!confirmedNow) p.delete(rowId)
    else if (changed && meta.template?.confirm?.before) {
      if (!this.checksManaged) throw new WorkError('FORBIDDEN', 'a write that leaves a row confirmed on a checked sheet needs withProjectSheetWrite')
      p.add(rowId)
    }
    this.pendingConfirm.set(meta.id, p)
  }

  manageChecks(): void {
    this.checksManaged = true
  }

  async finishChecks(): Promise<void> {
    for (const [sheetId, ids] of this.pendingConfirm) {
      if (ids.size === 0) continue
      const meta = await this.meta(sheetId)
      const check = meta.template?.confirm?.before
      if (!check) continue
      const touched = this.touched.get(sheetId) ?? new Map()
      const tc = this.touchedConfirmed.get(sheetId)
      const load = async (id: string) => { const r = await this.loadRow(id, sheetId); return { id, data: r.data, before: touched.get(id) ?? null, confirmedBefore: tc?.get(id) ?? false } }
      const rows = await Promise.all([...ids].sort().map(load))
      const others = await this.othersOf(sheetId, ids)
      if (this.checkedBatch.get(sheetId) === batchKey(rows.map((r) => r.id), others.map((r) => r.id))) continue
      const problems = await this.runCheck(meta, check, rows, others)
      if (problems.length > 0) throw this.checkStop(problems[0])
    }
    this.pendingConfirm.clear()
  }

  private async othersOf(sheetId: string, exclude: ReadonlySet<string>): Promise<ConfirmCheckRow[]> {
    const touched = this.touched.get(sheetId) ?? new Map<string, Readonly<Record<string, unknown>> | null>()
    const out: ConfirmCheckRow[] = []
    for (const id of [...touched.keys()].filter((x) => !exclude.has(x)).sort()) {
      const r = await this.tx.dataSheetRow.findFirst({ where: { id, kind: 'project', projectId: this.projectId, userId: this.userId, sheetId } })
      if (!r) continue
      const v = decodeRow(r, this.key)
      if (v.confirmed === true) continue
      out.push({ id, data: v.data, before: touched.get(id) ?? null, confirmedBefore: this.touchedConfirmed.get(sheetId)?.get(id) ?? false })
    }
    return out
  }

  private async runCheck(meta: SheetMeta, check: NonNullable<NonNullable<SheetTemplate['confirm']>['before']>, rows: ConfirmCheckRow[], others: ConfirmCheckRow[]): Promise<readonly ConfirmProblem[]> {
    const hide = new Set([...rows, ...others].map((x) => x.id))
    const ctx: ConfirmCheckCtx = {
      projectId: this.projectId,
      rows: async (family) => {
        const sheets = await this.sheetsOfFamily(family)
        const out: SheetRowView[] = []
        for (const sh of sheets) for (const r of await this.rows(sh.id)) if (!hide.has(r.id)) out.push(r)
        return out
      },
      references: () => (this.refReader ??= import('./references').then((m) => m.readProjectReferences({ ...this.deps, db: this.tx as unknown as PrismaClient }, { userId: this.userId, projectId: this.projectId }))),
      settings: async () => {
        const { readProjectSettingsTx } = await import('./projects')
        const { name: _name, ...rest } = await readProjectSettingsTx(this.tx, this.key, this.userId, this.projectId)
        return rest
      },
      fxMonthly: (currency, date) => estvMonthlyFx(this.tx, currency, date),
      fingerprint: async (label, value) => fingerprintOf(this.key, label, value),
      ...(isV7Template(meta.template) ? { who: async () => personOf(this.actor), members: async () => projectMembersTx(this.tx, this.userId, this.projectId) } : {}),
      serialize: async (name) => {
        await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(4203, hashtext(${`${this.userId}|${name}`}))`
        this.refReader = null
      },
    }
    const problems = await check(ctx, { sheetId: meta.id, by: this.actor.type === 'ai' ? 'ai' : 'human', rows, others })
    for (const x of problems) if (!Number.isInteger(x.index) || x.index < 0 || x.index >= rows.length) throw new Error(`confirm check of ${meta.template?.name}: row index ${x.index} out of range`)
    return problems
  }

  private applyWriteRule(meta: SheetMeta, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>>, confirmedBefore: boolean | null, confirmedAfter: boolean | null): void {
    const rule = meta.template?.writeRule
    if (!rule) return
    const bad = rule({ before, after, confirmedBefore, confirmedAfter, actor: this.actor.type, ...(isV7Template(meta.template) ? { who: personOf(this.actor), module: moduleIdOf(this.actor) } : {}) })
    if (bad) throw moduleStop(bad.code, `write rule: ${bad.code}`, bad.params ?? {})
  }

  private specTeamCache: Promise<SpecTeam> | null = null
  private specTeamOf(): Promise<SpecTeam> {
    return (this.specTeamCache ??= specTeam(this.tx, this.userId, this.projectId))
  }

  private async applySpecRule(meta: SheetMeta, rowId: string | null, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>>, confirming: boolean): Promise<void> {
    const t = meta.spec?.table
    if (!t) return
    const blank = (v: unknown) => v === undefined || v === null || v === ''
    if (before) {
      if (!sameValue(before[NUMBER_COLUMN], after[NUMBER_COLUMN])) throw new WorkError('FORBIDDEN', 'the row number is given by the app — it cannot be changed')
      const st = t.status
      if (st) {
        const from = blank(before[STATUS_COLUMN]) ? st.start : String(before[STATUS_COLUMN])
        const to = after[STATUS_COLUMN]
        if (st.lockedIn?.includes(from)) {
          const others = Object.keys({ ...before, ...after }).filter((k) => k !== STATUS_COLUMN && !sameValue(before[k], after[k]))
          if (others.length) throw new WorkError('FORBIDDEN', `the row is "${from}" — only its status can change`)
        }
        if (blank(to) && !blank(before[STATUS_COLUMN])) throw new WorkError('INVALID', `${st.label ?? 'Stage'} is required`)
        if (!blank(to) && String(to) !== from) {
          const move = st.moves.find((m) => m.from === from && m.to === to)
          if (!move) {
            const can = st.moves.filter((m) => m.from === from).map((m) => m.to)
            throw new WorkError('INVALID', `${st.label ?? 'Stage'}: "${from}" can move only to ${can.length ? can.map((x) => `"${x}"`).join(', ') : 'nothing'}`)
          }
          if (move.by) await this.assertSpecPerson(meta, before, move.by, `move the status from "${from}" to "${String(to)}"`)
        }
      }
    }
    const people = t.columns.filter((c) => c.kind === 'person')
    if (people.length) {
      const team = new Set(teamEmails(await this.specTeamOf()))
      for (const c of people) {
        const v = after[c.key]
        if (blank(v) || (before && sameValue(before[c.key], v))) continue
        if (!team.has(String(v))) throw new WorkError('INVALID', `${c.label}: choose a person of this app's team (their email)`)
      }
    }
    for (const col of authorityColumnsOf(t)) {
      if (!before || sameValue(before[col], after[col])) continue
      const p = personOf(this.actor)
      const me = p ? await this.specEmailOf(p) : null
      if (!p?.owner && (blank(before[col]) || me !== String(before[col]).trim().toLowerCase())) throw new WorkError('FORBIDDEN', `${t.columns.find((c) => c.key === col)?.label ?? col}: only the owner or the person set here can change it`)
    }
    for (const c of t.columns) {
      if (c.kind !== 'time') continue
      const v = after[c.key]
      if (blank(v) || (before && sameValue(before[c.key], v))) continue
      if (typeof v !== 'string' || !TIME_RE.test(v)) throw new WorkError('INVALID', `${c.label}: write the time as HH:MM, 24-hour, two digits (for example 09:30 or 14:00)`)
    }
    for (const d of t.docs ?? []) for (const k of [docFileColumn(d.key), docFpColumn(d.key)]) {
      if (before ? !sameValue(before[k], after[k]) : !blank(after[k])) throw new WorkError('FORBIDDEN', `${k}: a made document is set only by making the document`)
    }
    await this.assertSpecRefs(t, before, after)
    if (t.checks?.length) await this.assertSpecChecks(meta, rowId, before, after)
    if (confirming) await this.assertSpecConfirmer(meta, before ?? after)
  }

  private async assertSpecChecks(meta: SheetMeta, rowId: string | null, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>> | null): Promise<void> {
    const t = meta.spec?.table
    if (!t?.checks?.length) return
    let others: SheetRowView[] | null = null
    const load = async () => (others ??= (await this.tx.dataSheetRow.findMany({ where: { sheetId: meta.id, kind: 'project', projectId: this.projectId, userId: this.userId, ...(rowId ? { id: { not: rowId } } : {}) } })).map((r) => decodeRow(r, this.key)))
    for (const c of t.checks) {
      if (c.kind === 'no_overlap') {
        if (!after || (before && !checkTouched(t, c, before, after))) continue
        const span = overlapSpan(c, after, true)
        if (!span || !isCounted(t, c, after)) continue
        const by = c.by ? normValue(t, c.by, after[c.by]) : 'all'
        if (by === null) continue
        for (const r of await load()) {
          if (!isCounted(t, c, r.data) || (c.by && normValue(t, c.by, r.data[c.by]) !== by)) continue
          const o = overlapSpan(c, r.data, false)
          if (o && spansOverlap(span, o)) throw this.checkFailed(c, r, null)
        }
      } else {
        const gb = before && isCounted(t, c, before) ? limitGroup(t, c, before) : null
        const ga = after && isCounted(t, c, after) ? limitGroup(t, c, after) : null
        for (const g of new Set([gb, ga].filter((x): x is string => x !== null))) {
          const pre = gb === g ? amountOf(c, before!) : DEC0
          const post = ga === g ? amountOf(c, after!) : DEC0
          if (decimalCompare(pre, post) === 0) continue
          let sum = DEC0
          for (const r of await load()) if (isCounted(t, c, r.data) && limitGroup(t, c, r.data) === g) sum = decAdd(sum, amountOf(c, r.data))
          const now = decAdd(sum, post)
          if (limitBroken(c, decAdd(sum, pre), now)) throw this.checkFailed(c, null, now)
        }
      }
    }
  }

  async setSpecDoc(sheetId: string, rowId: string, docKey: string, fileId: string, fp: string): Promise<void> {
    if (this.actor.type !== 'human' && this.actor.type !== 'ai') throw new WorkError('FORBIDDEN', 'documents are made by a person or the app AI')
    const meta = await this.writableMeta(sheetId)
    if (!meta.spec?.table.docs?.some((d) => d.key === docKey && !d.hidden)) throw new WorkError('INVALID', `no document template "${docKey}" in this table`)
    const cur = await this.loadRow(rowId, sheetId)
    const old = await this.tx.dataSheetRow.findUniqueOrThrow({ where: { id: rowId }, select: { rowData: true, sealed: true } })
    const plain = { ...(JSON.parse(old.rowData) as Record<string, unknown>), [docFileColumn(docKey)]: fileId, [docFpColumn(docKey)]: fp }
    const rowData = JSON.stringify(plain)
    await this.bumpLedger(meta.id, rowBytes(rowData, old.sealed) - rowBytes(old.rowData, old.sealed))
    await this.tx.dataSheetRow.update({ where: { id: rowId }, data: { rowData } })
    await this.event('update', meta.id, rowId, { data: cur.data, confirmed: cur.confirmed }, { data: { ...cur.data, [docFileColumn(docKey)]: fileId, [docFpColumn(docKey)]: fp }, confirmed: cur.confirmed })
  }

  private checkFailed(c: SpecCheck, hit: SheetRowView | null, total: Dec | null): WorkError {
    if (outsideActor(this.actor)) return new WorkError('CHECK_FAILED', 'this time cannot be booked — please choose another time', { code: 'check_taken' })
    if (c.kind === 'no_overlap') {
      const no = hit && typeof hit.data[NUMBER_COLUMN] === 'string' && hit.data[NUMBER_COLUMN] ? String(hit.data[NUMBER_COLUMN]) : null
      return new WorkError('CHECK_FAILED', `${c.label}: this overlaps ${no ? `row ${no}` : 'another row'} — choose another time or ${c.by ? 'another one' : 'free the other row first'}`, { code: no ? 'check_overlap_row' : 'check_overlap', params: { name: c.label, ...(no ? { row: no } : {}) } })
    }
    const t = decText(total ?? DEC0)
    return new WorkError('CHECK_FAILED', `${c.label}: the total would become ${t} (allowed ${c.min !== undefined ? `from ${c.min}` : ''}${c.min !== undefined && c.max !== undefined ? ' ' : ''}${c.max !== undefined ? `up to ${c.max}` : ''})`, { code: 'check_limit', params: { name: c.label, total: t } })
  }

  private async fireSpecMove(rule: SpecRule, rowId: string, from: string | null, after: Readonly<Record<string, unknown>>): Promise<void> {
    const to = after[STATUS_COLUMN]
    if (typeof to !== 'string' || !to) return
    const p = personOf(this.actor)
    const { fireMoveAlertsTx } = await import('./assembled-alerts')
    await fireMoveAlertsTx(this.tx, this.key, {
      userId: this.userId, projectId: this.projectId, table: rule.table, sends: rule.sends, rowId, from, to, data: after, team: await this.specTeamOf(),
      ...(p ? { by: p.owner ? 'human' : `member:${p.memberId}` } : {}), ai: this.actor.type === 'ai', outside: outsideActor(this.actor),
      ...(this.actor.type === 'app' ? { fromAppWorkflowId: this.actor.workflowId } : {}),
    })
  }

  private async assertNotPointedTo(rule: SpecRule, rowId: string): Promise<void> {
    for (const table of [...new Set(rule.pointedBy.map((p) => p.table))]) {
      const cols = rule.pointedBy.filter((p) => p.table === table)
      const sheetId = await this.specSheetId(table)
      if (!sheetId) continue
      const any = Prisma.join(cols.map((p) => Prisma.sql`(row_data::jsonb ->> ${p.column}) = ${rowId}`), ' OR ')
      const [{ n }] = await this.tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT count(*)::int AS n FROM data_sheet_rows
        WHERE sheet_id = ${sheetId} AND project_id = ${this.projectId} AND user_id = ${this.userId} AND (${any})`)
      if (n > 0) throw new WorkError('ROW_IN_USE', `${n} row(s) of "${cols[0].tableName}" point to this row — change or remove them first`, { code: 'ref_in_use', params: { n, where: cols[0].tableName } })
    }
  }

  private async specSheetId(tableKey: string): Promise<string | null> {
    const s = await this.tx.dataSheet.findFirst({ where: { userId: this.userId, projectId: this.projectId, kind: 'project', template: null, name: specSheetName(tableKey) }, select: { id: true } })
    return s?.id ?? null
  }

  private async assertSpecRefs(t: SpecRule['table'], before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>>): Promise<void> {
    const blank = (v: unknown) => v === undefined || v === null || v === ''
    for (const c of t.columns) {
      if (c.kind !== 'ref' || !c.ref) continue
      const v = after[c.key]
      if (blank(v) || (before && sameValue(before[c.key], v))) continue
      if (c.ref.app) { await this.assertCrossRef(c, v); continue }
      const sheetId = typeof v === 'string' ? await this.specSheetId(c.ref.table) : null
      const hit = sheetId && typeof v === 'string' && v.length <= 25 ? await this.tx.dataSheetRow.findFirst({ where: { id: v, sheetId, projectId: this.projectId, userId: this.userId }, select: { id: true } }) : null
      if (!hit) throw new WorkError('INVALID', `${c.label}: choose a row of the table "${c.ref.table}" (its row id)`)
    }
  }

  private async assertCrossRef(c: SpecRule['table']['columns'][number], v: unknown): Promise<void> {
    const ref = c.ref!
    const no = () => new WorkError('INVALID', `${c.label}: choose a row of "${ref.table}" of the other app that this app may read (its row id)`)
    if (typeof v !== 'string' || v.length > 25) throw no()
    const line = await crossLine(this.tx, { userId: this.userId, readerProjectId: this.projectId, sourceProjectId: ref.app!, table: ref.table })
    if (!line) throw new WorkError('INVALID', `${c.label}: this app cannot read "${ref.table}" of the other app any more — the reference line is missing`)
    const src = await this.tx.workAppSpec.findFirst({ where: { userId: this.userId, projectId: ref.app! }, select: { info: true } })
    if (crossTargetProblem(src ? decryptJson<AppSpec>(Buffer.from(src.info), this.key) : null, ref)) throw new WorkError('INVALID', `${c.label}: "${ref.table}" of the other app cannot be read`)
    const hit = await this.tx.dataSheetRow.findFirst({ where: { id: v, sheetId: line.sheetId, projectId: ref.app!, userId: this.userId }, select: { confirmed: true } })
    if (!hit || (!line.includeUnconfirmed && hit.confirmed !== true)) throw no()
  }

  private async prepareSpecInsert(rule: SpecRule, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const t = rule.table
    const out: Record<string, unknown> = { ...data }
    const blank = (v: unknown) => v === undefined || v === null || v === ''
    if (!blank(out[NUMBER_COLUMN])) throw new WorkError('INVALID', 'the row number is given by the app — leave it out')
    if (t.status) {
      if (blank(out[STATUS_COLUMN])) out[STATUS_COLUMN] = t.status.start
      else if (out[STATUS_COLUMN] !== t.status.start) throw new WorkError('INVALID', `a new row starts as "${t.status.start}"`)
    }
    if (t.number) out[NUMBER_COLUMN] = await nextSpecNumber(this.tx, { userId: this.userId, projectId: this.projectId, tableKey: t.key, number: t.number, today: await accountToday(this.tx, this.userId) })
    return out
  }

  private specLockedStatus(meta: SheetMeta, row: Readonly<Record<string, unknown>>): string | null {
    const st = meta.spec?.table.status
    if (!st?.lockedIn?.length) return null
    const v = row[STATUS_COLUMN] === undefined || row[STATUS_COLUMN] === null || row[STATUS_COLUMN] === '' ? st.start : String(row[STATUS_COLUMN])
    return st.lockedIn.includes(v) ? v : null
  }

  private async specEmailOf(p: WorkPerson): Promise<string | null> {
    const team = await this.specTeamOf()
    return p.owner ? team.ownerEmail : team.members.find((m) => m.id === p.memberId)?.email ?? null
  }

  private async assertSpecConfirmer(meta: SheetMeta, row: Readonly<Record<string, unknown>>): Promise<void> {
    const t = meta.spec?.table
    if (!t) return
    if (!personOf(this.actor)) throw new WorkError('FORBIDDEN', 'only a person can confirm rows of this table')
    await this.assertSpecPerson(meta, row, t.confirm?.by ?? 'anyone', 'confirm this row')
  }

  private async assertSpecPerson(meta: SheetMeta, row: Readonly<Record<string, unknown>>, by: ConfirmBy, what: string): Promise<void> {
    const t = meta.spec?.table
    if (!t || by === 'anyone') return
    const p = personOf(this.actor)
    if (!p) throw new WorkError('FORBIDDEN', `only a person can ${what}`)
    if (p.owner) return
    if (by === 'owner') throw new WorkError('FORBIDDEN', `only the owner can ${what}`)
    const col = by.slice(7)
    const label = t.columns.find((c) => c.key === col)?.label ?? col
    const v = typeof row[col] === 'string' ? (row[col] as string).trim().toLowerCase() : row[col]
    const team = teamEmails(await this.specTeamOf())
    if (typeof v !== 'string' || !team.includes(v)) throw new WorkError('FORBIDDEN', `${label}: no one of the team is set — only the owner can ${what}`)
    if ((await this.specEmailOf(p)) !== v) throw new WorkError('FORBIDDEN', `only the person in ${label} can ${what}`)
  }

  private checkStop(x: ConfirmProblem): WorkError {
    return moduleStop(x.code, `confirm check: ${x.code}`, { ...(x.params ?? {}), row: x.index })
  }

  async pair(fromRowId: string, toRowId: string, kind: string): Promise<{ id: string }> {
    this.checkedBatch.clear()
    this.assertNotChannel()
    if (fromRowId === toRowId) throw new WorkError('INVALID', 'a row cannot pair with itself')
    const ctx = await this.pairContext(fromRowId, toRowId, kind)
    this.assertModuleOnly(ctx.fromMeta)
    this.assertModuleOnly(ctx.toMeta)
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
    await this.event('pair', ctx.toMeta.id, toRowId, null, { fromRowId, kind }, ctx.usedException)
    return created
  }

  async unpair(pairId: string): Promise<void> {
    this.checkedBatch.clear()
    this.assertNotChannel()
    const p = await this.tx.sheetRowPair.findFirst({ where: { id: pairId, projectId: this.projectId, userId: this.userId } })
    if (!p) throw new WorkError('NOT_FOUND')
    const ctx = await this.pairContext(p.fromRowId, p.toRowId, p.kind)
    this.assertModuleOnly(ctx.fromMeta)
    this.assertModuleOnly(ctx.toMeta)
    await this.assertPairWritable('unpair', ctx)
    await this.tx.sheetRowPair.delete({ where: { id: pairId } })
    await this.event('unpair', ctx.fromMeta.id, p.fromRowId, { toRowId: p.toRowId, kind: p.kind, confirmed: p.confirmed }, null, ctx.usedException)
    await this.event('unpair', ctx.toMeta.id, p.toRowId, { fromRowId: p.fromRowId, kind: p.kind, confirmed: p.confirmed }, null, ctx.usedException)
  }

  async confirmPair(pairId: string): Promise<void> {
    this.checkedBatch.clear()
    this.assertHuman()
    const p = await this.tx.sheetRowPair.findFirst({ where: { id: pairId, projectId: this.projectId, userId: this.userId } })
    if (!p) throw new WorkError('NOT_FOUND')
    if (p.confirmed) return
    const ctx = await this.pairContext(p.fromRowId, p.toRowId, p.kind)
    if (await this.isPairLockedCtx(ctx)) throw new WorkError('LOCKED')
    await this.tx.sheetRowPair.update({ where: { id: pairId }, data: { confirmed: true } })
    await this.event('confirm', ctx.fromMeta.id, p.fromRowId, { pairId, confirmed: false }, { pairId, confirmed: true })
    await this.event('confirm', ctx.toMeta.id, p.toRowId, { pairId, confirmed: false }, { pairId, confirmed: true })
  }

  private async meta(sheetId: string): Promise<SheetMeta> {
    const hit = this.metaCache.get(sheetId)
    if (hit) return hit
    const s = await this.tx.dataSheet.findFirst({
      where: { id: sheetId, kind: 'project', projectId: this.projectId, userId: this.userId },
      select: { id: true, name: true, schema: true, template: true, templateFamily: true },
    })
    if (!s) throw new WorkError('NOT_FOUND')
    const m = sheetMeta(s, this.deps.templates)
    if (!s.template) m.form = await formRuleLocked(this.tx, this.key, { userId: this.userId, sheetId })
    if (!s.template && !m.form) {
      m.spec = await specRuleLocked(this.tx, this.key, { userId: this.userId, projectId: this.projectId, sheetName: s.name })
      if (m.spec) m.form = m.spec.form
    }
    this.metaCache.set(sheetId, m)
    return m
  }

  private async writableMeta(sheetId: string): Promise<SheetMeta> {
    if (!this.lockedSheets.has(sheetId)) throw new WorkError('INVALID', 'sheet was not locked for this write')
    const meta = await this.meta(sheetId)
    if (this.actor.type === 'ai' && meta.template?.aiWrite === false) throw new WorkError('FORBIDDEN', 'this sheet is written only by a person or a module')
    this.assertModuleOnly(meta)
    return meta
  }

  private assertModuleOnly(meta: SheetMeta): void {
    if (meta.template?.moduleOnly && this.actor.type !== 'module') throw new WorkError('FORBIDDEN', 'this sheet is written only by its work app')
  }

  async isLocked(sheetId: string, rowId: string): Promise<boolean> {
    return this.isRowLocked(await this.meta(sheetId), await this.loadRow(rowId, sheetId))
  }

  async addPreparedFile(p: PreparedWorkFile): Promise<{ id: string; sha256: string; created: boolean }> {
    this.assertNotChannel()
    if (p.userId !== this.userId || p.projectId !== this.projectId) throw new WorkError('FORBIDDEN', 'the file was prepared for another project')
    const { insertPreparedFile } = await import('./files')
    const { file, created } = await insertPreparedFile(this.tx, this.key, p, this.actor)
    return { id: file.id, sha256: file.sha256, created }
  }

  async addPublicLink(input: { fileId: string; rowId: string; lastDay: string; expiresAt: Date }): Promise<{ token: string; url: string } | null> {
    if (this.actor.type !== 'module') throw new WorkError('FORBIDDEN', 'only a module makes a download link')
    const { newPublicToken, publicLinkUrl, zurichToday } = await import('./public-links')
    const f = await this.tx.workFile.findFirst({ where: { id: input.fileId, projectId: this.projectId, userId: this.userId }, select: { kind: true, mimeType: true } })
    if (!f || f.kind !== 'invoice' || f.mimeType !== 'application/pdf') throw new WorkError('INVALID', 'a download link is only for an invoice PDF of this project')
    await this.loadRow(input.rowId)
    if (input.lastDay < zurichToday()) return null
    const { token, hash } = newPublicToken()
    const url = publicLinkUrl(token)
    if (!url) return null
    await this.tx.workPublicLink.create({ data: { userId: this.userId, projectId: this.projectId, fileId: input.fileId, rowId: input.rowId, tokenHash: hash, expiresAt: input.expiresAt } })
    await this.tx.workEvent.create({ data: { userId: this.userId, projectId: this.projectId, rowId: input.rowId, fileId: input.fileId, actor: actorLabel(this.actor), action: 'public_link_create', payload: null } })
    return { token, url }
  }

  async revokePublicLinks(rowId: string): Promise<number> {
    if (this.actor.type !== 'module') throw new WorkError('FORBIDDEN', 'only a module revokes a download link')
    const n = await this.tx.workPublicLink.updateMany({ where: { rowId, projectId: this.projectId, userId: this.userId, revokedAt: null }, data: { revokedAt: new Date() } })
    if (n.count > 0) await this.tx.workEvent.create({ data: { userId: this.userId, projectId: this.projectId, rowId, actor: actorLabel(this.actor), action: 'public_link_revoke', payload: null } })
    return n.count
  }

  async discardSendsFor(rowId: string): Promise<number> {
    if (this.actor.type !== 'module') throw new WorkError('FORBIDDEN', 'only a module discards cards')
    const n = await this.tx.workSend.updateMany({ where: { ref: rowId, projectId: this.projectId, userId: this.userId, status: 'pending' }, data: { status: 'discarded', code: 'REF_CLOSED', decidedBy: actorLabel(this.actor), decidedAt: new Date() } })
    if (n.count > 0) await this.tx.workEvent.create({ data: { userId: this.userId, projectId: this.projectId, rowId, actor: actorLabel(this.actor), action: 'send_discard', payload: null } })
    return n.count
  }

  async projectFile(fileId: string): Promise<{ id: string; sha256: string }> {
    await assertScanWrite(null, [], [fileId])
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
      const moreCol = meta.template?.ui?.moreFiles ?? null
      const rows = await this.tx.$queryRaw<Array<{ id: string; row_data: string }>>(Prisma.sql`
        SELECT id, row_data FROM data_sheet_rows
        WHERE sheet_id = ${s.id} AND project_id = ${this.projectId} AND user_id = ${this.userId} AND kind = 'project' AND id <> ${exceptRowId}
          AND ((row_data::jsonb ->> ${fileCol}) = ${fileId}
            OR (${moreCol}::text IS NOT NULL AND string_to_array(row_data::jsonb ->> ${moreCol ?? ''}, ',') @> ARRAY[${fileId}]::text[]))`)
      for (const r of rows) {
        const d = calendarDateOf(meta.byName.get(dateCol)!, (JSON.parse(r.row_data) as Record<string, unknown>)[dateCol])
        if (d && d >= period.start && d <= period.end) return true
      }
    }
    return false
  }

  async syncRowFile(rowId: string, fileCol: string, dateCol: string, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>> | null): Promise<void> {
    this.assertNotChannel()
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
  async syncRowFiles(rowId: string, idsOf: (d: Readonly<Record<string, unknown>>) => string[], dateCol: string, before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>> | null): Promise<void> {
    this.assertNotChannel()
    const pick = async (d: Readonly<Record<string, unknown>> | null) => {
      const ids = d ? idsOf(d) : []
      const date = d && typeof d[dateCol] === 'string' ? (d[dateCol] as string).slice(0, 10) : null
      return { ids, taskId: ids.length > 0 && date ? await this.openTaskAt(date) : null }
    }
    const b = await pick(before)
    const a = await pick(after)
    for (const id of b.ids) {
      if (!b.taskId || (a.ids.includes(id) && a.taskId === b.taskId) || (await this.fileStillUsedIn(id, rowId, b.taskId))) continue
      const n = await this.tx.workTaskFile.deleteMany({ where: { taskId: b.taskId, fileId: id } })
      if (n.count > 0) await this.tx.workEvent.create({ data: { userId: this.userId, projectId: this.projectId, taskId: b.taskId, fileId: id, actor: actorLabel(this.actor), action: 'file_detach', payload: null } })
    }
    if (!a.taskId) return
    for (const id of a.ids) {
      const had = await this.tx.workTaskFile.findUnique({ where: { taskId_fileId: { taskId: a.taskId, fileId: id } } })
      if (had) continue
      await this.tx.workTaskFile.create({ data: { taskId: a.taskId, fileId: id, projectId: this.projectId, userId: this.userId } })
      await this.tx.workEvent.create({ data: { userId: this.userId, projectId: this.projectId, taskId: a.taskId, fileId: id, actor: actorLabel(this.actor), action: 'file_attach', payload: null } })
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

  private assertNotChannel(): void {
    if (insertOnly(this.actor)) throw new WorkError('FORBIDDEN', 'a channel only adds rows')
  }

  private assertHuman(): void {
    if (this.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person can confirm')
  }

  private confirmerLabel(): string {
    const p = this.actor.type === 'module' ? personOf(this.actor) : null
    return p ? personLabel(p) : actorLabel(this.actor)
  }

  private initialConfirmed(meta: SheetMeta, opts: WriteOptions, full: Record<string, unknown>, given: Record<string, unknown>): boolean | null {
    if (opts.confirm) {
      this.assertMayConfirm(meta, full, given)
      return true
    }
    return meta.template?.confirm || meta.form ? false : null
  }

  private assertMayConfirm(meta: SheetMeta, full: Record<string, unknown>, given: Record<string, unknown>): void {
    if (!meta.template?.confirm && !meta.form) throw new WorkError('INVALID', 'this sheet has no confirmation')
    if (this.actor.type === 'human') return
    if (!meta.template?.confirm) throw new WorkError('FORBIDDEN', 'only a person can confirm rows of this sheet')
    if (this.actor.type === 'module' && this.actor.person && meta.template.confirm.byModule) return
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

  private searchKeyCache: Buffer | null = null
  private searchData(meta: SheetMeta, full: Readonly<Record<string, unknown>>) {
    const decl = meta.template?.search
    if (!decl) return {}
    this.searchKeyCache ??= searchKeyOf(this.key)
    const c = computeSearchCopy(decl, full, this.searchKeyCache)
    const day = (d: string | null) => (d ? new Date(`${d}T00:00:00.000Z`) : null)
    return {
      fDate1: day(c.fDate1), fDate2: day(c.fDate2), fDate3: day(c.fDate3), fDate4: day(c.fDate4),
      fAmt1: c.fAmt1, fAmt2: c.fAmt2, fCur: c.fCur,
      fKey1: c.fKey1, fKey2: c.fKey2, fKey3: c.fKey3, fKey4: c.fKey4,
      fParty: c.fParty, fLink: c.fLink, fVer: c.fVer,
    }
  }

  private async bumpLedger(sheetId: string, delta: number, rows = 0): Promise<void> {
    const grow = delta > 0 ? delta : 0
    const n = await this.tx.$executeRaw`
      UPDATE data_sheets SET size_bytes = GREATEST(0, size_bytes + ${delta}), row_count = GREATEST(0, row_count + ${rows}), updated_at = NOW() AT TIME ZONE 'UTC'
      WHERE id = ${sheetId} AND (${grow} = 0 OR size_bytes + ${grow} <= ${MAX_SHEET_SIZE_BYTES})`
    if (n === 1) return
    if (!(await this.tx.dataSheet.findUnique({ where: { id: sheetId }, select: { id: true } }))) throw new WorkError('NOT_FOUND')
    throw new WorkError('INVALID', 'Storage limit exceeded. Maximum sheet size is 50MB.')
  }

  private noteRow(meta: SheetMeta, action: 'insert' | 'update' | 'confirm', before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>>): void {
    const hook = meta.template?.rowNotice
    if (!hook) return
    let n: WorkNotice | null = null
    try { n = moduleNoticeOf({ notice: hook({ action, before, after }) }) } catch (e) { console.warn(`[work] rowNotice ${meta.template?.name}: ${e instanceof Error ? e.message : String(e)}`) }
    if (n) this.notices.push(n)
  }

  async writeNotices(): Promise<void> {
    const p = personOf(this.actor)
    const by = p ? (p.owner ? 'human' : `member:${p.memberId}`) : undefined
    for (const n of this.notices.splice(0)) await writeWorkNotice(this.tx, this.key, { userId: this.userId, projectId: this.projectId, notice: { ...n, ...(by ? { by } : {}) }, ...(by ? { alsoPrivate: by } : {}) })
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

const batchKey = (rows: readonly string[], others: readonly string[]) => `${[...rows].sort().join(',')}|${[...others].sort().join(',')}`

export async function withProjectSheetWrite<T>(deps: WorkSheetDeps, req: ProjectSheetWriteRequest, fn: (w: ProjectSheetWriter) => Promise<T>): Promise<T> {
  validateTemplateRegistry(deps.templates)
  const key = await deps.dataKey(deps.db, req.userId)
  return deps.db.$transaction(async (tx) => {
    const w = await openProjectSheetWriter(tx, deps, key, req)
    w.manageChecks()
    const out = await fn(w)
    await w.finishChecks()
    await w.writeNotices()
    return out
  }, { timeout: TX_TIMEOUT_MS })
}

export async function openProjectSheetWriter(tx: Tx, deps: WorkSheetDeps, key: Buffer, req: ProjectSheetWriteRequest): Promise<ProjectSheetWriter> {
  const sheetIds = [...new Set(req.sheetIds)].sort()
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
  return new ProjectSheetWriter(tx, deps, key, req.userId, req.projectId, req.actor, new Set(sheetIds), periods, req.taskId ?? null, req.exception ?? null)
}

export async function readProjectSheet(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string; sheetId: string; workflowId?: string; rowIds?: readonly string[] },
): Promise<{ schema: SheetSchema; rows: SheetRowView[] }> {
  const sheet = await deps.db.dataSheet.findFirst({
    where: { id: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId },
    select: { schema: true, name: true, template: true, project: { select: { workflowId: true } } },
  })
  if (!sheet) throw new WorkError('NOT_FOUND')
  if (q.workflowId !== undefined && (!sheet.project?.workflowId || sheet.project.workflowId !== q.workflowId)) throw new WorkError('FORBIDDEN')
  const key = await deps.dataKey(deps.db, q.userId)
  if (!sheet.template && sheet.name.startsWith('app_') && (await readAssembledForms(deps.db, key, { userId: q.userId, projectId: q.projectId, sheetIds: [q.sheetId], deleted: true }))[0]?.deletedAt) throw new WorkError('NOT_FOUND')
  const rows = q.rowIds
    ? (await deps.db.dataSheetRow.findMany({
        where: { id: { in: [...q.rowIds] }, kind: 'project', projectId: q.projectId, userId: q.userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })).filter((r) => r.sheetId === q.sheetId)
    : await deps.db.dataSheetRow.findMany({
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
          searchVer: template?.search?.version ?? 0,
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
