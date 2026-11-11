import type { PrismaClient, Prisma } from '@prisma/client'
import {
  accountToday, buildSpecMail, readRefRows, readSpec, specSendBlocked, specSheetName, NUMBER_COLUMN, STATUS_COLUMN, TELEGRAM_SLOT,
  type SpecSend, type SpecTable,
} from './assembled'
import { TELEGRAM_ALERT_DECLARED, TELEGRAM_ALERT_PER_MINUTE, TELEGRAM_ALERT_STALE_MS, type AlertRef } from './sends'
import type { SheetActor } from './sheet-gate'

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

export const TELEGRAM_ALERTS_PER_SAVE = 20
const MISS_NOTICE: Record<string, string> = {
  RECIPIENT_EMPTY: 'notice_tg_no_chat',
  NO_CONNECTION: 'notice_tg_no_bot',
  HTTP_403: 'notice_tg_not_in_chat',
  HTTP_400: 'notice_tg_bad_chat',
  HTTP_401: 'notice_tg_bad_bot',
  HTTP_404: 'notice_tg_bad_bot',
  STALE: 'notice_tg_stale',
}
export const TELEGRAM_ALERT_ACTOR: SheetActor = { type: 'module', id: 'assembled.telegram', version: 1 }

async function alertsOff(db: Db, projectId: string): Promise<boolean> {
  const { isAutoOff } = await import('./sends')
  const off = (await db.workProject.findUnique({ where: { id: projectId }, select: { capabilityOff: true } }))?.capabilityOff
  return isAutoOff(off, TELEGRAM_ALERT_DECLARED)
}

async function slotState(db: Db, userId: string, workflowId: string): Promise<{ chat: string | null; connected: boolean }> {
  const w = await db.workflow.findFirst({ where: { workflowId, agent: { userId } }, select: { workflowJson: true, agentId: true } })
  if (!w) return { chat: null, connected: false }
  const { appStartSettings } = await import('./app-chat')
  const st = appStartSettings(w.workflowJson)
  const id = st.connections.telegram?.[TELEGRAM_SLOT]
  const conn = id ? await db.workflowConnection.findFirst({ where: { id, userId, agentId: w.agentId, provider: 'telegram', status: 'active' }, select: { id: true } }) : null
  return { chat: st.telegramChats[TELEGRAM_SLOT] ?? null, connected: !!conn }
}

export async function createTelegramAlertLineTx(tx: Tx, key: Buffer, q: {
  userId: string; projectId: string; workflowId: string; table: SpecTable; send: SpecSend; rowId: string
  data: Readonly<Record<string, unknown>>; today: string; ref: AlertRef; alertLabel: string
}): Promise<'made' | 'refused' | 'off' | 'over'> {
  if (await alertsOff(tx, q.projectId)) return 'off'
  const num = q.table.number && typeof q.data[NUMBER_COLUMN] === 'string' ? (q.data[NUMBER_COLUMN] as string) : ''
  const { writeWorkNotice } = await import('./notices')
  const n = q.ref.kind === 'move'
    ? Number((await tx.$queryRaw<Array<{ n: string }>>`SELECT set_config('aitalk.move_tg', (COALESCE(NULLIF(current_setting('aitalk.move_tg', true), ''), '0')::int + 1)::text, true) AS n`)[0].n)
    : 0
  if (n > TELEGRAM_ALERTS_PER_SAVE) {
    if (n === TELEGRAM_ALERTS_PER_SAVE + 1) await writeWorkNotice(tx, key, { userId: q.userId, projectId: q.projectId, notice: { key: 'notice_tg_cap', params: { table: q.table.name } } })
    return 'over'
  }
  const st = await slotState(tx, q.userId, q.workflowId)
  const refuseCode = !st.chat ? 'RECIPIENT_EMPTY' : !st.connected ? 'NO_CONNECTION' : specSendBlocked(q.table, q.send, q.data, q.today) !== null ? 'NOT_ALLOWED' : undefined
  const { createSendTx } = await import('./sends')
  const row = await createSendTx(tx, key, {
    userId: q.userId, projectId: q.projectId, taskId: null, workflowId: q.workflowId, kind: 'telegram', slot: TELEGRAM_SLOT,
    declared: TELEGRAM_ALERT_DECLARED, auto: true, payload: { alertRef: q.ref }, requestedBy: TELEGRAM_ALERT_ACTOR, refuseCode, ref: q.rowId,
  })
  if (row.status === 'refused' && refuseCode) await noticeTelegramMiss(tx, key, { userId: q.userId, projectId: q.projectId, sendId: row.id, code: refuseCode, alert: q.alertLabel, table: q.table.name, row: num })
  return row.status === 'refused' ? 'refused' : 'made'
}

