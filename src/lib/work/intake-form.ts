import { createHmac, timingSafeEqual } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import { newPublicToken, hashPublicToken, isPublicToken } from './public-links'
import { getAppBaseUrl } from '@/lib/app-url'
import { ASSEMBLED_KIND, readSpec, specSheetName, type SpecColumn } from './assembled'
import { assertProjectWritable, isProjectDetached, lockProjectForWrite, withProjectSheetWrite, type WorkSheetDeps } from './sheet-gate'
import { writeInboxSignal } from './signals'
import { INBOX_HOURLY_LIMIT } from './inbox'

export const INTAKE_FORM_PATH = '/f/'
export const INTAKE_LINK_DAILY_LIMIT = 200
export const INTAKE_MIN_FILL_MS = 3_000
export const INTAKE_MAX_FILL_MS = 2 * 3600_000
export const INTAKE_BODY_LIMIT = 32 * 1024

type Deps = Pick<WorkSheetDeps, 'db' | 'dataKey'>

export function intakeFormUrl(token: string, env: Record<string, string | undefined> = process.env): string | null {
  try { return `${getAppBaseUrl(env).replace(/\/+$/, '')}${INTAKE_FORM_PATH}${token}` } catch { return null }
}

export interface IntakeLinkView { tableKey: string; table: string; sheetId: string | null; url: string | null; createdAt: string | null }

export async function listIntakeLinks(deps: Deps, q: { userId: string; projectId: string }): Promise<IntakeLinkView[]> {
  const key = await deps.dataKey(deps.db, q.userId)
  const spec = await readSpec(deps.db, key, q)
  const tables = (spec?.spec.tables ?? []).filter((t) => t.intake?.form && !t.hidden)
  if (!tables.length) return []
  const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, template: null, name: { in: tables.map((t) => specSheetName(t.key)) } }, select: { id: true, name: true } })
  const links = await deps.db.workIntakeLink.findMany({ where: { userId: q.userId, projectId: q.projectId, revokedAt: null, tableKey: { in: tables.map((t) => t.key) } }, orderBy: { createdAt: 'desc' } })
  return tables.map((t) => {
    const l = links.find((x) => x.tableKey === t.key)
    let url: string | null = null
    if (l) { try { url = intakeFormUrl(decryptJson<{ token: string }>(Buffer.from(l.tokenSealed), key).token) } catch { url = null } }
    return { tableKey: t.key, table: t.name, sheetId: sheets.find((s) => s.name === specSheetName(t.key))?.id ?? null, url, createdAt: l?.createdAt.toISOString() ?? null }
  })
}

export async function createIntakeLink(deps: Deps, q: { userId: string; projectId: string; tableKey: string }): Promise<{ url: string | null }> {
  const key = await deps.dataKey(deps.db, q.userId)
  const { token, hash } = newPublicToken()
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, q.userId, q.projectId))
    const spec = await readSpec(tx as unknown as PrismaClient, key, q)
    const t = spec?.spec.tables.find((x) => x.key === q.tableKey)
    if (!t || t.hidden || !t.intake?.form) throw new WorkError('INVALID', 'this table does not take rows from a public page — set intake.form in the app spec first')
    await tx.workIntakeLink.updateMany({ where: { userId: q.userId, projectId: q.projectId, tableKey: q.tableKey, revokedAt: null }, data: { revokedAt: new Date() } })
    await tx.workIntakeLink.create({ data: { userId: q.userId, projectId: q.projectId, tableKey: q.tableKey, tokenHash: hash, tokenSealed: encryptJson({ token }, key) } })
  })
  return { url: intakeFormUrl(token) }
}

export async function revokeIntakeLink(deps: Deps, q: { userId: string; projectId: string; tableKey: string }): Promise<number> {
  return deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, q.userId, q.projectId)
    const r = await tx.workIntakeLink.updateMany({ where: { userId: q.userId, projectId: q.projectId, tableKey: q.tableKey, revokedAt: null }, data: { revokedAt: new Date() } })
    return r.count
  })
}

