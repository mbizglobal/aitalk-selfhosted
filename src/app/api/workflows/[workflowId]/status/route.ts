
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { setWorkflowStatus } from '@/lib/workflow/service'
import { workflowServiceErrorResponse } from '@/lib/workflow/service-rest'

// ========================================
// PATCH /api/workflows/[workflowId]/status
// ========================================

export async function PATCH(
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

    const result = await setWorkflowStatus({
      userId: session.user.id,
      workflowId,
      status: body.status,
    })
    if (!result.ok) {
      return workflowServiceErrorResponse(result)
    }

    return NextResponse.json({
      success: true,
      workflow: result.workflow
    })

  } catch (error) {
    console.error('[PATCH /api/workflows/[workflowId]/status] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
