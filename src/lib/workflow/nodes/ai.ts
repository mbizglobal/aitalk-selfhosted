
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { OpenAI, AzureOpenAI } from 'openai'
import { LLMProviderType } from '@/lib/ai-providers'
import { LLM_PROVIDER_REGISTRY } from '@/lib/ai-providers/core/registry'
import { getProviderApiKey } from '@/lib/secret-vault'
import { getManagedAzureConfig } from '@/lib/managed/api-key'
import { getRegionById } from '@/lib/managed/regions'
import { replaceRetiredChatModel } from '@/lib/managed/model-lineup'
import { ResultBuilders } from './ai/utils'
import { executeOpenAI } from './ai/openai-execute'
import { executeWithClient } from './ai/providers'
import { isQuizExecution, createQuizAssignment } from './ai/miniapp-quiz'
import { isSelfHosted } from '@/lib/edition'
import { createConnectionClient, defaultAiConnectionDeps, resolveAiConnection, resolveFailureMessage, toConnectionInfo } from '@/lib/ai-connections'

export class AINodeExecutor extends BaseNodeExecutor {

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const {
      provider = 'openai' as LLMProviderType,
      model: savedModel = 'gpt-6-luna',
      temperature = 0.7,
      maxTokens = 2048,
      topP = 1.0,
      systemMessage = 'You are a helpful assistant',
      vectorStoreId,
    } = node.data
    const model: string = context.isManaged ? replaceRetiredChatModel(savedModel) : savedModel

