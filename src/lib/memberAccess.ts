
import type { Prisma, PrismaClient } from '@prisma/client'

export interface MemberAccess {
  workflowIds: ReadonlySet<string>
}

const cache = new Map<string, MemberAccess>()
const gen = new Map<string, number>()
const keyOf = (agentId: string, memberId: number) => `${agentId}:${memberId}`

export async function memberAccess(db: Pick<PrismaClient, 'agentMember'>, agentId: string, memberId: number): Promise<MemberAccess | null> {
  const k = keyOf(agentId, memberId)
  const hit = cache.get(k)
  if (hit) return hit
  const g = gen.get(k) ?? 0
  const m = await db.agentMember.findUnique({ where: { id: memberId }, select: { agentAgentId: true, access: { select: { workflowId: true } } } })
  if (!m || m.agentAgentId !== agentId) return null
  const v: MemberAccess = { workflowIds: new Set(m.access.map((a) => a.workflowId)) }
  if ((gen.get(k) ?? 0) === g) cache.set(k, v)
  return v
}

export async function memberCanUseWorkflow(db: Pick<PrismaClient, 'agentMember'>, agentId: string, memberId: number, workflowId: string): Promise<boolean> {
  const a = await memberAccess(db, agentId, memberId)
  return !!a && a.workflowIds.has(workflowId)
}

export function invalidateMemberAccess(agentId: string, memberId: number): void {
  const k = keyOf(agentId, memberId)
  gen.set(k, (gen.get(k) ?? 0) + 1)
  cache.delete(k)
}

export async function invitationAccessData(
  tx: Pick<PrismaClient, 'workflow'>,
  inv: { agentAgentId: string; accessWorkflowIds: readonly string[] | null },
): Promise<{ accessAll: false; access?: { create: Array<{ workflowId: string }> } }> {
  const ids = [...new Set(inv.accessWorkflowIds ?? [])]
  const ok = ids.length ? await tx.workflow.findMany({ where: { workflowId: { in: ids }, agentId: inv.agentAgentId }, select: { workflowId: true } }) : []
  return { accessAll: false, access: { create: ok.map((w) => ({ workflowId: w.workflowId })) } }
}

export async function changeMemberAccess(
  db: PrismaClient,
  q: { agentId: string; memberId: number; add: readonly string[]; remove: readonly string[] },
  inTx?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<string[]> {
  invalidateMemberAccess(q.agentId, q.memberId)
  try {
    return await db.$transaction(async (tx) => {
      if (inTx) await inTx(tx)
      return changeMemberAccessTx(tx, q)
    })
  } finally {
    invalidateMemberAccess(q.agentId, q.memberId)
  }
}

export async function changeMemberAccessTx(tx: Prisma.TransactionClient, q: { agentId: string; memberId: number; add: readonly string[]; remove: readonly string[] }): Promise<string[]> {
  const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM agent_members WHERE id = ${q.memberId} AND agent_id = ${q.agentId} FOR UPDATE`
  if (!locked.length) throw new MemberAccessGone()
  const remove = [...new Set(q.remove)]
  const add = [...new Set(q.add)].filter((id) => !remove.includes(id))
  if (remove.length) await tx.agentMemberAccess.deleteMany({ where: { memberId: q.memberId, workflowId: { in: remove } } })
  if (add.length) await tx.agentMemberAccess.createMany({ data: add.map((workflowId) => ({ memberId: q.memberId, workflowId })), skipDuplicates: true })
  return (await tx.agentMemberAccess.findMany({ where: { memberId: q.memberId }, select: { workflowId: true }, orderBy: { workflowId: 'asc' } })).map((a) => a.workflowId)
}

export class MemberAccessGone extends Error {}

