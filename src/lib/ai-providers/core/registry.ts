
import {
  ProviderDefinition,
  ModelDefinition,
  ProviderCapabilities,
  LLMProviderType,
} from './types'

// ============================================
// ============================================

const openaiDefinition: ProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  type: 'llm',
  connection: {
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    apiKeyPattern: '^sk-[a-zA-Z0-9-_]{20,}$',
  },
  models: [
    { id: 'gpt-5-mini', name: 'GPT-5 Mini', contextWindow: 1000000, maxOutputTokens: 65536, vision: true, functionCalling: true, features: { reasoning: true }, pricing: { input: 0.25, output: 2 } },
    { id: 'gpt-6-luna', name: 'GPT-6 Luna', contextWindow: 1100000, maxOutputTokens: 65536, vision: true, functionCalling: true, features: { reasoning: true }, pricing: { input: 0.1, output: 0.5 } },
    { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 1100000, maxOutputTokens: 65536, vision: true, functionCalling: true, features: { reasoning: true }, pricing: { input: 2, output: 10 } },
    { id: 'gpt-5.1', name: 'GPT-5.1', contextWindow: 1000000, maxOutputTokens: 65536, vision: true, functionCalling: true, features: { reasoning: true }, pricing: { input: 1.25, output: 10 } },
    { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1000000, maxOutputTokens: 32768, vision: true, functionCalling: true, pricing: { input: 2, output: 8 } },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextWindow: 1000000, maxOutputTokens: 32768, vision: true, functionCalling: true, pricing: { input: 0.4, output: 1.6 } },
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384, vision: true, functionCalling: true, pricing: { input: 2.5, output: 10 } },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxOutputTokens: 16384, vision: true, functionCalling: true, pricing: { input: 0.15, output: 0.6 } },
    { id: 'gpt-realtime-1.5', name: 'GPT Realtime 1.5 (Voice)', contextWindow: 128000, maxOutputTokens: 4096, vision: false, functionCalling: true, pricing: { input: 4, output: 16 } },
    { id: 'gpt-realtime-2.1', name: 'GPT Realtime 2.1 (Voice)', contextWindow: 128000, maxOutputTokens: 4096, vision: false, functionCalling: true, pricing: { input: 4, output: 24 } },
    { id: 'gpt-realtime-2.1-mini', name: 'GPT Realtime 2.1 Mini (Voice)', contextWindow: 128000, maxOutputTokens: 4096, vision: false, functionCalling: true, pricing: { input: 0.6, output: 2.4 } },
  ],
  capabilities: {
    chat: true,
    streaming: true,
    vision: true,
    rag: { type: 'built-in', implementation: 'openai-vector-store' },
    webSearch: { type: 'native', implementation: 'openai-web-search' },
    functionCalling: { format: 'openai', mcp: true, parallelCalls: true },
    jsonOutput: { format: 'response_format' },
  },
  ui: {
    parameters: [
      { name: 'temperature', type: 'slider', label: 'Temperature', default: 0.7, min: 0, max: 2, step: 0.01 },
      { name: 'maxTokens', type: 'number', label: 'Max Tokens', default: 2048, min: 1, max: 65536 },
      { name: 'topP', type: 'slider', label: 'Top P', default: 1, min: 0, max: 1, step: 0.01 },
      { name: 'effort', type: 'select', label: 'Reasoning Effort', default: 'medium', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], showIf: "model.startsWith('gpt-5')" },
      { name: 'verbosity', type: 'select', label: 'Verbosity', default: 'medium', options: [{ value: 'concise', label: 'Concise' }, { value: 'medium', label: 'Medium' }, { value: 'detailed', label: 'Detailed' }], showIf: "model.startsWith('gpt-5')" },
    ],
  },
  compatibility: 'openai',
  docsUrl: 'https://platform.openai.com/docs',
}

