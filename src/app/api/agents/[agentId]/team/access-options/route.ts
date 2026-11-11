
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { memberAccessOptions } from '@/lib/team/member-access-options'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const agent = await prisma.agent.findUnique({ where: { agentId }, select: { userId: true, accessMode: true } })
    if (!agent || agent.userId !== session.user.id) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json({ options: await memberAccessOptions(prisma, { userId: agent.userId, agentId, accessMode: agent.accessMode }) })
  } catch (e) {
    console.error('[team-access] options', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
