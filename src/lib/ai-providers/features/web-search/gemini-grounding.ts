
import { BaseWebSearchHandler, WebSearchResult } from './base'
import {
  ProviderDefinition,
  UnifiedRequest,
  WebSearchFeatureConfig,
} from '../../core/types'

export class GeminiGroundingHandler extends BaseWebSearchHandler {
  featureId = 'web-search:gemini-grounding'

  isSupported(provider: ProviderDefinition): boolean {
    return (
      provider.id === 'gemini' &&
      provider.capabilities.webSearch?.implementation === 'gemini-grounding'
    )
  }

  async apply(
    request: UnifiedRequest,
    config: WebSearchFeatureConfig,
    provider: ProviderDefinition
  ): Promise<UnifiedRequest> {
    if (!config.enabled) {
      return request
    }

    return {
      ...request,
      features: {
        ...request.features,
        webSearch: {
          ...config,
        },
      },
    }
  }

  extract(response: any): WebSearchResult[] | null {
    const groundingMetadata = response?.groundingMetadata || response?.metadata?.grounding
    if (!groundingMetadata) {
      return null
    }

    const results: WebSearchResult[] = []

    // Google Search Results
    if (groundingMetadata.groundingChunks) {
      for (const chunk of groundingMetadata.groundingChunks) {
        if (chunk.web) {
          results.push({
            url: chunk.web.uri,
            title: chunk.web.title,
          })
        }
      }
    }

    // Search Entry Point
    if (groundingMetadata.searchEntryPoint?.renderedContent) {
    }

    return results.length > 0 ? results : null
  }
}
