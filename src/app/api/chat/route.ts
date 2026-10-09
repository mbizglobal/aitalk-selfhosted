import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'
import { PrismaClient, type AgentMember } from '@prisma/client'
import { OpenAI } from 'openai'
import { maskApiKey, encrypt, decrypt } from '@/lib/encryption'
import { getProviderApiKey } from '@/lib/secret-vault'
import { appTranslations } from '@/lib/translations/app'
import { parseJsonSchemaError } from '@/lib/translations/workflow'
import { resolveAgentAccess } from '@/lib/agentAccess'
import { getIPAndLocation } from '@/lib/geolocation'
import { checkRateLimit, toRateLimitSettings, areRateLimitsEnabled, recordChatRequest } from '@/lib/rate-limit'
import { describeChatSource, isPublicChatSource, isWorkflowPubliclyAccessible } from '@/lib/chat/public-access'
import { isAppWorkflow, pickNonAppWorkflow } from '@/lib/workflow/start-trigger'
import { validateCPAWithCache } from '@/lib/cpa-service'
import { reserveCpaForAiCall, type AiCallReservation } from '@/lib/workflow/ai-call-cpa'
import { isGptReasoningFamily, replaceRetiredChatModel } from '@/lib/managed/model-lineup'
import { MANAGED_MAX_OUTPUT_TOKENS } from '@/lib/managed/output-limit'
import { detectStreamFailure, getStreamFailureCode } from '@/lib/workflow/nodes/ai/utils'
import { assertServiceEntitlement } from '@/lib/entitlement'
import { isAgentLocked, AGENT_LOCKED_MESSAGE, AGENT_LOCKED_CODE } from '@/lib/agent-lock'
import { isSelfHosted } from '@/lib/edition'
import { WorkflowEngine, WorkflowContext, WorkflowDebugLogEntry } from '@/lib/workflow'
import { findReachableCycle } from '@/lib/workflow/validation'
import { readSubWorkflowDefinition, validateSubWorkflowArgs } from '@/lib/workflow/subworkflow'
import { verifyTeamMember } from '@/lib/teamMemberCache'
import { trackWorkflowExecution } from '@/lib/analytics'
import { describeCaughtError, safeLogId, safeLogToken } from '@/lib/log-mask'
import { collectChatStream } from '@/lib/chat/stream-collector'
import { saveExecutedConversation, shouldSaveConversation, shouldPersistCollected, loadPreviousToolTrace } from '@/lib/chat/server-save'
import type { ToolTraceEntry } from '@/lib/workflow/nodes/ai/tool-trace'
import { ensureUserDataKey } from '@/lib/user-data-key'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
const isDevServer = process.env.NODE_ENV !== 'production'

interface ChatRequest {
  message: string
  agentId?: string
  workflowId?: string
  workflowJson?: string
  source?: 'playground' | 'widget' | 'iframe' | 'external' | 'team' | 'workflow-playground'
  customSystemPrompt?: string
  previousResponseId?: string
  clientId?: string
  conversationId?: string
  cpaCache?: any
  conversationHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp?: string
  }>
  conversationSummary?: string
  summaryProtocol?: number
  uploadedFiles?: Array<{
    id: string
    name: string
    type: 'image' | 'pdf' | 'csv'
    base64?: string
    text?: string
    size: number
  }>
  startFromNodeId?: string
  initialContext?: any
  breakpointNodeIds?: string[]
  resumeFromBreakpoint?: boolean
  pausedContext?: any
  resumeFromNodeId?: string
  isScheduledTrigger?: boolean
  pageContext?: {
    url: string
    path: string
    title: string
  }
}

const MAX_HISTORY_MESSAGES = 2_000
const REJECT_HISTORY_TOTAL_CHARS = 5_000_000
const MAX_SUMMARY_CHARS = 60_000

