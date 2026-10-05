import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const passkeys = await prisma.passkey.findMany({
      where: { userId: session.user.id, kind: 'passkey' },
      select: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ passkeys })
  } catch (error) {
    console.error('[Passkey List]', error)
    return NextResponse.json({ error: 'Failed to fetch passkeys' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const passkeyId = searchParams.get('id')

    if (!passkeyId) {
      return NextResponse.json({ error: 'Passkey ID required' }, { status: 400 })
    }

    const passkey = await prisma.passkey.findFirst({
      where: {
        id: passkeyId,
        userId: session.user.id,
        kind: 'passkey',
      },
    })

    if (!passkey) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })
    }

    await prisma.passkey.delete({
      where: { id: passkeyId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Passkey Delete]', error)
    return NextResponse.json({ error: 'Failed to delete passkey' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, name } = body as { id: string; name: string }

    if (!id || !name) {
      return NextResponse.json({ error: 'ID and name required' }, { status: 400 })
    }

    const passkey = await prisma.passkey.findFirst({
      where: {
        id,
        userId: session.user.id,
        kind: 'passkey',
      },
    })

    if (!passkey) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })
    }

    await prisma.passkey.update({
      where: { id },
      data: { name },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Passkey Update]', error)
    return NextResponse.json({ error: 'Failed to update passkey' }, { status: 500 })
  }
}
