
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { updateWorkflow, deleteWorkflow } from '@/lib/workflow/service'
import { workflowServiceErrorResponse } from '@/lib/workflow/service-rest'

// ========================================
// GET /api/workflows/[workflowId]
// ========================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId } = await params

    const workflow = await prisma.workflow.findUnique({
      where: { workflowId },
      include: {
        agent: {
          select: {
            agentId: true,
            title: true,
            userId: true
          }
        }
      }
    })

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (workflow.agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      workflow
    })

  } catch (error) {
    console.error('[GET /api/workflows/[workflowId]] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ========================================
// PUT /api/workflows/[workflowId]
// ========================================

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId } = await params
    const body = await request.json()

    const result = await updateWorkflow({
      userId: session.user.id,
      workflowId,
      patch: {
        name: body.name,
        description: body.description,
        workflowJson: body.workflowJson,
        status: body.status,
      },
      expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
      expectedStatus: typeof body.expectedStatus === 'string' ? body.expectedStatus : undefined,
      source: 'ui',
    })
    if (!result.ok) {
      return workflowServiceErrorResponse(result)
    }

    return NextResponse.json({
      success: true,
      workflow: result.workflow
    })

  } catch (error) {
    console.error('[PUT /api/workflows/[workflowId]] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ========================================
// DELETE /api/workflows/[workflowId]
// ========================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId } = await params

    const result = await deleteWorkflow({ userId: session.user.id, workflowId })
    if (!result.ok) {
      return workflowServiceErrorResponse(result)
    }

    return NextResponse.json({
      success: true,
      message: 'Workflow deleted successfully'
    })

  } catch (error) {
    console.error('[DELETE /api/workflows/[workflowId]] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
