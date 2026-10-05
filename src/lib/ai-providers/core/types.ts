
// ============================================
// Provider Definition Types
// ============================================

export interface ProviderDefinition {
  id: string
  name: string
  type: 'llm'

  connection: ConnectionConfig

  models: ModelDefinition[]

  capabilities: ProviderCapabilities

  ui: UIConfig

  compatibility: 'openai' | 'anthropic' | 'gemini' | 'custom'

  docsUrl?: string
}

export interface ConnectionConfig {
  baseUrl: string
  authType: 'bearer' | 'api-key' | 'custom'
  apiKeyHeader?: string
  apiKeyPattern?: string
  customHeaders?: Record<string, string>
  apiVersion?: string
}

export interface ModelDefinition {
  id: string
  name: string
  contextWindow?: number
  maxOutputTokens?: number
  vision: boolean
  functionCalling: boolean
  pricing?: {
    input: number   // per 1M tokens
    output: number  // per 1M tokens
  }
  features?: {
    reasoning?: boolean
    webSearch?: boolean
    json?: boolean
  }
}

export interface ProviderCapabilities {
  chat: boolean
  streaming: boolean
  vision: boolean

  rag?: RAGCapability
  webSearch?: WebSearchCapability
  functionCalling?: FunctionCallingCapability
  jsonOutput?: JSONOutputCapability
}

export interface RAGCapability {
  type: 'built-in' | 'external'
  implementation: string // 'openai-vector-store' | 'gemini-file-search' | 'none'
}

export interface WebSearchCapability {
  type: 'native' | 'tool-based' | 'grounding'
  implementation: string // 'openai-web-search' | 'gemini-grounding' | 'claude-tool'
}

export interface FunctionCallingCapability {
  format: 'openai' | 'anthropic' | 'gemini'
  mcp: boolean
  parallelCalls?: boolean
}

export interface JSONOutputCapability {
  format: 'response_format' | 'schema' | 'prompt-based'
}

export interface UIConfig {
  parameters: ParameterDefinition[]
  sections?: UISectionDefinition[]
}

export interface ParameterDefinition {
  name: string
  type: 'slider' | 'select' | 'checkbox' | 'number' | 'text'
  label: string
  default: any
  min?: number
  max?: number
  step?: number
  options?: Array<{ value: any; label: string }>
  showIf?: string
  description?: string
}

export interface UISectionDefinition {
  id: string
  label: string
  showIf?: string
  parameters: string[] // parameter names
}

// ============================================
// Unified Request/Response Types
// ============================================

export interface UnifiedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | UnifiedMessageContent[]
  name?: string // tool name
  toolCallId?: string // tool result reference
}

export interface UnifiedMessageContent {
  type: 'text' | 'image'
  text?: string
  image?: {
    url?: string
    base64?: string
    mimeType?: string
  }
}

export interface UnifiedRequest {
  messages: UnifiedMessage[]
  model: string
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  systemMessage?: string
  responseFormat?: 'text' | 'json'
  jsonSchema?: object
  stream?: boolean

  features?: FeatureConfig
}

export interface FeatureConfig {
  rag?: RAGFeatureConfig
  webSearch?: WebSearchFeatureConfig
  mcp?: MCPFeatureConfig
}

export interface RAGFeatureConfig {
  enabled: boolean
  vectorStoreId?: string
  fileReferences?: Array<{ fileUri: string; fileName?: string }>
  maxResults?: number
}

export interface WebSearchFeatureConfig {
  enabled: boolean
  domains?: string[]
  location?: {
    country?: string
    region?: string
    city?: string
    timezone?: string
  }
  contextSize?: 'low' | 'medium' | 'high'

  maxUses?: number
  allowedDomains?: string[]
  blockedDomains?: string[]
  userLocation?: {
    country?: string
    region?: string
    city?: string
    timezone?: string
  }
}

export interface MCPFeatureConfig {
  enabled: boolean
  connectionId: string
  tools?: ToolDefinition[]
}

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: object
}

export interface UnifiedResponse {
  id: string
  content: string
  model: string
  provider: string
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error'

