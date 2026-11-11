
import { Prisma, type PrismaClient } from '@prisma/client'
import { changeMemberAccess, changeMemberAccessTx, invalidateMemberAccess, MemberAccessGone } from '@/lib/memberAccess'
import { InviteEmailRefusedError, normalizeInviteEmail, sendInvitationMail, writeInvitation } from '@/lib/team/invitations'
import { lockAgentSeats, TeamSeatLimitError } from '@/lib/teamSeats'
import { appTemplateOf } from './app-templates'
import { WorkError } from './errors'
import type { ProjectSettings } from './projects'
import { decryptJson } from './sealed'
import type { WorkSheetDeps } from './sheet-gate'
import type { WorkTeamAccess } from './team-access'

export const PEOPLE_PAGE = 50
const INVITE_HOURS = 72

export type PeopleTab = 'in' | 'out'

export interface AppPerson {
  id: number
  name: string | null
  email: string | null
  status: 'active' | 'suspended'
  jobTitle: string | null
  sameAsOwner?: true
  approverOf?: string[]
}

export interface AppInvite { id: number; email: string; expiresAt: string | null }

export interface AppPeople {
  owner: { name: string | null; email: string | null }
  items: AppPerson[]
  invites: AppInvite[]
  counts: { in: number; out: number; team: number }
  more: boolean
}

interface Target { workflowId: string | null; kind: string; settings: Uint8Array | null }

