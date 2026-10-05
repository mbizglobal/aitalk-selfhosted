
import { BaseFeatureHandler } from '../base'
import {
  ProviderDefinition,
  UnifiedRequest,
  UnifiedResponse,
  WebSearchFeatureConfig,
} from '../../core/types'

export interface WebSearchResult {
  url: string
  title?: string
  snippet?: string
  score?: number
}

export abstract class BaseWebSearchHandler extends BaseFeatureHandler<WebSearchFeatureConfig, WebSearchResult[]> {
  featureId = 'web-search'

  isSupported(provider: ProviderDefinition): boolean {
    return !!provider.capabilities.webSearch
  }

  abstract apply(
    request: UnifiedRequest,
    config: WebSearchFeatureConfig,
    provider: ProviderDefinition
  ): Promise<UnifiedRequest>

  extract(response: UnifiedResponse): WebSearchResult[] | null {
    if (!response.citations || response.citations.length === 0) {
      return null
    }

    return response.citations.map(c => ({
      url: c.url,
      title: c.title,
      snippet: c.snippet,
    }))
  }
}
