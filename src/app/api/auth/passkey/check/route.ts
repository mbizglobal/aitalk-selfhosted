import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        _count: {
          select: { passkeys: { where: { kind: 'passkey' } } }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ hasPasskey: false })
    }

    return NextResponse.json({
      hasPasskey: user._count.passkeys > 0,
      passkeyCount: user._count.passkeys
    })
  } catch (error) {
    console.error('[Passkey Check]', error)
    return NextResponse.json({ error: 'Failed to check passkey status' }, { status: 500 })
  }
}
