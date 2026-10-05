import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { approveDeployRequest, cancelDeployRequest } from '@/lib/workflow/service'
import { workflowServiceErrorResponse } from '@/lib/workflow/service-rest'

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const host = request.headers.get('host')
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })

    const { requestId } = await params
    const result = await approveDeployRequest({ requestId, approverUserId: session.user.id })
    if (!result.ok) return workflowServiceErrorResponse(result)
    return NextResponse.json({
      success: true,
      workflow: { workflowId: result.workflow.workflowId, status: result.workflow.status },
    })
  } catch (error) {
    console.error('[POST /api/workflows/deploy-requests/[requestId]] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })

    const { requestId } = await params
    const result = await cancelDeployRequest({ userId: session.user.id, requestId })
    if (!result.ok) return workflowServiceErrorResponse(result)
    return NextResponse.json({ success: true, canceled: result.canceled })
  } catch (error) {
    console.error('[DELETE /api/workflows/deploy-requests/[requestId]] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
