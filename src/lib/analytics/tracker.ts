// Workflow Execution Event Tracker

import { sendGA4Event } from './ga4-client'
import { WorkflowExecutionEvent } from './types'
import { prisma } from '@/lib/prisma'
import { decryptData } from '@/lib/encryption'

export async function trackWorkflowExecution(
  userId: string,
  event: WorkflowExecutionEvent
): Promise<void> {
  try {
    const config = await prisma.analyticsConfig.findUnique({
      where: { userId }
    })

    if (!config?.isEnabled) return

    const apiSecret = await decryptData(config.apiSecret)

    await sendGA4Event(
      {
        measurementId: config.measurementId,
        apiSecret,
        isEnabled: config.isEnabled
      },
      event.agent_id,
      [{
        name: 'workflow_execution',
        params: {
          workflow_id: event.workflow_id,
          workflow_name: truncateString(event.workflow_name, 100),
          agent_id: event.agent_id,
          agent_name: truncateString(event.agent_name, 100),
          trigger_type: event.trigger_type,
          execution_status: event.execution_status,
          duration_ms: event.duration_ms || 0,
          node_count: event.node_count || 0,
          ai_model: event.ai_model || 'unknown',
        }
      }]
    )
  } catch (error) {
    console.error('[Analytics] Failed to track workflow execution:', error)
  }
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 3) + '...'
}
