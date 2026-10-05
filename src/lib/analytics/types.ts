// GA4 Measurement Protocol Types

export interface GA4Event {
  name: string
  params: Record<string, string | number | boolean>
}

export interface WorkflowExecutionEvent {
  workflow_id: string
  workflow_name: string
  agent_id: string
  agent_name: string
  trigger_type: 'chat_widget' | 'team_chat' | 'telegram' | 'schedule'
  execution_status: 'started' | 'success' | 'failed'
  duration_ms?: number
  node_count?: number
  ai_model?: string
  user_id?: string
}

export interface AnalyticsConfig {
  measurementId: string
  apiSecret: string
  isEnabled: boolean
}