export interface IntakePage {
  linkId: string
  app: string
  table: string
  columns: Array<Pick<SpecColumn, 'key' | 'label' | 'kind' | 'options' | 'required' | 'hint'>>
  opened: string
}

interface LiveLink { id: string; userId: string; projectId: string; tableKey: string }

async function liveLink(deps: Deps, token: unknown): Promise<{ link: LiveLink; key: Buffer; table: NonNullable<Awaited<ReturnType<typeof readSpec>>>['spec']['tables'][number]; app: string } | null> {
  if (!isPublicToken(token)) return null
  const link = await deps.db.workIntakeLink.findUnique({ where: { tokenHash: hashPublicToken(token) }, select: { id: true, userId: true, projectId: true, tableKey: true, revokedAt: true } })
  if (!link || link.revokedAt) return null
  const p = await deps.db.workProject.findFirst({ where: { id: link.projectId, userId: link.userId }, select: { kind: true, status: true, workflowId: true, workflowLinkedAt: true } })
  if (!p || p.kind !== ASSEMBLED_KIND || p.status !== 'active' || isProjectDetached(p)) return null
  const key = await deps.dataKey(deps.db, link.userId)
  const spec = await readSpec(deps.db, key, { userId: link.userId, projectId: link.projectId })
  const table = spec?.spec.tables.find((t) => t.key === link.tableKey)
  if (!spec || !table || table.hidden || !table.intake?.form) return null
  return { link, key, table, app: spec.spec.name }
}

const openKey = (key: Buffer) => createHmac('sha256', key).update('aitalk-intake-open@1').digest()
export function signOpened(key: Buffer, linkId: string, at: number = Date.now()): string {
  return `${at}.${createHmac('sha256', openKey(key)).update(`${linkId}.${at}`).digest('base64url')}`
}
export function checkOpened(key: Buffer, linkId: string, sig: unknown, now: number = Date.now()): 'OK' | 'BAD' | 'TOO_SOON' | 'EXPIRED' {
  if (typeof sig !== 'string' || sig.length > 100) return 'BAD'
  const m = /^(\d{10,15})\.([A-Za-z0-9_-]{43})$/.exec(sig)
  if (!m) return 'BAD'
  const want = Buffer.from(signOpened(key, linkId, Number(m[1])).split('.')[1])
  const got = Buffer.from(m[2])
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'BAD'
  const age = now - Number(m[1])
  if (age < INTAKE_MIN_FILL_MS) return 'TOO_SOON'
  if (age > INTAKE_MAX_FILL_MS) return 'EXPIRED'
  return 'OK'
}

export async function resolveIntakePage(deps: Deps, token: unknown): Promise<IntakePage | null> {
  const live = await liveLink(deps, token)
  if (!live) return null
  const { link, key, table, app } = live
  const columns = table.intake!.columns.map((k) => table.columns.find((c) => c.key === k)).filter((c): c is SpecColumn => !!c)
    .map((c) => ({ key: c.key, label: c.label, kind: c.kind, ...(c.options ? { options: c.options } : {}), ...(c.required ? { required: true } : {}), ...(c.hint ? { hint: c.hint } : {}) }))
  return { linkId: link.id, app, table: table.name, columns, opened: signOpened(key, link.id) }
}

export type IntakeSubmitResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'LIMIT' | 'TOO_SOON' | 'EXPIRED' | 'TAKEN' }
  | { ok: false; code: 'INVALID'; detail: string }

class IntakeLimit extends Error {}

