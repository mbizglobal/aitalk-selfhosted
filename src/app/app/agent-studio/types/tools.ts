
export interface ToolTypeInfo {
  name: string
  icon: any // React Component
  color: string
  textColor?: string
  description: string
}

export interface MCPToolConfig {
  url: string
  label: string
  description: string
  authType: 'none' | 'token' | 'custom'
  authToken: string
  customHeaders: Array<{
    id: string
    header: string
    value: string
  }>
  connected: boolean
  approvalType: 'always' | 'never' | 'tool-specific'
  tools: Array<{
    id: string
    name: string
    description: string
    enabled: boolean
  }>
  serverName: string
}

export interface WebSearchToolConfig {
  domains: string
  country: string
  region: string
  city: string
  timezone: string
  contextSize: 'high' | 'medium' | 'low'
}

export interface FunctionCallingToolConfig {
  definition: string
}

export interface FunctionExample {
  name: string
  label: string
  definition: {
    name: string
    description: string
    strict: boolean
    parameters: {
      type: string
      properties: Record<string, any>
      additionalProperties: boolean
      required: string[]
    }
  }
}

export interface ToolItem {
  id: string
  name: string
  [key: string]: any
}