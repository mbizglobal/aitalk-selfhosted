import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

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
    const { sheetId } = body

    if (!sheetId) {
      return NextResponse.json({ error: 'sheetId is required' }, { status: 400 })
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

    const dataSheet = await prisma.dataSheet.findFirst({
      where: { id: sheetId, agentId }
    })

    if (!dataSheet) {
      return NextResponse.json({ error: 'Data Sheet not found' }, { status: 404 })
    }

    const existing = await prisma.workflowGroupDataSheet.findFirst({
      where: { groupId, sheetId }
    })

    if (existing) {
      return NextResponse.json({ error: 'Data Sheet already linked to this group' }, { status: 400 })
    }

    const item = await prisma.workflowGroupDataSheet.create({
      data: {
        groupId,
        sheetId
      }
    })

    return NextResponse.json({ item }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/agents/[agentId]/workflow-groups/[groupId]/data-sheets]', error)
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
    const sheetId = searchParams.get('sheetId')

    if (!sheetId) {
      return NextResponse.json({ error: 'sheetId is required' }, { status: 400 })
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

    const item = await prisma.workflowGroupDataSheet.findFirst({
      where: { groupId, sheetId }
    })

    if (!item) {
      return NextResponse.json({ error: 'Data Sheet not linked to this group' }, { status: 404 })
    }

    await prisma.workflowGroupDataSheet.delete({
      where: { id: item.id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/agents/[agentId]/workflow-groups/[groupId]/data-sheets]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