export async function noticeTelegramMiss(db: Db, key: Buffer, q: { userId: string; projectId: string; sendId: string; code: string; alert: string; table: string; row: string }): Promise<boolean> {
  const noticeKey = MISS_NOTICE[q.code]
  if (!noticeKey) return false
  const me = await db.workSend.findFirst({ where: { id: q.sendId, projectId: q.projectId, userId: q.userId }, select: { updatedAt: true } })
  if (!me) return false
  const hour = new Date(me.updatedAt)
  hour.setUTCMinutes(0, 0, 0)
  const first = await db.workSend.findFirst({
    where: { projectId: q.projectId, userId: q.userId, declared: TELEGRAM_ALERT_DECLARED, code: q.code, status: { in: ['failed', 'refused'] }, updatedAt: { gte: hour, lt: new Date(hour.getTime() + 3600_000) } },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], select: { id: true },
  })
  if (first?.id !== q.sendId) return false
  const { writeWorkNotice } = await import('./notices')
  await writeWorkNotice(db as Tx, key, { userId: q.userId, projectId: q.projectId, notice: { key: noticeKey, params: { alert: q.alert.slice(0, 200), table: q.table.slice(0, 200), row: q.row.slice(0, 200) } } })
  return true
}

async function langOf(db: Db, userId: string): Promise<'en' | 'de' | 'fr' | 'ko'> {
  const s = await db.settings.findUnique({ where: { id: userId }, select: { locale: true } })
  const l = (s?.locale ?? 'en').slice(0, 2).toLowerCase()
  return l === 'de' || l === 'fr' || l === 'ko' ? l : 'en'
}
const WORDS = {
  en: { unconfirmed: 'not confirmed yet', newRow: 'new row in', late: 'late — due on' },
  de: { unconfirmed: 'noch nicht bestätigt', newRow: 'neue Zeile in', late: 'verspätet — fällig am' },
  fr: { unconfirmed: 'pas encore confirmé', newRow: 'nouvelle ligne en', late: 'en retard — prévu le' },
  ko: { unconfirmed: '아직 확인 전', newRow: '새 줄', late: '늦은 알림 — 원래' },
} as const

export type AlertLine = { ok: true; to: string; subject: string; text: string } | { ok: false; code: string }

