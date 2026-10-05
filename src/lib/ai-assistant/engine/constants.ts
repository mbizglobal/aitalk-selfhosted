/**
 * AI Assistant Constants
 */

import { getProviderPricing } from '@/lib/ai-providers';

// AI Assistant pricing per provider (per 1M tokens, USD)
export const AI_ASSISTANT_PRICING: Record<string, Record<string, { input: number; output: number }>> = getProviderPricing();

// Default model per provider
export const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5-mini',
  claude: 'claude-opus-4-6',
  gemini: 'gemini-3-flash-preview',
  deepseek: 'deepseek-chat',
  grok: 'grok-4-1-fast-reasoning',
  mistral: 'mistral-small-latest',
};

// Provider key mapping (UI provider → DB provider key)
export const PROVIDER_KEY_MAP: Record<string, string> = {
  openai: 'openai',
  claude: 'claude',
  gemini: 'gemini',
  deepseek: 'deepseek',
  grok: 'xai',
  mistral: 'mistral',
};
