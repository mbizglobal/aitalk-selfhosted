
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { changeMemberAccess, MemberAccessGone } from '@/lib/memberAccess'
import { memberAccessOptions, parseAccessChange } from '@/lib/team/member-access-options'

type P = { agentId: string; memberId: string }

async function ownerMember(p: P) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return { error: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) }
  const agent = await prisma.agent.findUnique({ where: { agentId: p.agentId }, select: { userId: true, accessMode: true } })
  if (!agent || agent.userId !== session.user.id) return { error: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) }
  const id = Number(p.memberId)
  const member = Number.isSafeInteger(id) ? await prisma.agentMember.findFirst({ where: { id, agentAgentId: p.agentId }, select: { id: true, access: { select: { workflowId: true } } } }) : null
  if (!member) return { error: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) }
  return { agent, member, options: await memberAccessOptions(prisma, { userId: agent.userId, agentId: p.agentId, accessMode: agent.accessMode }) }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<P> }) {
  try {
    const r = await ownerMember(await params)
    if ('error' in r) return r.error
    return NextResponse.json({ options: r.options, workflowIds: r.member.access.map((a) => a.workflowId) })
  } catch (e) {
    console.error('[team-access] GET', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<P> }) {
  try {
    const p = await params
    const r = await ownerMember(p)
    if ('error' in r) return r.error
    let body: unknown
    try { body = await req.json() } catch { body = null }
    const parsed = parseAccessChange(body, r.options)
    if (!parsed) return NextResponse.json({ error: 'INVALID' }, { status: 400 })
    const workflowIds = await changeMemberAccess(prisma, { agentId: p.agentId, memberId: r.member.id, add: parsed.add, remove: parsed.remove })
    return NextResponse.json({ workflowIds })
  } catch (e) {
    if (e instanceof MemberAccessGone) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    console.error('[team-access] PUT', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