    try {
      if (isQuizExecution(node, context)) {
        const res = await createQuizAssignment(node, context, prisma)
        const msg = res.ok ? 'Quiz assignment created' : (res.errorMessage || 'Quiz assignment aborted')
        return this.createSuccessResult(
          { ...context, aiResponse: msg, outputTokens: 0, inputTokens: 0 },
          { input: { message: context.message }, output: { aiResponse: msg } }
        )
      }

      const user = await prisma.user.findUnique({
        where: { id: context.userId },
        include: { aiProviders: true, zki: true }
      })

      const agent = await prisma.agent.findUnique({
        where: { agentId: context.agentId },
        select: { gitbookPublishedUrl: true }
      })
      const citationBaseUrl = agent?.gitbookPublishedUrl || null

      let apiKey: string = ''
      let azureManagedConfig: Awaited<ReturnType<typeof getManagedAzureConfig>> | null = null
      let connectionClient: OpenAI | null = null
      const selfHosted = isSelfHosted()

      if (selfHosted) {
        const resolved = await resolveAiConnection(await defaultAiConnectionDeps(), node.data?.aiConnectionId)
        const stop = !resolved.ok ? resolveFailureMessage(resolved.reason) : null
        if (stop || !resolved.ok) {
          const infoMessage = stop || resolveFailureMessage('invalid')
          return this.createSuccessResult(
            { ...context, aiResponse: infoMessage, outputTokens: 0, inputTokens: 0 },
            { input: { message: context.message }, output: { aiResponse: infoMessage } }
          )
        }
        const conn = resolved.connection
        const hasImages = (node.data?.imageInput || node.data?.pdfInput) && context.uploadedFiles?.some((f) => f.type === 'image')
        if (hasImages && conn.imageModel !== conn.textModel) {
          const infoMessage = conn.imageModel
            ? 'This AI connection reads images with a separate image model, which cannot be used for images attached directly to the chat yet.'
            : 'This AI connection cannot read images (no image model is set). An administrator can add one.'
          return this.createSuccessResult(
            { ...context, aiResponse: infoMessage, outputTokens: 0, inputTokens: 0 },
            { input: { message: context.message }, output: { aiResponse: infoMessage } }
          )
        }
        connectionClient = createConnectionClient(conn)
        node.data.model = conn.textModel
        context.workflowAiModel = conn.textModel
        if (conn.maxOutputTokens && !(maxTokens > 0 && maxTokens <= conn.maxOutputTokens)) node.data.maxTokens = conn.maxOutputTokens
        context.aiConnection = toConnectionInfo(conn)
      } else if (context.isManaged && context.managedRegion) {
        try {
          azureManagedConfig = await getManagedAzureConfig(context.managedRegion)
          apiKey = azureManagedConfig.apiKey
        } catch (error: any) {
          const infoMessage = 'Managed service is not available for this region.'
          return this.createSuccessResult(
            { ...context, aiResponse: infoMessage, outputTokens: 0, inputTokens: 0 },
            { input: { message: context.message }, output: { aiResponse: infoMessage } }
          )
        }

        if (model !== savedModel) {
          console.log(`[AI Node] Retired model '${savedModel}' → '${model}'`)
          node.data.model = model
          context.workflowAiModel = model
        }
        const regionInfo = getRegionById(context.managedRegion)
        if (regionInfo) {
          const regionModels = regionInfo.models as readonly string[]
          const modelUnset = !node.data?.model
          if (modelUnset || !regionModels.includes(model) || /^gpt-realtime/i.test(model)) {
            const fallbackModel = regionModels.includes('gpt-6-luna') ? 'gpt-6-luna' : regionModels[0]
            console.log(
              modelUnset
                ? `[AI Node] Model unspecified, using '${fallbackModel}' in region '${context.managedRegion}'`
                : `[AI Node] Model '${model}' not available in region '${context.managedRegion}', fallback to '${fallbackModel}'`
            )
            node.data.model = fallbackModel
            context.workflowAiModel = fallbackModel

            const fallbackModelDef = LLM_PROVIDER_REGISTRY['openai']?.models.find(m => m.id === fallbackModel)
            if (fallbackModelDef?.maxOutputTokens && maxTokens > fallbackModelDef.maxOutputTokens) {
              node.data.maxTokens = Math.min(maxTokens, fallbackModelDef.maxOutputTokens)
              console.log(`[AI Node] maxTokens clamped: ${maxTokens} → ${node.data.maxTokens}`)
            }
          }
        }
      } else {
        if (!user?.encryptedDataKey) {
          const infoMessage = 'API key is not configured. Please set up your API key in Settings.'
          return this.createSuccessResult(
            { ...context, aiResponse: infoMessage, outputTokens: 0, inputTokens: 0 },
            { input: { message: context.message }, output: { aiResponse: infoMessage } }
          )
        }

        try {
          apiKey = await this.getApiKeyForProvider(user, provider, prisma)
        } catch (error: any) {
          const isVaultError = error?.message?.includes('[Secret Vault]')
          const infoMessage = isVaultError
            ? error.message
            : 'API key is not configured. Please set up your API key in Settings.'
          return this.createSuccessResult(
            { ...context, aiResponse: infoMessage, outputTokens: 0, inputTokens: 0 },
            { input: { message: context.message }, output: { aiResponse: infoMessage } }
          )
        }
      }

      const resultBuilders: ResultBuilders = {
        createSuccessResult: this.createSuccessResult.bind(this),
        createErrorResult: this.createErrorResult.bind(this),
      }

      if (!selfHosted && provider !== 'openai') {
        return await executeWithClient(node, context, prisma, provider, apiKey, citationBaseUrl, resultBuilders)
      }

      const effectiveModel = node.data.model || model
      let openai: OpenAI
      if (connectionClient) {
        openai = connectionClient
      } else if (azureManagedConfig) {
        openai = new AzureOpenAI({
          apiKey,
          endpoint: azureManagedConfig.endpoint,
          apiVersion: azureManagedConfig.apiVersion,
          deployment: effectiveModel,
        })
      } else {
        openai = new OpenAI({ apiKey })
      }
      const execResult = await executeOpenAI(node, context, prisma, openai, citationBaseUrl, resultBuilders)
      return execResult

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : 'Unknown error'
      console.warn('[Workflow] AI node error:', errorMsg)
      const debugInfo = {
        input: {
          model,
          temperature,
          maxTokens,
          topP,
          systemMessage,
          input: context.message,
          vectorStoreId
        },
        output: {},
        status: 'error' as const,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
      if (error && typeof error === 'object') {
        ; (error as any).__workflowDebug = debugInfo
      }
      throw error
    }
  }

  private async getApiKeyForProvider(
    user: any,
    provider: LLMProviderType,
    prisma: PrismaClient
  ): Promise<string> {
    const apiKey = await getProviderApiKey(prisma, user.id, provider, user)
    if (!apiKey) {
      throw new Error(`${provider} API key not found. Please configure it in Settings.`)
    }
    return apiKey
  }
}

// Singleton instance
export const aiNodeExecutor = new AINodeExecutor()
