
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

interface CalendarNodeOut {
  nodeId: string
  nodeName: string
  type: 'google' | 'microsoft'
  connectionId: string
  calendarId: string
  timezone: string
  weeklyClosedDays?: any
  holidays?: any[]
  closedRanges?: any[]
}

interface WorkflowOut {
  workflowId: string
  workflowName: string
  agentId: string
  agentTitle: string
  calendarNodes: CalendarNodeOut[]
}

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const workflows = await prisma.workflow.findMany({
      where: {
        agent: { userId },
        status: { not: 'archived' },
      },
      select: {
        workflowId: true,
        name: true,
        agentId: true,
        workflowJson: true,
        agent: { select: { title: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const activeConnectionIds = new Set(
      (
        await prisma.workflowConnection.findMany({
          where: {
            userId,
            status: 'active',
            provider: { in: ['google_workspace', 'microsoft_workspace'] },
          },
          select: { id: true },
        })
      ).map((c) => c.id)
    )

    const result: WorkflowOut[] = []

    for (const wf of workflows) {
      let parsed: any
      try {
        parsed = JSON.parse(wf.workflowJson)
      } catch {
        continue
      }
      const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : []
      const calendarNodes: CalendarNodeOut[] = []

      for (const n of nodes) {
        const data = n?.data || {}
        const isGoogle = data.nodeType === 'google_calendar'
        const isMs = data.nodeType === 'microsoft_calendar'
        if (!isGoogle && !isMs) continue
        const connectionId = typeof data.connectionId === 'string' ? data.connectionId : ''
        if (!connectionId || !activeConnectionIds.has(connectionId)) continue

        calendarNodes.push({
          nodeId: String(n.id),
          nodeName: String(data.label || (isGoogle ? 'Google Calendar' : 'Microsoft Calendar')),
          type: isGoogle ? 'google' : 'microsoft',
          connectionId,
          calendarId: typeof data.calendarId === 'string' ? data.calendarId : 'primary',
          timezone: typeof data.timezone === 'string' ? data.timezone : 'Europe/Zurich',
          weeklyClosedDays: data.weeklyClosedDays,
          holidays: Array.isArray(data.holidays) ? data.holidays : undefined,
          closedRanges: Array.isArray(data.closedRanges) ? data.closedRanges : undefined,
        })
      }

      if (calendarNodes.length === 0) continue

      result.push({
        workflowId: wf.workflowId,
        workflowName: wf.name,
        agentId: wf.agentId,
        agentTitle: wf.agent?.title || '',
        calendarNodes,
      })
    }

    return NextResponse.json({ success: true, workflows: result })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to load calendar workflows' },
      { status: 500 }
    )
  }
}
