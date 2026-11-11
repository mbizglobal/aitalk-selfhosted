
import { Prisma, type PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { sendLinesOf, type AppIdOf } from './reference-lines'
import { APP_WORKFLOW_KIND, isAppCanvas, isWorkAppRow } from './app-canvas'
import { familySheets, inboxTargetReason, resolveInbox } from './inbox'
import { writeWorkNotice } from './notices'
import { decodeRow, isProjectDetached, lockProjectForWrite, openProjectSheetWriter, sheetMeta, actorLabel, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { ASSEMBLED_KIND, readSpec, specSheetName } from './assembled'
import {
  APP_SEND_HOLD, appSendBlocked, appSendColumns, appSendLineOpen, appSendRowProblem, appSendSlot, appSendSourceRow, appSendTarget, appSendTargetProblem,
  buildAppSendRow, liveAppSend, sameAppSendRow,
} from './assembled-send'
import { validateTemplateRegistry } from './sheet-templates'
import { writeInboxSignal } from './signals'
import { writeWorkEvent } from './projects'
import { APP_SEND_CARD_BURST, createSend, type AppSendCard, type SendPayload, type SendStatus } from './sends'
import { decryptJson, encryptJson } from './sealed'
import type { V3Registry } from './v3-handles'
import type { WorkFileDeps } from './files'

type Tx = Prisma.TransactionClient

export const APP_SEND_MAX_ROWS = 20
export const APP_SEND_HOURLY_LIMIT = 200
export const APP_SEND_ROW_MAX_CHARS = 20_000
export { APP_SEND_CARD_BURST }

export interface SendRoute {
  toWorkflowId: string
  family: string
  lineWorkflowIds: string[]
}

const routeKey = (to: string, family: string) => `${to}\0${family}`

export async function findSendRoutes(db: Pick<PrismaClient, 'workflow'> | Tx, userId: string, fromWorkflowId: string): Promise<SendRoute[]> {
  const wfs = await db.workflow.findMany({
    where: { status: 'production', kind: 'main', agent: { userId } },
    select: { workflowId: true, workflowJson: true },
    orderBy: { workflowId: 'asc' },
  })
  return routesFrom(wfs, fromWorkflowId, await canvasAppIds(db, wfs))
}

async function canvasAppIds(db: Pick<PrismaClient, 'workflow'> | Tx, wfs: Array<{ workflowId: string; workflowJson: string }>): Promise<Map<string, AppIdOf>> {
  const canvases = wfs.filter((w) => isAppCanvas(w.workflowJson)).map((w) => w.workflowId)
  const out = new Map<string, AppIdOf>()
  if (!canvases.length) return out
  const rows = await db.workflow.findMany({ where: { parentWorkflowId: { in: canvases }, kind: APP_WORKFLOW_KIND, status: 'production' }, select: { workflowId: true, parentWorkflowId: true, parentNodeId: true } })
  for (const c of canvases) {
    const m = new Map(rows.filter((r) => r.parentWorkflowId === c && r.parentNodeId).map((r) => [r.parentNodeId as string, r.workflowId]))
    out.set(c, (nodeId) => m.get(nodeId))
  }
  return out
}

function routesFrom(wfs: Array<{ workflowId: string; workflowJson: string }>, fromWorkflowId: string, appIds: Map<string, AppIdOf>): SendRoute[] {
  const map = new Map<string, SendRoute>()
  for (const w of wfs) {
    for (const l of sendLinesOf(w.workflowJson, appIds.get(w.workflowId)).lines) {
      if (l.fromWorkflowId !== fromWorkflowId || !l.family) continue
      const k = routeKey(l.toWorkflowId, l.family)
      const r = map.get(k) ?? { toWorkflowId: l.toWorkflowId, family: l.family, lineWorkflowIds: [] }
      if (!r.lineWorkflowIds.includes(w.workflowId)) r.lineWorkflowIds.push(w.workflowId)
      map.set(k, r)
    }
  }
  return [...map.values()]
}

export async function sendLineProblems(tx: Tx, userId: string, workflowJson: unknown, registry?: V3Registry, parentWorkflowId?: string): Promise<Array<{ edgeId: string; reason: string }>> {
  const hidden = parentWorkflowId && isAppCanvas(workflowJson)
    ? new Map((await tx.workflow.findMany({ where: { parentWorkflowId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true, parentNodeId: true } })).map((r) => [r.parentNodeId as string, r.workflowId]))
    : null
  const { lines, problems } = sendLinesOf(workflowJson, hidden ? (nodeId) => hidden.get(nodeId) : undefined)
  const out = problems.map((p) => ({ edgeId: p.edgeId, reason: p.message }))
  for (const l of lines) {
    if (!l.family) { out.push({ edgeId: l.edgeId, reason: 'choose the inbox of the receiving work app' }); continue }
    const from = await tx.workflow.findFirst({ where: { workflowId: l.fromWorkflowId, kind: { in: ['main', APP_WORKFLOW_KIND] }, agent: { userId } }, select: { kind: true, workflowJson: true } })
    const fromProject = from && isWorkAppRow(from) ? await tx.workProject.findFirst({ where: { workflowId: l.fromWorkflowId, userId }, select: { id: true } }) : null
    if (!from || !fromProject) { out.push({ edgeId: l.edgeId, reason: 'the sending work app does not exist in this account or was never opened' }); continue }
    const reason = await inboxTargetReason(tx, userId, l.toWorkflowId, l.family, registry, { appSend: true })
    if (reason) out.push({ edgeId: l.edgeId, reason: `receiving work app: ${reason}` })
  }
  return out
}

export interface SendRouteView {
  route: string
  toName: string
  sheetName: string
  columns: Array<{ name: string; type: string; required?: boolean; values?: readonly string[] }>
}

export const appSendRouteName = (r: Pick<SendRoute, 'toWorkflowId' | 'family'>) => `${r.toWorkflowId}:${r.family}`

export async function sendRouteViews(deps: WorkSheetDeps, userId: string, fromWorkflowId: string, registry?: V3Registry): Promise<SendRouteView[]> {
  const out: SendRouteView[] = []
  for (const r of await findSendRoutes(deps.db, userId, fromWorkflowId)) {
    const t = await resolveInbox(deps, { userId, targetWorkflowId: r.toWorkflowId, family: r.family, registry })
    if (!t) continue
    const sheet = (await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: t.projectId, userId, templateFamily: r.family }, select: { id: true, name: true, schema: true, template: true, templateFamily: true }, orderBy: { id: 'asc' }, take: 1 }))[0]
    if (!sheet) continue
    const meta = sheetMeta(sheet, deps.templates)
    const hidden = new Set([...(meta.template?.ui?.hidden ?? []), t.decl.identify.column])
    const wf = await deps.db.workflow.findUnique({ where: { workflowId: r.toWorkflowId }, select: { name: true } })
    out.push({
      route: appSendRouteName(r),
      toName: wf?.name ?? r.toWorkflowId,
      sheetName: sheet.name,
      columns: meta.schema.columns.filter((c) => !hidden.has(c.name)).map((c) => ({
        name: c.name, type: c.type, ...(c.required ? { required: true } : {}),
        ...(meta.template?.ui?.options?.[c.name] ? { values: meta.template.ui.options[c.name] } : {}),
      })),
    })
  }
  return out
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim())

