import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { describeCaughtError } from '@/lib/log-mask'
import { isChatStartTrigger, pickNonAppWorkflow } from '@/lib/workflow/start-trigger'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params
    const { searchParams } = new URL(request.url)
    const previewWorkflowId = searchParams.get('workflowId')

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        agentId: true,
        widgetButtonSettings: true,
        widgetSettings: true,
        workflows: {
          where: previewWorkflowId
            ? { workflowId: previewWorkflowId }
            : { status: 'production' },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          ...(previewWorkflowId ? { take: 1 } : {}),
          select: { workflowId: true, workflowJson: true },
        },
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    let buttonData = null

    if (agent.widgetButtonSettings) {
      try {
        buttonData = typeof agent.widgetButtonSettings === 'string'
          ? JSON.parse(agent.widgetButtonSettings)
          : agent.widgetButtonSettings
      } catch (e) {
        console.error('Failed to parse widgetButtonSettings:', describeCaughtError(e))
      }
    }

    if (!buttonData && agent.widgetSettings) {
      try {
        const fullSettings = typeof agent.widgetSettings === 'string'
          ? JSON.parse(agent.widgetSettings)
          : agent.widgetSettings

        if (fullSettings?.chatButton) {
          buttonData = {
            chatButton: fullSettings.chatButton,
            welcomeMessage: fullSettings.welcomeMessage || null,
            welcomeMessageBackgroundColor: fullSettings.welcomeMessageBackgroundColor || '#ffffff',
            welcomeMessageTextColor: fullSettings.welcomeMessageTextColor || '#1f2937',
            welcomeMessageCloseDelay: fullSettings.welcomeMessageCloseDelay || 1440,
            customIconData: fullSettings.customIconData || null
          }
        }
      } catch (e) {
        console.error('Failed to parse widgetSettings:', describeCaughtError(e))
      }
    }

    if (!buttonData) {
      buttonData = {
        chatButton: {
          showMode: 'always',
          buttonSize: 100,
          backgroundColor: '#000000',
          iconColor: '#ffffff',
          iconType: 'message-circle',
          position: 'right',
          horizontalGap: 20,
          verticalGap: 20,
          shadowColor: '#000000',
          shadowDirection: 'bottom-right',
          shadowIntensity: 0.3
        },
        welcomeMessage: null,
        welcomeMessageBackgroundColor: '#ffffff',
        welcomeMessageTextColor: '#1f2937',
        welcomeMessageCloseDelay: 1440,
        customIconData: null
      }
    }

    let webVoiceEnabled = false
    let webVoiceWorkflowId: string | null = null
    let webVoiceTimeLimitMin = 10
    const activeWorkflow = previewWorkflowId ? agent.workflows?.[0] : pickNonAppWorkflow(agent.workflows ?? [])
    if (activeWorkflow?.workflowJson) {
      try {
        const wfJson = typeof activeWorkflow.workflowJson === 'string'
          ? JSON.parse(activeWorkflow.workflowJson)
          : activeWorkflow.workflowJson
        const nodes = wfJson?.nodes || []
        const pstnStartNode = nodes.find(
          (n: any) => n.data?.nodeType === 'start' && n.data?.triggerType === 'pstn'
        )
        const voiceNode = pstnStartNode
          ? null
          : nodes.find(
              (n: any) =>
                n.data?.nodeType === 'start' &&
                isChatStartTrigger(n.data?.triggerType) &&
                n.data?.webVoice?.enabled === true
            )
        if (voiceNode) {
          webVoiceEnabled = true
          webVoiceWorkflowId = activeWorkflow.workflowId
          webVoiceTimeLimitMin = voiceNode.data?.webVoice?.timeLimitMin ?? 10
        }
      } catch {
        // ignore parse errors
      }
    }

    return NextResponse.json({
      agentId: agent.agentId,
      ...buttonData,
      webVoiceEnabled,
      webVoiceWorkflowId,
      webVoiceTimeLimitMin,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': previewWorkflowId ? 'no-store' : 'public, max-age=60',
      }
    })
  } catch (error) {
    console.error('Button info error:', describeCaughtError(error))
    return NextResponse.json({
      error: 'Internal server error'
    }, {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  })
}
