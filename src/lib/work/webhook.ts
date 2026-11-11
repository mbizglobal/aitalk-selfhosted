import { createHash } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import { newPublicToken, hashPublicToken, isPublicToken } from './public-links'
import { getAppBaseUrl } from '@/lib/app-url'
import { ASSEMBLED_KIND, readSpec, specSheetName, type SpecTable, type SpecWebhook } from './assembled'
import { assertProjectWritable, isProjectDetached, lockProjectForWrite, withProjectSheetWrite, type WorkSheetDeps } from './sheet-gate'
import { writeInboxSignal } from './signals'
import { INBOX_HOURLY_LIMIT } from './inbox'

export const WEBHOOK_PATH = '/api/hooks/'
export const WEBHOOK_DAILY_LIMIT = 200
export const WEBHOOK_BODY_LIMIT = 256 * 1024
export const WEBHOOK_ID_MAX = 200

type Deps = Pick<WorkSheetDeps, 'db' | 'dataKey'>

export function webhookUrl(token: string, env: Record<string, string | undefined> = process.env): string | null {
  try { return `${getAppBaseUrl(env).replace(/\/+$/, '')}${WEBHOOK_PATH}${token}` } catch { return null }
}

export interface WebhookShape { mode: 'flat' | 'map'; keys: string[]; map: Record<string, string> | null; id: string | null }
export interface WebhookView { tableKey: string; table: string; sheetId: string | null; url: string | null; createdAt: string | null; shape: WebhookShape }

function intakeKeys(t: SpecTable): string[] {
  const out: string[] = []
  for (const k of t.intake?.columns ?? []) {
    out.push(k)
    if (t.columns.find((c) => c.key === k)?.kind === 'money') out.push(`${k}_cur`)
  }
  return out
}

function shapeOf(t: SpecTable): WebhookShape {
  const w = t.intake?.webhook ?? {}
  return w.map ? { mode: 'map', keys: Object.keys(w.map), map: w.map, id: w.id ?? null } : { mode: 'flat', keys: intakeKeys(t), map: null, id: null }
}

export async function listWebhooks(deps: Deps, q: { userId: string; projectId: string }): Promise<WebhookView[]> {
  const key = await deps.dataKey(deps.db, q.userId)
  const spec = await readSpec(deps.db, key, q)
  const tables = (spec?.spec.tables ?? []).filter((t) => t.intake?.webhook && !t.hidden)
  if (!tables.length) return []
  const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, template: null, name: { in: tables.map((t) => specSheetName(t.key)) } }, select: { id: true, name: true } })
  const hooks = await deps.db.workWebhookHook.findMany({ where: { userId: q.userId, projectId: q.projectId, revokedAt: null, tableKey: { in: tables.map((t) => t.key) } }, orderBy: { createdAt: 'desc' } })
  return tables.map((t) => {
    const h = hooks.find((x) => x.tableKey === t.key)
    let url: string | null = null
    if (h) { try { url = webhookUrl(decryptJson<{ token: string }>(Buffer.from(h.tokenSealed), key).token) } catch { url = null } }
    return { tableKey: t.key, table: t.name, sheetId: sheets.find((s) => s.name === specSheetName(t.key))?.id ?? null, url, createdAt: h?.createdAt.toISOString() ?? null, shape: shapeOf(t) }
  })
}

export async function createWebhook(deps: Deps, q: { userId: string; projectId: string; tableKey: string }): Promise<{ url: string | null }> {
  const key = await deps.dataKey(deps.db, q.userId)
  const { token, hash } = newPublicToken()
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, q.userId, q.projectId))
    const spec = await readSpec(tx as unknown as PrismaClient, key, q)
    const t = spec?.spec.tables.find((x) => x.key === q.tableKey)
    if (!t || t.hidden || !t.intake?.webhook) throw new WorkError('INVALID', 'this table does not take rows from a webhook — set intake.webhook in the app spec first')
    await tx.workWebhookHook.updateMany({ where: { userId: q.userId, projectId: q.projectId, tableKey: q.tableKey, revokedAt: null }, data: { revokedAt: new Date() } })
    await tx.workWebhookHook.create({ data: { userId: q.userId, projectId: q.projectId, tableKey: q.tableKey, tokenHash: hash, tokenSealed: encryptJson({ token }, key) } })
  })
  return { url: webhookUrl(token) }
}