const geminiDefinition: ProviderDefinition = {
  id: 'gemini',
  name: 'Google Gemini',
  type: 'llm',
  connection: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'api-key',
    apiKeyPattern: '^AIza[a-zA-Z0-9-_]{35}$',
  },
  models: [
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', contextWindow: 1000000, maxOutputTokens: 65536, vision: true, functionCalling: true, pricing: { input: 0.5, output: 3 } },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', contextWindow: 1000000, maxOutputTokens: 65536, vision: true, functionCalling: true, pricing: { input: 2, output: 12 } },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000, maxOutputTokens: 65536, vision: true, functionCalling: true, pricing: { input: 0.3, output: 2.5 } },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, maxOutputTokens: 65536, vision: true, functionCalling: true, pricing: { input: 1.25, output: 10 } },
  ],
  capabilities: {
    chat: true,
    streaming: true,
    vision: true,
    rag: { type: 'built-in', implementation: 'gemini-file-search' },
    webSearch: { type: 'grounding', implementation: 'gemini-grounding' },
    functionCalling: { format: 'gemini', mcp: true },
    jsonOutput: { format: 'schema' },
  },
  ui: {
    parameters: [
      { name: 'temperature', type: 'slider', label: 'Temperature', default: 0.7, min: 0, max: 2, step: 0.01 },
      { name: 'maxTokens', type: 'number', label: 'Max Tokens', default: 2048, min: 1, max: 65536 },
      { name: 'topP', type: 'slider', label: 'Top P', default: 1, min: 0, max: 1, step: 0.01 },
      { name: 'topK', type: 'number', label: 'Top K', default: 40, min: 1, max: 100 },
    ],
  },
  compatibility: 'gemini',
  docsUrl: 'https://ai.google.dev/gemini-api/docs',
}

const claudeDefinition: ProviderDefinition = {
  id: 'claude',
  name: 'Anthropic Claude',
  type: 'llm',
  connection: {
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'api-key',
    apiKeyHeader: 'x-api-key',
    apiKeyPattern: '^sk-ant-[a-zA-Z0-9-_]{20,}$',
    apiVersion: '2023-06-01',
  },
  models: [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200000, maxOutputTokens: 64000, vision: true, functionCalling: true, pricing: { input: 5, output: 25 } },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000, maxOutputTokens: 64000, vision: true, functionCalling: true, pricing: { input: 3, output: 15 } },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxOutputTokens: 64000, vision: true, functionCalling: true, pricing: { input: 1, output: 5 } },
  ],
  capabilities: {
    chat: true,
    streaming: true,
    vision: true,
    rag: { type: 'external', implementation: 'none' },
    webSearch: { type: 'native', implementation: 'claude-web-search' }, // web_search_20250305 tool
    functionCalling: { format: 'anthropic', mcp: true },
    jsonOutput: { format: 'prompt-based' },
  },
  ui: {
    parameters: [
      { name: 'temperature', type: 'slider', label: 'Temperature', default: 0.7, min: 0, max: 1, step: 0.01 },
      { name: 'maxTokens', type: 'number', label: 'Max Tokens', default: 2048, min: 1, max: 64000 },
    ],
  },
  compatibility: 'anthropic',
  docsUrl: 'https://docs.anthropic.com',
}

const deepseekDefinition: ProviderDefinition = {
  id: 'deepseek',
  name: 'DeepSeek',
  type: 'llm',
  connection: {
    baseUrl: 'https://api.deepseek.com/v1',
    authType: 'bearer',
  },
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek V3.2', contextWindow: 128000, maxOutputTokens: 8192, vision: false, functionCalling: true, pricing: { input: 0.28, output: 0.42 } },
  ],
  capabilities: {
    chat: true,
    streaming: true,
    vision: false,
    functionCalling: { format: 'openai', mcp: true },
    jsonOutput: { format: 'response_format' },
  },
  ui: {
    parameters: [
      { name: 'temperature', type: 'slider', label: 'Temperature', default: 0.7, min: 0, max: 2, step: 0.01 },
      { name: 'maxTokens', type: 'number', label: 'Max Tokens', default: 2048, min: 1, max: 64000 },
      { name: 'topP', type: 'slider', label: 'Top P', default: 1, min: 0, max: 1, step: 0.01 },
    ],
  },
  compatibility: 'openai',
  docsUrl: 'https://api-docs.deepseek.com',
}

