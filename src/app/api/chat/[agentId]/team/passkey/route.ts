import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)
    if (!payload || payload.agentId !== agentId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const passkeys = await prisma.agentMemberPasskey.findMany({
      where: { memberId: payload.memberId },
      select: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ passkeys })
  } catch (error) {
    console.error('[Team Passkey List]', describeCaughtError(error))
    return NextResponse.json({ error: 'Failed to get passkeys' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params
    const { searchParams } = new URL(request.url)
    const passkeyId = searchParams.get('id')

    if (!passkeyId) {
      return NextResponse.json({ error: 'Passkey ID is required' }, { status: 400 })
    }

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)
    if (!payload || payload.agentId !== agentId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const passkey = await prisma.agentMemberPasskey.findUnique({
      where: { id: passkeyId },
      select: { memberId: true }
    })

    if (!passkey) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })
    }

    if (passkey.memberId !== payload.memberId) {
      return NextResponse.json({ error: 'Not authorized to delete this passkey' }, { status: 403 })
    }

    await prisma.agentMemberPasskey.delete({
      where: { id: passkeyId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Team Passkey Delete]', describeCaughtError(error))
    return NextResponse.json({ error: 'Failed to delete passkey' }, { status: 500 })
  }
}