export async function revokeWebhook(deps: Deps, q: { userId: string; projectId: string; tableKey: string }): Promise<number> {
  return deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, q.userId, q.projectId)
    const r = await tx.workWebhookHook.updateMany({ where: { userId: q.userId, projectId: q.projectId, tableKey: q.tableKey, revokedAt: null }, data: { revokedAt: new Date() } })
    return r.count
  })
}

const own = (o: unknown, k: string): o is Record<string, unknown> => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)

export function readPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const part of path.split('.')) {
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d{0,5})$/.test(part)) return undefined
      const i = Number(part)
      if (i >= cur.length) return undefined
      cur = cur[i]
    } else if (cur && typeof cur === 'object') {
      if (!own(cur, part)) return undefined
      cur = cur[part]
    } else return undefined
  }
  return cur
}

export function webhookIdOf(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim()
    return s && s.length <= WEBHOOK_ID_MAX ? s : null
  }
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v)
  return null
}

export type WebhookExtract = { ok: true; values: Record<string, unknown>; id: string | null } | { ok: false; detail: string }

export function extractWebhook(t: SpecTable, w: SpecWebhook, body: unknown, headerId: string | null): WebhookExtract {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, detail: 'the body must be a JSON object' }
  const hraw = headerId?.trim() ? headerId : null
  const hid = hraw === null ? null : webhookIdOf(hraw)
  if (hraw !== null && hid === null) return { ok: false, detail: `the Idempotency-Key header is longer than ${WEBHOOK_ID_MAX} characters` }
  const values: Record<string, unknown> = {}
  const scalar = (v: unknown) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
  if (!w.map) {
    const allowed = new Set(intakeKeys(t))
    const b = body as Record<string, unknown>
    const outside = Object.keys(b).filter((k) => !allowed.has(k))
    if (outside.length) return { ok: false, detail: `only these keys can be sent: ${[...allowed].join(', ')} — not ${outside.slice(0, 10).join(', ')}` }
    for (const k of Object.keys(b)) {
      if (!scalar(b[k])) return { ok: false, detail: `"${k}" must be text, a number, true / false or null — not a list or an object` }
      values[k] = b[k]
    }
    return { ok: true, values, id: hid }
  }
  for (const [col, path] of Object.entries(w.map)) {
    const v = readPath(body, path)
    if (v === undefined) continue
    if (!scalar(v)) return { ok: false, detail: `"${path}" (for ${col}) must be text, a number, true / false or null — not a list or an object` }
    values[col] = v
  }
  let id: string | null = null
  if (w.id) {
    id = webhookIdOf(readPath(body, w.id)) ?? hid
    if (id === null) return { ok: false, detail: `no usable request id at "${w.id}" (text up to ${WEBHOOK_ID_MAX} characters, or a whole number up to 9007199254740991 — send larger numbers as text) and no Idempotency-Key header` }
  } else id = hid
  return { ok: true, values, id }
}

const idHash = (id: string) => createHash('sha256').update(id, 'utf8').digest('hex')

export type WebhookResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'LIMIT' | 'RATE' | 'TAKEN' }
  | { ok: false; code: 'INVALID'; detail: string }

class WebhookLimit extends Error {}
class WebhookDuplicate extends Error {}
class WebhookInvalid extends Error {}

const isReceiptClash = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && (
  e.meta?.modelName === 'WorkWebhookReceipt' || JSON.stringify(e.meta?.target ?? '').includes('key_hash'))

export interface WebhookTestHooks { afterReceiptCheck?: () => Promise<void> }

