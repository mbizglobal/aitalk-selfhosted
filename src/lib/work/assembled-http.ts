
import { createHash } from 'crypto'
import { WorkError } from './errors'
import { decryptJson } from './sealed'
import { decodeRow, isProjectDetached, lockProjectForWrite, actorLabel, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { writeWorkEvent } from './projects'
import { createSendTx, SEND_SENDING_LIMIT_MS, type SendPayload } from './sends'
import {
  ASSEMBLED_KIND, NUMBER_COLUMN, STATUS_COLUMN, accountToday, computeRow, readRefRows, readSpec, specSendBlocked, specSheetName,
  type AppSpec, type RefRows, type SpecSend, type SpecTable,
} from './assembled'
import { hostOf, slotHttpNow } from './http-target'

export const HTTP_DECLARED_PREFIX = 'assembled.http:'
export const httpDeclared = (sendKey: string) => `${HTTP_DECLARED_PREFIX}${sendKey}`
export const isHttpDeclared = (d: string | null | undefined): boolean => typeof d === 'string' && d.startsWith(HTTP_DECLARED_PREFIX)
export const HTTP_SLOT = 'api'
export const HTTP_BODY_MAX = 16 * 1024

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

export type HttpValue = string | null | { amount: string; currency: string | null }

function httpValueOf(t: SpecTable, k: string, row: Readonly<Record<string, unknown>>, comp: Record<string, string | null>, refRows: RefRows): HttpValue {
  if (k === NUMBER_COLUMN) return blank(row[NUMBER_COLUMN]) ? null : String(row[NUMBER_COLUMN])
  if (k === STATUS_COLUMN) return blank(row[STATUS_COLUMN]) ? (t.status?.start ?? null) : String(row[STATUS_COLUMN])
  const c = t.columns.find((x) => x.key === k)
  if (!c) return null
  if (c.kind === 'computed') return blank(comp[k]) ? null : String(comp[k])
  const v = row[k]
  if (blank(v)) return null
  if (c.kind === 'yesno') return v === true ? 'yes' : 'no'
  if (c.kind === 'money') { const cur = row[`${k}_cur`]; return { amount: String(v), currency: blank(cur) ? null : String(cur) } }
  if (c.kind === 'ref') return refRows[k]?.find((x) => x.id === v)?.label ?? null
  return String(v)
}

export function buildSpecHttp(spec: Pick<AppSpec, 'name'>, t: SpecTable, s: SpecSend, rowId: string, row: Readonly<Record<string, unknown>>, today: string, refRows: RefRows): { app: string; table: string; send: string; rowId: string; data: Record<string, HttpValue> } {
  const comp = computeRow(t, row, today)
  const data: Record<string, HttpValue> = Object.fromEntries(Object.entries(s.map ?? {}).map(([out, k]) => [out, httpValueOf(t, k, row, comp, refRows)]))
  return { app: spec.name, table: t.key, send: s.key, rowId, data }
}

export const httpPrint = (body: unknown) => createHash('sha256').update(canonicalJson(body)).digest('hex').slice(0, 16)
export const httpIdemKey = (projectId: string, body: unknown) => createHash('sha256').update(`${projectId}\n${canonicalJson(body)}`).digest('hex').slice(0, 32)
export const httpRefKey = (s: Pick<SpecSend, 'table' | 'key'>, body: unknown, day: string) => `${s.table}:${s.key}:${httpPrint(body)}:${day}`

export function specHttpBlocked(t: SpecTable, s: SpecSend, row: Readonly<Record<string, unknown>>, confirmed: boolean, today: string): string | null {
  if (s.allowWhen?.confirmed && !confirmed) return `"${s.label}" is only for confirmed rows`
  return specSendBlocked(t, s, row, today)
}

export async function specHttpOpen(db: Parameters<typeof readSpec>[0], key: Buffer, q: { userId: string; projectId: string; rowId: string }, sp: { spec: AppSpec }, s: SpecSend, t: SpecTable, print: string, made: string): Promise<boolean> {
  const row = await db.dataSheetRow.findFirst({ where: { id: q.rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(t.key) } } })
  if (!row) return false
  const d = decodeRow(row, key)
  if (specHttpBlocked(t, s, d.data, d.confirmed === true, await accountToday(db, q.userId)) !== null) return false
  const body = buildSpecHttp(sp.spec, t, s, row.id, d.data, made, await readRefRows(db, key, q, t))
  return httpPrint(body) === print
}

export interface HttpCardResult {
  sendId: string
  status: 'card' | 'waiting' | 'sending'
  to: string
  values: Record<string, HttpValue>
}