export async function resolveAlertLine(db: Db, key: Buffer, q: { userId: string; projectId: string; workflowId: string; rowId: string | null; ref: AlertRef }): Promise<AlertLine> {
  const r = q.ref
  if (!q.rowId) return { ok: false, code: 'REF_CLOSED' }
  const sp = await readSpec(db, key, { userId: q.userId, projectId: q.projectId })
  const t = sp?.spec.tables.find((x) => x.key === r.table)
  const s = sp?.spec.sends?.find((x) => x.key === r.send && x.table === r.table && x.via === 'telegram')
  const alert = r.kind === 'date' ? t?.alerts?.find((a) => a.key === r.alert) : t?.moveAlerts?.find((a) => a.key === r.alert)
  if (!sp || !t || t.hidden || !s || !alert || alert.telegram !== s.key) return { ok: false, code: 'REF_CLOSED' }
  const row = await db.dataSheetRow.findFirst({ where: { id: q.rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(t.key) } } })
  if (!row) return { ok: false, code: 'REF_CLOSED' }
  const { decodeRow } = await import('./sheet-gate')
  const data = decodeRow(row, key).data
  const today = await accountToday(db, q.userId)
  if (specSendBlocked(t, s, data, today) !== null) return { ok: false, code: 'NOT_ALLOWED' }
  if (r.kind === 'date') {
    const a = t.alerts!.find((x) => x.key === r.alert)!
    const { alertDue } = await import('./assembled-alerts')
    const status = data[STATUS_COLUMN] === undefined || data[STATUS_COLUMN] === null || data[STATUS_COLUMN] === '' ? t.status?.start : String(data[STATUS_COLUMN])
    const due = alertDue(a, data[a.date], today)
    const rec = await db.workAlertFired.findUnique({ where: { rowId_tableKey_alertKey: { rowId: row.id, tableKey: t.key, alertKey: a.key } }, select: { targetDate: true, firedAt: true } })
    const whenOk = !a.when || (!!status && a.when.status.includes(status))
    if (!due || !whenOk || due.target !== r.target || !rec || rec.targetDate !== r.target || rec.firedAt.toISOString() !== r.firedAt) return { ok: false, code: 'SUPERSEDED' }
  }
  const st = await slotState(db, q.userId, q.workflowId)
  if (!st.chat) return { ok: false, code: 'RECIPIENT_EMPTY' }
  if (!st.connected) return { ok: false, code: 'NO_CONNECTION' }
  const w = WORDS[await langOf(db, q.userId)]
  const num = t.number && typeof data[NUMBER_COLUMN] === 'string' ? (data[NUMBER_COLUMN] as string) : ''
  const late = r.kind === 'date' && r.late && r.target ? `(${w.late} ${r.target}) ` : ''
  if (row.confirmed === true) {
    const m = buildSpecMail(t, s, data, today, { ownerEmail: null, members: [] }, null, await readRefRows(db, key, { userId: q.userId, projectId: q.projectId }, t))
    return { ok: true, to: st.chat, subject: late ? `${late}${m.subject}`.trim() : m.subject, text: m.text }
  }
  const head = `«${alert.label}» — ${t.name}${num ? ` ${num}` : ''}`
  const what = r.kind === 'move'
    ? (r.from ? `${r.from} → ${r.to ?? ''}` : `${w.newRow} ${r.to ?? ''}`)
    : (t.columns.find((c) => c.key === t.alerts!.find((x) => x.key === r.alert)!.date)?.label ?? r.alert)
  return { ok: true, to: st.chat, subject: '', text: `${late}${head}: ${what}${r.ai ? ' (AI)' : ''} · ${w.unconfirmed}` }
}

