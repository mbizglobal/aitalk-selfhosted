
import type { Node, Edge } from 'reactflow'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'

export interface WorkflowState {
  nodes: Node[]
  edges: Edge[]
  agentId: string | null
  agentName: string
  hasChanges: boolean
}

export type TestStatus = 'untested' | 'testing' | 'tested' | 'failed'

export interface TestState {
  status: TestStatus
  errors: string[]
  message: string
  isExecuting: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface PreviewState {
  isActive: boolean
  tab: 'chat' | 'logs'
  messages: ChatMessage[]
  executionLogs: WorkflowDebugLogEntry[]
  selectedStepIndex: number | null
}

export interface PanelSizeState {
  height: number
  chatWidth: number
  stepsWidth: number
  detailsWidth: number
  isDraggingHeight: boolean
  isDraggingChatWidth: boolean
  isDraggingStepsWidth: boolean
  isDraggingDetailsWidth: boolean
}

export interface ExpandedLogView {
  type: 'input' | 'output'
  title: string
  data: any
}

export interface StorageStats {
  totalItems: number
  totalSize: number
  byType: Record<string, Record<string, number>>
}

export interface Country {
  code: string
  name: string
  region: string
}

export interface UploadedFile {
  id: string
  name: string
  type: 'image' | 'pdf' | 'csv'
  base64?: string
  text?: string
  size: number
  previewUrl?: string
  isFirstPage?: boolean
  totalPages?: number
}

export interface FileInputConfig {
  imageInput: boolean
  pdfInput: boolean
  csvInput: boolean
}