export function normalizeAppSendRows(rows: unknown, identifyColumn: string): Array<Record<string, unknown>> {
  if (!Array.isArray(rows) || rows.length === 0) throw new WorkError('INVALID', 'rows must be a list of 1 or more rows')
  if (rows.length > APP_SEND_MAX_ROWS) throw new WorkError('INVALID', `at most ${APP_SEND_MAX_ROWS} rows per card — send the rest on another card`)
  return rows.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new WorkError('INVALID', `row ${i + 1} must be an object of column names`)
    const row: Record<string, unknown> = { ...(r as Record<string, unknown>) }
    delete row[identifyColumn]
    if (Object.values(row).every(isBlank)) throw new WorkError('INVALID', `row ${i + 1} has no values`)
    if (JSON.stringify(row).length > APP_SEND_ROW_MAX_CHARS) throw new WorkError('INVALID', `row ${i + 1} is too large`)
    return row
  })
}

export interface AppSendScope {
  deps: WorkSheetDeps
  userId: string
  projectId: string
  workflowId: string
  caller: SheetActor
  taskId?: string | null
  registry?: V3Registry
}

export async function createAppSendCard(s: AppSendScope, route: unknown, rows: unknown): Promise<{ sendId: string; status: 'card'; rows: number }> {
  if (typeof route !== 'string' || !route) throw new WorkError('INVALID', 'route is required')
  const r = (await findSendRoutes(s.deps.db, s.userId, s.workflowId)).find((x) => appSendRouteName(x) === route)
  if (!r) throw new WorkError('INVALID', 'ROUTE_GONE — this work app has no send line to that inbox')
  const t = await resolveInbox(s.deps, { userId: s.userId, targetWorkflowId: r.toWorkflowId, family: r.family, registry: s.registry })
  if (!t) throw new WorkError('UNAVAILABLE', 'the receiving work app cannot take rows now')
  const sheets = await familySheets(s.deps, s.userId, t.projectId, r.family)
  if (!sheets.length) throw new WorkError('UNAVAILABLE', 'the receiving work app has no inbox sheet')
  const list = normalizeAppSendRows(rows, t.decl.identify.column)
  const wf = await s.deps.db.workflow.findUnique({ where: { workflowId: r.toWorkflowId }, select: { name: true } })
  const card: AppSendCard = { toWorkflowId: r.toWorkflowId, family: r.family, toLabel: `${wf?.name ?? r.toWorkflowId} · ${sheets[0].name}`, rows: list }
  const sent = await createSend(s.deps, {
    userId: s.userId, projectId: s.projectId, taskId: s.taskId ?? null, workflowId: s.workflowId,
    kind: 'work_app', slot: appSendRouteName(r), auto: false, payload: { appSend: card }, requestedBy: s.caller, maxPending: APP_SEND_CARD_BURST,
  })
  return { sendId: sent.id, status: 'card', rows: list.length }
}

