
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { cloneWorkflow } from '@/lib/workflow/service'
import { workflowServiceErrorResponse } from '@/lib/workflow/service-rest'

// ========================================
// POST /api/workflows/[workflowId]/clone
// ========================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId } = await params
    const body = await request.json().catch(() => ({}))

    const result = await cloneWorkflow({
      userId: session.user.id,
      workflowId,
      name: body.name,
    })
    if (!result.ok) {
      return workflowServiceErrorResponse(result)
    }

    return NextResponse.json({
      success: true,
      workflow: result.workflow
    }, { status: 201 })

  } catch (error) {
    console.error('[POST /api/workflows/[workflowId]/clone] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
