import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

function serializeBigInt<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ))
}

interface RouteContext {
  params: Promise<{ agentId: string; groupId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId, groupId } = await context.params

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
      where: { id: groupId, agentId },
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

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    return NextResponse.json({ group: serializeBigInt(group) })
  } catch (error) {
    console.error('[GET /api/agents/[agentId]/workflow-groups/[groupId]]', error)
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
    const { name, description, color, isExpanded } = body

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const existingGroup = await prisma.workflowGroup.findFirst({
      where: { id: groupId, agentId }
    })

    if (!existingGroup) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (color !== undefined) updateData.color = color
    if (isExpanded !== undefined) updateData.isExpanded = isExpanded

    const group = await prisma.workflowGroup.update({
      where: { id: groupId },
      data: updateData,
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
    console.error('[PATCH /api/agents/[agentId]/workflow-groups/[groupId]]', error)
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

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const existingGroup = await prisma.workflowGroup.findFirst({
      where: { id: groupId, agentId }
    })

    if (!existingGroup) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    await prisma.workflowGroup.delete({
      where: { id: groupId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/agents/[agentId]/workflow-groups/[groupId]]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
