
// ============================================
// Core Types
// ============================================

export type {
  // Provider Definition
  ProviderDefinition,
  ModelDefinition,
  ProviderCapabilities,
  ConnectionConfig,
  UIConfig,
  ParameterDefinition,

  // Unified Request/Response
  UnifiedRequest,
  UnifiedResponse,
  UnifiedMessage,
  UnifiedMessageContent,
  UnifiedStreamChunk,
  UnifiedUsage,
  UnifiedError,

  // Feature Config
  FeatureConfig,
  RAGFeatureConfig,
  WebSearchFeatureConfig,
  MCPFeatureConfig,
  ToolDefinition,
  ToolCall,

  // Adapter Interface
  ProviderAdapter,
  FeatureHandler,

  // Legacy Compatibility Types
  LLMProviderType,
  ChatMessage,
  ChatMessageContent,
  ChatOptions,
  ChatResponse,
  StreamChunk,
} from './core/types'

export { AIErrorCode } from './core/types'

// ============================================
// ============================================

export {
  providerRegistry,
  getProviderList,
  getProvider,
  getProviderModels,
  checkProviderCapability,
  LLM_PROVIDER_REGISTRY,
  getProviderPricing,
  getProviderModelsForUI,
  getProviderFeaturesFromCapabilities,
} from './core/registry'

// ============================================
// Executor
// ============================================

export {
  UnifiedAIExecutor,
  unifiedExecutor,
  executeChat,
  executeChatStream,
  validateProviderApiKey,
} from './core/executor'

// ============================================
// Adapters
// ============================================

export {
  BaseAdapter,
  OpenAICompatibleAdapter,
  AnthropicCompatibleAdapter,
  GeminiAdapter,
} from './adapters'

// ============================================
// Feature Handlers
// ============================================

export {
  BaseFeatureHandler,
  BaseRAGHandler,
  OpenAIVectorStoreHandler,
  GeminiFileSearchHandler,
  BaseWebSearchHandler,
  OpenAIWebSearchHandler,
  GeminiGroundingHandler,
  BaseMCPHandler,
  StandardMCPHandler,
} from './features'

export type {
  RAGSearchResult,
  WebSearchResult,
  MCPToolResult,
} from './features'

// ============================================
// API Key Helpers
// ============================================

export {
  getApiKeyFromUser,
  getApiKeyByUserId,
  hasApiKey,
  hasAnyApiKey,
  getConfiguredProviders,
  getDefaultProvider,
} from './get-api-key'

// ============================================
// Legacy API Compatibility (createLLMClient)
// ============================================

import {
  LLMProviderType,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
} from './core/types'
import { providerRegistry } from './core/registry'
import { OpenAICompatibleAdapter } from './adapters/openai-compatible'
import { AnthropicCompatibleAdapter } from './adapters/anthropic-compatible'
import { GeminiAdapter } from './adapters/gemini-adapter'
import OpenAI from 'openai'

/**
 * Azure OpenAI Config for Managed users
 */
export interface AzureConfig {
  endpoint: string;   // e.g. 'https://germanywestcentral.api.cognitive.microsoft.com'
  apiVersion: string; // e.g. '2024-12-01-preview'
}

