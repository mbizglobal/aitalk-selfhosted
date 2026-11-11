import type { PrismaClient, Prisma } from '@prisma/client'
import { decryptJson } from './sealed'
import { accountToday, buildSpecMail, readRefRows, readSpec, specSendBlocked, specSendRefKey, specSheetName, specTeam, STATUS_COLUMN, NUMBER_COLUMN, type AppSpec, type SpecAlert, type SpecSend, type SpecTable, type SpecTeam, type RefRows } from './assembled'
import type { SheetActor } from './sheet-gate'

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

export const ALERT_BEFORE_GRACE_DAYS = 7
export const ALERT_AFTER_GRACE_DAYS = 30
export const ALERT_FIRES_PER_RUN = 20
export const ALERT_ACTOR: SheetActor = { type: 'module', id: 'assembled.alerts', version: 1 }

const DAY = 24 * 3600 * 1000
const toDay = (d: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return new Date(t).toISOString().slice(0, 10) === d ? t / DAY : null
}
const fromDay = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10)

export function alertDue(a: Pick<SpecAlert, 'daysBefore' | 'daysAfter'>, dateValue: unknown, today: string): { target: string; late: boolean } | null {
  const d = typeof dateValue === 'string' ? toDay(dateValue) : null
  const t0 = toDay(today)
  if (d === null || t0 === null) return null
  const before = a.daysBefore !== undefined
  const target = before ? d - a.daysBefore! : d + (a.daysAfter ?? 0)
  const end = before ? d + ALERT_BEFORE_GRACE_DAYS : target + ALERT_AFTER_GRACE_DAYS
  if (t0 < target || t0 > end) return null
  return { target: fromDay(target), late: t0 > target }
}

export interface AlertFire {
  kind: 'full' | 'card'
  table: SpecTable
  alert: SpecAlert
  rowId: string
  data: Record<string, unknown>
  target: string
  late: boolean
  mail?: { send: SpecSend; to: string[] | null; subject: string; text: string; refuseCode?: string }
  prevSendId?: string
}

const CARD_CLOCK_SLACK_MS = 60_000

const RETRY_CODES: ReadonlySet<string> = new Set(['NOT_ALLOWED', 'RECIPIENT_EMPTY'])

function mailOf(spec: AppSpec, t: SpecTable, a: SpecAlert, data: Readonly<Record<string, unknown>>, today: string, team: SpecTeam, refRows: RefRows): AlertFire['mail'] {
  const s = a.send ? spec.sends?.find((x) => x.key === a.send && x.table === t.key) : undefined
  if (!s) return undefined
  const m = buildSpecMail(t, s, data, today, team, null, refRows)
  const refuseCode = specSendBlocked(t, s, data, today) !== null ? 'NOT_ALLOWED' : !m.to ? 'RECIPIENT_EMPTY' : undefined
  return { send: s, ...m, ...(refuseCode ? { refuseCode } : {}) }
}

