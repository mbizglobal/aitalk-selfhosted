
import { WorkflowNode, WorkflowContext } from '../../types'
import { NodeExecutionResult } from '../base'
import { PrismaClient } from '@prisma/client'
import { McpClient } from '../mcp'
import { TelegramMcpClient } from '@/lib/mcp/telegram'
import { agentScopedWhere, MCP_CONNECTION_PROVIDERS, isSaveAsKeyAllowed } from '@/lib/connection-scope'
import { markTemplateVar } from '../../template-scope'
import { getConnectionSecret } from '@/lib/secret-vault'
import { saveTempData, loadTempData } from '../../temp-storage'
import { PineconeClient, PineconeConnectionConfig } from '@/lib/rag-providers/clients/pinecone'
import { tryGetKnowledgeStore } from '@/lib/knowledge'
import { AIToolClient, SendGridToolClient, TelegramToolClient, SmsToolClient, SmtpToolClient, GoogleCalendarToolClient, MicrosoftCalendarToolClient } from '../../tools'
import { MultiCalendarDispatcher } from '../../tools/multi-calendar-dispatcher'
import {
  LLMProviderType,
  createLLMClient,
  ChatMessage,
  ChatMessageContent,
  ChatOptions,
} from '@/lib/ai-providers'
import { extractPureJson, transformCitations, substituteTemplate, ResultBuilders } from './utils'
import { LLM_PROVIDER_REGISTRY } from '@/lib/ai-providers/core/registry'
import { reserveCpaForAiCall, type AiCallReservation } from '../../ai-call-cpa'

