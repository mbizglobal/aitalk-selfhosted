
import { prisma } from '@/lib/prisma'
import { calculateNextRunAt } from './cron-utils'
import { WorkflowEngine } from '../workflow/engine'
import { WorkflowJson, WorkflowContext } from '../workflow/types'
import { safeLogToken, describeCaughtError } from '../log-mask'
import { isSelfHosted } from '@/lib/edition'

//

const globalForScheduler = globalThis as unknown as {
  schedulerInterval: NodeJS.Timeout | undefined
  isSchedulerRunning: boolean
}

function getPollingInterval(): number {
  if (process.env.NODE_ENV === 'development') {
    return 30 * 1000
  }
  return 10 * 60 * 1000
}

export function startScheduler(): void {
  if (globalForScheduler.isSchedulerRunning) {
    console.log('[SCHEDULER] Scheduler already running')
    return
  }

  globalForScheduler.isSchedulerRunning = true
  const interval = getPollingInterval()

  console.log(`[SCHEDULER] Starting scheduler with ${interval / 1000}s interval`)

  processScheduledWorkflows()

  globalForScheduler.schedulerInterval = setInterval(() => {
    processScheduledWorkflows()
  }, interval)
}

export function stopScheduler(): void {
  if (globalForScheduler.schedulerInterval) {
    clearInterval(globalForScheduler.schedulerInterval)
    globalForScheduler.schedulerInterval = undefined
    globalForScheduler.isSchedulerRunning = false
    console.log('[SCHEDULER] Scheduler stopped')
  }
}

async function processScheduledWorkflows(): Promise<void> {
  const now = new Date()

  try {
    const schedules = await prisma.$transaction(async (tx) => {
      const dueSchedules = await tx.workflowSchedule.findMany({
        where: {
          enabled: true,
          nextRunAt: { lte: now }
        },
        take: 10
      })

      if (dueSchedules.length === 0) {
        return []
      }

      for (const schedule of dueSchedules) {
        const nextRunAt = calculateNextRunAt(schedule.cronExpression, schedule.timezone)
        await tx.workflowSchedule.update({
          where: { id: schedule.id },
          data: {
            nextRunAt,
            lastRunAt: now
          }
        })
      }

      return dueSchedules
    }, {
      timeout: 10000,
      maxWait: 5000,
    })

    if (schedules.length === 0) {
      return
    }

    console.log(`[SCHEDULER] Found ${schedules.length} due workflow(s)`)

    for (const schedule of schedules) {
      const scheduleRunKey = `${schedule.id}:${schedule.nextRunAt.toISOString()}`
      setImmediate(() => {
        executeScheduledWorkflow(schedule.workflowId, schedule.agentId, scheduleRunKey)
      })
    }
  } catch (error: any) {
    if (error?.code === 'P2028' || error?.code === 'P1001') {
      //
      console.warn('[SCHEDULER] Temporary DB error (will retry):', describeCaughtError(error))
    } else {
      console.error('[SCHEDULER] Error processing schedules:', describeCaughtError(error))
    }
  }
}