const grokDefinition: ProviderDefinition = {
  id: 'grok',
  name: 'xAI Grok',
  type: 'llm',
  connection: {
    baseUrl: 'https://api.x.ai/v1',
    authType: 'bearer',
  },
  models: [
    { id: 'grok-4-1-fast-reasoning', name: 'Grok 4.1 Fast', contextWindow: 2000000, maxOutputTokens: 32768, vision: true, functionCalling: true, pricing: { input: 0.2, output: 0.5 } },
  ],
  capabilities: {
    chat: true,
    streaming: true,
    vision: true,
    functionCalling: { format: 'openai', mcp: true },
    jsonOutput: { format: 'response_format' },
  },
  ui: {
    parameters: [
      { name: 'temperature', type: 'slider', label: 'Temperature', default: 0.7, min: 0, max: 2, step: 0.01 },
      { name: 'maxTokens', type: 'number', label: 'Max Tokens', default: 2048, min: 1, max: 32768 },
      { name: 'topP', type: 'slider', label: 'Top P', default: 1, min: 0, max: 1, step: 0.01 },
    ],
  },
  compatibility: 'openai',
  docsUrl: 'https://docs.x.ai',
}

const mistralDefinition: ProviderDefinition = {
  id: 'mistral',
  name: 'Mistral AI',
  type: 'llm',
  connection: {
    baseUrl: 'https://api.mistral.ai/v1',
    authType: 'bearer',
  },
  models: [
    { id: 'mistral-large-latest', name: 'Mistral Large', contextWindow: 262000, maxOutputTokens: 8192, vision: true, functionCalling: true, pricing: { input: 0.50, output: 1.50 } },
    { id: 'mistral-small-latest', name: 'Mistral Small', contextWindow: 128000, maxOutputTokens: 8192, vision: true, functionCalling: true, pricing: { input: 0.06, output: 0.18 } },
  ],
  capabilities: {
    chat: true,
    streaming: true,
    vision: true,
    functionCalling: { format: 'openai', mcp: true },
    jsonOutput: { format: 'response_format' },
  },
  ui: {
    parameters: [
      { name: 'temperature', type: 'slider', label: 'Temperature', default: 0.7, min: 0, max: 2, step: 0.01 },
      { name: 'maxTokens', type: 'number', label: 'Max Tokens', default: 2048, min: 1, max: 8192 },
      { name: 'topP', type: 'slider', label: 'Top P', default: 1, min: 0, max: 1, step: 0.01 },
    ],
  },
  compatibility: 'openai',
  docsUrl: 'https://docs.mistral.ai',
}

// ============================================
// Provider Registry Class
// ============================================

class ProviderRegistry {
  private providers: Map<string, ProviderDefinition> = new Map()
  private customProviders: Map<string, ProviderDefinition> = new Map()

  constructor() {
    this.register(openaiDefinition)
    this.register(geminiDefinition)
    this.register(claudeDefinition)
    this.register(deepseekDefinition)
    this.register(grokDefinition)
    this.register(mistralDefinition)
  }

  register(definition: ProviderDefinition): void {
    this.providers.set(definition.id, definition)
  }

  registerCustom(definition: ProviderDefinition): void {
    this.customProviders.set(definition.id, definition)
  }

  get(id: string): ProviderDefinition | undefined {
    return this.providers.get(id) || this.customProviders.get(id)
  }

  getAll(): ProviderDefinition[] {
    return [
      ...Array.from(this.providers.values()),
      ...Array.from(this.customProviders.values()),
    ]
  }

  getBuiltIn(): ProviderDefinition[] {
    return Array.from(this.providers.values())
  }

  getCustom(): ProviderDefinition[] {
    return Array.from(this.customProviders.values())
  }

  has(id: string): boolean {
    return this.providers.has(id) || this.customProviders.has(id)
  }

  getModels(providerId: string): ModelDefinition[] {
    const provider = this.get(providerId)
    return provider?.models || []
  }

  getModel(providerId: string, modelId: string): ModelDefinition | undefined {
    const models = this.getModels(providerId)
    return models.find(m => m.id === modelId)
  }

  hasCapability(
    providerId: string,
    capability: keyof ProviderCapabilities
  ): boolean {
    const provider = this.get(providerId)
    if (!provider) return false
    return !!provider.capabilities[capability]
  }

  getCapability<K extends keyof ProviderCapabilities>(
    providerId: string,
    capability: K
  ): ProviderCapabilities[K] | undefined {
    const provider = this.get(providerId)
    return provider?.capabilities[capability]
  }

  getProvidersWithCapability(capability: keyof ProviderCapabilities): ProviderDefinition[] {
    return this.getAll().filter(p => !!p.capabilities[capability])
  }

