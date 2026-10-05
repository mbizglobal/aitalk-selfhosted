
import { BaseAdapter } from './base'
import {
  ProviderDefinition,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedStreamChunk,
  UnifiedMessage,
  ToolDefinition,
  ToolCall,
} from '../core/types'
import { isGptReasoningFamily } from '@/lib/managed/model-lineup'

export class OpenAICompatibleAdapter extends BaseAdapter {
  constructor(apiKey: string, definition: ProviderDefinition) {
    super(apiKey, definition)
  }

  // ============================================
  // Request Transformation
  // ============================================

  transformRequest(request: UnifiedRequest): any {
    const {
      messages,
      model,
      temperature = 0.7,
      maxTokens = 2048,
      topP,
      systemMessage,
      responseFormat,
      jsonSchema,
      stream = false,
      features,
    } = request

    const openaiMessages = this.transformMessages(messages, systemMessage)

    const tokenKey =
      this.definition.id === 'openai' ? 'max_completion_tokens' : 'max_tokens'

    const isOpenAIReasoningModel =
      this.definition.id === 'openai' &&
      (isGptReasoningFamily(model) || /^o[134]\b/.test(model))

    const requestBody: any = {
      model,
      messages: openaiMessages,
      [tokenKey]: maxTokens,
      stream,
    }

    if (!isOpenAIReasoningModel) {
      requestBody.temperature = temperature
    }

    if (topP !== undefined && !isOpenAIReasoningModel) {
      requestBody.top_p = topP
    }

    if (responseFormat === 'json') {
      if (jsonSchema) {
        requestBody.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'output',
            schema: jsonSchema,
          },
        }
      } else {
        requestBody.response_format = { type: 'json_object' }
      }
    }

    // Function Calling (Tools)
    if (features?.mcp?.tools && features.mcp.tools.length > 0) {
      requestBody.tools = this.transformTools(features.mcp.tools)
    }

    return requestBody
  }

  private transformMessages(messages: UnifiedMessage[], systemMessage?: string): any[] {
    const result: any[] = []

    if (systemMessage) {
      result.push({ role: 'system', content: systemMessage })
    }

    for (const msg of messages) {
      if (msg.role === 'system') continue

      if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        })
        continue
      }

      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content })
        continue
      }

      const content: any[] = []
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          content.push({ type: 'text', text: part.text })
        } else if (part.type === 'image' && part.image) {
          let imageUrl: string
          if (part.image.base64) {
            const mimeType = part.image.mimeType || 'image/jpeg'
            imageUrl = `data:${mimeType};base64,${part.image.base64}`
          } else if (part.image.url) {
            imageUrl = part.image.url
          } else {
            continue
          }
          content.push({
            type: 'image_url',
            image_url: { url: imageUrl },
          })
        }
      }
      result.push({ role: msg.role, content })
    }

    return result
  }

  private transformTools(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  // ============================================
  // Response Transformation
  // ============================================

  transformResponse(response: any): UnifiedResponse {
    const choice = response.choices?.[0]
    const message = choice?.message

    const toolCalls: ToolCall[] = []
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '{}',
        })
      }
    }

    let finishReason: UnifiedResponse['finishReason'] = 'stop'
    if (choice?.finish_reason === 'length') finishReason = 'length'
    else if (choice?.finish_reason === 'tool_calls') finishReason = 'tool_calls'
    else if (choice?.finish_reason === 'content_filter') finishReason = 'content_filter'

    return {
      id: response.id || '',
      content: message?.content || '',
      model: response.model || '',
      provider: this.providerId,
      finishReason,
      usage: this.transformUsage(response.usage),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  }

  // ============================================
  // Stream Chunk Transformation
  // ============================================

  transformStreamChunk(chunk: any): UnifiedStreamChunk {
    if (chunk === '[DONE]') {
      return { type: 'done' }
    }

    const choice = chunk.choices?.[0]
    const delta = choice?.delta

    // Tool Call Delta
    if (delta?.tool_calls) {
      const tc = delta.tool_calls[0]
      return {
        type: 'tool_call',
        toolCall: {
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments,
        },
      }
    }

    // Content Delta
    if (delta?.content) {
      return {
        type: 'delta',
        content: delta.content,
      }
    }

    if (chunk.usage) {
      return {
        type: 'done',
        id: chunk.id,
        usage: this.transformUsage(chunk.usage),
      }
    }

    return { type: 'delta', content: '' }
  }

  // ============================================
  // API Execution
  // ============================================

  async execute(request: any): Promise<any> {
    const response = await fetch(this.getApiUrl('/chat/completions'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw {
        status: response.status,
        message: error.error?.message || `API error: ${response.status}`,
        error,
      }
    }

    return response.json()
  }

  async *executeStream(request: any): AsyncGenerator<any> {
    const response = await fetch(this.getApiUrl('/chat/completions'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...request, stream: true }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw {
        status: response.status,
        message: error.error?.message || `API error: ${response.status}`,
        error,
      }
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              yield '[DONE]'
              continue
            }

            try {
              yield JSON.parse(data)
            } catch {
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ============================================
  // API Key Validation
  // ============================================

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch(this.getApiUrl('/models'), {
        method: 'GET',
        headers: this.getHeaders(),
      })
      return response.status !== 401 && response.status !== 403
    } catch {
      return false
    }
  }
}