export async function sendAppNow(deps: WorkSheetDeps, s: { userId: string; projectId: string; by: SheetActor }, p: { family: string; rows: unknown; toProjectId?: string }): Promise<{ sent: boolean; rows: number; code?: string; setup?: string }> {
  if (s.by.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person sends from a button')
  const proj = await deps.db.workProject.findFirst({ where: { id: s.projectId, userId: s.userId }, select: { workflowId: true } })
  if (!proj?.workflowId) return { sent: false, rows: 0, setup: 'this work app is not linked to a workflow' }
  const routes = (await findSendRoutes(deps.db, s.userId, proj.workflowId)).filter((r) => r.family === p.family)
  if (routes.length !== 1) return { sent: false, rows: 0, setup: routes.length ? 'several send lines to that inbox — keep one' : `no send line from this work app to an app inbox ${p.family} — the owner draws it on the canvas` }
  if (p.toProjectId !== undefined && (await resolveInbox(deps, { userId: s.userId, targetWorkflowId: routes[0].toWorkflowId, family: p.family }))?.projectId !== p.toProjectId) return { sent: false, rows: 0, setup: 'the send line goes to another app than the one this work app reads decisions from' }
  const card = await createAppSendCard({ deps, userId: s.userId, projectId: s.projectId, workflowId: proj.workflowId, caller: s.by, taskId: null }, appSendRouteName(routes[0]), p.rows)
  const r = await executeAppSend(deps, { userId: s.userId, projectId: s.projectId, sendId: card.sendId }, s.by)
  await (await import('./send-report')).reportSendResult(deps as WorkFileDeps, { userId: s.userId, projectId: s.projectId, sendId: card.sendId, by: s.by })
  return { sent: r.status === 'sent', rows: card.rows, ...(r.code ? { code: r.code } : {}) }
}

export async function createAssembledSendCard(deps: WorkSheetDeps, q: { userId: string; projectId: string; by: SheetActor; taskId?: string | null }, sendKey: unknown, rowId: unknown): Promise<{ sendId: string; status: 'card'; row: Record<string, unknown>; toLabel: string }> {
  const key = await deps.dataKey(deps.db, q.userId)
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, status: true, workflowId: true, workflowLinkedAt: true } })
  if (!p || p.kind !== ASSEMBLED_KIND) throw new WorkError('NOT_FOUND')
  if (p.status !== 'active' || isProjectDetached(p) || !p.workflowId) throw new WorkError('READ_ONLY')
  const sp = await readSpec(deps.db, key, { userId: q.userId, projectId: q.projectId })
  const s = sp?.spec.appSends?.find((x) => x.key === sendKey)
  if (!sp || !s || !liveAppSend(sp.spec, s)) throw new WorkError('INVALID', `send must be one of ${(sp?.spec.appSends ?? []).filter((x) => liveAppSend(sp!.spec, x)).map((x) => x.key).join(', ') || '(none in this app)'}`)
  const at = sp.spec.tables.find((t) => t.key === s.table)!
  const row = await appSendSourceRow(deps.db, { userId: q.userId, projectId: q.projectId, table: s.table, rowId: String(rowId ?? '') })
  if (!row) throw new WorkError('NOT_FOUND', `no row ${String(rowId)} in table "${s.table}"`)
  const data = decodeRow(row, key).data
  const blocked = appSendBlocked(at, s, data, row.confirmed === true)
  if (blocked) throw new WorkError('INVALID', blocked)
  const b = await appSendTarget(deps.db, key, { userId: q.userId, toProjectId: s.to.app })
  const why = b ? appSendTargetProblem(b.spec, at, s) : 'that app is not an open assembled app'
  if (why || !b) throw new WorkError('UNAVAILABLE', `"${s.label}": ${why}`)
  if (!(await appSendLineOpen(deps.db, { userId: q.userId, fromWorkflowId: p.workflowId, toWorkflowId: b.workflowId, table: s.to.table }))) throw new WorkError('INVALID', `ROUTE_GONE — "${s.label}" needs a send line on the canvas from this app to that app with "${s.to.table}" as its inbox`)
  const bt = b.spec.tables.find((t) => t.key === s.to.table)!
  const values = buildAppSendRow(at, s, data)
  const bad = appSendRowProblem(bt, values)
  if (bad) throw new WorkError('INVALID', bad)
  const slot = appSendSlot(s.key)
  const held = async () => {
    const h = await deps.db.workSend.findFirst({ where: { projectId: q.projectId, userId: q.userId, kind: 'work_app', slot, ref: row.id, status: { in: [...APP_SEND_HOLD] } }, select: { status: true } })
    return h ? new WorkError('INVALID', h.status === 'sent' ? `ALREADY_SENT — this row already went with "${s.label}"` : `CARD_WAITING — a card for this row with "${s.label}" is already waiting`) : null
  }
  const first = await held()
  if (first) throw first
  const wf = await deps.db.workflow.findUnique({ where: { workflowId: b.workflowId }, select: { name: true } })
  const card: AppSendCard = { toWorkflowId: b.workflowId, family: specSheetName(s.to.table), toLabel: `${wf?.name?.trim() || b.spec.name} · ${bt.name}`, rows: [values], asm: { send: s.key, rowId: row.id, toProjectId: b.projectId, toTable: s.to.table } }
  try {
    const sent = await createSend(deps, { userId: q.userId, projectId: q.projectId, taskId: q.taskId ?? null, workflowId: p.workflowId, kind: 'work_app', slot, ref: row.id, auto: false, payload: { appSend: card }, requestedBy: q.by, maxPending: APP_SEND_CARD_BURST })
    return { sendId: sent.id, status: 'card', row: values, toLabel: card.toLabel }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw (await held()) ?? new WorkError('INVALID', `CARD_WAITING — a card for this row with "${s.label}" is already waiting`)
    throw e
  }
}

