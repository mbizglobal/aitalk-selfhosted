
import { BaseFeatureHandler } from '../base'
import {
  ProviderDefinition,
  UnifiedRequest,
  UnifiedResponse,
  RAGFeatureConfig,
  UnifiedMessage,
} from '../../core/types'

export interface RAGSearchResult {
  content: string
  score?: number
  metadata?: Record<string, any>
  source?: string
}

export abstract class BaseRAGHandler extends BaseFeatureHandler<RAGFeatureConfig, RAGSearchResult[]> {
  featureId = 'rag'

  isSupported(provider: ProviderDefinition): boolean {
    return !!provider.capabilities.rag
  }

  abstract apply(
    request: UnifiedRequest,
    config: RAGFeatureConfig,
    provider: ProviderDefinition
  ): Promise<UnifiedRequest>

  protected injectContext(
    request: UnifiedRequest,
    searchResults: RAGSearchResult[]
  ): UnifiedRequest {
    if (searchResults.length === 0) {
      return request
    }

    const contextText = searchResults
      .map((r, i) => `[Document ${i + 1}]${r.source ? ` (${r.source})` : ''}\n${r.content}`)
      .join('\n\n')

    const systemPrefix = `You have access to the following relevant documents:\n\n${contextText}\n\nUse this information to answer the user's question accurately.`

    const newSystemMessage = request.systemMessage
      ? `${systemPrefix}\n\n${request.systemMessage}`
      : systemPrefix

    return {
      ...request,
      systemMessage: newSystemMessage,
    }
  }
}
