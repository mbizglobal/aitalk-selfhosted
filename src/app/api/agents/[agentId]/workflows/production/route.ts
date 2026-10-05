/**
 * Production Workflow API
 * GET /api/agents/[agentId]/workflows/production
 *
 * Returns the production (or latest) workflow JSON for the given agent.
 * Used by Dashboard AI Assistant which doesn't have WorkflowContext.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'

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
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        id: true,
        userId: true,
        title: true,
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let workflow = null
    let workflowId: string | null = null

    const workflowRecord = await prisma.workflow.findFirst({
      where: { agentId },
      orderBy: [
        { status: 'asc' },
        { updatedAt: 'desc' },
      ],
      select: {
        workflowId: true,
        workflowJson: true,
        status: true,
      }
    })

    if (workflowRecord) {
      workflowId = workflowRecord.workflowId
      try {
        const parsed = JSON.parse(workflowRecord.workflowJson)
        workflow = {
          nodes: parsed.nodes || [],
          edges: parsed.edges || [],
        }
      } catch {
      }
    }

    return NextResponse.json({
      success: true,
      agentTitle: agent.title,
      workflowId,
      workflow,
    })

  } catch (error: any) {
    console.error('Production workflow API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
