import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string; passkeyId: string }> }
) {
  try {
    const { agentId, passkeyId } = await params

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)
    if (!payload || payload.agentId !== agentId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = await request.json()
    const { name } = body as { name?: string }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (name.length > 100) {
      return NextResponse.json({ error: 'Name is too long (max 100 characters)' }, { status: 400 })
    }

    const passkey = await prisma.agentMemberPasskey.findUnique({
      where: { id: passkeyId },
      select: { memberId: true }
    })

    if (!passkey) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })
    }

    if (passkey.memberId !== payload.memberId) {
      return NextResponse.json({ error: 'Not authorized to update this passkey' }, { status: 403 })
    }

    const updated = await prisma.agentMemberPasskey.update({
      where: { id: passkeyId },
      data: { name: name.trim() },
      select: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      }
    })

    return NextResponse.json({ success: true, passkey: updated })
  } catch (error) {
    console.error('[Team Passkey Update]', describeCaughtError(error))
    return NextResponse.json({ error: 'Failed to update passkey' }, { status: 500 })
  }
}
