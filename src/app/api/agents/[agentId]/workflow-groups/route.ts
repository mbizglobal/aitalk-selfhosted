import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

function serializeBigInt<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ))
}

interface RouteContext {
  params: Promise<{ agentId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await context.params

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const groups = await prisma.workflowGroup.findMany({
      where: { agentId },
      include: {
        workflows: {
          include: {
            workflow: true
          },
          orderBy: { order: 'asc' }
        },
        dataSheets: {
          include: {
            dataSheet: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    return NextResponse.json({ groups: serializeBigInt(groups) })
  } catch (error) {
    console.error('[GET /api/agents/[agentId]/workflow-groups]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await context.params
    const body = await request.json()
    const { name, description, color } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const group = await prisma.workflowGroup.create({
      data: {
        agentId,
        name: name.trim(),
        description: description?.trim() || null,
        color: color || 'blue'
      },
      include: {
        workflows: {
          include: { workflow: true },
          orderBy: { order: 'asc' }
        },
        dataSheets: {
          include: { dataSheet: true }
        }
      }
    })

    return NextResponse.json({ group: serializeBigInt(group) }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/agents/[agentId]/workflow-groups]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
