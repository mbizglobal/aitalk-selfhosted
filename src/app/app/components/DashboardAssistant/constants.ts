
import { getProviderModelsForUI, LLM_PROVIDER_REGISTRY } from '@/lib/ai-providers/core/registry'

export const AI_ASSISTANT_MODELS = getProviderModelsForUI();

export const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5-mini',
  claude: 'claude-opus-4-6',
  gemini: 'gemini-3-flash-preview',
  deepseek: 'deepseek-chat',
  grok: 'grok-4-1-fast-reasoning',
  mistral: 'mistral-small-latest',
};

export const AI_ASSISTANT_PROVIDERS = Object.entries(LLM_PROVIDER_REGISTRY).map(([id, def]) => ({
  value: id,
  label: def.name,
}));

export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  } else if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}
