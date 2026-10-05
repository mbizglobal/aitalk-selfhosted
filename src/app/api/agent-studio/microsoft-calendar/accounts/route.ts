
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const connectionId = request.nextUrl.searchParams.get('connectionId')
    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId required' }, { status: 400 })
    }

    const conn = await prisma.workflowConnection.findFirst({
      where: {
        id: connectionId,
        userId: session.user.id,
        provider: 'microsoft_workspace',
      },
      select: { id: true },
    })
    if (!conn) {
      return NextResponse.json({ success: false, error: 'Connection not found' }, { status: 404 })
    }

    const accounts = await prisma.workflowCalendarAccount.findMany({
      where: {
        connectionId,
        status: { in: ['active', 'expired'] },
      },
      select: {
        id: true,
        ownerEmail: true,
        label: true,
        status: true,
        tokenExpiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ success: true, accounts })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to list accounts' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = request.nextUrl.searchParams.get('accountId')
    if (!accountId) {
      return NextResponse.json({ success: false, error: 'accountId required' }, { status: 400 })
    }

    const account = await prisma.workflowCalendarAccount.findFirst({
      where: { id: accountId, userId: session.user.id },
      select: { id: true, agentId: true },
    })
    if (!account) {
      return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 })
    }

    const workflows = await prisma.workflow.findMany({
      where: { agentId: account.agentId },
      select: { workflowId: true, name: true, workflowJson: true },
    })

    const inUseBy: Array<{ workflowId: string; workflowName: string; nodeLabel: string }> = []
    for (const wf of workflows) {
      if (!wf.workflowJson) continue
      try {
        const canvas = JSON.parse(wf.workflowJson)
        const wfNodes = canvas?.nodes || []
        for (const n of wfNodes) {
          if (
            n?.type === 'tool' &&
            n?.data?.toolType === 'microsoft_calendar' &&
            n?.data?.accountId === accountId
          ) {
            inUseBy.push({
              workflowId: wf.workflowId,
              workflowName: wf.name || wf.workflowId,
              nodeLabel: n?.data?.label || n?.data?.name || 'Calendar',
            })
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (inUseBy.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'account_in_use',
          message: 'Cannot delete: this Microsoft account is still used by Calendar nodes.',
          inUseBy,
        },
        { status: 409 }
      )
    }

    await prisma.workflowCalendarAccount.delete({
      where: { id: accountId },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete account' },
      { status: 500 }
    )
  }
}
