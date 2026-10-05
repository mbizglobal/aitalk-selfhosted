
import { BaseRAGHandler, RAGSearchResult } from './base'
import {
  ProviderDefinition,
  UnifiedRequest,
  RAGFeatureConfig,
} from '../../core/types'

export class GeminiFileSearchHandler extends BaseRAGHandler {
  featureId = 'rag:gemini-file-search'

  isSupported(provider: ProviderDefinition): boolean {
    return (
      provider.id === 'gemini' &&
      provider.capabilities.rag?.implementation === 'gemini-file-search'
    )
  }

  async apply(
    request: UnifiedRequest,
    config: RAGFeatureConfig,
    provider: ProviderDefinition
  ): Promise<UnifiedRequest> {
    if (!config.enabled || !config.fileReferences || config.fileReferences.length === 0) {
      return request
    }

    return {
      ...request,
      features: {
        ...request.features,
        rag: {
          ...config,
          fileReferences: config.fileReferences,
        },
      },
    }
  }

  extract(response: any): RAGSearchResult[] | null {
    const groundingMetadata = response?.groundingMetadata || response?.metadata?.grounding
    if (!groundingMetadata) {
      return null
    }

    const results: RAGSearchResult[] = []

    // File grounding
    if (groundingMetadata.searchEntryPoint?.retrievedContext) {
      for (const ctx of groundingMetadata.searchEntryPoint.retrievedContext) {
        results.push({
          content: ctx.text || '',
          source: ctx.uri,
          metadata: ctx,
        })
      }
    }

    return results.length > 0 ? results : null
  }
}
