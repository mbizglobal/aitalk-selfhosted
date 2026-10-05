
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext, RAGSearchResult } from '../types'
import { PrismaClient } from '@prisma/client'
import { PineconeClient, PineconeConnectionConfig } from '@/lib/rag-providers/clients/pinecone'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { GoogleGenAI } from '@google/genai'
import { getManagedAzureConfig } from '@/lib/managed/api-key'
import { resolveSearchSpace } from '@/lib/rag-space'
import { describeCaughtError } from '@/lib/log-mask'
import { isSelfHosted } from '@/lib/edition'
import { SELFHOSTED_REGION, selfHostedKnowledgeKind } from '@/lib/knowledge'

type RAGProviderType = 'none' | 'openai_vector_store' | 'gemini_file_search' | 'pinecone' | 'azure_ai_search'

const RAG_AI_COMPATIBILITY: Record<RAGProviderType, string | null> = {
  none: null,
  openai_vector_store: 'openai',
  gemini_file_search: 'gemini',
  pinecone: null,
  azure_ai_search: null,
}

export class SourceNodeExecutor extends BaseNodeExecutor {
  constructor(private readonly loadManagedAzureConfig = getManagedAzureConfig) {
    super()
  }

  private getAiProviderFromModel(modelId: string): string {
    if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
      return 'openai'
    } else if (modelId.startsWith('gemini') || modelId.startsWith('models/gemini')) {
      return 'gemini'
    } else if (modelId.startsWith('claude')) {
      return 'claude'
    } else if (modelId.startsWith('deepseek')) {
      return 'deepseek'
    } else if (modelId.startsWith('grok')) {
      return 'grok'
    }
    return 'unknown'
  }

  private getAiProviderFromContext(context: WorkflowContext): string | null {
    if (!context.workflowAiModel) return null
    return this.getAiProviderFromModel(context.workflowAiModel)
  }

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    try {
      let ragProvider: RAGProviderType = 'openai_vector_store'

      const userRagProviders = await prisma.ragProviders.findUnique({
        where: { id: context.userId }
      })

      if (userRagProviders?.defaultProvider) {
        ragProvider = userRagProviders.defaultProvider as RAGProviderType
      }

      if (isSelfHosted()) return await this.handleSelfHostedSearch(node, context, prisma)

      const subscription = await prisma.subscription.findUnique({
        where: { id: context.userId },
        select: { serviceVariant: true, managedRegion: true }
      })
      if (subscription?.serviceVariant === 'managed') {
        ragProvider = 'azure_ai_search'
      }

      console.log(`[Workflow] Source node: RAG Provider = ${ragProvider}`)

      const requiredAiProvider = RAG_AI_COMPATIBILITY[ragProvider]
      if (requiredAiProvider) {
        const actualAiProvider = this.getAiProviderFromContext(context)
        if (actualAiProvider && actualAiProvider !== requiredAiProvider) {
          console.warn(`[Workflow] Source node: RAG Provider '${ragProvider}' requires '${requiredAiProvider}' AI, but workflow uses '${actualAiProvider}'. Skipping RAG.`)
          return this.createSuccessResult(
            {
              ...context,
              ragProvider: 'none'
            },
            {
              input: { agentId: context.agentId, ragProvider, aiProvider: actualAiProvider },
              output: {
                warning: `RAG skipped: ${ragProvider} only works with ${requiredAiProvider} models, but ${actualAiProvider} is being used. Use Pinecone for cross-provider RAG.`,
                ragProvider: 'none'
              }
            }
          )
        }
      }

      const agent = await prisma.agent.findUnique({
        where: { agentId: context.agentId },
        select: {
          vectorStoreId: true,
          vectorStoreName: true,
          aiConfig: true
        }
      })

      switch (ragProvider) {
        case 'none':
          console.log('[Workflow] Source node: RAG Provider is none, skipping file search')
          return this.createSuccessResult(
            {
              ...context,
              ragProvider: 'none'
            },
            {
              input: { agentId: context.agentId, ragProvider: 'none' },
              output: { message: 'RAG Provider not configured, skipping file search' }
            }
          )

        case 'openai_vector_store':
          return this.handleOpenAIVectorStore(node, context, agent)

        case 'gemini_file_search':
          return this.handleGeminiFileSearch(node, context, agent, prisma)

        case 'pinecone':
          return this.handlePinecone(node, context, prisma)

        case 'azure_ai_search':
          return this.handleAzureAISearch(node, context, prisma)

        default:
          console.warn(`[Workflow] Source node: Unknown RAG provider ${ragProvider}, falling back to OpenAI`)
          return this.handleOpenAIVectorStore(node, context, agent)
      }
    } catch (error) {
      console.error('[Workflow] Source node failed:', error)
      throw error
    }
  }

  private handleOpenAIVectorStore(
    node: WorkflowNode,
    context: WorkflowContext,
    agent: any
  ): NodeExecutionResult {
    if (!agent?.vectorStoreId) {
      console.warn('[Workflow] Source node: Agent has no OpenAI Vector Store configured')
      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'openai_vector_store'
        },
        {
          input: { agentId: context.agentId, ragProvider: 'openai_vector_store' },
          output: { warning: 'No OpenAI Vector Store configured' }
        }
      )
    }

    console.log(`[Workflow] Source node: Connected to OpenAI Vector Store ${agent.vectorStoreName || agent.vectorStoreId}`)

    return this.createSuccessResult(
      {
        ...context,
        ragProvider: 'openai_vector_store',
        sourceVectorStoreId: agent.vectorStoreId,
        sourceVectorStoreName: agent.vectorStoreName || undefined
      },
      {
        input: { agentId: context.agentId, ragProvider: 'openai_vector_store' },
        output: {
          ragProvider: 'openai_vector_store',
          vectorStoreId: agent.vectorStoreId,
          vectorStoreName: agent.vectorStoreName
        }
      }
    )
  }

  private async handlePinecone(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const user = await prisma.user.findUnique({
      where: { id: context.userId },
      include: { ragProviders: true, zki: true }
    })

    if (!user?.encryptedDataKey || !user?.ragProviders?.providers) {
      console.warn('[Workflow] Source node: Pinecone settings not found')
      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'pinecone'
        },
        {
          input: { agentId: context.agentId, ragProvider: 'pinecone' },
          output: { warning: 'Pinecone is not configured in Settings' }
        }
      )
    }

    const ragProvidersConfig = typeof user.ragProviders.providers === 'string'
      ? JSON.parse(user.ragProviders.providers)
      : user.ragProviders.providers
    if (!ragProvidersConfig?.pinecone?.apiKey || !ragProvidersConfig?.pinecone?.indexName) {
      console.warn('[Workflow] Source node: Pinecone API Key or Index Name not configured')
      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'pinecone'
        },
        {
          input: { agentId: context.agentId, ragProvider: 'pinecone' },
          output: { warning: 'Pinecone API Key or Index Name not configured in Settings' }
        }
      )
    }

    try {
      const storedApiKey = ragProvidersConfig.pinecone.apiKey
      let pineconeApiKey: string

      if (storedApiKey.startsWith('pcsk_')) {
        pineconeApiKey = storedApiKey
      } else {
        let dek: Buffer
        if (user.zkiId && user.zki?.masterKey) {
          dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
        } else {
          dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
        }
        pineconeApiKey = decrypt(Buffer.from(storedApiKey, "base64"), dek)

        if (pineconeApiKey === "Decryption failed") {
          throw new Error('Failed to decrypt Pinecone API key')
        }
      }

      const embeddingModel = ragProvidersConfig.pinecone.embeddingModel || 'text-embedding-3-small'
      const isPineconeEmbedding = ['llama-text-embed-v2', 'multilingual-e5-large'].includes(embeddingModel)

      let openaiApiKey: string | undefined
      if (!isPineconeEmbedding) {
        const userWithAi = await prisma.user.findUnique({
          where: { id: context.userId },
          include: { aiProviders: true }
        })
        const aiProvidersConfig = userWithAi?.aiProviders?.providers
          ? JSON.parse(userWithAi.aiProviders.providers as string)
          : null

        if (!aiProvidersConfig?.openai?.apiKey) {
          return this.createSuccessResult(
            {
              ...context,
              ragProvider: 'pinecone'
            },
            {
              input: { agentId: context.agentId, ragProvider: 'pinecone' },
              output: { warning: 'OpenAI API Key is required for OpenAI embedding models' }
            }
          )
        }
        const dekForOpenai = user.zkiId && user.zki?.masterKey
          ? decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
          : await decryptDataKey(Buffer.from(user.encryptedDataKey))
        openaiApiKey = decrypt(Buffer.from(aiProvidersConfig.openai.apiKey, "base64"), dekForOpenai)
      }

      const pineconeConfig: PineconeConnectionConfig = {
        host: ragProvidersConfig.pinecone.host || undefined,
        indexName: ragProvidersConfig.pinecone.indexName,
        namespace: ragProvidersConfig.pinecone.namespace || undefined,
        embeddingApiKey: openaiApiKey,
        embeddingModel: embeddingModel,
        dimension: ragProvidersConfig.pinecone.dimension || 1536,
      }

      console.log(`[Workflow] Source node: Connected to Pinecone Index ${pineconeConfig.indexName}`)

      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'pinecone',
          pineconeApiKey,
          pineconeConfig,
        },
        {
          input: { agentId: context.agentId, ragProvider: 'pinecone' },
          output: {
            ragProvider: 'pinecone',
            indexName: pineconeConfig.indexName,
            namespace: pineconeConfig.namespace || 'default',
            embeddingModel: pineconeConfig.embeddingModel
          }
        }
      )
    } catch (error) {
      console.error('[Workflow] Source node: Pinecone initialization failed:', error)
      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'pinecone'
        },
        {
          input: { agentId: context.agentId, ragProvider: 'pinecone' },
          output: { error: error instanceof Error ? error.message : 'Pinecone initialization failed' }
        }
      )
    }
  }

  private async handleSelfHostedSearch(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const kind = selfHostedKnowledgeKind()
    const { ragSpace, ragSpaceIncludeNull } = await resolveSearchSpace(prisma, context.agentId, node.data?.ragSpaceId, 'Workflow Source node')
    console.log(`[Workflow] Source node: document search = ${kind}, agent=${context.agentId}, ragSpace=${ragSpace ?? 'all'}`)
    return this.createSuccessResult(
      {
        ...context,
        ragProvider: kind,
        azureSearchConfig: { regionId: SELFHOSTED_REGION, indexName: kind, agentId: context.agentId, ragSpace, ragSpaceIncludeNull },
      },
      {
        input: { agentId: context.agentId, ragProvider: kind },
        output: { ragProvider: kind },
      }
    )
  }

  private async handleAzureAISearch(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const subscription = await prisma.subscription.findUnique({
      where: { id: context.userId },
      select: { managedRegion: true }
    })

    //
    const contextWithoutAzureConfig: WorkflowContext = { ...context }
    delete contextWithoutAzureConfig.azureSearchConfig

    if (!subscription?.managedRegion) {
      return this.createSuccessResult(
        { ...contextWithoutAzureConfig, ragProvider: 'azure_ai_search' },
        {
          input: { agentId: context.agentId, ragProvider: 'azure_ai_search' },
          output: { warning: 'Managed region not configured' }
        }
      )
    }

    try {
      const azureConfig = await this.loadManagedAzureConfig(subscription.managedRegion)
      if (!azureConfig.searchApiKey || !azureConfig.searchEndpoint) {
        return this.createSuccessResult(
          { ...contextWithoutAzureConfig, ragProvider: 'azure_ai_search' },
          {
            input: { agentId: context.agentId, ragProvider: 'azure_ai_search' },
            output: { warning: 'Azure AI Search not configured for this region' }
          }
        )
      }

      const regionSanitized = subscription.managedRegion.replace(/[^a-z0-9-]/gi, '').toLowerCase()
      const indexName = `managed-${regionSanitized}`

      const { ragSpace, ragSpaceIncludeNull } = await resolveSearchSpace(
        prisma,
        context.agentId,
        node.data?.ragSpaceId,
        'Workflow Source node'
      )

      console.log(`[Workflow] Source node: Connected to Azure AI Search shared index ${indexName}, agent=${context.agentId}, ragSpace=${ragSpace ?? 'all'} (region: ${subscription.managedRegion})`)

      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'azure_ai_search',
          azureSearchConfig: {
            regionId: subscription.managedRegion,
            indexName,
            agentId: context.agentId,
            ragSpace,
            ragSpaceIncludeNull,
          },
        },
        {
          input: { agentId: context.agentId, ragProvider: 'azure_ai_search' },
          output: {
            ragProvider: 'azure_ai_search',
            indexName,
            region: subscription.managedRegion,
          }
        }
      )
    } catch (error) {
      console.error('[Workflow] Source node: Azure AI Search initialization failed:', describeCaughtError(error))
      return this.createSuccessResult(
        { ...contextWithoutAzureConfig, ragProvider: 'azure_ai_search' },
        {
          input: { agentId: context.agentId, ragProvider: 'azure_ai_search' },
          output: { error: error instanceof Error ? error.message : 'Azure AI Search initialization failed' }
        }
      )
    }
  }

  private async handleGeminiFileSearch(
    node: WorkflowNode,
    context: WorkflowContext,
    agent: any,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const user = await prisma.user.findUnique({
      where: { id: context.userId },
      include: { aiProviders: true, zki: true }
    })

    if (!user?.encryptedDataKey || !user?.aiProviders?.providers) {
      console.warn('[Workflow] Source node: Gemini API key not configured')
      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'gemini_file_search',
          geminiFiles: []
        },
        {
          input: { agentId: context.agentId, ragProvider: 'gemini_file_search' },
          output: { warning: 'Gemini API key not configured', geminiFiles: [] }
        }
      )
    }

    try {
      const providersConfig = JSON.parse(user.aiProviders.providers as string)
      const geminiConfig = providersConfig.gemini

      if (!geminiConfig?.apiKey) {
        console.warn('[Workflow] Source node: Gemini API key not found')
        return this.createSuccessResult(
          {
            ...context,
            ragProvider: 'gemini_file_search',
            geminiFiles: []
          },
          {
            input: { agentId: context.agentId, ragProvider: 'gemini_file_search' },
            output: { warning: 'Gemini API key not configured', geminiFiles: [] }
          }
        )
      }

      const dek = user.zkiId && user.zki?.masterKey
        ? decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
        : await decryptDataKey(Buffer.from(user.encryptedDataKey))

      const geminiApiKey = decrypt(Buffer.from(geminiConfig.apiKey, "base64"), dek)

      if (geminiApiKey === "Decryption failed") {
        throw new Error('Failed to decrypt Gemini API key')
      }

      const genAI = new GoogleGenAI({ apiKey: geminiApiKey })
      const filesResult = await genAI.files.list()

      const geminiFiles: Array<{ fileId: string; fileUri: string; fileName: string }> = []

      for await (const file of filesResult) {
        if (file.state === 'ACTIVE' && file.name && file.uri) {
          geminiFiles.push({
            fileId: file.name,
            fileUri: file.uri,
            fileName: file.displayName || file.name
          })
        }
      }

      if (geminiFiles.length === 0) {
        console.warn('[Workflow] Source node: No Gemini files found')
        return this.createSuccessResult(
          {
            ...context,
            ragProvider: 'gemini_file_search',
            geminiFiles: []
          },
          {
            input: { agentId: context.agentId, ragProvider: 'gemini_file_search' },
            output: { warning: 'No Gemini files found', geminiFiles: [] }
          }
        )
      }

      console.log(`[Workflow] Source node: Found ${geminiFiles.length} Gemini files from API`)

      const geminiSearchResults: RAGSearchResult[] = geminiFiles.map(file => ({
        provider: 'gemini' as const,
        source: file.fileName,
        content: `File reference: ${file.fileUri}`,
        metadata: {
          fileId: file.fileId,
          fileUri: file.fileUri
        }
      }))

      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'gemini_file_search',
          geminiFiles,
          searchResults: geminiSearchResults
        },
        {
          input: { agentId: context.agentId, ragProvider: 'gemini_file_search' },
          output: {
            ragProvider: 'gemini_file_search',
            fileCount: geminiFiles.length,
            files: geminiFiles.map(f => f.fileName)
          }
        }
      )
    } catch (error) {
      console.error('[Workflow] Source node: Gemini file fetch failed:', error)
      return this.createSuccessResult(
        {
          ...context,
          ragProvider: 'gemini_file_search',
          geminiFiles: []
        },
        {
          input: { agentId: context.agentId, ragProvider: 'gemini_file_search' },
          output: { error: error instanceof Error ? error.message : 'Gemini file fetch failed', geminiFiles: [] }
        }
      )
    }
  }
}

// Singleton instance
export const sourceNodeExecutor = new SourceNodeExecutor()