export async function addWebhookRow(deps: WorkSheetDeps, input: { token: unknown; body: unknown; headerId: string | null }, test?: WebhookTestHooks): Promise<WebhookResult> {
  if (!isPublicToken(input.token)) return { ok: false, code: 'NOT_FOUND' }
  const hook = await deps.db.workWebhookHook.findUnique({ where: { tokenHash: hashPublicToken(input.token) }, select: { id: true, userId: true, projectId: true, tableKey: true, revokedAt: true } })
  if (!hook || hook.revokedAt) return { ok: false, code: 'NOT_FOUND' }
  const p = await deps.db.workProject.findFirst({ where: { id: hook.projectId, userId: hook.userId }, select: { kind: true, status: true, workflowId: true, workflowLinkedAt: true } })
  if (!p || p.kind !== ASSEMBLED_KIND || p.status !== 'active' || isProjectDetached(p)) return { ok: false, code: 'NOT_FOUND' }
  const name = specSheetName(hook.tableKey)
  const sheet = await deps.db.dataSheet.findFirst({ where: { kind: 'project', projectId: hook.projectId, userId: hook.userId, name, template: null }, select: { id: true } })
  if (!sheet) return { ok: false, code: 'NOT_FOUND' }
  if (!allowWebhookCall(hook.id)) return { ok: false, code: 'RATE' }
  const key = await deps.dataKey(deps.db, hook.userId)
  let invalid = ''
  let receipt = false
  try {
    await withProjectSheetWrite(deps, { userId: hook.userId, projectId: hook.projectId, sheetIds: [sheet.id], actor: { type: 'webhook', hookId: hook.id } }, async (w) => {
      const t = await w.withTx(async (tx) => {
        const h = await tx.workWebhookHook.findUnique({ where: { id: hook.id }, select: { revokedAt: true } })
        if (!h || h.revokedAt) return null
        const spec = await readSpec(tx as unknown as PrismaClient, key, { userId: hook.userId, projectId: hook.projectId })
        const x = spec?.spec.tables.find((y) => y.key === hook.tableKey)
        return x && !x.hidden && x.intake?.webhook ? x : null
      })
      if (!t) throw new WorkError('NOT_FOUND')
      const ex = extractWebhook(t, t.intake!.webhook!, input.body, input.headerId)
      if (!ex.ok) { invalid = ex.detail; throw new WebhookInvalid() }
      const kh = ex.id === null ? null : idHash(ex.id)
      if (kh && await w.withTx((tx) => tx.workWebhookReceipt.findUnique({ where: { hookId_keyHash: { hookId: hook.id, keyHash: kh } }, select: { id: true } }))) throw new WebhookDuplicate()
      await test?.afterReceiptCheck?.()
      if ((await w.countChannelInserts(new Date(Date.now() - 3600_000))) >= INBOX_HOURLY_LIMIT) throw new WebhookLimit()
      if ((await w.countWebhookInserts(hook.id, new Date(Date.now() - 24 * 3600_000))) >= WEBHOOK_DAILY_LIMIT) throw new WebhookLimit()
      const row = await w.insert(sheet.id, ex.values)
      if (kh) { receipt = true; await w.withTx((tx) => tx.workWebhookReceipt.create({ data: { hookId: hook.id, keyHash: kh, rowId: row.id } })) }
      await w.withTx((tx) => writeInboxSignal(tx, key, { userId: hook.userId, projectId: hook.projectId, title: name, rowId: row.id, family: name }))
    })
    return { ok: true, duplicate: false }
  } catch (e) {
    if (e instanceof WebhookDuplicate || (receipt && isReceiptClash(e))) return { ok: true, duplicate: true }
    if (e instanceof WebhookInvalid) return { ok: false, code: 'INVALID', detail: invalid }
    if (e instanceof WebhookLimit) return { ok: false, code: 'LIMIT' }
    if (e instanceof WorkError) {
      if (e.code === 'CHECK_FAILED') return { ok: false, code: 'TAKEN' }
      if (e.code === 'INVALID' || e.code === 'DUPLICATE') return { ok: false, code: 'INVALID', detail: e.message }
      if (e.code === 'NOT_FOUND' || e.code === 'READ_ONLY' || e.code === 'APP_CLOSED' || e.code === 'LOCKED' || e.code === 'FORBIDDEN') return { ok: false, code: 'NOT_FOUND' }
    }
    throw e
  }
}

const HOOK_WINDOW_MS = 60_000
export const WEBHOOK_PER_MINUTE = 120
const HOOK_MAX_KEYS = 20_000
const hookHits = new Map<string, number[]>()

export function allowWebhookCall(hookId: string, now: number = Date.now()): boolean {
  const k = hookId
  const list = (hookHits.get(k) ?? []).filter((t) => now - t < HOOK_WINDOW_MS)
  if (list.length >= WEBHOOK_PER_MINUTE) { hookHits.set(k, list); return false }
  if (!hookHits.has(k) && hookHits.size >= HOOK_MAX_KEYS) {
    for (const [x, v] of hookHits) if (v.every((t) => now - t >= HOOK_WINDOW_MS)) hookHits.delete(x)
    if (hookHits.size >= HOOK_MAX_KEYS) return true
  }
  list.push(now)
  hookHits.set(k, list)
  return true
}
export function __resetWebhookLimiter(): void { hookHits.clear() }
