import type { Prisma } from '@prisma/client'
import { isEeFeatureEnabled } from '@/lib/license'
import { actorLabel, type SheetActor } from '@/lib/work/sheet-gate'
import { WorkError } from '@/lib/work/errors'

type Tx = Prisma.TransactionClient

export interface ApprovalSettings {
  enabled: boolean
  owner: boolean
  members: number[]
}

export const MAX_APPROVERS = 50

export function parseApprovalSettings(v: unknown): ApprovalSettings | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (typeof o.enabled !== 'boolean' || typeof o.owner !== 'boolean' || !Array.isArray(o.members)) return null
  if (o.members.length > MAX_APPROVERS || !o.members.every((m) => Number.isSafeInteger(m) && (m as number) > 0)) return null
  return { enabled: o.enabled, owner: o.owner, members: [...new Set(o.members as number[])] }
}

async function readProject(tx: Tx, projectId: string) {
  const p = await tx.workProject.findUnique({ where: { id: projectId }, select: { agentId: true, approvalSettings: true } })
  return p ? { agentId: p.agentId, settings: parseApprovalSettings(p.approvalSettings) } : null
}

export async function approvalApplies(tx: Tx, projectId: string): Promise<boolean> {
  if (!isEeFeatureEnabled('approval')) return false
  return (await readProject(tx, projectId))?.settings?.enabled === true
}

export async function eligibleApprovers(tx: Tx, projectId: string): Promise<Set<string>> {
  const p = await readProject(tx, projectId)
  const out = new Set<string>()
  if (!p?.settings) return out
  if (p.settings.owner) out.add('human')
  if (p.agentId && p.settings.members.length) {
    const active = await tx.agentMember.findMany({
      where: { id: { in: p.settings.members }, agentAgentId: p.agentId, status: 'active' },
      select: { id: true },
    })
    for (const m of active) out.add(`member:${m.id}`)
  }
  return out
}

export async function assertMayUnlockSeal(tx: Tx, projectId: string, actor: SheetActor, seal: { preparedBy: string | null; approvedBy: string | null } | null): Promise<void> {
  if (!seal?.approvedBy) return
  const me = actorLabel(actor)
  if (me === seal.preparedBy) throw new WorkError('FORBIDDEN', 'the person who requested this approval cannot unlock it')
  if (!(await eligibleApprovers(tx, projectId)).has(me)) throw new WorkError('FORBIDDEN', 'only an approver can unlock an approved submission')
}
