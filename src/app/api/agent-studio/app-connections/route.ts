import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// ?agentId={agentId}&providers=sendgrid,telegram,smtp
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')
    const providers = searchParams.get('providers')
    const statuses = searchParams.get('statuses')

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const providerList = providers
      ? providers.split(',').map(p => p.trim()).filter(Boolean)
      : ['sendgrid', 'telegram', 'smtp']

    const statusList = statuses
      ? (statuses.split(',').map(s => s.trim()).filter(Boolean) as any[])
      : ['active']

    const connections = await prisma.workflowConnection.findMany({
      where: {
        agentId,
        userId,
        provider: { in: providerList },
        status: { in: statusList },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        label: true,
        status: true,
        createdAt: true,
      }
    })

    return NextResponse.json({ connections })
  } catch (error) {
    console.error('App connections GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