export async function planAlertFires(db: Db, key: Buffer, q: { userId: string; projectId: string; spec: AppSpec; today: string; team: SpecTeam; limit?: number }): Promise<AlertFire[]> {
  const { decodeRow } = await import('./sheet-gate')
  const out: AlertFire[] = []
  const limit = q.limit ?? ALERT_FIRES_PER_RUN
  for (const t of q.spec.tables) {
    if (t.hidden || !t.alerts?.length) continue
    const sheet = await db.dataSheet.findFirst({ where: { userId: q.userId, projectId: q.projectId, kind: 'project', template: null, name: specSheetName(t.key) }, select: { id: true } })
    if (!sheet) continue
    const [rows, fired] = await Promise.all([
      db.dataSheetRow.findMany({ where: { sheetId: sheet.id, projectId: q.projectId, userId: q.userId, kind: 'project' }, orderBy: { createdAt: 'asc' } }),
      db.workAlertFired.findMany({ where: { projectId: q.projectId, userId: q.userId, tableKey: t.key }, select: { rowId: true, alertKey: true, targetDate: true, sendId: true, firedAt: true } }),
    ])
    const last = new Map(fired.map((f) => [`${f.rowId}\u0000${f.alertKey}`, f]))
    const refRows = t.alerts.some((a) => a.send) ? await readRefRows(db, key, q, t) : {}
    const sendIds = fired.map((f) => f.sendId).filter((x): x is string => !!x)
    const cards = new Map((sendIds.length ? await db.workSend.findMany({ where: { id: { in: sendIds }, projectId: q.projectId, userId: q.userId }, select: { id: true, status: true, code: true } }) : []).map((c) => [c.id, c]))
    const liveSince = async (rowId: string, sendKey: string, since: Date): Promise<boolean> => {
      const cs = await db.workSend.findMany({ where: { projectId: q.projectId, userId: q.userId, ref: rowId, kind: 'email', status: { in: ['pending', 'sending', 'unknown', 'sent', 'discarded'] }, createdAt: { gte: new Date(since.getTime() - CARD_CLOCK_SLACK_MS) } }, select: { payload: true } })
      return cs.some((c) => { try { return (decryptJson<{ refKey?: string }>(c.payload, key).refKey ?? '').startsWith(`${t.key}:${sendKey}:`) } catch { return true } })
    }
    for (const r of rows) {
      const data = decodeRow(r, key).data
      const status = data[STATUS_COLUMN] === undefined || data[STATUS_COLUMN] === null || data[STATUS_COLUMN] === '' ? t.status?.start : String(data[STATUS_COLUMN])
      for (const a of t.alerts) {
        if (a.when && (!status || !a.when.status.includes(status))) continue
        const due = alertDue(a, data[a.date], q.today)
        if (!due) continue
        const rec = last.get(`${r.id}\u0000${a.key}`)
        const mail = mailOf(q.spec, t, a, data, q.today, q.team, refRows)
        if (rec?.targetDate === due.target) {
          const prev = rec.sendId ? cards.get(rec.sendId) : null
          const owed = !!mail && !mail.refuseCode && (rec.sendId === null || (!!prev && prev.status === 'refused' && RETRY_CODES.has(prev.code ?? ''))) && !(await liveSince(r.id, mail.send.key, rec.firedAt))
          if (!owed) continue
          out.push({ kind: 'card', table: t, alert: a, rowId: r.id, data, target: due.target, late: due.late, mail, ...(rec.sendId ? { prevSendId: rec.sendId } : {}) })
        } else out.push({ kind: 'full', table: t, alert: a, rowId: r.id, data, target: due.target, late: due.late, ...(mail ? { mail } : {}) })
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

export interface AlertDeps {
  db: PrismaClient
  dataKey: (db: PrismaClient, userId: string) => Promise<Buffer>
}

export async function fireProjectAlerts(deps: AlertDeps, q: { userId: string; projectId: string; now?: Date }): Promise<{ fired: number; late: number; cards: number }> {
  const none = { fired: 0, late: 0, cards: 0 }
  const key = await deps.dataKey(deps.db, q.userId)
  const now = q.now ?? new Date()
  const first = await readSpec(deps.db, key, q)
  if (!first) return none
  if (!(await planAlertFires(deps.db, key, { ...q, spec: first.spec, today: await accountToday(deps.db, q.userId, now), team: await specTeam(deps.db, q.userId, q.projectId), limit: 1 })).length) return none
  const { lockProjectForWrite, isProjectDetached } = await import('./sheet-gate')
  const { writeWorkNotice } = await import('./notices')
  const { createSendTx } = await import('./sends')
  return deps.db.$transaction(async (tx) => {
    const p = await lockProjectForWrite(tx, q.userId, q.projectId)
    if (p.status !== 'active' || isProjectDetached(p) || p.appClosed) return none
    const sp = await readSpec(tx, key, q)
    if (!sp) return none
    const today = await accountToday(tx, q.userId, q.now ?? new Date())
    const team = await specTeam(tx, q.userId, q.projectId)
    const fires = await planAlertFires(tx, key, { ...q, spec: sp.spec, today, team })
    const out = { ...none }
    for (const f of fires) {
      let sendId: string | null = null
      if (f.mail) {
        const m = f.mail
        sendId = (await createSendTx(tx, key, {
          userId: q.userId, projectId: q.projectId, taskId: null, workflowId: p.workflowId ?? '', kind: 'email', slot: 'mail', declared: null, auto: false,
          payload: { ...(m.to ? { to: m.to } : {}), subject: m.subject, text: m.text, refKey: specSendRefKey(m.send, m, today) },
          requestedBy: ALERT_ACTOR, refuseCode: m.refuseCode, ref: f.rowId,
          ...(f.kind === 'card' && f.prevSendId ? { reissueOf: f.prevSendId } : {}),
        })).id
        out.cards++
      }
      const at = q.now ?? new Date()
      if (f.kind === 'card') {
        await tx.workAlertFired.update({ where: { rowId_tableKey_alertKey: { rowId: f.rowId, tableKey: f.table.key, alertKey: f.alert.key } }, data: { sendId } })
        continue
      }
      await tx.workAlertFired.upsert({
        where: { rowId_tableKey_alertKey: { rowId: f.rowId, tableKey: f.table.key, alertKey: f.alert.key } },
        create: { userId: q.userId, projectId: q.projectId, rowId: f.rowId, tableKey: f.table.key, alertKey: f.alert.key, targetDate: f.target, late: f.late, sendId, firedAt: at },
        update: { targetDate: f.target, late: f.late, sendId, firedAt: at },
      })
      out.fired++
      if (f.late) out.late++
      const tg = f.alert.telegram ? sp.spec.sends?.find((x) => x.key === f.alert.telegram && x.via === 'telegram' && x.table === f.table.key) : undefined
      if (tg) {
        const { createTelegramAlertLineTx } = await import('./assembled-telegram')
        await createTelegramAlertLineTx(tx, key, {
          userId: q.userId, projectId: q.projectId, workflowId: p.workflowId ?? '', table: f.table, send: tg, rowId: f.rowId, data: f.data, today, alertLabel: f.alert.label,
          ref: { kind: 'date', table: f.table.key, alert: f.alert.key, send: tg.key, target: f.target, firedAt: at.toISOString(), late: f.late },
        })
      }
      const col = f.table.columns.find((c) => c.key === f.alert.date)
      const num = f.table.number && typeof f.data[NUMBER_COLUMN] === 'string' ? (f.data[NUMBER_COLUMN] as string) : ''
      await writeWorkNotice(tx, key, {
        userId: q.userId,
        projectId: q.projectId,
        notice: { key: f.late ? 'notice_alert_late' : 'notice_alert', params: { alert: f.alert.label, table: f.table.name, row: num, column: col?.label ?? f.alert.date, date: String(f.data[f.alert.date]), due: f.target } },
        alsoPrivate: privateOwner(f.alert, f.data, team),
      })
    }
    return out
  })
}

function privateOwner(a: SpecAlert, data: Readonly<Record<string, unknown>>, team: SpecTeam): string | undefined {
  if (!a.to) return undefined
  if (a.to === 'owner') return 'human'
  const v = data[a.to.slice(7)]
  const email = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (email && email === team.ownerEmail) return 'human'
  const m = team.members.find((x) => x.active && x.email === email)
  return m ? `member:${m.id}` : 'human'
}

export async function processWorkAlerts(deps: AlertDeps, now?: Date): Promise<{ apps: number; fired: number; late: number; cards: number; failed: number }> {
  const specs = await deps.db.workAppSpec.findMany({ select: { userId: true, projectId: true, info: true }, orderBy: { projectId: 'asc' } })
  const keys = new Map<string, Buffer>()
  const out = { apps: 0, fired: 0, late: 0, cards: 0, failed: 0 }
  for (const r of specs) {
    try {
      if (!keys.has(r.userId)) keys.set(r.userId, await deps.dataKey(deps.db, r.userId))
      const spec = decryptJson<AppSpec>(r.info, keys.get(r.userId)!)
      if (!spec.tables.some((t) => !t.hidden && t.alerts?.length)) continue
      out.apps++
      const x = await fireProjectAlerts(deps, { userId: r.userId, projectId: r.projectId, ...(now ? { now } : {}) })
      out.fired += x.fired
      out.late += x.late
      out.cards += x.cards
    } catch (e) {
      out.failed++
      console.error('[work-alerts] app failed:', r.projectId, e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
  }
  return out
}

export const MOVE_ACTOR: SheetActor = { type: 'module', id: 'assembled.moves', version: 1 }

export function moveAlertsFor(t: Pick<SpecTable, 'moveAlerts'>, from: string | null, to: string): NonNullable<SpecTable['moveAlerts']> {
  return (t.moveAlerts ?? []).filter((a) => a.to.includes(to) && (from === null ? !a.from : !a.from || a.from.includes(from)))
}

export function moveRecipient(notify: 'owner' | `column:${string}`, data: Readonly<Record<string, unknown>>, team: SpecTeam): string | undefined {
  if (notify === 'owner') return team.ownerEmail ? 'human' : undefined
  const v = data[notify.slice(7)]
  const email = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (!email) return undefined
  if (email === team.ownerEmail) return 'human'
  const m = team.members.find((x) => x.active && x.email === email)
  return m ? `member:${m.id}` : undefined
}

export async function fireMoveAlertsTx(tx: Tx, key: Buffer, q: {
  userId: string; projectId: string; table: SpecTable; sends: readonly SpecSend[]; rowId: string
  from: string | null; to: string; data: Readonly<Record<string, unknown>>; team: SpecTeam
  by?: string; ai: boolean
  outside?: boolean
  fromAppWorkflowId?: string
}): Promise<{ notices: number; cards: number; skippedCards: number }> {
  const out = { notices: 0, cards: 0, skippedCards: 0 }
  const alerts = moveAlertsFor(q.table, q.from, q.to)
  if (!alerts.length) return out
  const { writeWorkNotice } = await import('./notices')
  const { createSendTx } = await import('./sends')
  const { SPEC_LIMITS } = await import('./assembled')
  let today: string | null = null
  let refRows: RefRows | null = null
  let workflowId: string | null = null
  const num = q.table.number && typeof q.data[NUMBER_COLUMN] === 'string' ? (q.data[NUMBER_COLUMN] as string) : ''
  const fromApp = q.fromAppWorkflowId ? (await tx.workflow.findUnique({ where: { workflowId: q.fromAppWorkflowId }, select: { name: true } }))?.name?.trim() || '—' : null
  for (const a of alerts) {
    const recipient = moveRecipient(a.notify, q.data, q.team)
    let nocard = false
    const s = a.send ? q.sends.find((x) => x.key === a.send) : undefined
    if (s) {
      const [{ n }] = await tx.$queryRaw<Array<{ n: string }>>`SELECT set_config('aitalk.move_cards', (COALESCE(NULLIF(current_setting('aitalk.move_cards', true), ''), '0')::int + 1)::text, true) AS n`
      if (Number(n) > SPEC_LIMITS.moveCards) { nocard = true; out.skippedCards++ }
      else {
        today ??= await accountToday(tx, q.userId)
        refRows ??= await readRefRows(tx, key, q, q.table)
        workflowId ??= (await tx.workProject.findUnique({ where: { id: q.projectId }, select: { workflowId: true } }))?.workflowId ?? ''
        const m = buildSpecMail(q.table, s, q.data, today, q.team, null, refRows)
        const refuseCode = specSendBlocked(q.table, s, q.data, today) !== null ? 'NOT_ALLOWED' : !m.to ? 'RECIPIENT_EMPTY' : undefined
        await createSendTx(tx, key, {
          userId: q.userId, projectId: q.projectId, taskId: null, workflowId, kind: 'email', slot: 'mail', declared: null, auto: false,
          payload: { ...(m.to ? { to: m.to } : {}), subject: m.subject, text: m.text, refKey: specSendRefKey(s, m, today) },
          requestedBy: MOVE_ACTOR, refuseCode, ref: q.rowId,
        })
        out.cards++
      }
    }
    const tg = a.telegram ? q.sends.find((x) => x.key === a.telegram && x.via === 'telegram') : undefined
    if (tg) {
      today ??= await accountToday(tx, q.userId)
      workflowId ??= (await tx.workProject.findUnique({ where: { id: q.projectId }, select: { workflowId: true } }))?.workflowId ?? ''
      const { createTelegramAlertLineTx } = await import('./assembled-telegram')
      await createTelegramAlertLineTx(tx, key, {
        userId: q.userId, projectId: q.projectId, workflowId, table: q.table, send: tg, rowId: q.rowId, data: q.data, today, alertLabel: a.label,
        ref: { kind: 'move', table: q.table.key, alert: a.key, send: tg.key, from: q.from, to: q.to, ...(q.ai ? { ai: true } : {}) },
      })
    }
    const key2 = q.from === null
      ? q.outside ? (nocard ? 'notice_move_intake_nocard' : 'notice_move_intake') : fromApp !== null ? (nocard ? 'notice_move_fromapp_nocard' : 'notice_move_fromapp') : nocard ? 'notice_move_new_nocard' : 'notice_move_new'
      : nocard ? 'notice_move_nocard' : 'notice_move'
    await writeWorkNotice(tx, key, {
      userId: q.userId, projectId: q.projectId,
      notice: { key: key2, params: { alert: a.label, table: q.table.name, row: num, from: q.from ?? '—', to: q.to, who: q.ai ? ' (AI)' : '', ...(fromApp !== null ? { app: fromApp } : {}) }, ...(q.by ? { by: q.by } : {}) },
      ...(recipient ? { alsoPrivate: recipient } : {}),
    })
    out.notices++
  }
  return out
}
