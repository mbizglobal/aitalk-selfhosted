
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import {
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getScheduleByWorkflow,
  isValidCronExpression,
  calculateNextRunAt,
  getNextRunTimes,
  describeCronExpression
} from '@/lib/schedule'

interface RouteParams {
  params: Promise<{ agentId: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId: session.user.id }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (workflowId) {
      const schedule = await getScheduleByWorkflow(workflowId)

      if (!schedule) {
        return NextResponse.json({ schedule: null })
      }

      return NextResponse.json({
        schedule: {
          ...schedule,
          description: describeCronExpression(schedule.cronExpression),
          nextRunTimes: getNextRunTimes(schedule.cronExpression, 5, schedule.timezone)
        }
      })
    } else {
      const schedules = await prisma.workflowSchedule.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' }
      })

      return NextResponse.json({
        schedules: schedules.map(s => ({
          ...s,
          description: describeCronExpression(s.cronExpression),
          nextRunTimes: getNextRunTimes(s.cronExpression, 3, s.timezone)
        }))
      })
    }
  } catch (error) {
    console.error('[SCHEDULE_API] GET error:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to fetch schedules' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params
    const body = await request.json()
    const { workflowId, cronExpression, timezone = 'UTC', enabled = true } = body

    if (!workflowId || !cronExpression) {
      return NextResponse.json(
        { error: 'workflowId and cronExpression are required' },
        { status: 400 }
      )
    }

    if (!isValidCronExpression(cronExpression)) {
      return NextResponse.json(
        { error: 'Invalid cron expression' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId: session.user.id }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workflow = await prisma.workflow.findFirst({
      where: { workflowId, agentId }
    })

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const existingSchedule = await getScheduleByWorkflow(workflowId)

    if (existingSchedule) {
      await updateSchedule(existingSchedule.id, {
        cronExpression,
        timezone,
        enabled
      })

      const updatedSchedule = await getScheduleByWorkflow(workflowId)

      return NextResponse.json({
        success: true,
        schedule: {
          ...updatedSchedule,
          description: describeCronExpression(cronExpression),
          nextRunTimes: getNextRunTimes(cronExpression, 5, timezone)
        },
        message: 'Schedule updated'
      })
    } else {
      const scheduleId = await createSchedule(workflowId, agentId, cronExpression, timezone, enabled)

      const newSchedule = await prisma.workflowSchedule.findUnique({
        where: { id: scheduleId }
      })

      return NextResponse.json({
        success: true,
        schedule: {
          ...newSchedule,
          description: describeCronExpression(cronExpression),
          nextRunTimes: getNextRunTimes(cronExpression, 5, timezone)
        },
        message: 'Schedule created'
      })
    }
  } catch (error) {
    console.error('[SCHEDULE_API] POST error:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to save schedule' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params
    const { searchParams } = new URL(request.url)
    const scheduleId = searchParams.get('scheduleId')
    const workflowId = searchParams.get('workflowId')

    if (!scheduleId && !workflowId) {
      return NextResponse.json(
        { error: 'scheduleId or workflowId is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId: session.user.id }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (scheduleId) {
      const schedule = await prisma.workflowSchedule.findFirst({
        where: { id: scheduleId, agentId }
      })

      if (!schedule) {
        return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
      }

      await deleteSchedule(scheduleId)
    } else if (workflowId) {
      const schedule = await getScheduleByWorkflow(workflowId)

      if (!schedule) {
        return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
      }

      if (schedule.agentId !== agentId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      await deleteSchedule(schedule.id)
    }

    return NextResponse.json({
      success: true,
      message: 'Schedule deleted'
    })
  } catch (error) {
    console.error('[SCHEDULE_API] DELETE error:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to delete schedule' },
      { status: 500 }
    )
  }
}
