
import { NextRequest } from 'next/server'

// ========================================
// ========================================

export interface WorkflowNode {
  id: string
  type: 'start' | 'ai' | 'file_search' | 'source' | 'condition' | 'ifElse' | 'webhook' | 'while' | 'wait' | 'dataSheets' | 'mcp' | 'sendgrid' | 'telegram' | 'sms' | 'sms_acs' | 'sms_infobip' | 'imap' | 'smtp' | 'httpRequest' | 'store' | 'pstn' | 'end' | 'tool' | 'note' | 'continue'
  position: { x: number; y: number }
  data: Record<string, any>
}

export interface WorkflowEdge {
  id: string
  source: string  // source node id
  target: string  // target node id
  sourceHandle?: string
  targetHandle?: string
}

export interface WorkflowJson {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface RAGSearchResult {
  provider: 'openai' | 'gemini' | 'pinecone'
  source: string
  content: string
  score?: number
  metadata?: {
    fileId?: string
    pageNumber?: number
    chunkId?: string
    [key: string]: any
  }
}

export interface WorkflowDebugChildEntry {
  type: 'llm_call' | 'tool_call' | 'mcp_call' | 'apps_tool_call' | 'file_search' | 'web_search'
  name: string
  duration: number
  status: 'success' | 'error' | 'warning'
  input?: any
  output?: any
  error?: string
}

export interface WorkflowDebugLogEntry {
  nodeId: string
  nodeName: string
  nodeType?: WorkflowNode['type']
  duration: number
  status: 'success' | 'error'
  input: any
  output: any
  error?: string
  children?: WorkflowDebugChildEntry[]
}

// ========================================
// ========================================

export interface WorkflowContext {
  message: string
  agentId: string
  userId: string
  request?: NextRequest

  uploadedFiles?: Array<{
    id: string
    name: string
    type: 'image' | 'pdf' | 'csv'
    base64?: string
    text?: string
    size: number
  }>

  vectorStoreId?: string
  sourceVectorStoreId?: string
  sourceVectorStoreName?: string
  searchResults?: RAGSearchResult[]
  aiResponse?: string
  finalAnswer?: string

  workflowAiModel?: string

  ragProvider?: 'none' | 'openai_vector_store' | 'gemini_file_search' | 'pinecone' | 'azure_ai_search' | 'pgvector' | 'http_search'
  geminiFiles?: Array<{ fileId: string; fileName: string }>
  pineconeApiKey?: string
  pineconeConfig?: {
    host?: string
    indexName: string
    namespace?: string
    embeddingApiKey?: string
    embeddingModel?: string
    dimension?: number
  }
  azureSearchConfig?: {
    regionId: string
    indexName: string        // managed-{regionId}
    agentId: string
    ragSpace?: string
    ragSpaceIncludeNull?: boolean
  }
  jsonData?: any
  whileResult?: any
  ifElseResult?: {
    matchedCondition: string
    matchedHandle: string | null
    conditionType: string
  }
  mcpTools?: Array<{ name: string; description: string }>
  mcpResult?: any

  httpResult?: any

  storeResult?: {
    success: boolean
    provider: string
    documentCount: number
    documentIds: string[]
    error?: string
  }

  input?: Record<string, unknown>
  subWorkflowDepth?: number
  callerNumber?: string
  voiceQuiz?: {
    roundId: string
    phase: string
    questionCount: number
    asked: number
    correct: number
    topic: string
    actionKey?: string
    anonKey?: string
    consentText?: string
    consentAt?: string
    consentAfterMs?: number
    callReg?: string
    callGroup?: string
  }

  workScope?: import('@/lib/work/app-scope').WorkScope

  chatHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>

  toolTraceSink?: import('./nodes/ai/tool-trace').ToolTraceEntry[]

  previousToolTrace?: import('./nodes/ai/tool-trace').PreviousToolTrace

  chatSummaryProtocol?: number

  chatSummary?: string
  chatSummaryUpdate?: { summary: string; foldedCount: number }
  chatHistoryTruncated?: boolean

  clientId?: string
  conversationId?: string
  previousResponseId?: string

  pageContext?: {
    url: string
    path: string   // pathname
    title: string
  }

  inputTokens?: number
  outputTokens?: number
  responseId?: string
  model?: string

  isResuming?: boolean
  waitingNodeId?: string

  whileLoopContext?: {
    whileNodeId: string
    currentIteration: number
    loopToolIndex: number
  }

  forEachContext?: {
    sourceArray: any[]
    currentIndex: number
    currentItem: any
    totalCount: number
  }

  // PSTN (ACS Call Automation)
  isPstnCall?: boolean
  callConnectionId?: string
  pstnResult?: {
    success: boolean
    callConnectionId?: string
    targetPhoneNumber?: string
    error?: string
  }

  isScheduledTrigger?: boolean
  scheduleRunKey?: string
  workflowId?: string

  skipAiCallCpa?: boolean

  isTestMode?: boolean

  __debugEnabled?: boolean

  isManaged?: boolean
  managedRegion?: string
  aiConnection?: import('@/lib/ai-connections').AiConnectionInfo

  nodeError?: {
    nodeId: string
    nodeLabel: string
    error: string
    folderNotFound?: boolean
  }
}

// ========================================
// ========================================

export interface WorkflowExecutionResult {
  streamResponse: Response
  executionPath: string[]
  totalDuration: number
  debugLogs?: WorkflowDebugLogEntry[]
  isWaiting?: boolean
  waitingNodeId?: string
  isPausedAtBreakpoint?: boolean
  pausedNodeId?: string
  context?: WorkflowContext
  needsRetry?: boolean
  retryAfterMs?: number
  nodeError?: {
    nodeId: string
    nodeLabel: string
    error: string
    folderNotFound?: boolean
  }
}

// ========================================
// ========================================

export interface StartNodeData {
  label: string
}

export interface AINodeData {
  label: string
  model: string
  temperature: number
  maxTokens: number
  systemMessage: string
  vectorStoreId?: string
}

export interface FileSearchNodeData {
  label: string
  vectorStoreId: string
  maxResults?: number
}

export interface ConditionNodeData {
  label: string
  condition: 'if_found' | 'if_not_found' | 'custom'
  customRule?: string
}

export interface WebhookNodeData {
  label: string
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

export interface EmailNodeData {
  label: string
  to: string
  subject: string
  body: string
}

export interface EndNodeData {
  label: string
}

// ========================================
// ========================================

export const DEFAULT_WORKFLOW: WorkflowJson = {
  nodes: [
    {
      id: 'start',
      type: 'start',
      position: { x: 100, y: 100 },
      data: { label: 'Chat Widget' }
    },
    {
      id: 'ai',
      type: 'ai',
      position: { x: 400, y: 100 },
      data: {
        label: 'AI',
        model: 'gpt-6-luna',
        temperature: 0.7,
        maxTokens: 2048,
        systemMessage: 'You are a helpful assistant',
      }
    },
    {
      id: 'end',
      type: 'end',
      position: { x: 700, y: 100 },
      data: { label: 'End' }
    }
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ai' },
    { id: 'e2', source: 'ai', target: 'end' }
  ]
}
