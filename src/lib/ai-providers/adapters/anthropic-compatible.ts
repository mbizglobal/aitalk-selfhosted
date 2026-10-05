
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

export class AnthropicCompatibleAdapter extends BaseAdapter {
  private webSearchEnabled: boolean = false
  private webSearchConfig: any = null

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
      systemMessage,
      stream = false,
      features,
    } = request

    const { systemContent, userMessages } = this.transformMessages(messages, systemMessage)

    const requestBody: any = {
      model,
      messages: userMessages,
      max_tokens: maxTokens,
      temperature,
      stream,
    }

    if (systemContent) {
      requestBody.system = systemContent
    }

    const tools: any[] = []

    // Web Search Tool (Claude web_search_20250305)
    if (features?.webSearch?.enabled) {
      this.webSearchEnabled = true
      const webSearchTool: any = {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: features.webSearch.maxUses || 5,
      }

      if (features.webSearch.allowedDomains && features.webSearch.allowedDomains.length > 0) {
        webSearchTool.allowed_domains = features.webSearch.allowedDomains
      } else if (features.webSearch.blockedDomains && features.webSearch.blockedDomains.length > 0) {
        webSearchTool.blocked_domains = features.webSearch.blockedDomains
      }

      if (features.webSearch.userLocation) {
        webSearchTool.user_location = {
          type: 'approximate',
          ...features.webSearch.userLocation,
        }
      }

      tools.push(webSearchTool)
      this.webSearchConfig = webSearchTool
    }

    // Function Calling (MCP Tools)
    if (features?.mcp?.tools && features.mcp.tools.length > 0) {
      tools.push(...this.transformTools(features.mcp.tools))
    }

    if (tools.length > 0) {
      requestBody.tools = tools
    }

    return requestBody
  }

  private transformMessages(
    messages: UnifiedMessage[],
    systemMessage?: string
  ): { systemContent: string; userMessages: any[] } {
    let systemContent = systemMessage || ''
    const userMessages: any[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          systemContent = msg.content
        }
        continue
      }

      if (msg.role === 'tool') {
        userMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          ],
        })
        continue
      }

      if (typeof msg.content === 'string') {
        userMessages.push({ role: msg.role, content: msg.content })
        continue
      }

      const content: any[] = []
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          content.push({ type: 'text', text: part.text })
        } else if (part.type === 'image' && part.image) {
          if (part.image.base64) {
            const mimeType = part.image.mimeType || 'image/jpeg'
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: part.image.base64,
              },
            })
          } else if (part.image.url) {
          }
        }
      }
      userMessages.push({ role: msg.role, content })
    }

    return { systemContent, userMessages }
  }

  private transformTools(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }

  // ============================================
  // Response Transformation
  // ============================================

  transformResponse(response: any): UnifiedResponse {
    let content = ''
    const toolCalls: ToolCall[] = []
    const citations: Array<{ url: string; title: string; citedText?: string }> = []
    const webSearchResults: Array<{ url: string; title: string; pageAge?: string }> = []

    if (response.content && Array.isArray(response.content)) {
      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text
          if (block.citations && Array.isArray(block.citations)) {
            for (const citation of block.citations) {
              if (citation.type === 'web_search_result_location') {
                citations.push({
                  url: citation.url,
                  title: citation.title,
                  citedText: citation.cited_text,
                })
              }
            }
          }
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
          })
        } else if (block.type === 'server_tool_use' && block.name === 'web_search') {
          console.log(`[Claude Web Search] Query: ${block.input?.query}`)
        } else if (block.type === 'web_search_tool_result') {
          if (Array.isArray(block.content)) {
            for (const result of block.content) {
              if (result.type === 'web_search_result') {
                webSearchResults.push({
                  url: result.url,
                  title: result.title,
                  pageAge: result.page_age,
                })
              }
            }
          }
        }
      }
    }

    let finishReason: UnifiedResponse['finishReason'] = 'stop'
    if (response.stop_reason === 'max_tokens') finishReason = 'length'
    else if (response.stop_reason === 'tool_use') finishReason = 'tool_calls'
    else if (response.stop_reason === 'pause_turn') finishReason = 'stop'

    const usage = this.transformUsage(response.usage)
    if (response.usage?.server_tool_use?.web_search_requests) {
      (usage as any).webSearchRequests = response.usage.server_tool_use.web_search_requests
    }

    return {
      id: response.id || '',
      content,
      model: response.model || '',
      provider: this.providerId,
      finishReason,
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      metadata: (citations.length > 0 || webSearchResults.length > 0) ? {
        citations,
        webSearchResults,
      } : undefined,
    } as UnifiedResponse
  }

  // ============================================
  // Stream Chunk Transformation
  // ============================================

  transformStreamChunk(chunk: any): UnifiedStreamChunk {
    const eventType = chunk.type

    if (eventType === 'content_block_delta' && chunk.delta?.text) {
      return {
        type: 'delta',
        content: chunk.delta.text,
      }
    }

    // Tool Use Delta (MCP Function Calling)
    if (eventType === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
      return {
        type: 'tool_call',
        toolCall: {
          id: chunk.content_block.id,
          name: chunk.content_block.name,
        },
      }
    }

    if (eventType === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
      return {
        type: 'tool_call',
        toolCall: {
          arguments: chunk.delta.partial_json,
        },
      }
    }

    if (eventType === 'content_block_start' && chunk.content_block?.type === 'server_tool_use') {
      if (chunk.content_block.name === 'web_search') {
        return {
          type: 'delta',
          content: '',
          metadata: { webSearchStarted: true },
        } as UnifiedStreamChunk
      }
    }

    if (eventType === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
      try {
        const query = JSON.parse(chunk.delta.partial_json || '{}')
        if (query.query) {
          console.log(`[Claude Web Search] Query: ${query.query}`)
        }
      } catch {
      }
      return { type: 'delta', content: '' }
    }

    if (eventType === 'content_block_start' && chunk.content_block?.type === 'web_search_tool_result') {
      const results = chunk.content_block.content || []
      const webSearchResults = results
        .filter((r: any) => r.type === 'web_search_result')
        .map((r: any) => ({
          url: r.url,
          title: r.title,
          pageAge: r.page_age,
        }))

      if (webSearchResults.length > 0) {
        console.log(`[Claude Web Search] Found ${webSearchResults.length} results`)
      }

      return {
        type: 'delta',
        content: '',
        metadata: { webSearchResults },
      } as UnifiedStreamChunk
    }

    // Message Start (input tokens)
    if (eventType === 'message_start' && chunk.message?.usage) {
      return {
        type: 'delta',
        content: '',
      }
    }

    // Message Delta (output tokens)
    if (eventType === 'message_delta' && chunk.usage) {
      const usage = this.transformUsage({
        input_tokens: 0,
        output_tokens: chunk.usage.output_tokens || 0,
      })

      return {
        type: 'done',
        usage,
      }
    }

    // Message Stop
    if (eventType === 'message_stop') {
      return { type: 'done' }
    }

    return { type: 'delta', content: '' }
  }

  // ============================================
  // API Execution
  // ============================================

  async execute(request: any): Promise<any> {
    const response = await fetch(this.getApiUrl('/messages'), {
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
    const response = await fetch(this.getApiUrl('/messages'), {
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
            if (data === '[DONE]') continue

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
      const response = await fetch(this.getApiUrl('/messages'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        }),
      })
      return response.status !== 401 && response.status !== 403
    } catch {
      return false
    }
  }
}
