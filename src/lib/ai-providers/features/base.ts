
import {
  FeatureHandler,
  ProviderDefinition,
  UnifiedRequest,
  UnifiedResponse,
} from '../core/types'

export abstract class BaseFeatureHandler<TConfig = any, TResult = any>
  implements FeatureHandler<TConfig, TResult>
{
  abstract featureId: string

  abstract isSupported(provider: ProviderDefinition): boolean

  abstract apply(
    request: UnifiedRequest,
    config: TConfig,
    provider: ProviderDefinition
  ): Promise<UnifiedRequest>

  extract(response: UnifiedResponse): TResult | null {
    return null
  }

  async initialize?(config: TConfig): Promise<void> {
  }

  async cleanup?(): Promise<void> {
  }
}
