
import { BaseMCPHandler, MCPToolResult } from './base'
import {
  ProviderDefinition,
  MCPFeatureConfig,
  ToolDefinition,
} from '../../core/types'

interface McpClientInterface {
  initialize(): Promise<void>
  listTools(): Promise<any[]>
  callTool(name: string, args: Record<string, any>): Promise<any>
  close(): Promise<void>
}

export class StandardMCPHandler extends BaseMCPHandler {
  featureId = 'mcp:standard'

  private serverUrl: string = ''
  private accessToken: string | null = null

  async initialize(config: MCPFeatureConfig): Promise<void> {
    if (!config.connectionId) {
      throw new Error('MCP connection ID is required')
    }

    const { McpClient } = await import('@/lib/workflow/nodes/mcp')

    this.mcpClient = new McpClient(this.serverUrl, this.accessToken)
    await this.mcpClient.initialize()

    const mcpTools = await this.mcpClient.listTools()
    this.tools = mcpTools.map((tool: any) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description || `MCP tool: ${tool.name}`,
      parameters: tool.inputSchema || {
        type: 'object',
        properties: {},
        required: [],
      },
    }))
  }

  setConnection(serverUrl: string, accessToken: string | null): void {
    this.serverUrl = serverUrl
    this.accessToken = accessToken
  }

  async executeTool(name: string, args: Record<string, any>): Promise<string> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized')
    }

    try {
      const result = await this.mcpClient.callTool(name, args)

      if (result.content && Array.isArray(result.content)) {
        return result.content
          .map((c: any) => c.text || JSON.stringify(c))
          .join('\n')
      }

      return JSON.stringify(result)
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  }

  async cleanup(): Promise<void> {
    if (this.mcpClient) {
      try {
        await this.mcpClient.close()
      } catch {
      }
      this.mcpClient = null
    }
    this.tools = []
  }

  getTools(): ToolDefinition[] {
    return this.tools
  }
}