export async function processWorkTelegram(deps: { db: PrismaClient; dataKey: (db: PrismaClient, userId: string) => Promise<Buffer> }, opts: { now?: Date; senders?: import('./sends').Senders } = {}): Promise<{ sent: number; stale: number; other: number }> {
  const clock = () => opts.now ?? new Date()
  const out = { sent: 0, stale: 0, other: 0 }
  const { executeSend, decryptPayloadOf } = await import('./sends')
  const { actorLabel } = await import('./sheet-gate')
  for (;;) {
    const cut = new Date(clock().getTime() - TELEGRAM_ALERT_STALE_MS)
    const old = await deps.db.workSend.findMany({ where: { declared: TELEGRAM_ALERT_DECLARED, status: 'pending', auto: true, createdAt: { lt: cut } }, select: { id: true, userId: true, projectId: true, payload: true, ref: true }, take: 200 })
    if (!old.length) break
    for (const o of old) {
      const r = await deps.db.workSend.updateMany({ where: { id: o.id, status: 'pending' }, data: { status: 'refused', code: 'STALE', decidedBy: actorLabel(TELEGRAM_ALERT_ACTOR), decidedAt: clock() } })
      if (r.count !== 1) continue
      out.stale++
      try {
        const key = await deps.dataKey(deps.db, o.userId)
        await noticeTelegramMiss(deps.db, key, { userId: o.userId, projectId: o.projectId, sendId: o.id, code: 'STALE', ...(await labelsOf(deps.db, key, o.userId, o.projectId, decryptPayloadOf(o.payload, key).alertRef, o.ref)) })
      } catch (e) { console.error('[work-telegram] stale notice failed:', e instanceof Error ? e.message.slice(0, 200) : 'error') }
    }
  }
  const t0 = clock()
  const ready = { declared: TELEGRAM_ALERT_DECLARED, status: 'pending', auto: true, createdAt: { gte: new Date(t0.getTime() - TELEGRAM_ALERT_STALE_MS) }, OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(t0.getTime() - 60_000) } }] }
  const apps = await deps.db.workSend.groupBy({ by: ['projectId'], where: ready, _min: { createdAt: true }, orderBy: { _min: { createdAt: 'asc' } }, take: 500 })
  if (!apps.length) return out
  const rows: Array<{ id: string; userId: string; projectId: string; payload: Uint8Array; ref: string | null }> = []
  for (const a of apps) rows.push(...await deps.db.workSend.findMany({ where: { ...ready, projectId: a.projectId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: TELEGRAM_ALERT_PER_MINUTE, select: { id: true, userId: true, projectId: true, payload: true, ref: true } }))
  const { defaultWorkSheetDeps } = await import('./sheet-gate')
  const sheetDeps = { ...(await defaultWorkSheetDeps()), db: deps.db, dataKey: deps.dataKey }
  const senders = opts.senders ?? (await import('./work-senders')).createWorkSenders(deps.db)
  const lookups = { file: async () => null, query: () => null }
  const full = new Set<string>()
  for (const r of rows) {
    if (full.has(r.projectId)) continue
    try {
      const res = await executeSend(sheetDeps, { userId: r.userId, projectId: r.projectId, sendId: r.id }, { by: TELEGRAM_ALERT_ACTOR, senders, lookups, mode: 'auto', ...(opts.now ? { now: opts.now } : {}) })
      if (res.status === 'sent') { out.sent++; continue }
      out.other++
      if (res.status === 'pending' && res.code === 'THROTTLED') { full.add(r.projectId); continue }
      if ((res.status === 'failed' || res.status === 'refused') && res.code && MISS_NOTICE[res.code]) {
        const key = await deps.dataKey(deps.db, r.userId)
        await noticeTelegramMiss(deps.db, key, { userId: r.userId, projectId: r.projectId, sendId: r.id, code: res.code, ...(await labelsOf(deps.db, key, r.userId, r.projectId, decryptPayloadOf(r.payload, key).alertRef, r.ref)) })
      }
    } catch (e) {
      out.other++
      console.error('[work-telegram] send failed:', r.id, e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
  }
  return out
}

async function labelsOf(db: Db, key: Buffer, userId: string, projectId: string, ref: AlertRef | undefined, rowId: string | null): Promise<{ alert: string; table: string; row: string }> {
  if (!ref) return { alert: '—', table: '—', row: '' }
  const sp = await readSpec(db, key, { userId, projectId })
  const t = sp?.spec.tables.find((x) => x.key === ref.table)
  const a = ref.kind === 'date' ? t?.alerts?.find((x) => x.key === ref.alert) : t?.moveAlerts?.find((x) => x.key === ref.alert)
  let row = ''
  if (t?.number && rowId) {
    const r = await db.dataSheetRow.findFirst({ where: { id: rowId, projectId, userId, kind: 'project' } })
    if (r) {
      const { decodeRow } = await import('./sheet-gate')
      const v = decodeRow(r, key).data[NUMBER_COLUMN]
      if (typeof v === 'string') row = v
    }
  }
  return { alert: a?.label ?? ref.alert, table: t?.name ?? ref.table, row }
}
