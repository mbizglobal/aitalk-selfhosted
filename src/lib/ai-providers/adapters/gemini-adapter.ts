
import { GoogleGenAI } from '@google/genai'
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

export class GeminiAdapter extends BaseAdapter {
  private client: GoogleGenAI

  constructor(apiKey: string, definition: ProviderDefinition) {
    super(apiKey, definition)
    this.client = new GoogleGenAI({ apiKey })
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
      topK,
      systemMessage,
      responseFormat,
      jsonSchema,
      features,
    } = request

    const contents = this.transformMessages(messages, features?.rag?.fileReferences)

    const config: any = {
      temperature,
      maxOutputTokens: maxTokens,
      topP,
      topK,
      systemInstruction: systemMessage,
    }

    if (responseFormat === 'json') {
      config.responseMimeType = 'application/json'
      if (jsonSchema) {
        config.responseSchema = jsonSchema
      }
    }

    const requestParams: any = {
      model,
      contents,
      config,
    }

    const tools: any[] = []

    // Web Search (Google Search Grounding)
    if (features?.webSearch?.enabled) {
      tools.push({ googleSearch: {} })
    }

    // Function Calling
    if (features?.mcp?.tools && features.mcp.tools.length > 0) {
      const functionDeclarations = this.transformTools(features.mcp.tools)
      tools.push({ functionDeclarations })
    }

    if (tools.length > 0) {
      requestParams.tools = tools
    }

    return requestParams
  }

  private transformMessages(
    messages: UnifiedMessage[],
    fileReferences?: Array<{ fileUri: string; fileName?: string }>
  ): any[] {
    return messages.map((msg, index) => {
      const parts: any[] = []

      if (index === 0 && msg.role === 'user' && fileReferences && fileReferences.length > 0) {
        for (const file of fileReferences) {
          parts.push({
            fileData: {
              fileUri: file.fileUri,
            },
          })
        }
      }

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content })
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts,
        }
      }

      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          parts.push({ text: part.text })
        } else if (part.type === 'image' && part.image) {
          if (part.image.base64) {
            const mimeType = part.image.mimeType || 'image/jpeg'
            parts.push({
              inlineData: {
                mimeType,
                data: part.image.base64,
              },
            })
          } else if (part.image.url) {
            parts.push({
              fileData: {
                fileUri: part.image.url,
              },
            })
          }
        }
      }

      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      }
    })
  }

  private transformTools(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || {
        type: 'object',
        properties: {},
        required: [],
      },
    }))
  }

  // ============================================
  // Response Transformation
  // ============================================

  transformResponse(response: any): UnifiedResponse {
    const text = response.text || ''

    const toolCalls: ToolCall[] = []
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const fc of response.functionCalls) {
        toolCalls.push({
          id: `fc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: fc.name,
          arguments: JSON.stringify(fc.args || {}),
        })
      }
    }

    // Finish Reason
    let finishReason: UnifiedResponse['finishReason'] = 'stop'
    if (toolCalls.length > 0) finishReason = 'tool_calls'

    return {
      id: response.responseId || '',
      content: text,
      model: '',
      provider: this.providerId,
      finishReason,
      usage: this.transformGeminiUsage(response.usageMetadata),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  }

  private transformGeminiUsage(usage: any) {
    return {
      promptTokens: usage?.promptTokenCount || 0,
      completionTokens: usage?.candidatesTokenCount || 0,
      totalTokens: usage?.totalTokenCount || 0,
    }
  }

  // ============================================
  // Stream Chunk Transformation
  // ============================================

  transformStreamChunk(chunk: any): UnifiedStreamChunk {
    if (chunk.functionCalls && chunk.functionCalls.length > 0) {
      const fc = chunk.functionCalls[0]
      return {
        type: 'tool_call',
        toolCall: {
          id: `fc_${Date.now()}`,
          name: fc.name,
          arguments: JSON.stringify(fc.args || {}),
        },
      }
    }

    const text = chunk.text || ''
    if (text) {
      return {
        type: 'delta',
        content: text,
      }
    }

    if (chunk.usageMetadata) {
      return {
        type: 'done',
        usage: this.transformGeminiUsage(chunk.usageMetadata),
      }
    }

    return { type: 'delta', content: '' }
  }

  // ============================================
  // API Execution
  // ============================================

  async execute(request: any): Promise<any> {
    const response = await this.client.models.generateContent(request)
    return response
  }

  async *executeStream(request: any): AsyncGenerator<any> {
    const response = await this.client.models.generateContentStream(request)

    for await (const chunk of response) {
      yield chunk
    }
  }

  // ============================================
  // API Key Validation
  // ============================================

  async validateApiKey(): Promise<boolean> {
    try {
      await this.client.models.list()
      return true
    } catch {
      return false
    }
  }
}