async function targetOf(db: PrismaClient, access: WorkTeamAccess, projectId: string): Promise<Target> {
  const p = await db.workProject.findFirst({ where: { id: projectId, userId: access.userId, agentId: access.agentId }, select: { workflowId: true, kind: true, settings: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  return p
}

const searchOf = (q: string, byEmail: boolean): Prisma.AgentMemberWhereInput =>
  !q ? {} : byEmail ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } : { displayName: { contains: q, mode: 'insensitive' } }

export async function countAppPeople(deps: Pick<WorkSheetDeps, 'db'>, access: WorkTeamAccess, projectId: string): Promise<number> {
  const t = await targetOf(deps.db, access, projectId)
  if (!t.workflowId) return 1
  const owner = (await deps.db.user.findUnique({ where: { id: access.userId }, select: { email: true } }))?.email?.toLowerCase()
  const n = await deps.db.agentMember.count({ where: { agentAgentId: access.agentId, status: 'active', access: { some: { workflowId: t.workflowId } }, ...(owner ? { NOT: { email: { equals: owner, mode: 'insensitive' } } } : {}) } })
  return 1 + n
}

export async function listAppPeople(
  deps: Pick<WorkSheetDeps, 'db' | 'dataKey'>,
  access: WorkTeamAccess,
  projectId: string,
  q: { tab: PeopleTab; search: string; skip: number; inviteSkip?: number },
): Promise<AppPeople> {
  const db = deps.db
  const t = await targetOf(db, access, projectId)
  const ownerUser = await db.user.findUnique({ where: { id: access.userId }, select: { name: true, email: true } })
  const owner = { name: ownerUser?.name ?? null, email: access.isOwner ? ownerUser?.email ?? null : null }
  if (!t.workflowId) return { owner, items: [], invites: [], counts: { in: 0, out: 0, team: 0 }, more: false }

  const tab: PeopleTab = access.isOwner ? q.tab : 'in'
  const search = q.search.trim().slice(0, 100)
  const base: Prisma.AgentMemberWhereInput = { agentAgentId: access.agentId, ...searchOf(search, access.isOwner) }
  const inWhere = { ...base, access: { some: { workflowId: t.workflowId } } }
  const outWhere = { ...base, access: { none: { workflowId: t.workflowId } } }
  const [nIn, nOut, nTeam] = await Promise.all([
    db.agentMember.count({ where: inWhere }),
    access.isOwner ? db.agentMember.count({ where: outWhere }) : 0,
    access.isOwner ? db.agentMember.count({ where: { agentAgentId: access.agentId } }) : 0,
  ])
  const rows = await db.agentMember.findMany({
    where: tab === 'in' ? inWhere : outWhere,
    select: { id: true, email: true, displayName: true, jobTitle: true, status: true },
    orderBy: [{ email: 'asc' }, { id: 'asc' }],
    skip: Math.max(0, q.skip),
    take: PEOPLE_PAGE + 1,
  })
  const memberMore = rows.length > PEOPLE_PAGE
  const ownerEmail = ownerUser?.email?.toLowerCase() ?? null

  const memberFields = access.isOwner && tab === 'in' ? (appTemplateOf(t.kind)?.ui.settings ?? []).filter((f) => f.type === 'members') : []
  const settings: Record<string, unknown> = memberFields.length && t.settings ? decryptJson<ProjectSettings>(t.settings, await deps.dataKey(db, access.userId)) : {}
  const approverOf = (email: string) => memberFields.filter((f) => Array.isArray(settings[f.name]) && (settings[f.name] as unknown[]).includes(email)).map((f) => f.name)

  const items: AppPerson[] = rows.slice(0, PEOPLE_PAGE).map((m) => {
    const email = m.email.toLowerCase()
    const roles = approverOf(email)
    return access.isOwner
      ? { id: m.id, name: m.displayName, email, jobTitle: m.jobTitle, status: m.status === 'active' ? 'active' : 'suspended', ...(email === ownerEmail ? { sameAsOwner: true as const } : {}), ...(roles.length ? { approverOf: roles } : {}) }
      : { id: m.id, name: m.displayName || null, email: null, jobTitle: m.jobTitle, status: m.status === 'active' ? 'active' : 'suspended' }
  })

  const inviteWhere: Prisma.AgentMemberInvitationWhereInput = {
    agentAgentId: access.agentId, status: 'pending', accessWorkflowIds: { has: t.workflowId },
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    ...(search ? { email: { contains: search, mode: 'insensitive' } } : {}),
  }
  const nInvites = access.isOwner ? await db.agentMemberInvitation.count({ where: inviteWhere }) : 0
  const inviteSkip = Math.max(0, q.inviteSkip ?? 0)
  const inviteRows = nInvites > inviteSkip && tab === 'in'
    ? await db.agentMemberInvitation.findMany({ where: inviteWhere, select: { id: true, email: true, expiresAt: true }, orderBy: [{ email: 'asc' }, { id: 'asc' }], skip: inviteSkip, take: PEOPLE_PAGE + 1 })
    : []
  const invites = inviteRows.slice(0, PEOPLE_PAGE).map((x) => ({ id: x.id, email: x.email, expiresAt: x.expiresAt?.toISOString() ?? null }))
  const more = memberMore || inviteRows.length > PEOPLE_PAGE

  return { owner, items, invites, counts: { in: nIn + nInvites, out: nOut, team: nTeam }, more }
}

async function lockTarget(tx: Prisma.TransactionClient, access: WorkTeamAccess, projectId: string, workflowId: string): Promise<void> {
  const p = await tx.$queryRaw<Array<{ agent_id: string | null; workflow_id: string | null }>>(
    Prisma.sql`SELECT agent_id, workflow_id FROM work_project WHERE id = ${projectId} AND user_id = ${access.userId} FOR UPDATE`,
  )
  if (!p.length || p[0].agent_id !== access.agentId) throw new WorkError('NOT_FOUND')
  if (p[0].workflow_id !== workflowId) throw new WorkError('STALE')
  const w = await tx.$queryRaw<Array<{ agentId: string }>>(Prisma.sql`SELECT "agentId" FROM workflows WHERE "workflowId" = ${workflowId}`)
  if (w[0]?.agentId !== access.agentId) throw new WorkError('STALE')
}

async function writableTarget(db: PrismaClient, access: WorkTeamAccess, projectId: string): Promise<string> {
  if (!access.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner can change who uses this app')
  const t = await targetOf(db, access, projectId)
  if (!t.workflowId) throw new WorkError('INVALID', 'this work app has no workflow')
  return t.workflowId
}

export async function changeAppPerson(deps: Pick<WorkSheetDeps, 'db'>, access: WorkTeamAccess, projectId: string, memberId: number, op: 'add' | 'remove'): Promise<void> {
  const wf = await writableTarget(deps.db, access, projectId)
  try {
    await changeMemberAccess(deps.db, { agentId: access.agentId, memberId, add: op === 'add' ? [wf] : [], remove: op === 'remove' ? [wf] : [] }, (tx) => lockTarget(tx, access, projectId, wf))
  } catch (e) {
    if (e instanceof MemberAccessGone) throw new WorkError('NOT_FOUND')
    throw e
  }
}

export async function inviteToApp(
  deps: Pick<WorkSheetDeps, 'db'>,
  access: WorkTeamAccess,
  projectId: string,
  rawEmail: string,
): Promise<{ result: 'added' } | { result: 'invited' | 'extended'; emailSent: boolean }> {
  const wf = await writableTarget(deps.db, access, projectId)
  const email = normalizeInviteEmail(rawEmail)
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WorkError('INVALID', 'email')

  const touched: { id: number | null } = { id: null }
  try {
    const out = await deps.db.$transaction(async (tx) => {
      await lockTarget(tx, access, projectId, wf)
      await lockAgentSeats(tx, access.agentId)
      const member = await tx.agentMember.findFirst({ where: { agentAgentId: access.agentId, email: { equals: email, mode: 'insensitive' } }, select: { id: true }, orderBy: [{ status: 'asc' }, { id: 'asc' }] })
      if (member) {
        touched.id = member.id
        invalidateMemberAccess(access.agentId, member.id)
        await changeMemberAccessTx(tx, { agentId: access.agentId, memberId: member.id, add: [wf], remove: [] })
        return { added: true as const }
      }
      return { added: false as const, ...(await writeInvitation(tx, { agentAgentId: access.agentId, email, invitedByUserId: access.userId, workflowId: wf, expiresInHours: INVITE_HOURS, access: { add: wf } })) }
    })
    if (out.added) return { result: 'added' }
    if (!out.sendMail) return { result: 'extended', emailSent: false }
    return { result: 'invited', emailSent: await sendInvitationMail(deps.db, { agentAgentId: access.agentId, invitation: out.invitation, workflowId: wf }) }
  } catch (e) {
    if (e instanceof InviteEmailRefusedError) throw new WorkError('INVITE_GMAIL')
    if (e instanceof TeamSeatLimitError) throw new WorkError('SEAT_LIMIT')
    if (e instanceof MemberAccessGone) throw new WorkError('NOT_FOUND')
    throw e
  } finally {
    if (touched.id !== null) invalidateMemberAccess(access.agentId, touched.id)
  }
}

export async function removeAppInvite(deps: Pick<WorkSheetDeps, 'db'>, access: WorkTeamAccess, projectId: string, invitationId: number): Promise<void> {
  const wf = await writableTarget(deps.db, access, projectId)
  await deps.db.$transaction(async (tx) => {
    await lockTarget(tx, access, projectId, wf)
    await lockAgentSeats(tx, access.agentId)
    const inv = await tx.agentMemberInvitation.findFirst({ where: { id: invitationId, agentAgentId: access.agentId, status: 'pending' }, select: { id: true, accessWorkflowIds: true } })
    if (!inv) throw new WorkError('NOT_FOUND')
    await tx.agentMemberInvitation.update({ where: { id: inv.id }, data: { accessWorkflowIds: inv.accessWorkflowIds.filter((id) => id !== wf) } })
  })
}
