
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { listWorkflowVersions, restoreWorkflow } from '@/lib/workflow/service'
import { workflowServiceErrorResponse } from '@/lib/workflow/service-rest'

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

    const result = await listWorkflowVersions({ userId: session.user.id, workflowId })
    if (!result.ok) {
      return workflowServiceErrorResponse(result)
    }
    return NextResponse.json({
      success: true,
      versions: result.versions,
      currentVersion: result.currentVersion,
      status: result.status,
    })
  } catch (error) {
    console.error('[GET /api/workflows/[workflowId]/versions] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, { status: 400 })
    }
    const isPositiveInt32 = (v: unknown): v is number =>
      typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647
    const b = body as Record<string, unknown> | null
    if (!b || typeof b !== 'object' || !isPositiveInt32(b.targetVersion) || !isPositiveInt32(b.expectedVersion)) {
      return NextResponse.json(
        { error: 'targetVersion and expectedVersion must be positive integers', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }

    const result = await restoreWorkflow({
      userId: session.user.id,
      workflowId,
      targetVersion: b.targetVersion,
      expectedVersion: b.expectedVersion,
    })
    if (!result.ok) {
      return workflowServiceErrorResponse(result)
    }
    return NextResponse.json({ success: true, workflow: result.workflow })
  } catch (error) {
    console.error('[POST /api/workflows/[workflowId]/versions] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
