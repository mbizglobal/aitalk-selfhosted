import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { resolveAgentAccess } from '@/lib/agentAccess'
import { describeCaughtError } from '@/lib/log-mask'
import { isWorkflowPubliclyAccessible } from '@/lib/chat/public-access'
import { resolveNodeType } from '@/lib/workflow/engine/resolve-node-type'

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
    const t = getApiTranslation(request)
    const { agentId } = await params

    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')

    if (!agentId) {
      return NextResponse.json({ error: t('api_error_agent_id_required') }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        id: true,
        userId: true,
        agentId: true,
        title: true,
        accessMode: true,
        vectorStoreId: true,
        chatLimitCount: true,
        chatLimitDurationMinutes: true,
        continuousAnswerLimit: true,
        chatLimitMessage: true,
        continuousAnswerLimitMessage: true,
        widgetSettings: true,
      }
    })

    if (!agent) {
      return NextResponse.json({ error: t('api_error_agent_not_found') }, { status: 404 })
    }

    //
    //
    let hasWorkflow = false
    let fileInput = { imageInput: false, pdfInput: false, csvInput: false }
    let finalAccessMode = agent.accessMode

    if (workflowId) {
      const workflow = await prisma.workflow.findFirst({
        where: {
          workflowId,
          agentId: agent.agentId
        },
        select: {
          workflowJson: true
        }
      })

      if (workflow) {
        try {
          const workflowJson = typeof workflow.workflowJson === 'string'
            ? JSON.parse(workflow.workflowJson)
            : workflow.workflowJson
          const nodes = (workflowJson as any)?.nodes

          //
          finalAccessMode = isWorkflowPubliclyAccessible(nodes, agent.accessMode) ? 'public' : 'team'

          const aiNode = Array.isArray(nodes)
            ? nodes.find((node: any) => resolveNodeType(node) === 'ai')
            : null
          if (aiNode?.data) {
            fileInput = {
              imageInput: !!aiNode.data.imageInput,
              pdfInput: !!aiNode.data.pdfInput,
              csvInput: !!aiNode.data.csvInput,
            }
          }
          hasWorkflow = !!workflowJson
        } catch (e) {
          console.error('Failed to parse workflow JSON:', describeCaughtError(e))
          finalAccessMode = 'team'
          fileInput = { imageInput: false, pdfInput: false, csvInput: false }
          hasWorkflow = false
        }
      }
    }

    const access = await resolveAgentAccess(prisma, { ...agent, accessMode: finalAccessMode }, request)
    const memberInfo = access.member ? {
      id: access.member.id,
      email: access.member.email,
      displayName: access.member.displayName,
    } : undefined

    const rateLimitSettings = {
      chatLimitCount: agent.chatLimitCount ?? 0,
      chatLimitDurationMinutes: agent.chatLimitDurationMinutes ?? 1440,
      continuousAnswerLimit: agent.continuousAnswerLimit ?? 0,
      chatLimitMessage: agent.chatLimitMessage ?? null,
      continuousAnswerLimitMessage: agent.continuousAnswerLimitMessage ?? null,
    }

    let widgetSettings = null
    if (agent.widgetSettings) {
      try {
        widgetSettings = typeof agent.widgetSettings === 'string'
          ? JSON.parse(agent.widgetSettings)
          : agent.widgetSettings
      } catch (e) {
        console.error('Failed to parse widget_settings:', describeCaughtError(e))
      }
    }

    return NextResponse.json({
      id: agent.agentId,
      title: agent.title,
      vectorStoreId: access.authorized ? agent.vectorStoreId : null,
      accessMode: finalAccessMode,
      authorized: access.authorized,
      ownerAuthorized: access.ownerAuthorized,
      member: memberInfo,
      reason: access.authorized ? undefined : access.reason,
      rateLimitSettings,
      widgetSettings,
      fileInput: access.authorized ? fileInput : null,
      workflowMode: hasWorkflow ? 'workflow' : 'simple',
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  } catch (error) {
    console.error('Agent info error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({
      error: t('api_error_internal_server_error')
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