import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
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
    const { agentId } = await params
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ isOwner: false })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        userId: true,
        title: true,
        user: {
          select: {
            name: true,
            email: true
          }
        }
      }
    })

    if (!agent) {
      return NextResponse.json({ isOwner: false, error: 'Agent not found' }, { status: 404 })
    }

    const isOwner = agent.userId === session.user.id

    if (isOwner) {
      return NextResponse.json({
        isOwner: true,
        owner: {
          id: session.user.id,
          name: agent.user?.name || session.user.name || 'Owner',
          email: agent.user?.email || session.user.email
        },
        agentTitle: agent.title
      })
    }

    return NextResponse.json({ isOwner: false })

  } catch (error) {
    console.error('Check owner error:', describeCaughtError(error))
    return NextResponse.json({ isOwner: false, error: 'Internal server error' }, { status: 500 })
  }
}