  usage: UnifiedUsage

  toolCalls?: ToolCall[]
  citations?: Citation[]
  metadata?: Record<string, any>
}

export interface ToolCall {
  id: string
  name: string
  arguments: string // JSON string
}

export interface Citation {
  url: string
  title?: string
  snippet?: string
}

export interface UnifiedUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number

  cachedTokens?: number
  reasoningTokens?: number

  estimatedCost?: {
    inputCost: number   // USD
    outputCost: number  // USD
    totalCost: number   // USD
  }
}

export interface UnifiedStreamChunk {
  type: 'delta' | 'tool_call' | 'done' | 'error'
  content?: string
  toolCall?: Partial<ToolCall>
  id?: string
  usage?: UnifiedUsage
  error?: UnifiedError
}

// ============================================
// Error Normalization
// ============================================

export enum AIErrorCode {
  AUTH_INVALID_API_KEY = 'AUTH_INVALID_API_KEY',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  AUTH_INSUFFICIENT_PERMISSIONS = 'AUTH_INSUFFICIENT_PERMISSIONS',
  ORGANIZATION_NOT_VERIFIED = 'ORGANIZATION_NOT_VERIFIED',

  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  MAX_TOKENS_EXCEEDED = 'MAX_TOKENS_EXCEEDED',

  CONTENT_POLICY_VIOLATION = 'CONTENT_POLICY_VIOLATION',
  UNSAFE_CONTENT = 'UNSAFE_CONTENT',

  SERVER_ERROR = 'SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',

  INVALID_REQUEST = 'INVALID_REQUEST',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  FEATURE_NOT_SUPPORTED = 'FEATURE_NOT_SUPPORTED',
  UNKNOWN = 'UNKNOWN',
}

export interface UnifiedError {
  code: AIErrorCode
  message: string
  originalError?: any
  retryable: boolean
  retryAfter?: number
  provider: string
  details?: Record<string, any>
}

// ============================================
// Adapter Interface
// ============================================

export interface ProviderAdapter {
  providerId: string

  transformRequest(request: UnifiedRequest): any

  transformResponse(response: any): UnifiedResponse

  transformStreamChunk(chunk: any): UnifiedStreamChunk

  transformError(error: any): UnifiedError

  execute(request: any): Promise<any>

  executeStream(request: any): AsyncGenerator<any>

  validateApiKey(): Promise<boolean>
}

// ============================================
// Feature Handler Interface
// ============================================

export interface FeatureHandler<TConfig = any, TResult = any> {
  featureId: string

  isSupported(provider: ProviderDefinition): boolean

  apply(request: UnifiedRequest, config: TConfig, provider: ProviderDefinition): Promise<UnifiedRequest>

  extract(response: UnifiedResponse): TResult | null

  initialize?(config: TConfig): Promise<void>

  cleanup?(): Promise<void>
}

// ============================================
// Legacy Compatibility Types
// ============================================

export type LLMProviderType = 'openai' | 'gemini' | 'claude' | 'deepseek' | 'grok' | string

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatMessageContent[]
}

export interface ChatMessageContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
    detail?: 'auto' | 'low' | 'high'
  }
}

export interface ChatOptions {
  model: string
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  stream?: boolean
  systemMessage?: string
  tools?: ToolDefinition[]
  responseFormat?: 'text' | 'json'
  jsonSchema?: object
  fileReferences?: Array<{ fileUri: string; fileName?: string }>
  webSearch?: boolean
  webSearchConfig?: {
    maxUses?: number
    allowedDomains?: string[]
    blockedDomains?: string[]
    userLocation?: {
      country?: string
      region?: string
      city?: string
      timezone?: string
    }
  }
  mcpToolCallHandler?: (toolName: string, args: Record<string, any>) => Promise<string>
}

export interface ChatResponse {
  id: string
  content: string
  model: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  finishReason?: string
}

export interface StreamChunk {
  type: 'delta' | 'done' | 'error'
  content?: string
  id?: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  error?: string
}