  validateApiKeyFormat(providerId: string, apiKey: string): boolean {
    const provider = this.get(providerId)
    if (!provider?.connection.apiKeyPattern) return true
    const pattern = new RegExp(provider.connection.apiKeyPattern)
    return pattern.test(apiKey)
  }

  getUIParameters(providerId: string, modelId?: string): ProviderDefinition['ui']['parameters'] {
    const provider = this.get(providerId)
    if (!provider) return []

    if (modelId) {
      return provider.ui.parameters.filter(param => {
        if (!param.showIf) return true
        return this.evaluateShowIf(param.showIf, modelId)
      })
    }

    return provider.ui.parameters
  }

  private evaluateShowIf(condition: string, modelId: string): boolean {
    try {
      if (condition.includes('model.startsWith')) {
        const match = condition.match(/model\.startsWith\(['"](.+)['"]\)/)
        if (match) {
          return modelId.startsWith(match[1])
        }
      }
      if (condition.includes('model ===')) {
        const match = condition.match(/model === ['"](.+)['"]/)
        if (match) {
          return modelId === match[1]
        }
      }
      return true
    } catch {
      return true
    }
  }
}

// ============================================
// Singleton Instance & Exports
// ============================================

export const providerRegistry = new ProviderRegistry()

export function getProviderList(): ProviderDefinition[] {
  return providerRegistry.getAll()
}

export function getProvider(id: LLMProviderType): ProviderDefinition | undefined {
  return providerRegistry.get(id)
}

export function getProviderModels(id: LLMProviderType): ModelDefinition[] {
  return providerRegistry.getModels(id)
}

export function checkProviderCapability(
  id: LLMProviderType,
  capability: keyof ProviderCapabilities
): boolean {
  return providerRegistry.hasCapability(id, capability)
}

export const LLM_PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
  openai: openaiDefinition,
  gemini: geminiDefinition,
  claude: claudeDefinition,
  deepseek: deepseekDefinition,
  grok: grokDefinition,
  mistral: mistralDefinition,
}

// ============================================
// Helper Functions (Single Source of Truth)
// ============================================

export function getProviderPricing(): Record<string, Record<string, { input: number; output: number }>> {
  const result: Record<string, Record<string, { input: number; output: number }>> = {}
  for (const [id, def] of Object.entries(LLM_PROVIDER_REGISTRY)) {
    result[id] = {}
    for (const model of def.models) {
      if (model.pricing) {
        result[id][model.id] = {
          input: model.pricing.input,
          output: model.pricing.output,
        }
      }
    }
  }
  return result
}

export function getProviderModelsForUI(): Record<string, { value: string; label: string; price: string }[]> {
  const result: Record<string, { value: string; label: string; price: string }[]> = {}
  for (const [id, def] of Object.entries(LLM_PROVIDER_REGISTRY)) {
    result[id] = def.models.map(model => ({
      value: model.id,
      label: model.name,
      price: `$${(model.pricing?.output ?? 0).toFixed(2)}/1M`,
    }))
  }
  return result
}

export function getProviderFeaturesFromCapabilities(): Record<string, {
  name: string;
  features: Record<string, { enabled: boolean; label: string; description?: string }>;
}> {
  const result: Record<string, any> = {}
  for (const [id, def] of Object.entries(LLM_PROVIDER_REGISTRY)) {
    const caps = def.capabilities
    result[id] = {
      name: def.name,
      features: {
        rag: {
          enabled: !!caps.rag && caps.rag.type !== 'external',
          label: 'RAG (Vector Store)',
          description: 'Retrieval-Augmented Generation',
        },
        webSearch: {
          enabled: !!caps.webSearch,
          label: 'Web Search',
          description: 'Real-time web search',
        },
        mcp: {
          enabled: !!(caps.functionCalling && (caps.functionCalling as any)?.mcp),
          label: 'MCP Tools',
          description: 'Model Context Protocol',
        },
        functionCalling: {
          enabled: !!caps.functionCalling,
          label: 'Function Calling',
          description: 'Tool/function calling support',
        },
        vision: {
          enabled: !!caps.vision,
          label: 'Image Input',
          description: 'Vision/image understanding',
        },
        jsonOutput: {
          enabled: !!caps.jsonOutput,
          label: 'JSON Output',
          description: 'Structured JSON output',
        },
        streaming: {
          enabled: !!caps.streaming,
          label: 'Streaming',
          description: 'Streaming responses',
        },
      },
    }
  }
  return result
}