async function executeScheduledWorkflow(
  workflowId: string,
  agentId: string,
  scheduleRunKey: string,
  retryCount: number = 0
): Promise<void> {
  const maxRetries = 30

  if (retryCount > 0) {
    console.log(`[SCHEDULER] Executing workflow: ${safeLogToken(workflowId)} (retry ${retryCount}/${maxRetries})`)
  } else {
    console.log(`[SCHEDULER] Executing workflow: ${safeLogToken(workflowId)}`)
  }

  try {
    const workflow = await prisma.workflow.findUnique({
      where: { workflowId },
      select: {
        workflowJson: true,
        status: true,
        agent: {
          select: {
            userId: true,
            vectorStoreId: true
          }
        }
      }
    })

    if (!workflow) {
      console.error(`[SCHEDULER] Workflow not found: ${safeLogToken(workflowId)}`)
      return
    }

    if (workflow.status !== 'production') {
      console.log(`[SCHEDULER] Workflow ${safeLogToken(workflowId)} is not in production status, skipping`)
      return
    }

    const workflowJson: WorkflowJson = JSON.parse(workflow.workflowJson)

    const subscription = isSelfHosted() ? null : await prisma.subscription.findUnique({
      where: { id: workflow.agent.userId },
      select: { serviceVariant: true, managedRegion: true }
    })
    const isManaged = subscription?.serviceVariant === 'managed'

    const context: WorkflowContext = {
      message: '[Scheduled Trigger]',
      conversationId: `schedule-${workflowId}-${Date.now()}`,
      agentId,
      userId: workflow.agent.userId,
      vectorStoreId: workflow.agent.vectorStoreId || undefined,
      isScheduledTrigger: true,
      skipAiCallCpa: retryCount !== 0,
      scheduleRunKey,
      workflowId,
      isManaged,
      managedRegion: subscription?.managedRegion || undefined,
    }

    const engine = new WorkflowEngine()
    const result = await engine.execute(workflowJson, context)

    //
    if (result.nodeError) {
      console.error(`[SCHEDULER] Workflow ${safeLogToken(workflowId)} failed at node ${safeLogToken(result.nodeError.nodeId)} after ${result.totalDuration}ms`)
    } else {
      console.log(`[SCHEDULER] Workflow ${safeLogToken(workflowId)} completed in ${result.totalDuration}ms`)
    }

    if (result.needsRetry) {
      const nextRetryCount = retryCount + 1
      if (nextRetryCount > maxRetries) {
        console.warn(`[SCHEDULER] Workflow ${safeLogToken(workflowId)} max retries (${maxRetries}) reached, giving up`)
      } else {
        const retryAfterMs = result.retryAfterMs || 1 * 60 * 1000
        console.log(`[SCHEDULER] Workflow ${safeLogToken(workflowId)} needs retry, scheduling in ${retryAfterMs / 1000}s`)

        setTimeout(() => {
          executeScheduledWorkflow(workflowId, agentId, scheduleRunKey, nextRetryCount)
        }, retryAfterMs)
      }
    }
  } catch (error) {
    console.error(`[SCHEDULER] Failed to execute workflow ${safeLogToken(workflowId)}:`, describeCaughtError(error))
  }
}

export async function createSchedule(
  workflowId: string,
  agentId: string,
  cronExpression: string,
  timezone: string = 'UTC',
  enabled: boolean
): Promise<string> {
  const nextRunAt = calculateNextRunAt(cronExpression, timezone)

  const schedule = await prisma.workflowSchedule.create({
    data: {
      workflowId,
      agentId,
      cronExpression,
      timezone,
      nextRunAt,
      enabled
    }
  })

  console.log(`[SCHEDULER] Created schedule ${safeLogToken(schedule.id)} for workflow ${safeLogToken(workflowId)}`)
  return schedule.id
}

export async function updateSchedule(
  scheduleId: string,
  data: {
    cronExpression?: string
    timezone?: string
    enabled?: boolean
  }
): Promise<void> {
  const schedule = await prisma.workflowSchedule.findUnique({
    where: { id: scheduleId }
  })

  if (!schedule) {
    throw new Error('Schedule not found')
  }

  const updateData: any = { ...data }

  if (data.cronExpression || data.timezone) {
    const cronExpression = data.cronExpression || schedule.cronExpression
    const timezone = data.timezone || schedule.timezone
    updateData.nextRunAt = calculateNextRunAt(cronExpression, timezone)
  }

  await prisma.workflowSchedule.update({
    where: { id: scheduleId },
    data: updateData
  })

  console.log(`[SCHEDULER] Updated schedule ${safeLogToken(scheduleId)}`)
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  await prisma.workflowSchedule.delete({
    where: { id: scheduleId }
  })

  console.log(`[SCHEDULER] Deleted schedule ${safeLogToken(scheduleId)}`)
}

export async function getScheduleByWorkflow(workflowId: string) {
  return prisma.workflowSchedule.findFirst({
    where: { workflowId }
  })
}

export async function getSchedulesByAgent(agentId: string) {
  return prisma.workflowSchedule.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' }
  })
}
