
import type { Prisma } from '@prisma/client'
import { chargeCPAWithReason, refundCPACharge, type CpaChargeFailure } from '@/lib/cpa-service'
import { decryptJson } from './sealed'
import { lockProjectForWrite } from './sheet-gate'
import { SEND_SENDING_LIMIT_MS, type SendDeps, type SendPayload } from './sends'

type Tx = Prisma.TransactionClient
type K = { userId: string; projectId: string; sendId: string }

export type SmsChargeResult =
  | { ok: true; credits: number }
  | { ok: false; status: 'pending' | 'refused' | 'lost'; code?: string }

class ChargeRefused extends Error {
  constructor(readonly failure: CpaChargeFailure) { super(`charge ${failure}`) }
}

let failNextChargeForTest = false
export function __failNextSmsChargeForTest() { failNextChargeForTest = true }

export async function chargeSmsSend(deps: SendDeps, k: K, now: Date = new Date()): Promise<SmsChargeResult> {
  const key = await deps.dataKey(deps.db, k.userId)
  let failure: CpaChargeFailure | 'exception' | null = null
  try {
    const won = await deps.db.$transaction(async (tx) => {
      await lockProjectForWrite(tx, k.userId, k.projectId)
      const at = new Date(Math.max(now.getTime(), Date.now()))
      const r = await tx.workSend.updateMany({
        where: { id: k.sendId, projectId: k.projectId, userId: k.userId, kind: 'sms', status: 'sending', dispatchedAt: null, claimedAt: { gte: new Date(at.getTime() - SEND_SENDING_LIMIT_MS) } },
        data: { dispatchedAt: at },
      })
      if (r.count !== 1) return null
      const row = await tx.workSend.findUniqueOrThrow({ where: { id: k.sendId }, select: { payload: true } })
      const total = decryptJson<SendPayload>(row.payload, key).smsPrice?.total
      if (!Number.isInteger(total) || (total as number) <= 0) throw new ChargeRefused('error')
      if (failNextChargeForTest) { failNextChargeForTest = false; throw new Error('test: charge transaction died') }
      const agentId = (await tx.workProject.findFirst({ where: { id: k.projectId, userId: k.userId }, select: { agentId: true } }))?.agentId
      if (!agentId) throw new ChargeRefused('agent_not_found')
      const res = await chargeCPAWithReason(agentId, total as number, tx)
      if ('failure' in res) throw new ChargeRefused(res.failure)
      const rc = res.receipt
      await tx.workSmsCharge.create({
        data: {
          sendId: k.sendId, userId: k.userId, agentId: rc.agentId, projectId: k.projectId, credits: rc.total,
          freeCharged: rc.freeCharged, boosterCharged: rc.boosterCharged, paidCharged: rc.paidCharged,
          logDate: rc.logDate, boosterExpiresAt: rc.boosterExpiresAt ?? null, status: 'charged',
        },
      })
      return rc.total
    })
    if (won !== null) return { ok: true, credits: won }
  } catch (e) {
    failure = e instanceof ChargeRefused ? e.failure : 'exception'
    if (failure === 'exception' || failure === 'error') console.error('[work-sms] 차감 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
  }
  if (failure === null) {
    const r = await deps.db.workSend.updateMany({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId, kind: 'sms', status: 'sending', dispatchedAt: null }, data: { status: 'refused', code: 'STALE_CLAIM' } })
    return r.count === 1 ? { ok: false, status: 'refused', code: 'STALE_CLAIM' } : { ok: false, status: 'lost' }
  }
  const permanent = failure === 'subscription_not_found' || failure === 'agent_not_found'
  const code = failure === 'insufficient' ? 'NO_CREDITS' : permanent ? 'CHARGE_REFUSED' : 'CHARGE_FAILED'
  try {
    const r = await deps.db.workSend.updateMany({
      where: { id: k.sendId, projectId: k.projectId, userId: k.userId, kind: 'sms', status: 'sending', dispatchedAt: null },
      data: permanent ? { status: 'refused', code } : { status: 'pending', code, claimedAt: null, decidedBy: null, decidedAt: null },
    })
    if (r.count !== 1) return { ok: false, status: 'lost' }
  } catch (e) {
    console.error('[work-sms] 차감 실패 뒤 되돌리기 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return { ok: false, status: 'lost' }
  }
  return { ok: false, status: permanent ? 'refused' : 'pending', code }
}

export async function refundSmsChargeWithRetry(deps: Pick<SendDeps, 'db'>, sendId: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      await deps.db.$transaction((tx) => refundSmsCharge(tx, sendId))
      return true
    } catch (e) {
      console.error('[work-sms] 돌려주기 실패(다시 시도):', sendId, e instanceof Error ? e.message.slice(0, 200) : 'error')
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  return false
}

export async function markSmsRefundDue(db: SendDeps['db'], sendId: string): Promise<void> {
  await db.workSmsCharge.updateMany({ where: { sendId, status: 'charged' }, data: { status: 'refund_due' } })
}

export async function sweepSmsRefunds(db: SendDeps['db'], now: Date = new Date()): Promise<number> {
  const old = new Date(now.getTime() - 60_000)
  const due = await db.$queryRaw<Array<{ send_id: string }>>`
    SELECT c.send_id FROM work_sms_charges c LEFT JOIN work_send s ON s.id = c.send_id
    WHERE c.created_at < ${old} AND (c.status = 'refund_due' OR (c.status = 'charged' AND s.kind = 'sms' AND s.status IN ('failed', 'refused')))
    ORDER BY c.closed_at ASC NULLS FIRST, c.created_at ASC LIMIT 200`
  let n = 0
  for (const d of due) {
    try {
      await db.$transaction((tx) => refundSmsCharge(tx, d.send_id))
      n++
    } catch (e) {
      console.error('[work-sms] 남은 돌려주기 실패(다음에 다시):', d.send_id, e instanceof Error ? e.message.slice(0, 200) : 'error')
      await db.workSmsCharge.updateMany({ where: { sendId: d.send_id, status: { in: ['charged', 'refund_due'] } }, data: { closedAt: new Date() } }).catch(() => {})
    }
  }
  return n
}

export async function refundSmsCharge(tx: Tx, sendId: string): Promise<boolean> {
  const r = await tx.workSmsCharge.updateMany({ where: { sendId, status: { in: ['charged', 'refund_due'] } }, data: { status: 'refunded', closedAt: new Date() } })
  if (r.count !== 1) return false
  const c = await tx.workSmsCharge.findUniqueOrThrow({ where: { sendId } })
  const ok = await refundCPACharge({ agentId: c.agentId, userId: c.userId, freeCharged: c.freeCharged, boosterCharged: c.boosterCharged, paidCharged: c.paidCharged, total: c.credits, logDate: c.logDate, boosterExpiresAt: c.boosterExpiresAt }, tx)
  if (!ok) throw new Error('refundCPACharge failed')
  return true
}
