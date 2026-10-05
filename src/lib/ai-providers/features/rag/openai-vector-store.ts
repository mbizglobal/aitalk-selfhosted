import { BaseRAGHandler, type RAGSearchResult } from '@/lib/ai-providers/features/rag/base'
import type { ProviderDefinition, UnifiedRequest, RAGFeatureConfig } from '@/lib/ai-providers/core/types'

export class OpenAIVectorStoreHandler extends BaseRAGHandler {
  featureId = 'openai-vector-store'
  isSupported(_provider: ProviderDefinition): boolean { return false }
  async apply(_request: UnifiedRequest, _config: RAGFeatureConfig, _provider: ProviderDefinition): Promise<UnifiedRequest> {
    throw new Error('OpenAI Vector Store is not part of this installation (self-hosted edition)')
  }
  extract(_response: any): RAGSearchResult[] | null { return null }
}
