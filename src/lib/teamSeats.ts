import type { Prisma, PrismaClient } from '@prisma/client'
import { getPlanTeamMemberLimit, getManagedPlanTeamMemberLimit, hasManagedPlanTier } from '@/lib/invoice/subscription/utils'
import { invalidateAgentMemberCache } from '@/lib/teamMemberCache'
import { isSelfHosted } from '@/lib/edition'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'

type TeamDb = Prisma.TransactionClient

export interface TeamSeatUsage {
  memberCount: number
  reservedCount: number
  /** memberCount + reservedCount */
  usedSeats: number
  limit: number
  hasFreeSeat: boolean
}

export class TeamSeatLimitError extends Error {
  constructor(public readonly usage: TeamSeatUsage) {
    super('TEAM_SEAT_LIMIT_REACHED')
    this.name = 'TeamSeatLimitError'
  }

  get limit() {
    return this.usage.limit
  }
}

function throwSeatLimit(agentAgentId: string, reason: 'invitation' | 'membership', usage: TeamSeatUsage): never {
  console.warn('[TEAM_SEAT] limit reached', JSON.stringify({
    agentId: agentAgentId,
    reason,
    memberCount: usage.memberCount,
    reservedCount: usage.reservedCount,
    usedSeats: usage.usedSeats,
    limit: usage.limit
  }))
  throw new TeamSeatLimitError(usage)
}

function normalize(email: string) {
  return email.trim().toLowerCase()
}