export async function appLinkSetup(deps: WorkSheetDeps, s: { userId: string; projectId: string }, p: { inbox: string; reads: readonly string[]; back: readonly string[] }): Promise<string[] | null> {
  const proj = await deps.db.workProject.findFirst({ where: { id: s.projectId, userId: s.userId }, select: { workflowId: true } })
  if (!proj?.workflowId) return ['this work app is not linked to a workflow']
  const routes = (await findSendRoutes(deps.db, s.userId, proj.workflowId)).filter((r) => r.family === p.inbox)
  if (routes.length !== 1) return [routes.length ? `several send lines to the app inbox ${p.inbox} — keep one` : `a send line from this work app to the app inbox ${p.inbox} — the owner draws it on the canvas`]
  const t = await resolveInbox(deps, { userId: s.userId, targetWorkflowId: routes[0].toWorkflowId, family: p.inbox })
  if (!t) return [`the app the send line goes to has no inbox ${p.inbox} now`]
  const need: string[] = []
  const line = async (from: string, to: string, sheets: readonly string[], name: string) => {
    if (!sheets.length) return
    const r = await deps.db.projectReference.findFirst({ where: { userId: s.userId, fromProjectId: from, toProjectId: to }, select: { sheets: true, includeUnconfirmed: true } })
    if (!r) { need.push(`a reference line ${name} reading ${sheets.join(', ')} with unconfirmed rows`); return }
    for (const x of sheets) if (!r.sheets.includes(x)) need.push(`the reference line ${name} must read ${x}`)
    if (!r.includeUnconfirmed) need.push(`the reference line ${name} must include unconfirmed rows`)
  }
  await line(s.projectId, t.projectId, p.reads, 'from that app to this work app')
  await line(t.projectId, s.projectId, p.back, 'from this work app to that app')
  return need.length ? need : null
}

