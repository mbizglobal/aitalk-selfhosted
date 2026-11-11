
import { randomBytes } from 'crypto'
import type { AgentMemberInvitation, Prisma, PrismaClient } from '@prisma/client'
import { getAppBaseUrl } from '@/lib/app-url'
import { emailService } from '@/lib/email'
import { inviteEmailRefused } from '@/lib/auth/google-login'
import { assertSeatForInvitation } from '@/lib/teamSeats'

export class InviteEmailRefusedError extends Error {
  constructor() { super('INVITE_EMAIL_REFUSED') }
}

export function inviteLanguage(locale: string | null | undefined): 'en' | 'de' | 'fr' | 'ko' {
  const l = (locale ?? '').toLowerCase().split('-')[0]
  return l === 'de' || l === 'fr' || l === 'ko' ? l : 'en'
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface InvitationWrite {
  agentAgentId: string
  email: string
  invitedByUserId: string
  workflowId?: string | null
  expiresInHours: number
  access?: { set: string[] } | { add: string }
}

export async function writeInvitation(tx: Prisma.TransactionClient, w: InvitationWrite): Promise<{ invitation: AgentMemberInvitation; sendMail: boolean }> {
  if (inviteEmailRefused(w.email)) throw new InviteEmailRefusedError()
  await assertSeatForInvitation(tx, w.agentAgentId, w.email)

  const existing = await tx.agentMemberInvitation.findFirst({ where: { agentAgentId: w.agentAgentId, email: w.email, status: 'pending' } })
  const adding = w.access && 'add' in w.access ? w.access.add : null

  if (existing && adding && (!existing.expiresAt || existing.expiresAt > new Date())) {
    const ids = existing.accessWorkflowIds.includes(adding) ? existing.accessWorkflowIds : [...existing.accessWorkflowIds, adding]
    const invitation = await tx.agentMemberInvitation.update({ where: { id: existing.id }, data: { accessWorkflowIds: ids } })
    return { invitation, sendMail: false }
  }

  const token = randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + w.expiresInHours * 60 * 60 * 1000)
  const accessIds = !w.access ? undefined
    : 'set' in w.access ? w.access.set
      : [...new Set([...(existing?.accessWorkflowIds ?? []), w.access.add])]

  if (existing) {
    const invitation = await tx.agentMemberInvitation.update({
      where: { id: existing.id },
      data: {
        token,
        expiresAt,
        invitedByUserId: w.invitedByUserId,
        ...(w.workflowId !== undefined ? { workflowId: w.workflowId } : {}),
        ...(accessIds ? { accessWorkflowIds: accessIds } : {}),
        createdAt: new Date(),
        acceptedAt: null,
        status: 'pending',
      },
    })
    return { invitation, sendMail: true }
  }

  const invitation = await tx.agentMemberInvitation.create({
    data: {
      agentAgentId: w.agentAgentId,
      email: w.email,
      token,
      expiresAt,
      invitedByUserId: w.invitedByUserId,
      workflowId: w.workflowId ?? null,
      ...(accessIds ? { accessWorkflowIds: accessIds } : {}),
      status: 'pending',
    },
  })
  return { invitation, sendMail: true }
}

export async function sendInvitationMail(db: PrismaClient, q: { agentAgentId: string; invitation: Pick<AgentMemberInvitation, 'email' | 'token'>; workflowId: string | null }): Promise<boolean> {
  const agent = await db.agent.findUnique({ where: { agentId: q.agentAgentId }, select: { title: true, accessMode: true, user: { select: { name: true, email: true, settings: { select: { locale: true } } } } } })
  if (!agent) return false
  if (agent.accessMode !== 'team') await db.agent.update({ where: { agentId: q.agentAgentId }, data: { accessMode: 'team' } })
  try {
    const inviterName = agent.user.name || agent.user.email || 'Unknown'
    let title = agent.title
    if (q.workflowId) {
      const wf = await db.workflow.findUnique({ where: { workflowId: q.workflowId }, select: { name: true } })
      if (wf?.name) title = wf.name
    }
    await emailService.sendTeamInvitationEmail(q.invitation.email, title, q.invitation.token, getAppBaseUrl(), inviterName, inviteLanguage(agent.user.settings?.locale))
    return true
  } catch (e) {
    console.error('Failed to send invitation email:', e)
    return false
  }
}
