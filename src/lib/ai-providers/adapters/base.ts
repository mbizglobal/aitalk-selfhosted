
import {
  ProviderAdapter,
  ProviderDefinition,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedStreamChunk,
  UnifiedError,
  UnifiedUsage,
  AIErrorCode,
} from '../core/types'

export abstract class BaseAdapter implements ProviderAdapter {
  protected apiKey: string
  protected definition: ProviderDefinition

  constructor(apiKey: string, definition: ProviderDefinition) {
    this.apiKey = apiKey
    this.definition = definition
  }

  get providerId(): string {
    return this.definition.id
  }

  // ============================================
  // ============================================

  abstract transformRequest(request: UnifiedRequest): any

  abstract transformResponse(response: any): UnifiedResponse

  abstract transformStreamChunk(chunk: any): UnifiedStreamChunk

  abstract execute(request: any): Promise<any>

  abstract executeStream(request: any): AsyncGenerator<any>

  abstract validateApiKey(): Promise<boolean>

  // ============================================
  // ============================================

  transformError(error: any): UnifiedError {
    const status = error?.status || error?.response?.status
    const code = error?.code || error?.error?.code
    const message = error?.message || error?.error?.message || 'Unknown error'

    // Rate Limit
    if (status === 429 || code === 'rate_limit_exceeded') {
      return {
        code: AIErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
        retryable: true,
        retryAfter: this.parseRetryAfter(error),
        provider: this.providerId,
        originalError: error,
      }
    }

    // Authentication
    if (status === 401 || status === 403) {
      return {
        code: AIErrorCode.AUTH_INVALID_API_KEY,
        message: 'API 키가 유효하지 않습니다. 설정에서 확인해주세요.',
        retryable: false,
        provider: this.providerId,
        originalError: error,
      }
    }

    // Organization Not Verified (OpenAI KYC)
    if (message.includes('organization must be verified') || message.includes('must be verified to')) {
      return {
        code: AIErrorCode.ORGANIZATION_NOT_VERIFIED,
        message: 'GPT-5 이상 모델을 사용하려면 OpenAI 조직 인증(KYC)이 필요합니다. https://platform.openai.com/settings/organization/general 에서 인증을 완료해주세요.',
        retryable: false,
        provider: this.providerId,
        originalError: error,
      }
    }

    // Context Length
    if (code === 'context_length_exceeded' || message.includes('context')) {
      return {
        code: AIErrorCode.CONTEXT_LENGTH_EXCEEDED,
        message: '입력이 모델의 최대 컨텍스트 길이를 초과했습니다.',
        retryable: false,
        provider: this.providerId,
        originalError: error,
      }
    }

    // Content Policy
    if (code === 'content_policy_violation' || status === 400 && message.includes('content')) {
      return {
        code: AIErrorCode.CONTENT_POLICY_VIOLATION,
        message: '콘텐츠 정책 위반으로 요청이 거부되었습니다.',
        retryable: false,
        provider: this.providerId,
        originalError: error,
      }
    }

    // Server Error
    if (status >= 500) {
      return {
        code: AIErrorCode.SERVER_ERROR,
        message: 'AI 서비스 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        retryable: true,
        retryAfter: 5000,
        provider: this.providerId,
        originalError: error,
      }
    }

    // Default
    return {
      code: AIErrorCode.UNKNOWN,
      message: message,
      retryable: false,
      provider: this.providerId,
      originalError: error,
    }
  }

  protected parseRetryAfter(error: any): number {
    const header = error?.response?.headers?.['retry-after']
    if (header) {
      const seconds = parseInt(header)
      if (!isNaN(seconds)) {
        return seconds * 1000
      }
    }
    return 60000
  }

  // ============================================
  // Utility Methods
  // ============================================

  protected transformUsage(usage: any, pricing?: { input: number; output: number }): UnifiedUsage {
    const promptTokens = usage?.input_tokens || usage?.prompt_tokens || usage?.promptTokenCount || 0
    const completionTokens = usage?.output_tokens || usage?.completion_tokens || usage?.candidatesTokenCount || 0
    const totalTokens = promptTokens + completionTokens

    const result: UnifiedUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
    }

    if (usage?.prompt_tokens_details?.cached_tokens) {
      result.cachedTokens = usage.prompt_tokens_details.cached_tokens
    }

    if (usage?.completion_tokens_details?.reasoning_tokens) {
      result.reasoningTokens = usage.completion_tokens_details.reasoning_tokens
    }

    if (pricing) {
      result.estimatedCost = {
        inputCost: (promptTokens / 1_000_000) * pricing.input,
        outputCost: (completionTokens / 1_000_000) * pricing.output,
        totalCost: ((promptTokens / 1_000_000) * pricing.input) +
                   ((completionTokens / 1_000_000) * pricing.output),
      }
    }

    return result
  }

  protected extractTextContent(content: string | any[]): string {
    if (typeof content === 'string') {
      return content
    }

    return content
      .filter(part => part.type === 'text')
      .map(part => part.text || '')
      .join('')
  }

  protected extractBase64Image(url: string): { mimeType: string; data: string } | null {
    if (!url.startsWith('data:')) {
      return null
    }

    const [header, base64] = url.split(',')
    const mimeType = header.match(/data:(.*?);/)?.[1] || 'image/jpeg'
    return { mimeType, data: base64 }
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const { authType, apiKeyHeader, apiVersion, customHeaders } = this.definition.connection

    if (authType === 'bearer') {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    } else if (authType === 'api-key') {
      const headerName = apiKeyHeader || 'x-api-key'
      headers[headerName] = this.apiKey
    }

    if (apiVersion) {
      headers['anthropic-version'] = apiVersion
    }

    // Custom Headers
    if (customHeaders) {
      Object.assign(headers, customHeaders)
    }

    return headers
  }

  protected getApiUrl(endpoint: string): string {
    const baseUrl = this.definition.connection.baseUrl.replace(/\/$/, '')
    return `${baseUrl}/${endpoint.replace(/^\//, '')}`
  }
}
