import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

function serializeBigInt<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ))
}

interface RouteContext {
  params: Promise<{ agentId: string; groupId: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId, groupId } = await context.params
    const body = await request.json()
    const { workflowId, order } = body

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 })
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

    const group = await prisma.workflowGroup.findFirst({
      where: { id: groupId, agentId }
    })

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    const workflow = await prisma.workflow.findFirst({
      where: { workflowId, agentId }
    })

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const existingItem = await prisma.workflowGroupItem.findFirst({
      where: { workflowId }
    })

    if (existingItem) {
      await prisma.workflowGroupItem.delete({
        where: { id: existingItem.id }
      })
    }

    let newOrder = order
    if (newOrder === undefined) {
      const maxOrder = await prisma.workflowGroupItem.aggregate({
        where: { groupId },
        _max: { order: true }
      })
      newOrder = (maxOrder._max.order ?? -1) + 1
    }

    const item = await prisma.workflowGroupItem.create({
      data: {
        groupId,
        workflowId,
        order: newOrder
      },
      include: {
        workflow: true
      }
    })

    return NextResponse.json({ item }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/agents/[agentId]/workflow-groups/[groupId]/workflows]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId, groupId } = await context.params
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 })
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

    const item = await prisma.workflowGroupItem.findFirst({
      where: { groupId, workflowId }
    })

    if (!item) {
      return NextResponse.json({ error: 'Workflow not in this group' }, { status: 404 })
    }

    await prisma.workflowGroupItem.delete({
      where: { id: item.id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/agents/[agentId]/workflow-groups/[groupId]/workflows]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId, groupId } = await context.params
    const body = await request.json()
    const { workflowIds } = body

    if (!Array.isArray(workflowIds)) {
      return NextResponse.json({ error: 'workflowIds array is required' }, { status: 400 })
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

    await prisma.$transaction(
      workflowIds.map((workflowId: string, index: number) =>
        prisma.workflowGroupItem.updateMany({
          where: { groupId, workflowId },
          data: { order: index }
        })
      )
    )

    const group = await prisma.workflowGroup.findFirst({
      where: { id: groupId },
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

    return NextResponse.json({ group: serializeBigInt(group) })
  } catch (error) {
    console.error('[PATCH /api/agents/[agentId]/workflow-groups/[groupId]/workflows]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
