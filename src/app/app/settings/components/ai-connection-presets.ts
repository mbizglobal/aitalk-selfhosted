export type PresetKind = 'azure' | 'openai_compatible' | 'anthropic'

export interface AiConnectionPreset {
  id: 'openai' | 'gemini' | 'anthropic' | 'azure' | 'own_server'
  label: string
  kind: PresetKind
  name: string
  baseUrl: string
  textModel: string
  imageModel: string
  embeddingModel: string
  keyUrl?: string
}

export const AI_CONNECTION_PRESETS: readonly AiConnectionPreset[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai_compatible', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', textModel: 'gpt-6-luna', imageModel: 'gpt-4.1-mini', embeddingModel: 'text-embedding-3-small', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai_compatible', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', textModel: 'gemini-3.8-flash', imageModel: 'gemini-3.8-flash', embeddingModel: 'gemini-embedding-001', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', textModel: 'claude-haiku-5-5', imageModel: 'claude-haiku-5-5', embeddingModel: '', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'azure', label: 'Azure OpenAI', kind: 'azure', name: 'Azure OpenAI', baseUrl: '', textModel: 'gpt-6-luna', imageModel: '', embeddingModel: '' },
  { id: 'own_server', label: 'Ollama / vLLM', kind: 'openai_compatible', name: 'Own AI server', baseUrl: 'http://ollama:11434/v1', textModel: '', imageModel: '', embeddingModel: '' },
]
