
import { ReactElement } from 'react'

export interface AgentStudioContentProps {
  initialAgent: any | null
  initialWorkflow?: any | null
  initialAgentId?: string | null
}

export interface AiNodeSettings {
  model: string
  temperature: number
  maxTokens: number
  topP: number
  effort: string
  verbosity: string
  summary: string
  storeLogs: boolean
  includeChatHistory: boolean
  outputFormat: 'text' | 'json'
  systemMessage: string
}

export interface SelectedToolsState {
  source: boolean
  mcp: boolean
  webSearch: boolean
  functionCalling: boolean
  imageInput: boolean
  pdfInput: boolean
}

export interface CustomNodeData {
  label: string
  icon?: any // React Component
  color?: string
  textColor?: string
  showLeftHandle?: boolean
  nodeType?: 'start' | 'ai' | 'end' | 'note' | 'ifelse' | 'tool'
  showTools?: boolean
  toolCount?: number
  hasToolsConnection?: boolean
  onAddTool?: (aiNodeId: string) => void

  accessMode?: 'public' | 'team'

  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  effort?: string
  verbosity?: string
  summary?: string
  storeLogs?: boolean
  includeChatHistory?: boolean
  outputFormat?: 'text' | 'json'
  systemMessage?: string
  selectedTools?: SelectedToolsState
  imageInput?: boolean
  pdfInput?: boolean
  vectorStoreId?: string
  schemaName?: string
  schemaProperties?: any[]
  jsonSchema?: string

  webSearchDomains?: string
  webSearchCountry?: string
  webSearchRegion?: string
  webSearchCity?: string
  webSearchTimezone?: string
  webSearchContextSize?: 'high' | 'medium' | 'low'

  toolType?: 'source' | 'mcp' | 'webSearch' | 'functionCalling' | 'webhook'
  parentId?: string

  ragProvider?: 'openai_vector_store' | 'gemini_file_search' | 'pinecone' | 'qdrant' | 'weaviate' | 'milvus' | 'chromadb'
  ragStoreId?: string

  noteText?: string
  backgroundColor?: string

  conditions?: Array<{
    id: string
    type: 'if' | 'elseif' | 'else'
    condition: string
    caseName: string
  }>

  maxIterations?: number
  conditionField?: string
  conditionOperator?: '==' | '!=' | '>' | '<' | '>=' | '<='
  conditionValue?: any
}