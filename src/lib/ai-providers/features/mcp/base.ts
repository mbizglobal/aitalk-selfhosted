
import { BaseFeatureHandler } from '../base'
import {
  ProviderDefinition,
  UnifiedRequest,
  UnifiedResponse,
  MCPFeatureConfig,
  ToolDefinition,
  ToolCall,
} from '../../core/types'

export interface MCPToolResult {
  callId: string
  name: string
  result: string
  success: boolean
}

export abstract class BaseMCPHandler extends BaseFeatureHandler<MCPFeatureConfig, MCPToolResult[]> {
  featureId = 'mcp'

  protected mcpClient: any = null
  protected tools: ToolDefinition[] = []

  isSupported(provider: ProviderDefinition): boolean {
    return provider.capabilities.functionCalling?.mcp === true
  }

  abstract initialize(config: MCPFeatureConfig): Promise<void>

  async apply(
    request: UnifiedRequest,
    config: MCPFeatureConfig,
    provider: ProviderDefinition
  ): Promise<UnifiedRequest> {
    if (!config.enabled || this.tools.length === 0) {
      return request
    }

    return {
      ...request,
      features: {
        ...request.features,
        mcp: {
          ...config,
          tools: this.tools,
        },
      },
    }
  }

  abstract executeTool(name: string, args: Record<string, any>): Promise<string>

  abstract cleanup(): Promise<void>

  createToolCallHandler(): (toolName: string, args: Record<string, any>) => Promise<string> {
    return async (toolName: string, args: Record<string, any>) => {
      return this.executeTool(toolName, args)
    }
  }
}