export async function getTeamSeatUsage(
  db: TeamDb,
  agentAgentId: string,
  options: { excludeEmail?: string } = {}
): Promise<TeamSeatUsage> {
  const excludeEmail = options.excludeEmail ? normalize(options.excludeEmail) : null

  const selfHosted = isSelfHosted()
  const agent = selfHosted
    ? await db.agent.findUnique({ where: { agentId: agentAgentId }, select: { agentId: true } })
    : await db.agent.findUnique({
        where: { agentId: agentAgentId },
        select: {
          user: {
            select: {
              subscription: { select: { planType: true, serviceVariant: true } }
            }
          }
        }
      })

  if (!agent) {
    throw new Error(`getTeamSeatUsage: agent not found (${agentAgentId})`)
  }
  const subscription = 'user' in agent ? agent.user.subscription : null

  //
  const members = await db.agentMember.findMany({
    where: { agentAgentId },
    select: { email: true, status: true }
  })

  const pending = await db.agentMemberInvitation.findMany({
    where: {
      agentAgentId,
      status: 'pending',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    select: { email: true }
  })

  const memberEmails = new Set(members.map(m => normalize(m.email)))
  const reservedEmails = new Set(
    pending
      .map(p => normalize(p.email))
      .filter(email => email !== excludeEmail && !memberEmails.has(email))
  )

  const activeCount = members.filter(m => m.status === 'active').length

  const planType = subscription?.planType || 'free'
  const isManaged = subscription?.serviceVariant === 'managed'

  //
  //
  //
  const limit = selfHosted
    ? SELF_HOSTED_POLICY.teamMemberLimit
    : isManaged && hasManagedPlanTier(planType)
      ? getManagedPlanTeamMemberLimit(planType)
      : getPlanTeamMemberLimit(planType)

  const memberCount = activeCount
  const reservedCount = reservedEmails.size
  const usedSeats = memberCount + reservedCount

  return { memberCount, reservedCount, usedSeats, limit, hasFreeSeat: usedSeats < limit }
}

export async function lockAgentSeats(tx: Prisma.TransactionClient, agentAgentId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agentAgentId}))`
}

export async function assertSeatForInvitation(
  tx: Prisma.TransactionClient,
  agentAgentId: string,
  forEmail: string
): Promise<TeamSeatUsage> {
  await lockAgentSeats(tx, agentAgentId)

  const seats = await getTeamSeatUsage(tx, agentAgentId, { excludeEmail: forEmail })
  if (!seats.hasFreeSeat) {
    throwSeatLimit(agentAgentId, 'invitation', seats)
  }

  return seats
}

export async function assertSeatForMembership(
  tx: Prisma.TransactionClient,
  agentAgentId: string
): Promise<TeamSeatUsage> {
  await lockAgentSeats(tx, agentAgentId)

  const seats = await getTeamSeatUsage(tx, agentAgentId)
  if (seats.memberCount >= seats.limit) {
    throwSeatLimit(agentAgentId, 'membership', seats)
  }

  return seats
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export interface SeatReconcileResult {
  agentAgentId: string
  limit: number
  activeBefore: number
  suspended: number
  reactivated: number
  suspendedIds: number[]
  reactivatedIds: number[]
}

function autoReconcileEnabled(): boolean {
  return process.env.TEAM_SEAT_AUTO_RECONCILE_ENABLED !== 'false'
}

export type SeatReconcileTrigger = 'sweep' | 'console' | 'soft-free' | 'manual'

export async function reconcileAgentTeamSeats(
  tx: Prisma.TransactionClient,
  agentAgentId: string
): Promise<SeatReconcileResult> {
  await lockAgentSeats(tx, agentAgentId)

  const seats = await getTeamSeatUsage(tx, agentAgentId)
  const result: SeatReconcileResult = {
    agentAgentId,
    limit: seats.limit,
    activeBefore: seats.memberCount,
    suspended: 0,
    reactivated: 0,
    suspendedIds: [],
    reactivatedIds: []
  }

  if (seats.memberCount > seats.limit) {
    const excess = seats.memberCount - seats.limit
    const victims = await tx.agentMember.findMany({
      where: { agentAgentId, status: 'active' },
      orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
      take: excess,
      select: { id: true }
    })

    const updated = await tx.agentMember.updateMany({
      where: { id: { in: victims.map(m => m.id) } },
      data: { status: 'suspended', planSuspendedAt: new Date() }
    })
    result.suspended = updated.count
    result.suspendedIds = victims.map(m => m.id)
  } else if (seats.usedSeats < seats.limit) {
    const room = seats.limit - seats.usedSeats
    const restorable = await tx.agentMember.findMany({
      where: { agentAgentId, status: 'suspended', planSuspendedAt: { not: null } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      take: room,
      select: { id: true }
    })

    const updated = await tx.agentMember.updateMany({
      where: { id: { in: restorable.map(m => m.id) } },
      data: { status: 'active', planSuspendedAt: null }
    })
    result.reactivated = updated.count
    result.reactivatedIds = restorable.map(m => m.id)
  }

  return result
}

export async function sweepAllTeamSeats(prisma: PrismaClient): Promise<SeatReconcileResult[]> {
  if (!autoReconcileEnabled()) {
    console.warn('[TEAM_SEAT] sweep skipped — TEAM_SEAT_AUTO_RECONCILE_ENABLED=false')
    return []
  }

  const withMembers = await prisma.agentMember.groupBy({
    by: ['agentAgentId'],
    _count: { _all: true }
  })

  const results: SeatReconcileResult[] = []

  for (const g of withMembers) {
    try {
      const peek = await getTeamSeatUsage(prisma, g.agentAgentId)
      const restorable = peek.usedSeats < peek.limit
        ? await prisma.agentMember.count({
            where: { agentAgentId: g.agentAgentId, status: 'suspended', planSuspendedAt: { not: null } }
          })
        : 0

      if (peek.memberCount <= peek.limit && restorable === 0) continue

      const r = await prisma.$transaction(async (tx) => reconcileAgentTeamSeats(tx, g.agentAgentId))

      if (r.suspended > 0 || r.reactivated > 0) {
        invalidateAgentMemberCache(g.agentAgentId)
        console.log('[TEAM_SEAT] swept', JSON.stringify({ trigger: 'sweep', ...r }))
      }

      results.push(r)
    } catch (error) {
      console.error(`[TEAM_SEAT] sweep failed for ${g.agentAgentId}:`, error)
    }
  }

  return results
}

export async function reconcileUserTeamSeats(
  prisma: PrismaClient,
  userId: string,
  trigger: SeatReconcileTrigger
): Promise<{ results: SeatReconcileResult[]; failures: string[] }> {
  if (!autoReconcileEnabled()) {
    console.warn(`[TEAM_SEAT] reconcile skipped (${trigger}) — TEAM_SEAT_AUTO_RECONCILE_ENABLED=false`)
    return { results: [], failures: [] }
  }

  const agents = await prisma.agent.findMany({
    where: { userId },
    select: { agentId: true }
  })

  const results: SeatReconcileResult[] = []
  const failures: string[] = []

  for (const agent of agents) {
    try {
      const r = await prisma.$transaction(async (tx) => reconcileAgentTeamSeats(tx, agent.agentId))

      if (r.suspended > 0 || r.reactivated > 0) {
        invalidateAgentMemberCache(agent.agentId)
        console.log('[TEAM_SEAT] reconciled', JSON.stringify({ trigger, userId, ...r }))
      }

      results.push(r)
    } catch (error) {
      failures.push(agent.agentId)
      console.error(`[TEAM_SEAT] reconcile failed for ${agent.agentId}:`, error)
    }
  }

  if (failures.length > 0) {
    console.warn(`[TEAM_SEAT] partial reconcile for user ${userId}: ${failures.length}/${agents.length} agent(s) failed — sweep will retry`)
  }

  return { results, failures }
}
