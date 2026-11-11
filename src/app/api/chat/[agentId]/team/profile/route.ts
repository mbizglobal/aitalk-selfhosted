import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }
    const payload = await verifyActiveAgentMemberToken(prisma, authHeader.slice(7), agentId)
    if (!payload || payload.agentId !== agentId) {
      return NextResponse.json({ error: t('api_error_invalid_or_expired_token') }, { status: 401 })
    }
    const m = await prisma.agentMember.findUnique({ where: { id: payload.memberId }, select: { displayName: true, jobTitle: true } })
    if (!m) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }
    return NextResponse.json({ member: m })
  } catch (error) {
    console.error('Team member profile read error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)

    if (!payload) {
      return NextResponse.json({ error: t('api_error_invalid_or_expired_token') }, { status: 401 })
    }

    if (payload.agentId !== agentId) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const body = await request.json()
    const data: { displayName?: string; jobTitle?: string | null } = {}
    if (body.displayName !== undefined) {
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
      if (!displayName) {
        return NextResponse.json({ error: t('api_error_display_name_required') }, { status: 400 })
      }
      if (displayName.length > 50) {
        return NextResponse.json({ error: t('api_error_display_name_too_long') }, { status: 400 })
      }
      data.displayName = displayName
    }
    if (body.jobTitle !== undefined) {
      const jobTitle = body.jobTitle === null ? '' : typeof body.jobTitle === 'string' ? body.jobTitle.trim() : null
      if (jobTitle === null || jobTitle.length > 50) {
        return NextResponse.json({ error: t('api_error_display_name_too_long') }, { status: 400 })
      }
      data.jobTitle = jobTitle || null
    }
    if (data.displayName === undefined && data.jobTitle === undefined) {
      return NextResponse.json({ error: t('api_error_display_name_required') }, { status: 400 })
    }

    const updatedMember = await prisma.agentMember.update({
      where: { id: payload.memberId },
      data
    })

    return NextResponse.json({
      success: true,
      member: {
        id: updatedMember.id,
        email: updatedMember.email,
        displayName: updatedMember.displayName,
        jobTitle: updatedMember.jobTitle,
        authMethod: updatedMember.authMethod,
      }
    })
  } catch (error) {
    console.error('Team member profile update error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
