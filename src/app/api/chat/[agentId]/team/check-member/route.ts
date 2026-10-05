import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
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
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')?.toLowerCase().trim()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        agentId: true,
        accessMode: true,
        title: true
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (agent.accessMode !== 'team') {
      return NextResponse.json({ error: 'Team login not enabled' }, { status: 400 })
    }

    const member = await prisma.agentMember.findUnique({
      where: {
        agentAgentId_email: {
          agentAgentId: agentId,
          email
        }
      },
      select: {
        id: true,
        authMethod: true,
        status: true,
        _count: {
          select: { passkeys: true }
        }
      }
    })

    if (!member) {
      return NextResponse.json({
        exists: false,
        agentTitle: agent.title
      })
    }

    if (member.status !== 'active') {
      return NextResponse.json({
        exists: false,
        suspended: true,
        agentTitle: agent.title
      })
    }

    const hasPasskey = member._count.passkeys > 0

    return NextResponse.json({
      exists: true,
      authMethod: member.authMethod,
      hasPasskey,
      agentTitle: agent.title
    })

  } catch (error) {
    console.error('Check member error:', describeCaughtError(error))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
