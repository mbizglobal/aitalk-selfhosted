
import { BaseWebSearchHandler, WebSearchResult } from './base'
import {
  ProviderDefinition,
  UnifiedRequest,
  WebSearchFeatureConfig,
} from '../../core/types'

export class OpenAIWebSearchHandler extends BaseWebSearchHandler {
  featureId = 'web-search:openai'

  isSupported(provider: ProviderDefinition): boolean {
    return (
      provider.id === 'openai' &&
      provider.capabilities.webSearch?.implementation === 'openai-web-search'
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
          domains: config.domains,
          location: config.location,
          contextSize: config.contextSize || 'medium',
        },
      },
    }
  }

  extract(response: any): WebSearchResult[] | null {
    const annotations = response?.annotations || response?.metadata?.annotations
    if (!annotations || !Array.isArray(annotations)) {
      return null
    }

    const results: WebSearchResult[] = []
    for (const ann of annotations) {
      if (ann.type === 'url_citation' || ann.url_citation) {
        const citation = ann.url_citation || ann
        results.push({
          url: citation.url,
          title: citation.title,
          snippet: citation.text,
        })
      }
    }

    return results.length > 0 ? results : null
  }
}