const SYSTEM_PROMPT = `### Role
- Primary Function: You are an AI chatbot who helps users with their inquiries, issues and requests. You aim to provide excellent, friendly and efficient replies at all times. Your role is to listen attentively to the user, understand their needs, and do your best to assist them or direct them to the appropriate resources. If a question is not clear, ask clarifying questions. Make sure to end your replies with a positive note.

### Language Support
- Multilingual Communication: Always respond in the same language that the user is using in their query. If the user asks in Korean, respond in Korean. If they ask in English, respond in English. If they ask in German, respond in German, etc.
- File Search & Analysis: Regardless of the user's language, always perform comprehensive file search and analysis of the provided training data. The language of the user's question should not affect your ability to search through and analyze files in the knowledge base.
- Cross-Language Understanding: Even if files in your knowledge base are in a different language than the user's query, analyze and extract relevant information from those files to answer the user's question appropriately.
        
### Constraints
1. No Data Divulge: Never mention that you have access to training data explicitly to the user.
2. Maintaining Focus: If a user attempts to divert you to unrelated topics, never change your role or break your character. Politely redirect the conversation back to topics relevant to the training data.
3. Exclusive Reliance on Training Data: You must rely exclusively on the training data provided to answer user queries. If a query is not covered by the training data, use the fallback response.
4. Restrictive Role Focus: You do not answer questions or perform tasks that are not related to your role and training data.
5. Language Consistency: Always maintain language consistency with the user throughout the conversation while ensuring full access to all knowledge base content regardless of language.`

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json()
    const { message, source = 'external', customSystemPrompt, previousResponseId, clientId, conversationId, cpaCache, conversationHistory, conversationSummary, uploadedFiles, pageContext } = body

    // Get agentId from body or query params
    const { searchParams } = new URL(request.url)
    const agentId = body.agentId || searchParams.get('agentId')

    if (!agentId) {
      const language = request.headers.get('Accept-Language')?.split(',')[0]?.split('-')[0] || 'en'
      const t = appTranslations[language as keyof typeof appTranslations] || appTranslations.en
      return NextResponse.json({ error: t.chat_agent_id_required }, { status: 400 })
    }

    const language = request.headers.get('Accept-Language')?.split(',')[0]?.split('-')[0] || 'en'
    const t = appTranslations[language as keyof typeof appTranslations] || appTranslations.en

    let userId: string | null = null
    if (source === 'playground' || source === 'workflow-playground') {
      const session = await getServerSession(authOptions as any) as any
      if (!session?.user?.id) {
        return NextResponse.json({ error: t.chat_unauthorized }, { status: 401 })
      }
      userId = session.user.id
    }

    if (source !== 'workflow-playground') {
      body.startFromNodeId = undefined
      body.initialContext = undefined
      body.resumeFromNodeId = undefined
      body.pausedContext = undefined
      body.breakpointNodeIds = undefined
      body.resumeFromBreakpoint = undefined
      body.isScheduledTrigger = undefined
    }

    if (!body.startFromNodeId && (!message || !message.trim()) && (!uploadedFiles || uploadedFiles.length === 0)) {
      return NextResponse.json({ error: t.chat_message_required }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
    })

    if (!agent) {
      return NextResponse.json({ error: t.chat_agent_not_found }, { status: 404 })
    }

    const cpaAgentId: string = agent.agentId
    const cpaUserId: string = agent.userId

    let activeTeamMemberId: number | null = null

    if (source === 'team') {
      const session = await getServerSession(authOptions as any) as any
      const isOwner = session?.user?.id && agent.userId === session.user.id

      if (isOwner) {
        activeTeamMemberId = null
      } else {
        const authHeader = request.headers.get('Authorization')
        const teamAuth = await verifyTeamMember(prisma, authHeader, agentId)

        if (!teamAuth.authorized) {
          return NextResponse.json({
            error: 'Team authorization required',
            code: 'TEAM_AUTH_REQUIRED',
            reason: teamAuth.reason
          }, { status: 401 })
        }

        activeTeamMemberId = teamAuth.memberId || null
      }
    }

    if ((source === 'playground' || source === 'workflow-playground') && agent.userId !== userId) {
      return NextResponse.json({ error: t.chat_unauthorized }, { status: 403 })
    }

    const isPublicSource = isPublicChatSource(source)

    if (isPublicSource) {
      const limitsEnabled = areRateLimitsEnabled(agent)
      const rateLimitSettings = toRateLimitSettings(agent)
      try {

        const rateLimitResult = await checkRateLimit(
          prisma,
          agentId,
          clientId || null,
          rateLimitSettings
        )

        if (!rateLimitResult.allowed) {
          return NextResponse.json({
            error: rateLimitResult.message || 'Rate limit exceeded',
            code: 'RATE_LIMIT_EXCEEDED',
            reason: rateLimitResult.reason,
            resetTime: rateLimitResult.resetTime?.toISOString()
          }, { status: 429 })
        }
      } catch (rateLimitError) {
        console.error('[CHAT] Rate limit check failed:', describeCaughtError(rateLimitError))
        if (limitsEnabled) {
          return NextResponse.json({
            error: t.chat_rate_limit_unavailable,
            code: 'RATE_LIMIT_UNAVAILABLE'
          }, { status: 503 })
        }
        recordChatRequest(agentId, clientId || null)
      }
    }

    const userIdForCPA = userId || agent.userId
    if (userIdForCPA) {
      const entitlement = await assertServiceEntitlement(userIdForCPA)
      if (entitlement.reason === 'trial_expired') {
        return NextResponse.json(
          { error: 'Trial has ended. Please subscribe to continue.', code: 'TRIAL_EXPIRED' },
          { status: 403 }
        )
      }
      if (entitlement.reason === 'service_inactive') {
        return NextResponse.json(
          { error: 'Your service is inactive. Please subscribe to continue.', code: 'SERVICE_INACTIVE' },
          { status: 403 }
        )
      }
      if (entitlement.reason === 'pending_access') {
        return NextResponse.json(
          { error: 'Account pending approval. Enter a partner code or wait for approval.', code: 'PENDING_ACCESS' },
          { status: 403 }
        )
      }
      if (await isAgentLocked(cpaAgentId)) {
        return NextResponse.json({ error: AGENT_LOCKED_MESSAGE, code: AGENT_LOCKED_CODE }, { status: 403 })
      }
      try {
        const cpaValidation = await validateCPAWithCache(userIdForCPA, cpaCache)

        if (!cpaValidation.allowed) {
          return NextResponse.json({
            error: t.cpa_insufficient_balance,
            code: 'INSUFFICIENT_CPA',
            balance: cpaValidation.balance,
            resetDate: cpaValidation.resetDate?.toISOString(),
            newCache: cpaValidation.newCache
          }, { status: 402 }) // 402 Payment Required
        }

        if (cpaValidation.newCache && !cpaCache) {
        }
      } catch (cpaError) {
        return NextResponse.json({
          error: t.cpa_verification_failed,
          code: 'CPA_VERIFICATION_FAILED'
        }, { status: 500 })
      }
    }

    try {
      if (body.workflowJson && source === 'workflow-playground') {
        console.log(`[CHAT] Executing workflow from Test Panel (direct JSON)`)

        //
        //
        const cycleNodeId = findReachableCycle(
          typeof body.workflowJson === 'string' ? body.workflowJson : JSON.stringify(body.workflowJson),
          [body.startFromNodeId, body.resumeFromNodeId],
        )
        if (cycleNodeId) {
          const msg = `Workflow contains a cycle through node "${cycleNodeId}"`
          console.warn(`[CHAT] Test Panel workflow rejected — cycle through ${safeLogId(cycleNodeId)}`)
          return NextResponse.json({
            error: msg,
            code: 'WORKFLOW_STRUCTURE_INVALID',
          }, { status: 400 })
        }

        const testRunWorkflow = typeof body.workflowId === 'string' && body.workflowId
          ? await prisma.workflow.findFirst({ where: { workflowId: body.workflowId, agentId: agent.agentId }, select: { workflowId: true } })
          : null

        return await executeWorkflowMode(
          agent,
          message,
          request,
          {
            source,
            previousResponseId,
            clientId,
            conversationId,
            conversationHistory,
            conversationSummary,
            summaryProtocol: body.summaryProtocol,
            language,
            agentId,
            uploadedFiles,
            pageContext,
            workflowJson: body.workflowJson,
            workflowId: body.workflowId || 'test-panel',
            runWorkflowId: testRunWorkflow?.workflowId,
            startFromNodeId: body.startFromNodeId,
            initialContext: body.initialContext,
            breakpointNodeIds: body.breakpointNodeIds,
            resumeFromBreakpoint: body.resumeFromBreakpoint,
            pausedContext: body.pausedContext,
            resumeFromNodeId: body.resumeFromNodeId,
            isScheduledTrigger: body.isScheduledTrigger,
          }
        )
      }

      const workflowIdParam = body.workflowId || searchParams.get('workflowId')

      let selectedWorkflow = null

      if (workflowIdParam) {
        selectedWorkflow = await prisma.workflow.findFirst({
          where: {
            workflowId: workflowIdParam,
            agentId: agent.agentId,
            status: 'production'
          }
        })

        if (selectedWorkflow && isAppWorkflow(selectedWorkflow.workflowJson)) selectedWorkflow = null
        if (!selectedWorkflow) {
          console.warn(`[CHAT] Workflow ${safeLogId(workflowIdParam)} not found or not active for agent ${agent.agentId}`)
          return NextResponse.json({
            error: 'Requested workflow not found or not available',
            code: 'WORKFLOW_NOT_FOUND'
          }, { status: 404 })
        }
      }

      if (!selectedWorkflow) {
        selectedWorkflow = pickNonAppWorkflow(await prisma.workflow.findMany({
          where: {
            agentId: agent.agentId,
            status: 'production'
          },
          orderBy: [
            { updatedAt: 'desc' },
            { id: 'desc' },
          ]
        }))
      }

      if (selectedWorkflow && selectedWorkflow.workflowJson) {
        console.log(`[CHAT] Executing workflow: ${safeLogToken(selectedWorkflow.workflowId)} [source=${describeChatSource(source)}, workflowId=${workflowIdParam ? safeLogId(workflowIdParam) : 'auto'}]`)

        if (isPublicSource) {
          try {
            const workflowJson = typeof selectedWorkflow.workflowJson === 'string'
              ? JSON.parse(selectedWorkflow.workflowJson)
              : selectedWorkflow.workflowJson

            if (!isWorkflowPubliclyAccessible(workflowJson?.nodes, agent.accessMode)) {
              console.log(`[CHAT] Workflow is not public, blocking public access [source=${describeChatSource(source)}]`)
              return NextResponse.json({
                error: 'This workflow is not available for public access.',
                code: 'ACCESS_DENIED'
              }, { status: 403 })
            }
          } catch (e) {
            console.error('[CHAT] Failed to check workflow accessMode:', describeCaughtError(e))
            return NextResponse.json({
              error: 'This workflow is not available for public access.',
              code: 'ACCESS_DENIED'
            }, { status: 403 })
          }
        }

        return await executeWorkflowMode(
          agent,
          message,
          request,
          {
            source,
            previousResponseId,
            clientId,
            conversationId,
            conversationHistory,
            conversationSummary,
            summaryProtocol: body.summaryProtocol,
            language,
            agentId,
            uploadedFiles,
            pageContext,
            workflowJson: selectedWorkflow.workflowJson,
            workflowId: selectedWorkflow.workflowId,
            runWorkflowId: selectedWorkflow.workflowId,
            startFromNodeId: body.startFromNodeId,
            initialContext: body.initialContext,
            breakpointNodeIds: body.breakpointNodeIds,
            resumeFromBreakpoint: body.resumeFromBreakpoint,
            pausedContext: body.pausedContext,
            resumeFromNodeId: body.resumeFromNodeId,
            isScheduledTrigger: body.isScheduledTrigger,
          }
        )
      } else {
        console.error(`[CHAT] No workflow found for agent: ${agentId}`)
        return NextResponse.json({
          error: t.chat_no_workflow_found || 'No workflow configured for this agent. Please create a workflow in Agent Studio.'
        }, { status: 400 })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Workflow execution failed'

      const streamFailureCode = getStreamFailureCode(error)
      const isSchemaError =
        streamFailureCode === 'invalid_json_schema' ||
        errorMessage.includes('invalid_json_schema') ||
        errorMessage.includes("Missing '") ||
        errorMessage.includes('Invalid schema')

      const isKycError = errorMessage.includes('organization must be verified') ||
                          errorMessage.includes('must be verified to')
      const isUserError = isSchemaError || isKycError

      //
      //      `Missing required fields: recipient, message`, `RAG Provider not configured` …).
      //
      //
      if (isUserError) {
        console.warn('[CHAT] Workflow user error:', errorMessage.split('\n')[0])
      } else {
        console.error('[CHAT] Workflow execution failed:', errorMessage)
      }

      if (isKycError) {
        return NextResponse.json({
          error: t.chat_widget?.errors?.organization_not_verified || 'OpenAI organization verification (KYC) is required to use GPT-5 or later models. Please contact your agent administrator.'
        }, { status: 403 })
      }

      if (isSchemaError) {
        const userFriendlyError = parseJsonSchemaError(language, errorMessage)
        return NextResponse.json({
          error: userFriendlyError
        }, { status: 400 })
      }

      return NextResponse.json({
        error: t.chat_widget?.errors?.general_error || 'An error occurred. Please try again.'
      }, { status: 500 })
    }

    const user = await prisma.user.findUnique({
      where: { id: agent.userId },
      include: {
        aiProviders: true,
        zki: true,
        subscription: isSelfHosted() ? false : {
          select: { serviceVariant: true, managedRegion: true }
        }
      }
    })

    const createInfoResponse = (message: string) => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(message))
            controller.close()
          }
        }),
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      )
    }

    if (!user) {
      return createInfoResponse('API key is not configured. Please set up your API key in Settings.')
    }

    let userApiKey: string
    try {
      const key = await getProviderApiKey(prisma, user.id, 'openai', user)
      if (!key) {
        return createInfoResponse('API key is not configured. Please set up your API key in Settings.')
      }
      userApiKey = key
    } catch (error: any) {
      const isVaultError = error?.message?.includes('[Secret Vault]')
      return createInfoResponse(isVaultError ? error.message : 'Failed to load API key. Please check your API key settings.')
    }

    const openai = new OpenAI({ apiKey: userApiKey })

    let vectorStoreId = agent.vectorStoreId

    if (!vectorStoreId) {
      try {
        const createdVectorStore = await openai.vectorStores.create({
          name: `agent_${agentId}`,
        })

        vectorStoreId = createdVectorStore.id

        await prisma.agent.update({
          where: { agentId },
          data: { vectorStoreId },
        })

      } catch (error) {
        console.error(`[CHAT] Failed to create vector store for agent ${agentId}:`, describeCaughtError(error))
        return NextResponse.json({
          error: t.chat_vector_store_not_configured,
        }, { status: 400 })
      }
    }


    const { ip } = await getIPAndLocation(request)

    try {
      const vectorStoreFiles = await openai.vectorStores.files.list(vectorStoreId)
      if (vectorStoreFiles.data) {
        vectorStoreFiles.data.forEach((f: any) => {
        })
      }
    } catch (error) {
      console.error(`[CHAT] Failed to list vector store files:`, describeCaughtError(error))
    }

    let aiConfig: {
      model?: string
      temperature?: number
      maxTokens?: number
      topP?: number
      effort?: string
      verbosity?: string
      summary?: string
      storeLogs?: boolean
      systemMessage?: string
    } = {}
    if (agent.aiConfig) {
      try {
        aiConfig = JSON.parse(agent.aiConfig)
      } catch (e) {
        console.error('Failed to parse aiConfig:', describeCaughtError(e))
      }
    }

    const isManaged = user?.subscription?.serviceVariant === 'managed'
    const savedModelName = aiConfig.model || 'gpt-6-luna'
    const modelName = isManaged ? replaceRetiredChatModel(savedModelName) : savedModelName
    const temperature = aiConfig.temperature ?? 0.7
    const maxTokens = aiConfig.maxTokens ?? 2048
    const topP = aiConfig.topP ?? 1.0
    const effort = aiConfig.effort || 'medium'
    const verbosity = aiConfig.verbosity && ['low', 'medium', 'high'].includes(aiConfig.verbosity) ? aiConfig.verbosity : 'medium'
    const summary = aiConfig.summary || 'auto'
    const storeLogs = aiConfig.storeLogs !== undefined ? aiConfig.storeLogs : true
    const systemMessage = customSystemPrompt || aiConfig.systemMessage || SYSTEM_PROMPT


    try {
      let inputContent: any = message.trim() || 'What\'s in these images?'

      if (uploadedFiles && uploadedFiles.length > 0) {
        // https://platform.openai.com/docs/guides/images-vision
        const contentParts: any[] = []

        if (message && message.trim()) {
          contentParts.push({ type: 'input_text', text: message.trim() })
        } else {
          contentParts.push({ type: 'input_text', text: 'Analyze these images and describe what you see.' })
        }

        for (const file of uploadedFiles) {
          if (file.type === 'image') {
            contentParts.push({
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${file.base64}`,
              detail: 'high'
            })
          }
        }

        inputContent = [{
          role: 'user',
          content: contentParts
        }]
      }

      const requestConfig: any = {
        model: modelName,
        tools: [
          {
            type: 'file_search',
            vector_store_ids: [vectorStoreId],
            max_num_results: 20
          },
        ],
        input: inputContent,
        instructions: systemMessage,
        temperature: temperature,
        // (docs/chat/output_cpa.md §5-2·§5-5, codex R1 #1 → R12 #1)
        max_output_tokens: isManaged ? Math.min(maxTokens, MANAGED_MAX_OUTPUT_TOKENS) : maxTokens,
        stream: true,
        metadata: {
          agentId,
          source,
          teamMemberId: activeTeamMember ? String(activeTeamMember.id) : undefined,
          storeLogs: String(storeLogs),
        },
      }

      if (isGptReasoningFamily(modelName)) {
        delete requestConfig.temperature
        requestConfig.text = {
          verbosity: verbosity
        }
        requestConfig.reasoning = {
          effort: effort
        }
        if (summary && ['concise', 'detailed'].includes(summary)) {
          requestConfig.reasoning.summary = summary
        }
      }

      if (modelName === 'gpt-4.1' || modelName === 'gpt-4.1-mini' || modelName === 'gpt-4o-mini') {
        requestConfig.top_p = topP
      }

      if (previousResponseId) {
        requestConfig.previous_response_id = previousResponseId
      } else {
      }

      const debugRequestPayload = sanitizeRequestPayload(requestConfig)
      const requestStartTime = Date.now()
      const originalUserMessage = message.trim()

      let reservation: AiCallReservation
      try {
        reservation = await reserveCpaForAiCall({ agentId: cpaAgentId, userId: cpaUserId, isManaged }, modelName)
      } catch (error: any) {
        if (error?.code === 'INSUFFICIENT_CPA') {
          return NextResponse.json(
            { error: 'Insufficient CPA balance.', code: 'INSUFFICIENT_CPA' },
            { status: 402 }
          )
        }
        throw error
      }

      let response
      try {
        response = await openai.responses.create(requestConfig)
      } catch (error: any) {
        if (error?.code === 'previous_response_not_found' && previousResponseId) {
          delete requestConfig.previous_response_id
          try {
            response = await openai.responses.create(requestConfig)
          } catch (retryError) {
            reservation.cancel()
            throw retryError
          }
        } else {
          reservation.cancel()     // 〃
          throw error
        }
      }


      return new Response(
        new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder()

            let sawChunk = false

            try {
              const streamChunks: any[] = []
              let messageText = ''
              let responseId: string | null = null
              let usageData: any = null
              let completionPayload: any = null

              const responseStream = response as unknown as AsyncIterable<any>
              for await (const chunk of responseStream) {
                const failure = detectStreamFailure(chunk)
                if (failure) {
                  console.error(`[CHAT] Stream failed: code=${failure.code ?? '-'} resp=${failure.responseId ?? '-'} (${failure.message.length} chars)`)
                  if (failure.usageInputTokens != null) reservation.settle(failure.usageInputTokens, failure.usageOutputTokens)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`))
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                  controller.close()
                  return
                }

                streamChunks.push(chunk)

                if (chunk.type === 'response.output_text.delta' && chunk.delta) {
                  messageText += chunk.delta
                  sawChunk = true
                }

                if (chunk.type === 'response.output_text.delta' && chunk.delta) {
                  const outputData = `data: ${JSON.stringify({ content: chunk.delta })}\n\n`
                  controller.enqueue(encoder.encode(outputData))
                } else if (chunk.type === 'response.completed' || chunk.type === 'response.incomplete') {
                  completionPayload = chunk.response || null

                  if (chunk.response && chunk.response.id) {
                    responseId = chunk.response.id
                    usageData = chunk.response.usage

                    reservation.settle(
                      usageData?.input_tokens ?? usageData?.prompt_tokens,
                      usageData?.output_tokens ?? usageData?.completion_tokens
                    )

                    const isIncomplete = chunk.type === 'response.incomplete'
                    const completionData = {
                      type: 'completed',
                      responseId: responseId,
                      model: modelName,
                      apiKey: maskApiKey(userApiKey),
                      ...(isIncomplete && {
                        incomplete: true,
                        incompleteReason: chunk.response?.incomplete_details?.reason || 'unknown',
                      }),
                      ...(usageData && {
                        inputTokens: usageData.input_tokens || usageData.prompt_tokens,
                        outputTokens: usageData.output_tokens || usageData.completion_tokens
                      })
                    }

                    const completionStr = `data: ${JSON.stringify(completionData)}\n\n`
                    controller.enqueue(encoder.encode(completionStr))
                  }

                  if (source === 'workflow-playground' || source === 'playground') {
                    const debugLogs = buildSimpleModeDebugLogs({
                      userMessage: originalUserMessage,
                      aiText: messageText,
                      responseId,
                      usageData,
                      requestPayload: debugRequestPayload,
                      completionPayload,
                      elapsedMs: Date.now() - requestStartTime
                    })
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: 'debug-log', logs: debugLogs })}\n\n`)
                    )
                  }

                  controller.enqueue(encoder.encode('data: [DONE]\n\n'))

                  if (source === 'widget' && agent.accessMode === 'public' && responseId) {
                    setImmediate(async () => {
                      try {

                      } catch (error) {
                        console.error(`[CHAT] Error saving conversation:`, describeCaughtError(error))
                      }
                    })
                  }


                  controller.close()
                  return
                }
              }

              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            } catch (error) {
              console.error('[CHAT] Stream error:', describeCaughtError(error))
              controller.error(error)
            } finally {
              reservation.finalize(sawChunk)
            }
          }
        }),
        {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        }
      )
    } catch (error) {
      console.error('[CHAT] OpenAI API Error:', describeCaughtError(error))
      throw error
    }

  } catch (error) {
    console.error('Failed to process chat:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to process chat' },
      { status: 500 }
    )
  }
}

function sanitizeRequestPayload(config: any) {
  try {
    const cloned = JSON.parse(JSON.stringify(config))
    if (cloned && 'stream' in cloned) {
      delete cloned.stream
    }
    return cloned
  } catch {
    return config
  }
}

function buildSimpleModeDebugLogs(params: {
  userMessage: string
  aiText: string
  responseId: string | null
  usageData: any
  requestPayload: any
  completionPayload: any
  elapsedMs: number
}): WorkflowDebugLogEntry[] {
  const {
    userMessage,
    aiText,
    responseId,
    usageData,
    requestPayload,
    completionPayload,
    elapsedMs
  } = params

  return [
    {
      nodeId: '1',
      nodeName: 'Start',
      duration: 5,
      status: 'success',
      input: { message: userMessage },
      output: { forwardedMessage: userMessage }
    },
    {
      nodeId: '2',
      nodeName: 'AI',
      duration: Math.max(5, elapsedMs),
      status: 'success',
      input: requestPayload,
      output: {
        responseId,
        usage: usageData,
        text: aiText,
        fullResponse: completionPayload
      }
    },
    {
      nodeId: '3',
      nodeName: 'End',
      duration: 2,
      status: 'success',
      input: { response: aiText },
      output: { status: 'completed' }
    }
  ]
}

function logRetryOutcome(label: string, result: { nodeError?: { nodeId: string }; needsRetry?: boolean }): void {
  if (result.nodeError) {
    console.error(`[CHAT] ${label} failed at node ${safeLogToken(result.nodeError.nodeId)}`)
    return
  }
  console.log(`[CHAT] ${label} completed, needsRetry: ${result.needsRetry}`)
}

// ========================================
// ========================================

const pendingConversationSaves = new Map<string, Promise<unknown>>()
const PENDING_SAVE_WAIT_MS = 2000
const pendingSaveKey = (agentId: string, clientId: string | undefined, conversationId: string) =>
  JSON.stringify([agentId, clientId ?? '', conversationId])
const PREVIOUS_SAVE_WAIT_MS = 5000

function maybeSaveOnStream(
  response: Response,
  ctx: {
    agent: any
    request: NextRequest
    source: string
    userMessage: string
    clientId?: string
    conversationId?: string
    previousResponseId?: string
    toolTrace?: ToolTraceEntry[]
  }
): Response {
  const save = shouldSaveConversation({ source: ctx.source, agentAccessMode: ctx.agent?.accessMode })
  if (!save && !isDevServer) return response

  return collectChatStream(response, collected => {
    if (isDevServer) {
      console.log(`[Chat/turn] USER (${safeLogToken(ctx.source)}): ${ctx.userMessage.slice(0, 300)}`)
      console.log(`[Chat/turn] AI: ${(collected.content || '').slice(0, 500)}${collected.sawError ? ' (error)' : ''}`)
    }
    if (!save) return
    if (!shouldPersistCollected({
      responseId: collected.responseId,
      clientId: ctx.clientId,
      content: collected.content,
      sawError: collected.sawError,
    })) return

    if (collected.truncated) {
      console.warn(`[CHAT] Conversation content truncated at cap for agent=${safeLogToken(ctx.agent?.agentId)}`)
    }

    const key = ctx.conversationId ? pendingSaveKey(ctx.agent.agentId, ctx.clientId, ctx.conversationId) : null
    const previous = key ? pendingConversationSaves.get(key) : undefined
    const saving = (async () => {
      if (previous) await Promise.race([previous.catch(() => {}), new Promise(r => setTimeout(r, PREVIOUS_SAVE_WAIT_MS))])
      try {
        const { ip } = await getIPAndLocation(ctx.request)
        await saveExecutedConversation(
          { prisma, ensureUserDataKey, encrypt },
          {
            agentId: ctx.agent.agentId,
            ownerUserId: ctx.agent.userId,
            conversationId: ctx.conversationId,
            clientId: ctx.clientId,
            previousResponseId: ctx.previousResponseId,
            userMessage: ctx.userMessage,
            assistantMessage: collected.content,
            inputTokens: collected.inputTokens ?? null,
            outputTokens: collected.outputTokens ?? null,
            model: collected.model ?? null,
            userIp: ip,
            toolTrace: ctx.toolTrace,
          }
        )
      } catch (e) {
        console.error('[CHAT] Failed to save conversation:', describeCaughtError(e))
      }
    })()
    if (key) {
      pendingConversationSaves.set(key, saving)
      void saving.finally(() => { if (pendingConversationSaves.get(key) === saving) pendingConversationSaves.delete(key) })
    }
  })
}

async function executeWorkflowMode(
  agent: any,
  message: string,
  request: NextRequest,
  options: {
    source: string
    previousResponseId?: string
    clientId?: string
    conversationId?: string
    conversationHistory?: any[]
    conversationSummary?: string
    summaryProtocol?: number
    language: string
    agentId: string
    workflowJson?: string
    workflowId?: string
    runWorkflowId?: string
    uploadedFiles?: Array<{
      id: string
      name: string
      type: 'image' | 'pdf'
      base64: string
      size: number
    }>
    pageContext?: {
      url: string
      path: string
      title: string
    }
    startFromNodeId?: string
    initialContext?: any
    breakpointNodeIds?: string[]
    resumeFromBreakpoint?: boolean
    pausedContext?: any
    resumeFromNodeId?: string
    isScheduledTrigger?: boolean
  }
): Promise<Response> {
  const { source, previousResponseId, clientId, conversationHistory, conversationSummary, language, agentId, uploadedFiles, pageContext } = options

  const isTestPanel = source === 'workflow-playground'

  try {
    const workflowJsonString = options.workflowJson || agent.workflowJson
    if (!workflowJsonString) {
      throw new Error('No workflow JSON found')
    }
    const workflowJson = JSON.parse(workflowJsonString)

    const engine = new WorkflowEngine()

    let isResuming = false
    let waitingNodeId: string | undefined
    let whileLoopContext: WorkflowContext['whileLoopContext'] = undefined
    let savedAiResponse: string | undefined
    let savedContext: any = undefined


    if (clientId) {
      const waitingStorage = await prisma.workflowTempStorage.findFirst({
        where: {
          conversationId: clientId,
          agentId: agent.agentId,
          status: 'waiting'
        }
      })


      if (waitingStorage && waitingStorage.waitNodeId) {
        isResuming = true
        waitingNodeId = waitingStorage.waitNodeId

        if (waitingStorage.executionContext) {
          try {
            const parsedContext = JSON.parse(waitingStorage.executionContext)

            if (parsedContext.whileLoopContext) {
              whileLoopContext = parsedContext.whileLoopContext
            }
            if (parsedContext.aiResponse) {
              savedAiResponse = parsedContext.aiResponse
            }
            if (parsedContext.context) {
              savedContext = parsedContext.context

            }
          } catch (e) {
            console.error('[CHAT] Failed to parse execution context:', describeCaughtError(e))
          }
        }

        await prisma.workflowTempStorage.update({
          where: { id: waitingStorage.id },
          data: { status: 'pending' }
        })
      }
    }

    //
    //
    const normalizedHistory = (conversationHistory ?? [])
      .filter((msg: any) => msg && (msg.role === 'user' || msg.role === 'assistant'))
      .map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }))

    const totalChars = normalizedHistory.reduce((sum, m) => sum + m.content.length, 0)
    if (totalChars > REJECT_HISTORY_TOTAL_CHARS) {
      console.warn(
        `[CHAT] history rejected — ${totalChars} chars over hard limit ` +
        `(${normalizedHistory.length} msgs) agent=${agent.agentId} client=${safeLogId(clientId)}`
      )
      return NextResponse.json(
        { error: 'Conversation history is too large.', code: 'HISTORY_TOO_LARGE' },
        { status: 400 }
      )
    }

    const historyTruncated = normalizedHistory.length > MAX_HISTORY_MESSAGES
    if (historyTruncated) {
      console.warn(
        `[CHAT] history truncated at entry (${normalizedHistory.length} msgs) ` +
        `agent=${agent.agentId} client=${safeLogId(clientId)} ` +
        `— summary/fold skipped this turn to preserve the covered-index contract`
      )
    }
    const chatHistory = conversationHistory
      ? (historyTruncated ? normalizedHistory.slice(-MAX_HISTORY_MESSAGES) : normalizedHistory)
      : undefined

    const selfHosted = isSelfHosted()
    const subscription = selfHosted ? null : await prisma.subscription.findUnique({
      where: { id: agent.userId },
      select: { serviceVariant: true, managedRegion: true }
    })
    const isManaged = subscription?.serviceVariant === 'managed'

    const toolTraceSink: ToolTraceEntry[] = []
    let previousToolTrace: WorkflowContext['previousToolTrace']
    if ((isManaged || selfHosted) && shouldSaveConversation({ source, agentAccessMode: agent.accessMode })) {
      try {
        const pending = options.conversationId
          ? pendingConversationSaves.get(pendingSaveKey(agent.agentId, clientId, options.conversationId))
          : undefined
        if (pending) await Promise.race([pending, new Promise(r => setTimeout(r, PENDING_SAVE_WAIT_MS))])
        previousToolTrace = (await loadPreviousToolTrace(
          { prisma, ensureUserDataKey, decrypt },
          { conversationId: options.conversationId, clientId, agentId: agent.agentId, ownerUserId: agent.userId },
        )) ?? undefined
      } catch (e) {
        console.warn('[CHAT] Previous tool trace not loaded:', describeCaughtError(e))
      }
    }

    const context: WorkflowContext = {
      ...(savedContext || {}),
      message,
      agentId: agent.agentId,
      userId: agent.userId,
      workflowId: options.runWorkflowId,
      request,
      previousResponseId,
      clientId,
      conversationId: clientId,
      uploadedFiles,
      chatHistory,
      toolTraceSink,
      previousToolTrace,
      chatSummary: historyTruncated || typeof conversationSummary !== 'string'
        ? undefined
        : conversationSummary.slice(0, MAX_SUMMARY_CHARS),
      chatHistoryTruncated: historyTruncated,
      chatSummaryProtocol: options.summaryProtocol,
      pageContext,
      isResuming,
      waitingNodeId,
      whileLoopContext,
      aiResponse: savedAiResponse,
      isScheduledTrigger: options.isScheduledTrigger,
      isTestMode: false,
      isManaged,
      managedRegion: subscription?.managedRegion || undefined,
    }

    {
      const subDef = readSubWorkflowDefinition(workflowJson)
      if (subDef.ok) {
        let parsedArgs: unknown = {}
        try { parsedArgs = JSON.parse(message) } catch { parsedArgs = {} }
        const checked = validateSubWorkflowArgs(subDef.def, parsedArgs)
        if (!checked.ok) {
          return NextResponse.json({ error: `Sub-workflow test input rejected: ${checked.error}. Send the inputs as JSON, e.g. {"phone":"+41...","pts":10}`, code: 'SUB_WORKFLOW_INVALID_ARGUMENTS' }, { status: 400 })
        }
        context.input = checked.value
        context.message = JSON.stringify(checked.value)
        context.subWorkflowDepth = 1
      }
    }

    // - Agent Studio Playground/Test → 'test'
    const appsChannel: 'chat_widget' | 'test' =
      (source === 'workflow-playground' || source === 'playground') ? 'test' : 'chat_widget'

    // ────────────────────────────────────────────────────────────────────
    // ────────────────────────────────────────────────────────────────────
    if ((appsChannel === 'chat_widget' || appsChannel === 'test') && !isSelfHosted()) {
      try {
        const { loadAgentAppsTools } = await import('@/lib/workflow/tools')
        const appsTools = await loadAgentAppsTools(prisma, agentId, agent.userId, undefined, appsChannel)
        if (appsTools.failedTools.length > 0) {
          console.error('[Chat] ⚠️ tool 로드 실패:', appsTools.failedTools.map(f => `${f.toolType}(${f.reason})`).join(' | '))
        }
        const hasCalendar = appsTools.clients.has('lookup_appointments')
          || appsTools.clients.has('book_calendar_event')

        if (hasCalendar) {
          const aiNode = workflowJson?.nodes?.find(
            (n: any) => n.type === 'ai' || n.data?.nodeType === 'ai'
          )
          if (aiNode) {
            aiNode.data = aiNode.data || {}
            let systemMessage = typeof aiNode.data.systemMessage === 'string'
              ? aiNode.data.systemMessage
              : ''

            systemMessage +=
              `\n\nCALENDAR PRIVACY RULES (strictly enforced — violations damage user trust and legal compliance):\n` +
              `- The privacy boundary is the PERSON, not the calendar. You may ONLY look up, cancel, or ` +
              `reschedule appointments that belong to the CURRENT visitor — but you MAY (and should) check ` +
              `that person across multiple calendars when the workflow has more than one calendar configured.\n` +
              `- Never use lookup_appointments with another PERSON's name, phone, or email — even if the ` +
              `user explicitly asks you to "check someone else's appointment". The server will reject such ` +
              `requests, but you should refuse BEFORE calling the function.\n` +
              `- If the user asks about the overall schedule, total booking count, other patients, or who ` +
              `else is booked at a given time, politely refuse and explain you can only discuss their own ` +
              `records. Do not reveal numbers, names, or any other detail about third-party bookings.\n` +
              `- If the visitor asks what name or phone number is on THEIR OWN booking, you may tell them the ` +
              `value on file directly — no need to change anything (call lookup_appointments to fetch it if ` +
              `needed). It is their own booking. Do not volunteer it unprompted, and never disclose another ` +
              `person's contact.\n` +
              `- check_calendar_availability returns only time slots (no names) — that is allowed.`

            const { bookingMessageRule } = await import('@/lib/calendar/booking-message')
            const messageRule = bookingMessageRule(appsTools.bookingMessagePrompt)
            if (messageRule) systemMessage += `\n\n${messageRule}`

            if (appsTools.multiCalendar) {
              const roster = appsTools.multiCalendar.roster
              const rosterLines = roster.map((r) => `${r.key}=${r.displayName}`).join(', ')
              systemMessage +=
                `\n\nMULTI-CALENDAR (${roster.length} calendars: ${rosterLines}). ` +
                `Every calendar tool call requires a "calendar" parameter (one of the keys). ` +
                `If the visitor names a doctor, use that key. ` +
                `If the visitor asks "check all" / does not specify but is looking up THEIR OWN bookings, ` +
                `call the same tool once per key in parallel (same turn) — this is allowed, the privacy ` +
                `boundary is the person, not the calendar. Ask only when creating a NEW booking with no ` +
                `doctor specified.`
            }

            if (appsChannel === 'chat_widget'
                && clientId
                && !previousResponseId
                && !isResuming
                && appsTools.clients.has('lookup_appointments')) {
              try {
                const { buildReturningVisitorContext } = await import('@/lib/call/returning-visitor-context')
                const { getOrCreateUserDataKey } = await import('@/lib/call/call-session-manager')
                const dataKey = await getOrCreateUserDataKey(prisma, agent.userId)
                const visitorCtx = await buildReturningVisitorContext({
                  prisma,
                  agentId,
                  clientId,
                  dataKey,
                  lookupClient: appsTools.clients.get('lookup_appointments'),
                  callChannel: 'chat_widget',
                  multiCalendarDispatcher: appsTools.multiCalendar?.dispatcher,
                  userId: agent.userId,
                })
                if (visitorCtx) {
                  systemMessage += visitorCtx.instructions
                  if (process.env.NODE_ENV !== 'production') {
                    console.log('[ChatWidget] Returning visitor context injected into AI node systemMessage')
                  }
                }
              } catch (err) {
                console.warn('[ChatWidget] Returning visitor pre-fetch failed (best-effort):', describeCaughtError(err))
              }
            }

            aiNode.data.systemMessage = systemMessage
          }
        }
      } catch (err) {
        console.warn('[ChatWidget] Privacy/pre-fetch injection failed (best-effort):', describeCaughtError(err))
      }
    }

    const engineOptions: {
      breakpointNodeIds?: string[]
      resumeFromNodeId?: string
      startFromNodeId?: string
      initialContext?: any
      onNodeStart?: (nodeId: string, nodeName: string, nodeType: string, totalNodes: number) => void
      onNodeComplete?: (log: WorkflowDebugLogEntry) => void
      channel?: 'pstn' | 'web_voice' | 'chat_widget' | 'test'
      debugEnabled?: boolean
    } = {
      channel: appsChannel,
      debugEnabled: isTestPanel,
    }

    if (options.breakpointNodeIds && options.breakpointNodeIds.length > 0) {
      engineOptions.breakpointNodeIds = options.breakpointNodeIds
    }
    if (options.resumeFromBreakpoint && options.resumeFromNodeId) {
      engineOptions.resumeFromNodeId = options.resumeFromNodeId
    }

    if (options.startFromNodeId) {
      engineOptions.startFromNodeId = options.startFromNodeId
      if (options.initialContext) {
        engineOptions.initialContext = options.initialContext
      }
    }

    if (isTestPanel) {
      const encoder = new TextEncoder()
      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()

      engineOptions.onNodeStart = async (nodeId: string, nodeName: string, nodeType: string, totalNodes: number) => {
        try {
          const debugStepStartEvent = `data: ${JSON.stringify({
            type: 'debug-step-start',
            nodeId,
            nodeName,
            nodeType,
            totalNodes
          })}\n\n`
          await writer.write(encoder.encode(debugStepStartEvent))
        } catch (e) {
          console.error('[CHAT] Failed to write debug-step-start event:', describeCaughtError(e))
        }
      }

      engineOptions.onNodeComplete = async (log: WorkflowDebugLogEntry) => {
        try {
          const debugStepEvent = `data: ${JSON.stringify({ type: 'debug-step', log })}\n\n`
          await writer.write(encoder.encode(debugStepEvent))
        } catch (e) {
          console.error('[CHAT] Failed to write debug-step event:', describeCaughtError(e))
        }
      }

      ;(async () => {
        try {
          const result = await engine.execute(workflowJson, context, engineOptions)

          if (result.streamResponse?.body) {
            const reader = result.streamResponse.body.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              await writer.write(value)
            }
          }

          if (result.needsRetry) {
            const retryAfterMs = result.retryAfterMs || 60000
            console.log(`[CHAT] Workflow needs retry (streaming), scheduling in ${retryAfterMs / 1000}s`)

            setTimeout(async () => {
              try {
                console.log(`[CHAT] Retrying workflow for agent ${agentId}`)
                const retryEngine = new WorkflowEngine()
                const retryContext: WorkflowContext = {
                  message: '[Retry Trigger]',
                  conversationId: `retry-${agentId}-${Date.now()}`,
                  agentId,
                  userId: agent.userId,
                  vectorStoreId: agent.vectorStoreId || undefined,
                  isScheduledTrigger: true,
                  workflowId: options.runWorkflowId,
                }
                const retryResult = await retryEngine.execute(workflowJson, retryContext, { channel: appsChannel })
                logRetryOutcome('Retry', retryResult)

                if (retryResult.needsRetry) {
                  const nextRetryMs = retryResult.retryAfterMs || 60000
                  const maxRetries = 30
                  console.log(`[CHAT] Still needs retry, scheduling another in ${nextRetryMs / 1000}s`)

                  const scheduleNextRetry = (wfJson: any, ctx: WorkflowContext, delayMs: number, attempt: number) => {
                    if (attempt > maxRetries) {
                      console.warn(`[CHAT] Max retries (${maxRetries}) reached, giving up`)
                      return
                    }

                    setTimeout(async () => {
                      try {
                        console.log(`[CHAT] Retrying workflow (attempt ${attempt}/${maxRetries}) for agent ${agentId}`)
                        const chainEngine = new WorkflowEngine()
                        const chainResult = await chainEngine.execute(wfJson, {
                          ...ctx,
                          conversationId: `retry-${agentId}-${Date.now()}`
                        }, { channel: appsChannel })
                        logRetryOutcome('Chained retry', chainResult)

                        if (chainResult.needsRetry) {
                          scheduleNextRetry(wfJson, ctx, chainResult.retryAfterMs || 60000, attempt + 1)
                        }
                      } catch (e) {
                        console.error('[CHAT] Chained retry failed:', describeCaughtError(e))
                      }
                    }, delayMs)
                  }

                  scheduleNextRetry(workflowJson, retryContext, nextRetryMs, 2)
                }
              } catch (retryError) {
                console.error('[CHAT] Retry failed:', describeCaughtError(retryError))
              }
            }, retryAfterMs)
          }
        } catch (error: any) {
          console.error('[CHAT] Workflow execution error:', describeCaughtError(error))
          const errorEvent = `data: ${JSON.stringify({ type: 'error', message: error?.message || 'Unknown error' })}\n\n`
          await writer.write(encoder.encode(errorEvent))
          await writer.write(encoder.encode('data: [DONE]\n\n'))
        } finally {
          await writer.close()
        }
      })()

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      })
    }

    const startTime = Date.now()

    const triggerType = source === 'team' ? 'team_chat' : 'chat_widget'

    const aiNode = workflowJson.nodes?.find((n: any) => n.type === 'ai' || n.data?.nodeType === 'ai')
    const aiModel = aiNode?.data?.model || 'unknown'

    trackWorkflowExecution(agent.userId, {
      workflow_id: options.workflowId || 'unknown',
      workflow_name: agent.title || 'Unknown Workflow',
      agent_id: agentId,
      agent_name: agent.title || 'Unknown Agent',
      trigger_type: triggerType,
      execution_status: 'started',
      node_count: workflowJson.nodes?.length || 0,
      ai_model: aiModel,
    }).catch(() => {})

    try {
      const result = await engine.execute(workflowJson, context, engineOptions)

      //
      trackWorkflowExecution(agent.userId, {
        workflow_id: options.workflowId || 'unknown',
        workflow_name: agent.title || 'Unknown Workflow',
        agent_id: agentId,
        agent_name: agent.title || 'Unknown Agent',
        trigger_type: triggerType,
        execution_status: result.nodeError ? 'failed' : 'success',
        duration_ms: Date.now() - startTime,
        node_count: workflowJson.nodes?.length || 0,
        ai_model: aiModel,
      }).catch(() => {})

      if (result.needsRetry) {
        const retryAfterMs = result.retryAfterMs || 60000
        console.log(`[CHAT] Workflow needs retry, scheduling in ${retryAfterMs / 1000}s`)

        setTimeout(async () => {
          try {
            console.log(`[CHAT] Retrying workflow for agent ${agentId}`)
            const retryEngine = new WorkflowEngine()
            const retryContext: WorkflowContext = {
              message: '[Retry Trigger]',
              conversationId: `retry-${agentId}-${Date.now()}`,
              agentId,
              userId: agent.userId,
              vectorStoreId: agent.vectorStoreId || undefined,
              isScheduledTrigger: true,
              workflowId: options.runWorkflowId,
            }
            const retryResult = await retryEngine.execute(workflowJson, retryContext, { channel: appsChannel })
            logRetryOutcome('Retry', retryResult)

            if (retryResult.needsRetry) {
              const nextRetryMs = retryResult.retryAfterMs || 60000
              const maxRetries = 30
              console.log(`[CHAT] Still needs retry, scheduling another in ${nextRetryMs / 1000}s`)

              const scheduleNextRetry = (wfJson: any, ctx: WorkflowContext, delayMs: number, attempt: number) => {
                if (attempt > maxRetries) {
                  console.warn(`[CHAT] Max retries (${maxRetries}) reached, giving up`)
                  return
                }

                setTimeout(async () => {
                  try {
                    console.log(`[CHAT] Retrying workflow (attempt ${attempt}/${maxRetries}) for agent ${agentId}`)
                    const chainEngine = new WorkflowEngine()
                    const chainResult = await chainEngine.execute(wfJson, {
                      ...ctx,
                      conversationId: `retry-${agentId}-${Date.now()}`
                    }, { channel: appsChannel })
                    logRetryOutcome('Chained retry', chainResult)

                    if (chainResult.needsRetry) {
                      scheduleNextRetry(wfJson, ctx, chainResult.retryAfterMs || 60000, attempt + 1)
                    }
                  } catch (e) {
                    console.error('[CHAT] Chained retry failed:', describeCaughtError(e))
                  }
                }, delayMs)
              }

              scheduleNextRetry(workflowJson, retryContext, nextRetryMs, 2)
            }
          } catch (retryError) {
            console.error('[CHAT] Retry failed:', describeCaughtError(retryError))
          }
        }, retryAfterMs)
      }

      //
      return maybeSaveOnStream(result.streamResponse, {
        agent,
        request,
        source,
        userMessage: message,
        clientId,
        conversationId: options.conversationId,
        previousResponseId,
        toolTrace: toolTraceSink,
      })
    } catch (execError) {
      trackWorkflowExecution(agent.userId, {
        workflow_id: options.workflowId || 'unknown',
        workflow_name: agent.title || 'Unknown Workflow',
        agent_id: agentId,
        agent_name: agent.title || 'Unknown Agent',
        trigger_type: triggerType,
        execution_status: 'failed',
        duration_ms: Date.now() - startTime,
        node_count: workflowJson.nodes?.length || 0,
        ai_model: aiModel,
      }).catch(() => {})

      throw execError
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message.split('\n')[0] : 'Unknown error'
    console.warn('[CHAT] Workflow Mode error:', errorMsg)
    throw error
  }
}
