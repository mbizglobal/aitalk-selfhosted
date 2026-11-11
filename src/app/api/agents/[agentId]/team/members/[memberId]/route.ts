
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getApiTranslation } from '@/lib/translations'
import { describeCaughtError } from '@/lib/log-mask'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ agentId: string; memberId: string }> }) {
  const t = getApiTranslation(request)
  try {
    const { agentId, memberId } = await params
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })

    const agent = await prisma.agent.findUnique({ where: { agentId }, select: { userId: true } })
    if (!agent) return NextResponse.json({ error: t('agent_not_found') }, { status: 404 })
    if (agent.userId !== session.user.id) return NextResponse.json({ error: t('api_error_forbidden') }, { status: 403 })

    const id = /^\d{1,9}$/.test(memberId) ? Number(memberId) : NaN
    const body = await request.json().catch(() => null) as { displayName?: unknown; jobTitle?: unknown } | null
    const data: { displayName?: string; jobTitle?: string | null } = {}
    if (body?.displayName !== undefined) {
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
      if (!displayName) return NextResponse.json({ error: t('api_error_display_name_required') }, { status: 400 })
      if (displayName.length > 50) return NextResponse.json({ error: t('api_error_display_name_too_long') }, { status: 400 })
      data.displayName = displayName
    }
    if (body?.jobTitle !== undefined) {
      const jobTitle = body.jobTitle === null ? '' : typeof body.jobTitle === 'string' ? body.jobTitle.trim() : null
      if (jobTitle === null || jobTitle.length > 50) return NextResponse.json({ error: t('api_error_display_name_too_long') }, { status: 400 })
      data.jobTitle = jobTitle || null
    }
    if (data.displayName === undefined && data.jobTitle === undefined) return NextResponse.json({ error: t('api_error_display_name_required') }, { status: 400 })

    const r = Number.isInteger(id) ? await prisma.agentMember.updateMany({ where: { id, agentAgentId: agentId }, data }) : { count: 0 }
    if (r.count === 0) return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 404 })
    return NextResponse.json({ success: true, member: { id, ...data } })
  } catch (e) {
    console.error('[team] member rename failed:', describeCaughtError(e))
    return NextResponse.json({ error: t('api_error_internal_server') }, { status: 500 })
  }
}
