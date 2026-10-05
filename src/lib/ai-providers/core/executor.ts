
import {
  ProviderDefinition,
  ProviderAdapter,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedStreamChunk,
  UnifiedError,
  AIErrorCode,
  LLMProviderType,
} from './types'
import { providerRegistry } from './registry'
import { OpenAICompatibleAdapter } from '../adapters/openai-compatible'
import { AnthropicCompatibleAdapter } from '../adapters/anthropic-compatible'
import { GeminiAdapter } from '../adapters/gemini-adapter'

// ============================================
// Adapter Factory
// ============================================

function createAdapter(
  providerId: string,
  apiKey: string,
  definition: ProviderDefinition
): ProviderAdapter {
  switch (definition.compatibility) {
    case 'openai':
      return new OpenAICompatibleAdapter(apiKey, definition)
    case 'anthropic':
      return new AnthropicCompatibleAdapter(apiKey, definition)
    case 'gemini':
      return new GeminiAdapter(apiKey, definition)
    case 'custom':
    default:
      return new OpenAICompatibleAdapter(apiKey, definition)
  }
}

// ============================================
// Unified AI Executor Class
// ============================================

export class UnifiedAIExecutor {
  private adapterCache: Map<string, ProviderAdapter> = new Map()

  private getAdapter(providerId: string, apiKey: string): ProviderAdapter {
    const cacheKey = `${providerId}:${apiKey.slice(0, 8)}`

    if (this.adapterCache.has(cacheKey)) {
      return this.adapterCache.get(cacheKey)!
    }

    const definition = providerRegistry.get(providerId)

    if (!definition) {
      throw new Error(`Unknown provider: ${providerId}`)
    }

    const adapter = createAdapter(providerId, apiKey, definition)
    this.adapterCache.set(cacheKey, adapter)
    return adapter
  }

  async execute(
    providerId: LLMProviderType,
    apiKey: string,
    request: UnifiedRequest
  ): Promise<UnifiedResponse> {
    const adapter = this.getAdapter(providerId, apiKey)

    try {
      const providerRequest = adapter.transformRequest(request)

      const providerResponse = await adapter.execute(providerRequest)

      const response = adapter.transformResponse(providerResponse)

      return response
    } catch (error) {
      const unifiedError = adapter.transformError(error)
      throw unifiedError
    }
  }

  async *executeStream(
    providerId: LLMProviderType,
    apiKey: string,
    request: UnifiedRequest
  ): AsyncGenerator<UnifiedStreamChunk> {
    const adapter = this.getAdapter(providerId, apiKey)

    try {
      const providerRequest = adapter.transformRequest({ ...request, stream: true })

      const stream = adapter.executeStream(providerRequest)

      for await (const chunk of stream) {
        const unifiedChunk = adapter.transformStreamChunk(chunk)
        yield unifiedChunk
      }
    } catch (error) {
      const unifiedError = adapter.transformError(error)
      yield {
        type: 'error',
        error: unifiedError,
      }
    }
  }

  async validateApiKey(providerId: LLMProviderType, apiKey: string): Promise<boolean> {
    try {
      const adapter = this.getAdapter(providerId, apiKey)
      return await adapter.validateApiKey()
    } catch {
      return false
    }
  }

  clearCache(): void {
    this.adapterCache.clear()
  }
}

// ============================================
// Singleton Instance
// ============================================

export const unifiedExecutor = new UnifiedAIExecutor()

// ============================================
// Convenience Functions
// ============================================

export async function executeChat(
  providerId: LLMProviderType,
  apiKey: string,
  request: UnifiedRequest
): Promise<UnifiedResponse> {
  return unifiedExecutor.execute(providerId, apiKey, request)
}

export async function* executeChatStream(
  providerId: LLMProviderType,
  apiKey: string,
  request: UnifiedRequest
): AsyncGenerator<UnifiedStreamChunk> {
  yield* unifiedExecutor.executeStream(providerId, apiKey, request)
}

export async function validateProviderApiKey(
  providerId: LLMProviderType,
  apiKey: string
): Promise<boolean> {
  return unifiedExecutor.validateApiKey(providerId, apiKey)
}