export async function executeWithClient(
  node: WorkflowNode,
  context: WorkflowContext,
  prisma: PrismaClient,
  provider: LLMProviderType,
  apiKey: string,
  citationBaseUrl: string | null,
  resultBuilders: ResultBuilders
): Promise<NodeExecutionResult> {
  const {
    model,
    temperature = 0.7,
    maxTokens = 2048,
    topP = 1.0,
    topK = 40,
    systemMessage = 'You are a helpful assistant',
    imageInput = false,
    pdfInput = false,
    csvInput = false,
    outputFormat = 'text',
    jsonSchema,
    saveTempStorage = false,
    loadTempStorage = false,
    displayJsonInChat = false,
    saveAs,
    includeChatHistory = true,
    selectedTools,
    mcpConnectionId,
  } = node.data

  const reservation = await reserveCpaForAiCall(context, model)
  let reservationHandedOff = false
  try {

  const client = createLLMClient(provider, apiKey)

  let processedSystemMessage = substituteTemplate(systemMessage, context)

  if (context.ragProvider === 'pinecone' && context.pineconeApiKey && context.pineconeConfig) {
    try {
      const pineconeClient = new PineconeClient(
        context.pineconeApiKey,
        context.pineconeConfig as PineconeConnectionConfig
      )
      const query = context.message || ''
      if (query.trim()) {
        let searchResults: Awaited<ReturnType<typeof pineconeClient.search>> = []

        if (context.pageContext?.path) {
          const currentPageResults = await pineconeClient.search(
            context.agentId,
            query,
            3,
            { pagePath: { $eq: context.pageContext.path } }
          )

          const parentPath = context.pageContext.path.split('/').slice(0, -1).join('/')
          let sectionResults: typeof searchResults = []
          if (parentPath) {
            sectionResults = await pineconeClient.search(
              context.agentId,
              query,
              3,
              { pagePath: { $regex: `^${parentPath}` } }
            )
          }

          const globalResults = await pineconeClient.search(context.agentId, query, 5)

          const seenIds = new Set<string>()
          searchResults = [...currentPageResults, ...sectionResults, ...globalResults]
            .filter(r => {
              if (seenIds.has(r.id)) return false
              seenIds.add(r.id)
              return true
            })
            .slice(0, 10)

        } else {
          searchResults = await pineconeClient.search(context.agentId, query, 10)
        }

        if (searchResults.length > 0) {
          const pineconeSearchResults = searchResults
            .map((r, i) => `[${i + 1}] (Score: ${r.score?.toFixed(3) || 'N/A'})\n${r.content}`)
            .join('\n\n---\n\n')
          processedSystemMessage += `\n\n## Relevant Context from Knowledge Base:\n${pineconeSearchResults}`
        }
      }
    } catch (error) {
      console.error('[AI Node] Pinecone search failed (non-OpenAI provider):', error)
    }
  }

  if (context.ragProvider === 'azure_ai_search' && context.azureSearchConfig) {
    try {
      const store = await tryGetKnowledgeStore({ regionId: context.azureSearchConfig.regionId }, 'AI Node')
      const query = context.message || ''
      if (store && query.trim()) {
        const searchResults = await store.search(
          {
            agentId: context.azureSearchConfig.agentId || context.agentId,
            ...(context.azureSearchConfig.ragSpace && { ragSpace: { id: context.azureSearchConfig.ragSpace, includeNull: !!context.azureSearchConfig.ragSpaceIncludeNull } }),
          },
          query,
          10,
        )
        if (searchResults.length > 0) {
          const contextText = searchResults
            .map((r, i) => `[${i + 1}] (Score: ${r.score?.toFixed(3) || 'N/A'})\n${r.content}`)
            .join('\n\n---\n\n')
          processedSystemMessage += `\n\n## Relevant Context from Knowledge Base:\n${contextText}`
        }
      }
    } catch (error) {
      console.error('[AI Node] Azure AI Search failed:', error)
    }
  }

  let inputText = (context as any).aiResponseRaw || (typeof context.aiResponse === 'string' ? context.aiResponse : null) || context.message

  if (loadTempStorage && context.conversationId && context.agentId) {
    const existingTempData = await loadTempData(prisma, context.conversationId, context.agentId)
    if (existingTempData) {
      inputText = `Previous data (JSON):\n${JSON.stringify(existingTempData, null, 2)}\n\nUser message:\n${context.message}`
    }
  }

  const modelVision = (() => {
    const providerDef = LLM_PROVIDER_REGISTRY[provider]
    if (!providerDef?.capabilities?.vision) return false
    if (model) {
      const modelDef = providerDef.models.find((m: any) => m.id === model)
      if (modelDef && !modelDef.vision) return false
    }
    return true
  })()
  const hasImageSupport = modelVision && (imageInput || pdfInput)
  const imageFiles = hasImageSupport && context.uploadedFiles
    ? context.uploadedFiles.filter(f => f.type === 'image')
    : []

  const csvFiles = csvInput && context.uploadedFiles
    ? context.uploadedFiles.filter(f => f.type === 'csv')
    : []

  if (csvFiles.length > 0) {
    const csvTexts = csvFiles
      .map(f => `CSV File: ${f.name}\n${f.text || ''}`)
      .join('\n\n')
    inputText = `${csvTexts}\n\n${inputText}`
  }

  const messages: ChatMessage[] = []

  if (includeChatHistory && context.chatHistory && context.chatHistory.length > 0) {
    for (const historyMsg of context.chatHistory) {
      messages.push({
        role: historyMsg.role,
        content: historyMsg.content
      })
    }
  }

  if (imageFiles.length > 0) {
    const content: ChatMessageContent[] = [{ type: 'text', text: inputText }]

    for (const file of imageFiles) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${file.base64}`
        }
      })
    }

    messages.push({ role: 'user', content })
  } else {
    messages.push({ role: 'user', content: inputText })
  }


  const chatOptions: ChatOptions = {
    model,
    temperature,
    maxTokens,
    topP,
    topK,
    systemMessage: processedSystemMessage,
    responseFormat: outputFormat === 'json' ? 'json' : 'text',
  }

  if (outputFormat === 'json' && jsonSchema) {
    try {
      chatOptions.jsonSchema = typeof jsonSchema === 'string' ? JSON.parse(jsonSchema) : jsonSchema
    } catch (e) {
    }
  }

  if (provider === 'gemini' && context.ragProvider === 'gemini_file_search' && context.geminiFiles) {
    if (geminiFiles.length > 0) {
      chatOptions.fileReferences = geminiFiles.map(f => ({
        fileUri: f.fileUri,
        fileName: f.fileName,
      }))
    }
  }

  if (provider === 'gemini' && selectedTools?.webSearch) {
    chatOptions.webSearch = true
  }

  if (provider === 'claude' && selectedTools?.webSearch) {
    chatOptions.webSearch = true

    const webSearchConfig: any = {
      maxUses: 5,
    }

    if (node.data.webSearchDomains && node.data.webSearchDomains.trim()) {
      const domains = node.data.webSearchDomains
        .split(/[,\n]/)
        .map((d: string) => d.trim())
        .filter((d: string) => d.length > 0)

      if (domains.length > 0) {
        webSearchConfig.allowedDomains = domains
      }
    }

    if (node.data.webSearchCountry || node.data.webSearchRegion || node.data.webSearchCity || node.data.webSearchTimezone) {
      webSearchConfig.userLocation = {}
      if (node.data.webSearchCountry) webSearchConfig.userLocation.country = node.data.webSearchCountry
      if (node.data.webSearchRegion) webSearchConfig.userLocation.region = node.data.webSearchRegion
      if (node.data.webSearchCity) webSearchConfig.userLocation.city = node.data.webSearchCity
      if (node.data.webSearchTimezone) webSearchConfig.userLocation.timezone = node.data.webSearchTimezone
    }

    chatOptions.webSearchConfig = webSearchConfig
  }

  let mcpClient: McpClient | TelegramMcpClient | null = null
  if (selectedTools?.mcp && mcpConnectionId) {
    try {
      const mcpConnection = await prisma.workflowConnection.findFirst({
        where: {
          id: mcpConnectionId,
          ...agentScopedWhere(context, 'AI Node MCP'),
          provider: { in: [...MCP_CONNECTION_PROVIDERS] },
          status: 'active',
        },
      })

      if (mcpConnection) {
        if (mcpConnection.provider === 'telegram_mcp') {
          const telegramClient = new TelegramMcpClient(mcpConnectionId)
          await telegramClient.initialize(prisma, context)
          mcpClient = telegramClient

          const mcpTools = telegramClient.listTools()
          const tools: Array<{ type: 'function'; name: string; description: string; parameters: object }> = []
          for (const mcpTool of mcpTools) {
            tools.push({
              type: 'function',
              name: mcpTool.name,
              description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
              parameters: mcpTool.inputSchema || {
                type: 'object',
                properties: {},
                required: []
              }
            })
          }

          chatOptions.tools = tools

          chatOptions.mcpToolCallHandler = async (toolName: string, args: Record<string, any>) => {
            const result = await telegramClient.callTool(toolName, args)
            if (result.content && result.content.length > 0) {
              return result.content.map(c => c.text || JSON.stringify(c)).join('\n')
            }
            return JSON.stringify(result)
          }

        } else {
          let accessToken: string | null = null
          if (mcpConnection.encryptedToken) {
            try {
              accessToken = await getConnectionSecret(prisma, context.userId, mcpConnection.id, mcpConnection.encryptedToken, mcpConnection.authType)
            } catch (err) {
              console.error('[AI Node] Failed to decrypt MCP token:', err)
            }
          }

          if (mcpConnection.serverUrl) {
            mcpClient = new McpClient(mcpConnection.serverUrl, accessToken, mcpConnectionId)
            await mcpClient.initialize()

            const mcpTools = await mcpClient.listTools()

            const tools: Array<{ type: 'function'; name: string; description: string; parameters: object }> = []
            for (const mcpTool of mcpTools) {
              tools.push({
                type: 'function',
                name: mcpTool.name,
                description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
                parameters: mcpTool.inputSchema || {
                  type: 'object',
                  properties: {},
                  required: []
                }
              })
            }

            chatOptions.tools = tools
            chatOptions.mcpToolCallHandler = async (toolName: string, args: Record<string, any>) => {
              if (!mcpClient) {
                throw new Error('MCP client not initialized')
              }
              const result = await mcpClient.callTool(toolName, args)
              if (result.content && result.content.length > 0) {
                return result.content.map(c => c.text || JSON.stringify(c)).join('\n')
              }
              return JSON.stringify(result)
            }

          }
        }

        await prisma.workflowConnection.update({
          where: { id: mcpConnectionId },
          data: { lastUsedAt: new Date() },
        })
      }
    } catch (mcpError: any) {
      console.error(`[AI Node] Failed to load MCP tools for ${provider}:`, mcpError.message)
    }
  }

  const appsToolClients: Map<string, AIToolClient> = new Map()

    try {
      const client2 = new SendGridToolClient()
      await client2.initialize(prisma, node.data.sendgridConnectionId, {
        agentId: context.agentId,
        fromEmail: node.data.sendgridFromEmail,
        fromName: node.data.sendgridFromName,
        toEmail: node.data.sendgridToEmail,
      }, context.userId)
      for (const tool of client2.listTools()) {
        if (!chatOptions.tools) chatOptions.tools = []
        chatOptions.tools.push({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters })
        appsToolClients.set(tool.name, client2)
      }
    } catch (err: any) {
      console.error('[AI Node] Failed to load SendGrid tool:', err.message)
    }

  if (selectedTools?.telegram && node.data.telegramConnectionId) {
    try {
      const client2 = new TelegramToolClient()
      await client2.initialize(prisma, node.data.telegramConnectionId, {
        agentId: context.agentId,
        chatId: node.data.telegramChatId,
      }, context.userId)
      for (const tool of client2.listTools()) {
        if (!chatOptions.tools) chatOptions.tools = []
        chatOptions.tools.push({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters })
        appsToolClients.set(tool.name, client2)
      }
    } catch (err: any) {
      console.error('[AI Node] Failed to load Telegram tool:', err.message)
    }
  }

  if (selectedTools?.sms && node.data.smsConnectionId) {
    try {
      const client2 = new SmsToolClient()
      await client2.initialize(prisma, node.data.smsConnectionId, { agentId: context.agentId, defaultTo: node.data.smsTo }, context.userId)
      for (const tool of client2.listTools()) {
        if (!chatOptions.tools) chatOptions.tools = []
        chatOptions.tools.push({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters })
        appsToolClients.set(tool.name, client2)
      }
    } catch (err: any) {
      console.error('[AI Node] Failed to load SMS tool:', err.message)
    }
  }

  if (selectedTools?.smtp && node.data.smtpConnectionId) {
    try {
      const client2 = new SmtpToolClient()
      await client2.initialize(prisma, node.data.smtpConnectionId, {
        agentId: context.agentId,
        toEmail: node.data.smtpToEmail,
      }, context.userId)
      for (const tool of client2.listTools()) {
        if (!chatOptions.tools) chatOptions.tools = []
        chatOptions.tools.push({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters })
        appsToolClients.set(tool.name, client2)
      }
    } catch (err: any) {
      console.error('[AI Node] Failed to load SMTP tool:', err.message)
    }
  }

  if (selectedTools?.googleCalendar && node.data.googleCalendarConnectionId) {
    try {
      const client2 = new GoogleCalendarToolClient()
      await client2.initialize(prisma, node.data.googleCalendarConnectionId, {
        agentId: context.agentId,
        userId: context.userId,
        accountId: node.data.googleCalendarAccountId,
        calendarId: node.data.googleCalendarId,
        timezone: node.data.googleCalendarTimezone,
        workingHoursStart: node.data.googleCalendarWorkingStart,
        workingHoursEnd: node.data.googleCalendarWorkingEnd,
        defaultDurationMin: node.data.googleCalendarDefaultDuration,
        inviteAttendee: node.data.googleCalendarInviteAttendee,
        notifyOnBook: node.data.googleCalendarNotifyOnBook,
        notifyOnReschedule: node.data.googleCalendarNotifyOnReschedule,
        notifyOnCancel: node.data.googleCalendarNotifyOnCancel,
        bookingWindowDays: node.data.googleCalendarBookingWindowDays,
        historyLookupDays: node.data.googleCalendarHistoryLookupDays,
        cancellationPolicy: node.data.googleCalendarCancellationPolicy,
        reschedulePolicy: node.data.googleCalendarReschedulePolicy,
        breakTimes: node.data.googleCalendarBreakTimes,
        weeklyClosedDays: node.data.googleCalendarWeeklyClosedDays,
        holidays: node.data.googleCalendarHolidays,
        closedRanges: node.data.googleCalendarClosedRanges,
        cleanupMin: node.data.googleCalendarCleanupMin,
        capacityMode: node.data.googleCalendarCapacityMode,
        simpleCapacity: node.data.googleCalendarSimpleCapacity,
        tableInventory: node.data.googleCalendarTableInventory,
        mealDurationMin: node.data.googleCalendarMealDurationMin,
        reservationGridMin: node.data.googleCalendarReservationGridMin,
        tableMatchPolicy: node.data.googleCalendarTableMatchPolicy,
        lastCallMin: node.data.googleCalendarLastCallMin,
        lastCallBreakMin: node.data.googleCalendarLastCallBreakMin,
      })
      for (const tool of client2.listTools()) {
        if (!chatOptions.tools) chatOptions.tools = []
        chatOptions.tools.push({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters })
        appsToolClients.set(tool.name, client2)
      }
    } catch (err: any) {
      console.error('[AI Node] Failed to load Google Calendar tool:', err.message)
    }
  }

  if (selectedTools?.microsoftCalendar && node.data.microsoftCalendarConnectionId) {
    try {
      const client2 = new MicrosoftCalendarToolClient()
      await client2.initialize(prisma, node.data.microsoftCalendarConnectionId, {
        agentId: context.agentId,
        userId: context.userId,
        accountId: node.data.microsoftCalendarAccountId,
        calendarId: node.data.microsoftCalendarId,
        userPrincipalName: node.data.microsoftCalendarUpn,
        timezone: node.data.microsoftCalendarTimezone,
        workingHoursStart: node.data.microsoftCalendarWorkingStart,
        workingHoursEnd: node.data.microsoftCalendarWorkingEnd,
        defaultDurationMin: node.data.microsoftCalendarDefaultDuration,
        inviteAttendee: node.data.microsoftCalendarInviteAttendee,
        notifyOnBook: node.data.microsoftCalendarNotifyOnBook,
        notifyOnReschedule: node.data.microsoftCalendarNotifyOnReschedule,
        notifyOnCancel: node.data.microsoftCalendarNotifyOnCancel,
        bookingWindowDays: node.data.microsoftCalendarBookingWindowDays,
        historyLookupDays: node.data.microsoftCalendarHistoryLookupDays,
        cancellationPolicy: node.data.microsoftCalendarCancellationPolicy,
        reschedulePolicy: node.data.microsoftCalendarReschedulePolicy,
        breakTimes: node.data.microsoftCalendarBreakTimes,
        weeklyClosedDays: node.data.microsoftCalendarWeeklyClosedDays,
        holidays: node.data.microsoftCalendarHolidays,
        closedRanges: node.data.microsoftCalendarClosedRanges,
        cleanupMin: node.data.microsoftCalendarCleanupMin,
        capacityMode: node.data.microsoftCalendarCapacityMode,
        simpleCapacity: node.data.microsoftCalendarSimpleCapacity,
        tableInventory: node.data.microsoftCalendarTableInventory,
        mealDurationMin: node.data.microsoftCalendarMealDurationMin,
        reservationGridMin: node.data.microsoftCalendarReservationGridMin,
        tableMatchPolicy: node.data.microsoftCalendarTableMatchPolicy,
        lastCallMin: node.data.microsoftCalendarLastCallMin,
        lastCallBreakMin: node.data.microsoftCalendarLastCallBreakMin,
      })
      for (const tool of client2.listTools()) {
        if (!chatOptions.tools) chatOptions.tools = []
        chatOptions.tools.push({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters })
        appsToolClients.set(tool.name, client2)
      }
    } catch (err: any) {
      console.error('[AI Node] Failed to load Microsoft Calendar tool:', err.message)
    }
  }

  if (selectedTools?.calendarMulti && Array.isArray(node.data.calendarMultiNodes) && node.data.calendarMultiNodes.length >= 2) {
    try {
      const dispatcher = new MultiCalendarDispatcher()
      await dispatcher.initializeMulti(prisma, context, node.data.calendarMultiNodes, '')
      for (const tool of dispatcher.listTools()) {
        if (!chatOptions.tools) chatOptions.tools = []
        chatOptions.tools.push({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters })
        appsToolClients.set(tool.name, dispatcher)
      }
    } catch (err: any) {
      console.error('[AI Node] Failed to load Multi-Calendar dispatcher:', err.message)
    }
  }

  if (appsToolClients.size > 0) {
    const existingHandler = chatOptions.mcpToolCallHandler
    chatOptions.mcpToolCallHandler = async (toolName: string, args: Record<string, any>) => {
      if (appsToolClients.has(toolName)) {
        return await appsToolClients.get(toolName)!.callTool(toolName, args)
      }
      if (existingHandler) {
        return await existingHandler(toolName, args)
      }
      return `Unknown tool: ${toolName}`
    }
  }

  if (outputFormat === 'json') {
    try {
      const response = await client.chat(messages, chatOptions)
      const aiResponse = response.content

      reservation.settle(response.usage?.inputTokens, response.usage?.outputTokens)

      let parsedJsonData: any = undefined
      try {
        const cleanedJson = extractPureJson(aiResponse)
        parsedJsonData = JSON.parse(cleanedJson)
      } catch (parseError) {
        console.warn(`[Workflow] Failed to parse ${provider} response as JSON:`, parseError)
        console.warn(`[Workflow] Response preview (first 500 chars):`, aiResponse.substring(0, 500))
      }

      if (saveTempStorage && parsedJsonData && context.conversationId && context.agentId) {
        try {
          await saveTempData(prisma, context.conversationId, context.agentId, parsedJsonData)
        } catch (saveError) {
          console.warn('[Workflow] Failed to save temp storage:', saveError)
        }
      }

      if (mcpClient) {
        try {
          await mcpClient.close()
        } catch (err) {
          console.error('[Workflow] Failed to close MCP client:', err)
        }
      }

      const transformedResponse = transformCitations(aiResponse, citationBaseUrl)

      const updatedContext: any = {
        ...context,
        aiResponse: parsedJsonData || transformedResponse,
        aiResponseRaw: transformedResponse,
        jsonData: parsedJsonData,
        model,
        inputTokens: response.usage?.inputTokens || context.inputTokens,
        outputTokens: response.usage?.outputTokens || context.outputTokens,
        displayJsonInChat: displayJsonInChat && parsedJsonData,
      }

      if (saveAs && parsedJsonData) {
        if (isSaveAsKeyAllowed(saveAs)) {
          updatedContext[saveAs] = parsedJsonData
          markTemplateVar(updatedContext, saveAs)
        }
      }

      return resultBuilders.createSuccessResult(
        updatedContext,
        {
          input: {
            provider,
            model,
            temperature,
            maxTokens,
            topP,
            topK,
            systemMessage: processedSystemMessage,
            input: inputText,
            outputFormat,
          },
          output: {
            text: aiResponse,
            usage: response.usage,
          }
        }
      )
    } catch (error) {
      if (mcpClient) {
        try {
          await mcpClient.close()
        } catch (err) {
          // ignore
        }
      }
      throw error
    }
  }

  if (context.isScheduledTrigger) {
    try {
      const response = await client.chat(messages, chatOptions)
      const aiResponse = response.content

      reservation.settle(response.usage?.inputTokens, response.usage?.outputTokens)

      if (mcpClient) {
        try {
          await mcpClient.close()
        } catch (err) {
          console.error('[Workflow] Failed to close MCP client:', err)
        }
      }
      const transformedResponse = transformCitations(aiResponse, citationBaseUrl)

      const updatedContext: any = {
        ...context,
        aiResponse: transformedResponse,
        model,
        inputTokens: response.usage?.inputTokens || context.inputTokens,
        outputTokens: response.usage?.outputTokens || context.outputTokens,
      }


      return resultBuilders.createSuccessResult(
        updatedContext,
        {
          input: {
            provider,
            model,
            temperature,
            maxTokens,
            topP,
            topK,
            systemMessage: processedSystemMessage,
            input: inputText,
            outputFormat,
            isScheduledTrigger: true,
          },
          output: {
            text: aiResponse,
            usage: response.usage,
          }
        }
      )
    } catch (error) {
      if (mcpClient) {
        try {
          await mcpClient.close()
        } catch (err) {
          // ignore
        }
      }
      throw error
    }
  }

  reservationHandedOff = true
  const streamResponse = await createProviderStreamResponse(
    client,
    messages,
    chatOptions,
    provider,
    model,
    context,
    {
      saveTempStorage,
      saveAs,
      processedSystemMessage,
      inputText,
      temperature,
      maxTokens,
      topP,
      topK,
      reservation,
      onCleanup: async () => {
        if (mcpClient) {
          try {
            await mcpClient.close()
          } catch (err) {
            console.error('[Workflow] Failed to close Gemini MCP client:', err)
          }
        }
      }
    },
    prisma
  )

  const updatedContext: any = {
    ...context,
    model,
  }

  return {
    context: updatedContext,
    streamResponse,
    debug: {
      input: {
        provider,
        model,
        temperature,
        maxTokens,
        topP,
        topK,
        systemMessage: processedSystemMessage,
        input: inputText,
        outputFormat,
        webSearch: selectedTools?.webSearch || false,
        mcp: selectedTools?.mcp || false,
        mcpToolsCount: chatOptions.tools?.length || 0,
      },
      output: {
        streaming: true,
        provider,
      },
      status: 'success'
    }
  }

  } finally {
    if (!reservationHandedOff) reservation.cancel()
  }
}

async function createProviderStreamResponse(
  client: any,
  messages: ChatMessage[],
  chatOptions: ChatOptions,
  provider: LLMProviderType,
  model: string,
  context: WorkflowContext,
  options: {
    outputFormat: string
    saveTempStorage: boolean
    saveAs?: string
    processedSystemMessage: string
    inputText: string
    temperature: number
    maxTokens: number
    topP: number
    topK: number
    reservation: AiCallReservation
    onCleanup?: () => Promise<void>
  },
  prisma: PrismaClient
): Promise<Response> {
  const { outputFormat, saveTempStorage, saveAs, reservation } = options

  const streamGenerator = client.stream(messages, chatOptions)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let fullContent = ''
      let inputTokens = 0
      let outputTokens = 0
      let sawChunk = false

      let streamErrored = false

      try {
        for await (const chunk of streamGenerator) {
          if (chunk.type === 'error') {
            streamErrored = true
            console.error(`[Workflow] ${provider} stream error chunk:`, chunk.error)
            continue
          }
          if (chunk.type === 'delta' && chunk.content) {
            sawChunk = true
            fullContent += chunk.content
            const outputData = `data: ${JSON.stringify({ content: chunk.content })}\n\n`
            controller.enqueue(encoder.encode(outputData))
          } else if (chunk.type === 'done') {
            inputTokens = chunk.usage?.inputTokens || 0
            outputTokens = chunk.usage?.outputTokens || 0
          }
        }

        if (streamErrored) {
          if (sawChunk) reservation.settle(inputTokens || undefined, outputTokens || undefined)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
          return
        }

        reservation.settle(inputTokens || undefined, outputTokens || undefined)

        let parsedJsonData: any = undefined
        if (outputFormat === 'json') {
          try {
            const cleanedJson = extractPureJson(fullContent)
            parsedJsonData = JSON.parse(cleanedJson)
          } catch (parseError) {
            console.warn(`[Workflow] Failed to parse ${provider} response as JSON:`, parseError)
          }
        }

        if (saveTempStorage && parsedJsonData && context.conversationId && context.agentId) {
          try {
            await saveTempData(prisma, context.conversationId, context.agentId, parsedJsonData)
          } catch (saveError) {
            console.warn('[Workflow] Failed to save temp storage:', saveError)
          }
        }

        const completionData = {
          type: 'completed',
          model,
          inputTokens,
          outputTokens,
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionData)}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()

      } catch (error) {
        console.error(`[Workflow] ${provider} stream error:`, error)
        const errorData = `data: ${JSON.stringify({ error: 'Stream error' })}\n\n`
        controller.enqueue(encoder.encode(errorData))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } finally {
        reservation.finalize(sawChunk)
        if (options.onCleanup) {
          await options.onCleanup()
        }
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
  })
}