export interface BaseLLMClient {
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>
  stream(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<StreamChunk>
  validateApiKey(): Promise<boolean>
}

export function createLLMClient(
  provider: LLMProviderType,
  apiKey: string,
  azureConfig?: AzureConfig
): BaseLLMClient {
  if (azureConfig) {
    return createAzureLLMClient(apiKey, azureConfig);
  }

  const definition = providerRegistry.get(provider)

  if (!definition) {
    throw new Error(`Unknown LLM provider: ${provider}`)
  }

  let adapter: any
  switch (definition.compatibility) {
    case 'openai':
      adapter = new OpenAICompatibleAdapter(apiKey, definition)
      break
    case 'anthropic':
      adapter = new AnthropicCompatibleAdapter(apiKey, definition)
      break
    case 'gemini':
      adapter = new GeminiAdapter(apiKey, definition)
      break
    default:
      adapter = new OpenAICompatibleAdapter(apiKey, definition)
  }

  return {
    async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
      const unifiedMessages = messages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }))

      const request = {
        messages: unifiedMessages,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        topP: options.topP,
        topK: options.topK,
        systemMessage: options.systemMessage,
        responseFormat: options.responseFormat,
        jsonSchema: options.jsonSchema,
        features: {
          rag: options.fileReferences ? {
            enabled: true,
            fileReferences: options.fileReferences,
          } : undefined,
          webSearch: options.webSearch ? {
            enabled: true,
            ...(options.webSearchConfig || {}),
          } : undefined,
          mcp: options.tools ? {
            enabled: true,
            connectionId: '',
            tools: options.tools,
          } : undefined,
        },
      }

      const providerRequest = adapter.transformRequest(request)
      const providerResponse = await adapter.execute(providerRequest)
      const response = adapter.transformResponse(providerResponse)

      return {
        id: response.id,
        content: response.content,
        model: response.model,
        usage: response.usage ? {
          inputTokens: response.usage.promptTokens,
          outputTokens: response.usage.completionTokens,
        } : undefined,
        finishReason: response.finishReason,
      }
    },

    async *stream(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<StreamChunk> {
      const unifiedMessages = messages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }))

      const request = {
        messages: unifiedMessages,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        topP: options.topP,
        topK: options.topK,
        systemMessage: options.systemMessage,
        responseFormat: options.responseFormat,
        jsonSchema: options.jsonSchema,
        stream: true,
        features: {
          rag: options.fileReferences ? {
            enabled: true,
            fileReferences: options.fileReferences,
          } : undefined,
          webSearch: options.webSearch ? {
            enabled: true,
            ...(options.webSearchConfig || {}),
          } : undefined,
          mcp: options.tools ? {
            enabled: true,
            connectionId: '',
            tools: options.tools,
          } : undefined,
        },
      }

      const providerRequest = adapter.transformRequest(request)
      const streamGen = adapter.executeStream(providerRequest)

      for await (const chunk of streamGen) {
        const unified = adapter.transformStreamChunk(chunk)

        if (unified.type === 'delta' && unified.content) {
          yield { type: 'delta', content: unified.content }
        } else if (unified.type === 'done') {
          yield {
            type: 'done',
            usage: unified.usage ? {
              inputTokens: unified.usage.promptTokens,
              outputTokens: unified.usage.completionTokens,
            } : undefined,
          }
        } else if (unified.type === 'error') {
          yield { type: 'error', error: unified.error?.message }
        }
      }
    },

    async validateApiKey(): Promise<boolean> {
      return adapter.validateApiKey()
    },
  }
}

function createAzureLLMClient(apiKey: string, azureConfig: AzureConfig): BaseLLMClient {
  const endpoint = azureConfig.endpoint.replace(/\/+$/, '');

  return {
    async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
      const deploymentClient = new OpenAI({
        apiKey,
        baseURL: `${endpoint}/openai/deployments/${options.model}`,
        defaultQuery: { 'api-version': azureConfig.apiVersion },
        defaultHeaders: { 'api-key': apiKey },
      });

      const response = await deploymentClient.chat.completions.create({
        model: options.model,
        messages: messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
        temperature: options.temperature ?? 0.7,
        max_completion_tokens: options.maxTokens ?? 2048,
        ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' as const } } : {}),
      });

      const choice = response.choices[0];
      return {
        id: response.id,
        content: choice?.message?.content || '',
        model: response.model,
        usage: response.usage ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        } : undefined,
        finishReason: choice?.finish_reason || undefined,
      };
    },

    async *stream(): AsyncGenerator<StreamChunk> {
      throw new Error('Azure LLM client does not support streaming in AI Assistant');
    },

    async validateApiKey(): Promise<boolean> {
      return true; // Managed keys are always valid
    },
  };
}

/**
 * Legacy API Key Validation
 */
export async function validateApiKey(
  provider: LLMProviderType,
  apiKey: string
): Promise<boolean> {
  try {
    const client = createLLMClient(provider, apiKey)
    return await client.validateApiKey()
  } catch {
    return false
  }
}