class AppSendRefusal extends Error {
  constructor(readonly code: string, readonly detail?: string) { super(code) }
}

type K = { userId: string; projectId: string; sendId: string }

export async function executeAppSend(deps: WorkSheetDeps, k: K, by: SheetActor, now: Date = new Date(), registry?: V3Registry): Promise<{ status: SendStatus | 'lost'; code?: string; affectedRows?: number }> {
  validateTemplateRegistry(deps.templates)
  const key = await deps.dataKey(deps.db, k.userId)
  const row = await deps.db.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { kind: true, status: true, auto: true, workflowId: true, payload: true } })
  if (!row || row.kind !== 'work_app' || row.status !== 'pending') return { status: 'lost' }
  if (row.auto) return refuse(deps, key, k, by, now, 'AUTO_NOT_ALLOWED')
  let card: AppSendCard | undefined
  try { card = decryptJson<SendPayload>(row.payload, key).appSend } catch { card = undefined }
  if (!card) return refuse(deps, key, k, by, now, 'PRECHECK_FAILED')
  const route = (await findSendRoutes(deps.db, k.userId, row.workflowId)).find((r) => r.toWorkflowId === card!.toWorkflowId && r.family === card!.family)
  if (!route) return refuse(deps, key, k, by, now, 'ROUTE_GONE')

  try {
    const n = await deps.db.$transaction(async (tx) => {
      const wfs = await tx.$queryRaw<Array<{ workflowId: string; status: string; kind: string; workflow_json: string }>>(Prisma.sql`
        SELECT w."workflowId", w.status, w.kind, w.workflow_json FROM workflows w JOIN agents a ON a."agentId" = w."agentId"
        WHERE w."workflowId" IN (${Prisma.join(route.lineWorkflowIds)}) AND a."userId" = ${k.userId}
        ORDER BY w."workflowId" FOR SHARE OF w`)
      const liveWfs = wfs.filter((w) => w.status === 'production' && w.kind === 'main').map((w) => ({ workflowId: w.workflowId, workflowJson: w.workflow_json }))
      const live = routesFrom(liveWfs, row.workflowId, await canvasAppIds(tx, liveWfs))
      if (!live.some((r) => r.toWorkflowId === card!.toWorkflowId && r.family === card!.family)) throw new AppSendRefusal('ROUTE_GONE')
      const target = await tx.workProject.findFirst({ where: { workflowId: card!.toWorkflowId, userId: k.userId }, select: { id: true } })
      if (!target) throw new AppSendRefusal('APP_UNAVAILABLE')
      if (target.id === k.projectId) throw new AppSendRefusal('APP_UNAVAILABLE')
      const locked = new Map<string, Awaited<ReturnType<typeof lockProjectForWrite>>>()
      for (const id of [k.projectId, target.id].sort()) {
        try {
          locked.set(id, await lockProjectForWrite(tx, k.userId, id))
        } catch (e) {
          if (id === target.id && e instanceof WorkError && e.code === 'NOT_FOUND') throw new AppSendRefusal('APP_UNAVAILABLE')
          throw e
        }
      }
      const a = locked.get(k.projectId)!
      if (a.status !== 'active' || isProjectDetached(a) || a.appClosed) throw new AppSendRefusal('PROJECT_READONLY')
      if (a.workflowId !== row.workflowId) throw new AppSendRefusal('ROUTE_GONE')
      const b = locked.get(target.id)!
      if (b.status !== 'active' || isProjectDetached(b) || b.appClosed || b.workflowId !== card!.toWorkflowId) throw new AppSendRefusal('APP_UNAVAILABLE')
      const cur = await tx.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { status: true } })
      if (cur?.status !== 'pending') throw new AppSendLost()
      const got = card!.asm ? await insertAssembled(tx, deps, key, k, row.workflowId, card!, target.id, now) : await (async () => {
      const t = await resolveInbox({ db: tx as unknown as PrismaClient }, { userId: k.userId, targetWorkflowId: card!.toWorkflowId, family: card!.family, registry })
      if (!t || t.projectId !== target.id) throw new AppSendRefusal('APP_UNAVAILABLE')
      const rows = (() => { try { return normalizeAppSendRows(card!.rows, t.decl.identify.column) } catch (e) { throw new AppSendRefusal('APP_ROW_INVALID', e instanceof WorkError ? e.detail : undefined) } })()
      const sheets = await familySheets({ db: tx as unknown as PrismaClient }, k.userId, target.id, card!.family)
      if (!sheets.length) throw new AppSendRefusal('APP_UNAVAILABLE')
      const w = await openProjectSheetWriter(tx, deps, key, { userId: k.userId, projectId: target.id, sheetIds: sheets.map((x) => x.id), actor: { type: 'app', workflowId: row.workflowId } })
        .catch((e) => { throw e instanceof WorkError && (e.code === 'NOT_FOUND' || e.code === 'READ_ONLY' || e.code === 'APP_CLOSED') ? new AppSendRefusal('APP_UNAVAILABLE') : e })
      const first = (await w.sheetsOfFamily(card!.family))[0]
      const sheet = first && sheets.find((x) => x.id === first.id)
      if (!sheet) throw new AppSendRefusal('APP_UNAVAILABLE')
      const recent = await w.countAppInserts(new Date(now.getTime() - 3600_000))
      if (recent + rows.length > APP_SEND_HOURLY_LIMIT) throw new AppSendRefusal('APP_LIMIT')
      const ids: string[] = []
      for (const [i, data] of rows.entries()) {
        try {
          const r = await w.insert(sheet.id, data)
          ids.push(r.id)
          await writeInboxSignal(tx, key, { userId: k.userId, projectId: target.id, title: sheet.name, rowId: r.id, family: card!.family, fromWorkflowId: row.workflowId })
        } catch (e) {
          if (e instanceof WorkError) {
            if (e.code === 'LOCKED') throw new AppSendRefusal('APP_PERIOD_LOCKED', `row ${i + 1}: ${e.detail || e.code}`)
            if (e.code === 'INVALID' || e.code === 'DUPLICATE') throw new AppSendRefusal('APP_ROW_INVALID', `row ${i + 1}: ${e.detail || e.code}`)
            if (e.code === 'NOT_FOUND' || e.code === 'READ_ONLY' || e.code === 'APP_CLOSED') throw new AppSendRefusal('APP_UNAVAILABLE')
          }
          throw e
        }
      }
      return { ids, numbers: null as Array<string | null> | null, sheet }
      })()
      const { ids, numbers, sheet } = got
      const u = await tx.workSend.updateMany({
        where: { id: k.sendId, projectId: k.projectId, userId: k.userId, status: 'pending' },
        data: { status: 'sent', code: null, decidedBy: actorLabel(by), decidedAt: now, result: encryptJson({ affectedRows: ids.length, rowIds: ids, ...(numbers ? { numbers } : {}) }, key) },
      })
      if (u.count !== 1) throw new AppSendLost()
      await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: by, action: 'send_sent', detail: { sendId: k.sendId, code: null, rows: ids.length } })
      const from = await tx.workflow.findUnique({ where: { workflowId: row.workflowId }, select: { name: true } })
      await writeWorkNotice(tx, key, { userId: k.userId, projectId: target.id, notice: { key: 'notice_rows_received', params: { from: from?.name ?? '', n: ids.length, sheet: sheet.name, family: card!.family } } })
      return ids.length
    }, { timeout: 30_000 })
    return { status: 'sent', affectedRows: n }
  } catch (e) {
    if (e instanceof AppSendLost) return { status: 'lost' }
    if (e instanceof AppSendRefusal) return refuse(deps, key, k, by, now, e.code, e.detail)
    if (e instanceof WorkError && e.code === 'NOT_FOUND') return { status: 'lost' }
    throw e
  }
}