export async function addIntakeFormRow(deps: WorkSheetDeps, input: { token: unknown; values: unknown; opened: unknown; trap: unknown }): Promise<IntakeSubmitResult> {
  if (typeof input.trap === 'string' ? input.trap.trim() !== '' : input.trap !== undefined && input.trap !== null) return { ok: true }
  if (!isPublicToken(input.token)) return { ok: false, code: 'NOT_FOUND' }
  const pre = await deps.db.workIntakeLink.findUnique({ where: { tokenHash: hashPublicToken(input.token) }, select: { id: true, userId: true, revokedAt: true } })
  if (!pre || pre.revokedAt) return { ok: false, code: 'NOT_FOUND' }
  const sig = checkOpened(await deps.dataKey(deps.db, pre.userId), pre.id, input.opened)
  if (sig === 'TOO_SOON') return { ok: false, code: 'TOO_SOON' }
  if (sig !== 'OK') return { ok: false, code: 'EXPIRED' }
  const live = await liveLink(deps, input.token)
  if (!live || live.link.id !== pre.id) return { ok: false, code: 'NOT_FOUND' }
  const { link, key } = live
  if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)) return { ok: false, code: 'INVALID', detail: 'values must be an object of column keys' }
  const name = specSheetName(link.tableKey)
  const sheet = await deps.db.dataSheet.findFirst({ where: { kind: 'project', projectId: link.projectId, userId: link.userId, name, template: null }, select: { id: true } })
  if (!sheet) return { ok: false, code: 'NOT_FOUND' }
  try {
    await withProjectSheetWrite(deps, { userId: link.userId, projectId: link.projectId, sheetIds: [sheet.id], actor: { type: 'intake_form', linkId: link.id } }, async (w) => {
      const still = await w.withTx(async (tx) => {
        const l = await tx.workIntakeLink.findUnique({ where: { id: link.id }, select: { revokedAt: true } })
        if (!l || l.revokedAt) return false
        const spec = await readSpec(tx as unknown as PrismaClient, key, { userId: link.userId, projectId: link.projectId })
        const t = spec?.spec.tables.find((x) => x.key === link.tableKey)
        return !!t && !t.hidden && !!t.intake?.form
      })
      if (!still) throw new WorkError('NOT_FOUND')
      if ((await w.countChannelInserts(new Date(Date.now() - 3600_000))) >= INBOX_HOURLY_LIMIT) throw new IntakeLimit()
      if ((await w.countIntakeFormInserts(link.id, new Date(Date.now() - 24 * 3600_000))) >= INTAKE_LINK_DAILY_LIMIT) throw new IntakeLimit()
      const row = await w.insert(sheet.id, input.values as Record<string, unknown>)
      await w.withTx((tx) => writeInboxSignal(tx, key, { userId: link.userId, projectId: link.projectId, title: name, rowId: row.id, family: name }))
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof IntakeLimit) return { ok: false, code: 'LIMIT' }
    if (e instanceof WorkError) {
      if (e.code === 'CHECK_FAILED') return { ok: false, code: 'TAKEN' }
      if (e.code === 'INVALID' || e.code === 'DUPLICATE') return { ok: false, code: 'INVALID', detail: e.message }
      if (e.code === 'NOT_FOUND' || e.code === 'READ_ONLY' || e.code === 'APP_CLOSED' || e.code === 'LOCKED' || e.code === 'FORBIDDEN') return { ok: false, code: 'NOT_FOUND' }
    }
    throw e
  }
}

const IP_WINDOW_MS = 10 * 60_000
const IP_LIMIT = 10
const IP_MAX_KEYS = 20_000
const ipHits = new Map<string, number[]>()

export function allowIntakeSubmit(ip: string | null, now: number = Date.now()): boolean {
  const k = ip ?? 'unknown'
  const list = (ipHits.get(k) ?? []).filter((t) => now - t < IP_WINDOW_MS)
  if (list.length >= IP_LIMIT) { ipHits.set(k, list); return false }
  if (!ipHits.has(k) && ipHits.size >= IP_MAX_KEYS) {
    for (const [x, v] of ipHits) if (v.every((t) => now - t >= IP_WINDOW_MS)) ipHits.delete(x)
    if (ipHits.size >= IP_MAX_KEYS) return true
  }
  list.push(now)
  ipHits.set(k, list)
  return true
}
export function __resetIntakeIpLimiter(): void { ipHits.clear() }