export async function createSpecHttpCard(deps: WorkSheetDeps, q: { userId: string; projectId: string; by: SheetActor; taskId?: string | null }, sendKey: unknown, rowId: unknown, now: Date = new Date()): Promise<HttpCardResult> {
  const key = await deps.dataKey(deps.db, q.userId)
  return deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, q.userId, q.projectId)
    const p = await tx.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, status: true, workflowId: true, workflowLinkedAt: true } })
    if (!p || p.kind !== ASSEMBLED_KIND) throw new WorkError('NOT_FOUND')
    if (p.status !== 'active' || isProjectDetached(p) || !p.workflowId) throw new WorkError('READ_ONLY')
    const sp = await readSpec(tx, key, { userId: q.userId, projectId: q.projectId })
    const s = sp?.spec.sends?.find((x) => x.key === sendKey && x.via === 'http')
    if (!sp || !s) throw new WorkError('INVALID', `send must be one of ${(sp?.spec.sends ?? []).filter((x) => x.via === 'http').map((x) => x.key).join(', ') || '(no HTTP send in this app)'}`)
    const t = sp.spec.tables.find((x) => x.key === s.table)
    if (!t || t.hidden) throw new WorkError('NOT_FOUND', 'the table of this send is hidden')
    const row = typeof rowId === 'string' && rowId ? await tx.dataSheetRow.findFirst({ where: { id: rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(t.key), template: null } } }) : null
    if (!row) throw new WorkError('NOT_FOUND', `no row ${String(rowId)} in table "${t.key}"`)
    const declared = httpDeclared(s.key)
    const open = await tx.workSend.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'http', declared, ref: row.id, status: { in: ['pending', 'sending'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, status: true, claimedAt: true, payload: true } })
    const asIs = (id: string, payload: Uint8Array, status: HttpCardResult['status']): HttpCardResult => {
      const op = decryptJson<SendPayload>(payload, key)
      return { sendId: id, status, to: hostOf(op.to?.[0] ?? ''), values: ((op.json as { data?: Record<string, HttpValue> } | undefined)?.data) ?? {} }
    }
    const sending = open.find((o) => o.status === 'sending' && !!o.claimedAt && now.getTime() - o.claimedAt.getTime() <= SEND_SENDING_LIMIT_MS)
    if (sending) return asIs(sending.id, sending.payload, 'sending')
    const d = decodeRow(row, key)
    const today = await accountToday(tx, q.userId, now)
    const why = specHttpBlocked(t, s, d.data, d.confirmed === true, today)
    if (why) throw new WorkError('INVALID', why)
    const target = await slotHttpNow(tx, q.userId, p.workflowId, HTTP_SLOT)
    if (!target) throw new WorkError('INVALID', 'NO_ADDRESS — this app has no HTTP address yet; the owner sets it in the studio (Start / App node, slot "HTTP")')
    const body = buildSpecHttp(sp.spec, t, s, row.id, d.data, today, await readRefRows(tx, key, q, t))
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > HTTP_BODY_MAX) throw new WorkError('INVALID', `TOO_LARGE — the values of this row are over ${HTTP_BODY_MAX / 1024} KB; send fewer or shorter columns`)
    const idemKey = httpIdemKey(q.projectId, body)
    const pend = open.filter((o) => o.status === 'pending')
    const latest = pend[0]
    const keep = latest && (() => { const op = decryptJson<SendPayload>(latest.payload, key); return op.idemKey === idemKey && op.to?.[0] === target.url })() ? latest : null
    for (const o of pend) {
      if (o === keep) continue
      const r = await tx.workSend.updateMany({ where: { id: o.id, status: 'pending' }, data: { status: 'discarded', code: 'REPLACED', decidedBy: actorLabel(q.by), decidedAt: now } })
      if (r.count === 1) await writeWorkEvent(tx, key, { userId: q.userId, projectId: q.projectId, actor: q.by, action: 'send_discard', detail: { sendId: o.id, code: 'REPLACED' } })
    }
    if (keep) return asIs(keep.id, keep.payload, 'waiting')
    const payload: SendPayload = { to: [target.url], toHttpSlot: HTTP_SLOT, json: body, idemKey, refKey: httpRefKey(s, body, today) }
    const c = await createSendTx(tx, key, { userId: q.userId, projectId: q.projectId, taskId: q.taskId ?? null, workflowId: p.workflowId, kind: 'http', slot: HTTP_SLOT, declared, auto: false, payload, requestedBy: q.by, ref: row.id })
    return { sendId: c.id, status: 'card', to: hostOf(target.url), values: body.data }
  })
}

export async function httpSendRisk(db: WorkSheetDeps['db'], k: { userId: string; projectId: string; sendId: string }, now: Date = new Date()): Promise<{ code: 'SENDING_IN_PROGRESS' | 'DUPLICATE_RISK'; at?: Date } | null> {
  const me = await db.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { kind: true, declared: true, ref: true } })
  if (!me || me.kind !== 'http' || !isHttpDeclared(me.declared) || !me.ref) return null
  const others = await db.workSend.findMany({ where: { projectId: k.projectId, userId: k.userId, kind: 'http', declared: me.declared, ref: me.ref, id: { not: k.sendId }, status: { in: ['sending', 'unknown', 'failed'] } }, orderBy: { createdAt: 'desc' }, select: { status: true, claimedAt: true, createdAt: true } })
  const fresh = (c: { claimedAt: Date | null }) => !!c.claimedAt && now.getTime() - c.claimedAt.getTime() <= SEND_SENDING_LIMIT_MS
  if (others.some((o) => o.status === 'sending' && fresh(o))) return { code: 'SENDING_IN_PROGRESS' }
  const risky = others.find((o) => o.status !== 'sending' || !fresh(o))
  return risky ? { code: 'DUPLICATE_RISK', at: risky.createdAt } : null
}