class AppSendLost extends Error {}

async function insertAssembled(tx: Prisma.TransactionClient, deps: WorkSheetDeps, key: Buffer, k: K, fromWorkflowId: string, card: AppSendCard, targetId: string, now: Date): Promise<{ ids: string[]; numbers: Array<string | null>; sheet: { id: string; name: string } }> {
  const asm = card.asm!
  if (asm.toProjectId !== targetId) throw new AppSendRefusal('SEND_CHANGED')
  const sp = await readSpec(tx, key, { userId: k.userId, projectId: k.projectId })
  const s = sp?.spec.appSends?.find((x) => x.key === asm.send)
  if (!sp || !s || !liveAppSend(sp.spec, s)) throw new AppSendRefusal('SEND_GONE')
  if (s.to.app !== asm.toProjectId || s.to.table !== asm.toTable || specSheetName(s.to.table) !== card.family) throw new AppSendRefusal('SEND_CHANGED')
  const at = sp.spec.tables.find((t) => t.key === s.table)!
  const arow = await appSendSourceRow(tx, { userId: k.userId, projectId: k.projectId, table: s.table, rowId: asm.rowId })
  if (!arow) throw new AppSendRefusal('ROW_GONE')
  const adata = decodeRow(arow, key).data
  const blocked = appSendBlocked(at, s, adata, arow.confirmed === true)
  if (blocked) throw new AppSendRefusal('NOT_ALLOWED', blocked)
  const values = buildAppSendRow(at, s, adata)
  if (card.rows.length !== 1 || !sameAppSendRow(values, card.rows[0])) throw new AppSendRefusal('ROW_CHANGED')
  const bp = await tx.workProject.findFirst({ where: { id: targetId, userId: k.userId }, select: { kind: true } })
  const bs = bp?.kind === ASSEMBLED_KIND ? await readSpec(tx, key, { userId: k.userId, projectId: targetId }) : null
  const why = appSendTargetProblem(bs?.spec ?? null, at, s)
  if (why || !bs) throw new AppSendRefusal('APP_UNAVAILABLE', why ?? undefined)
  const bt = bs.spec.tables.find((t) => t.key === s.to.table)!
  const bad = appSendRowProblem(bt, values)
  if (bad) throw new AppSendRefusal('APP_ROW_INVALID', bad)
  const sheet = (await tx.dataSheet.findMany({ where: { kind: 'project', projectId: targetId, userId: k.userId, name: card.family, template: null }, select: { id: true, name: true }, orderBy: { id: 'asc' }, take: 1 }))[0]
  if (!sheet) throw new AppSendRefusal('APP_UNAVAILABLE')
  const w = await openProjectSheetWriter(tx, deps, key, { userId: k.userId, projectId: targetId, sheetIds: [sheet.id], actor: { type: 'app', workflowId: fromWorkflowId } })
    .catch((e) => { throw e instanceof WorkError ? new AppSendRefusal('APP_UNAVAILABLE') : e })
  if ((await w.countAppInserts(new Date(now.getTime() - 3600_000))) + 1 > APP_SEND_HOURLY_LIMIT) throw new AppSendRefusal('APP_LIMIT')
  let r: Awaited<ReturnType<typeof w.insert>>
  try {
    r = await w.insert(sheet.id, values, { appSendColumns: appSendColumns(bt, s) })
  } catch (e) {
    if (!(e instanceof WorkError)) throw e
    const detail = (e.detail || e.message || e.code).slice(0, 300)
    if (e.code === 'CHECK_FAILED') throw new AppSendRefusal('APP_CHECK_FAILED', detail)
    if (e.code === 'INVALID' || e.code === 'DUPLICATE' || e.code === 'FORBIDDEN') throw new AppSendRefusal('APP_ROW_INVALID', detail)
    throw new AppSendRefusal('APP_UNAVAILABLE', detail)
  }
  await writeInboxSignal(tx, key, { userId: k.userId, projectId: targetId, title: sheet.name, rowId: r.id, family: card.family, fromWorkflowId })
  return { ids: [r.id], numbers: [typeof r.data.number === 'string' && r.data.number ? r.data.number : null], sheet }
}

async function refuse(deps: WorkSheetDeps, key: Buffer, k: K, by: SheetActor, now: Date, code: string, detail?: string): Promise<{ status: 'refused' | 'lost'; code?: string }> {
  return deps.db.$transaction(async (tx) => {
    try {
      await lockProjectForWrite(tx, k.userId, k.projectId)
    } catch (e) {
      if (e instanceof WorkError && e.code === 'NOT_FOUND') return { status: 'lost' as const }
      throw e
    }
    const u = await tx.workSend.updateMany({
      where: { id: k.sendId, projectId: k.projectId, userId: k.userId, status: 'pending' },
      data: { status: 'refused', code, decidedBy: actorLabel(by), decidedAt: now, ...(detail ? { result: encryptJson({ detail: detail.slice(0, 300) }, key) } : {}) },
    })
    if (u.count !== 1) return { status: 'lost' as const }
    await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: by, action: 'send_refused', detail: { sendId: k.sendId, code } })
    return { status: 'refused' as const, code }
  })
}
