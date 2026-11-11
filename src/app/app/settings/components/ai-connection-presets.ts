export type PresetKind = 'azure' | 'openai_compatible' | 'anthropic'

export interface AiConnectionPreset {
  id: 'openai' | 'gemini' | 'anthropic' | 'azure' | 'own_server' | 'phoeniqs' | 'infomaniak'
  label: string
  hosting?: { country: 'CH' }
  hintKey?: string
  kind: PresetKind
  name: string
  baseUrl: string
  textModel: string
  imageModel: string
  embeddingModel: string
  keyUrl?: string
  signupUrl?: string
  off?: true
}

export const ALL_AI_CONNECTION_PRESETS: readonly AiConnectionPreset[] = [
  { id: 'azure', label: 'Azure OpenAI', kind: 'azure', name: 'Azure OpenAI', baseUrl: '', textModel: 'gpt-6-luna', imageModel: '', embeddingModel: '' },
  { id: 'openai', label: 'OpenAI', kind: 'openai_compatible', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', textModel: 'gpt-6-luna', imageModel: 'gpt-4.1-mini', embeddingModel: 'text-embedding-3-small', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Gemini', kind: 'openai_compatible', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', textModel: 'gemini-3.8-flash', imageModel: 'gemini-3.8-flash', embeddingModel: 'gemini-embedding-001', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'anthropic', label: 'Claude', kind: 'anthropic', name: 'Claude', baseUrl: 'https://api.anthropic.com', textModel: 'claude-haiku-5-5', imageModel: 'claude-haiku-5-5', embeddingModel: '', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'phoeniqs', off: true, label: 'Phoeniqs', hosting: { country: 'CH' }, kind: 'openai_compatible', name: 'Phoeniqs', baseUrl: 'https://maas.phoeniqs.com/v1', textModel: 'inference-gpt-oss-120b', imageModel: 'inference-gemma4-31b', embeddingModel: 'inference-bge-m3' },
  { id: 'infomaniak', label: 'Infomaniak', hosting: { country: 'CH' }, hintKey: 'aic_hint_infomaniak', kind: 'openai_compatible', name: 'Infomaniak', baseUrl: 'https://api.infomaniak.com/2/ai/<product_id>/openai/v1', textModel: '', imageModel: '', embeddingModel: '', keyUrl: 'https://manager.infomaniak.com/v3/ng/profile/user/token/list', signupUrl: 'https://www.infomaniak.com/en/hosting/ai-services' },
  { id: 'own_server', label: 'Ollama / vLLM', kind: 'openai_compatible', name: 'Own AI server', baseUrl: 'http://ollama:11434/v1', textModel: '', imageModel: '', embeddingModel: '' },
]

export const AI_CONNECTION_PRESETS: readonly AiConnectionPreset[] = ALL_AI_CONNECTION_PRESETS.filter((p) => !p.off)

export type ConnectionLabel = 'openai' | 'azure' | 'gemini' | 'claude' | 'phoeniqs' | 'infomaniak' | 'openai_compatible'
export function connectionLabelOf(kind: PresetKind, baseUrl: string): ConnectionLabel {
  if (kind === 'azure') return 'azure'
  if (kind === 'anthropic') return 'claude'
  let host = ''
  try { host = new URL(baseUrl.trim()).hostname.toLowerCase() } catch { }
  if (host === 'api.openai.com') return 'openai'
  if (host === 'generativelanguage.googleapis.com') return 'gemini'
  if (host === 'maas.phoeniqs.com') return 'phoeniqs'
  if (host === 'api.infomaniak.com') return 'infomaniak'
  return 'openai_compatible'
}
export const CONNECTION_LABEL_NAMES: Readonly<Record<Exclude<ConnectionLabel, 'openai_compatible'>, string>> = {
  openai: 'OpenAI', azure: 'Azure OpenAI', gemini: 'Gemini', claude: 'Claude', phoeniqs: 'Phoeniqs', infomaniak: 'Infomaniak',
}
export const shouldShowModelSizeNote = (l: ConnectionLabel) => l === 'openai_compatible' || l === 'phoeniqs' || l === 'infomaniak'

export const hasUrlPlaceholder = (url: string) => /<[^>]*>|%3C|%3E/i.test(url)

export const REGION_NOTE_KEYS: Readonly<Partial<Record<ConnectionLabel, string>>> = {
  azure: 'aic_region_azure', openai: 'aic_region_openai', gemini: 'aic_region_gemini', claude: 'aic_region_claude',
}
