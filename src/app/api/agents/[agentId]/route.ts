
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { determineWorkflowMode, extractAgentFieldsFromWorkflow, validateWorkflow } from '@/lib/workflow'
import { MANAGED_MAX_OUTPUT_TOKENS } from '@/lib/managed/output-limit'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// ========================================
// GET /api/agents/[agentId]
// ========================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: {
        storage: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        }
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const responseData = {
      ...agent,
      workflowJson: agent.workflowJson ? JSON.parse(agent.workflowJson) : null
    }

    return NextResponse.json(responseData)
  } catch (error) {
    console.error('[Agent API] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agent' },
      { status: 500 }
    )
  }
}

// ========================================
// PUT /api/agents/[agentId]
// ========================================

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params
    const body = await request.json()

    //
    if (body.maxTokens !== undefined) {
      const parsed = Number(body.maxTokens)
      if (!Number.isFinite(parsed) || parsed < 1) {
        body.maxTokens = undefined
      } else {
        const requested = Math.floor(parsed)
        const subscription = await prisma.subscription.findUnique({
          where: { id: session.user.id },
          select: { serviceVariant: true },
        })
        body.maxTokens = subscription?.serviceVariant === 'managed'
          ? Math.min(requested, MANAGED_MAX_OUTPUT_TOKENS)
          : requested
      }
    }

    const existingAgent = await prisma.agent.findUnique({
      where: { agentId }
    })

    if (!existingAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (existingAgent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let workflowMode = existingAgent.workflowMode || 'simple'
    let workflowJsonString = existingAgent.workflowJson
    let updateData: any = {}

    // ========================================
    // ========================================
    if (body.syncFromPlayground && existingAgent.workflowMode === 'simple') {
      console.log('[Agent API] 🔄 Syncing Playground settings to workflowJson...')

      const workflowJson = existingAgent.workflowJson
        ? JSON.parse(existingAgent.workflowJson)
        : null

      if (workflowJson && workflowJson.nodes) {
        const aiNode = workflowJson.nodes.find((n: any) =>
          n.data?.nodeType === 'ai' ||
          n.id === '2' ||
          n.type === 'ai'
        )

        if (aiNode) {
          if (body.model !== undefined) aiNode.data.model = body.model
          if (body.temperature !== undefined) aiNode.data.temperature = body.temperature
          if (body.maxTokens !== undefined) aiNode.data.maxTokens = body.maxTokens
          if (body.topP !== undefined) aiNode.data.topP = body.topP
          if (body.effort !== undefined) aiNode.data.effort = body.effort
          if (body.verbosity !== undefined) aiNode.data.verbosity = body.verbosity
          if (body.summary !== undefined) aiNode.data.summary = body.summary
          if (body.storeLogs !== undefined) aiNode.data.storeLogs = body.storeLogs
          if (body.systemMessage !== undefined) aiNode.data.systemMessage = body.systemMessage

          updateData.workflowJson = JSON.stringify(workflowJson)
          console.log('[Agent API] ✅ AI node updated in workflowJson')
        } else {
          console.warn('[Agent API] ⚠️ AI node not found in workflowJson')
        }
      }

      if (body.model !== undefined) updateData.model = body.model
      if (body.temperature !== undefined) updateData.temperature = body.temperature
      if (body.maxTokens !== undefined) updateData.maxTokens = body.maxTokens
      if (body.topP !== undefined) updateData.topP = body.topP
      if (body.effort !== undefined) updateData.effort = body.effort
      if (body.verbosity !== undefined) updateData.verbosity = body.verbosity
      if (body.summary !== undefined) updateData.summary = body.summary
      if (body.storeLogs !== undefined) updateData.storeLogs = body.storeLogs
      if (body.systemMessage !== undefined) updateData.systemMessage = body.systemMessage

      console.log('[Agent API] 🔄 Playground → Agent Studio sync completed')
    }

    // ========================================
    // ========================================
    if (body.workflowJson) {
      // const validation = validateWorkflow(body.workflowJson, { strict: false })
      // if (!validation.valid) {
      //   return NextResponse.json(
      //     { error: `Invalid workflow: ${validation.error}` },
      //     { status: 400 }
      //   )
      // }

      workflowMode = determineWorkflowMode(body.workflowJson)
      workflowJsonString = JSON.stringify(body.workflowJson)

      updateData.workflowMode = workflowMode
      updateData.workflowJson = workflowJsonString

      if (workflowMode === 'simple') {
        const extractedFields = extractAgentFieldsFromWorkflow(body.workflowJson)
        Object.assign(updateData, extractedFields)
      }

      console.log(`[Agent API] Workflow mode determined: ${workflowMode}`)
    }

    const isSimpleModeWithWorkflow = body.workflowJson && workflowMode === 'simple'
    const aiSettingFields = ['model', 'temperature', 'maxTokens', 'topP', 'systemMessage', 'effort', 'verbosity', 'summary', 'storeLogs']

    const allowedFields = [
      'title',
      'model',
      'temperature',
      'maxTokens',
      'topP',
      'systemMessage',
      'vectorStoreId',
      'vectorStoreName',
      'accessMode',
      'widgetSettings',
      'chatLimitCount',
      'continuousAnswerLimit',
      'chatLimitMessage',
      'continuousAnswerLimitMessage',
      'chatLimitDurationMinutes',
      'effort',
      'verbosity',
      'summary',
      'storeLogs',
    ]

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (isSimpleModeWithWorkflow && aiSettingFields.includes(field)) {
          continue
        }
        updateData[field] = body[field]
      }
    }

    if (body.widgetSettings && typeof body.widgetSettings === 'object') {
      updateData.widgetSettings = JSON.stringify(body.widgetSettings)
    }

    const updatedAgent = await prisma.agent.update({
      where: { agentId },
      data: {
        ...updateData,
        updatedAt: new Date()
      }
    })

    console.log(`[Agent API] Agent ${agentId} updated successfully (mode: ${workflowMode})`)

    const responseData = {
      ...updatedAgent,
      workflowJson: updatedAgent.workflowJson ? JSON.parse(updatedAgent.workflowJson) : null
    }

    return NextResponse.json(responseData)
  } catch (error) {
    console.error('[Agent API] PUT error:', error)
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    )
  }
}
