export interface WebVoiceConfig {
  enabled?: boolean
  timeLimitMin?: number
  iconStyle?: 'classic' | 'filled' | 'outline' | 'rounded' | 'minimal' | string
  iconColor?: string
  backgroundColor?: string
  animation?: boolean
}
export function buildWebVoicePopupUrl(_baseUrl: string, _agentId: string, _workflowId?: string | null): string {
  return ''
}
export function generateWebVoiceEmbedCode(_agentId: string, _workflowId: string | undefined | null, _wv: WebVoiceConfig, _baseUrl: string): string {
  return ''
}
