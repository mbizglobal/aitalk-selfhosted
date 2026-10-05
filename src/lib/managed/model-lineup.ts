
export const RETIRED_CHAT_MODEL_REPLACEMENTS: Readonly<Record<string, string>> = {
  'gpt-5.6-luna': 'gpt-6-luna',
  'gpt-5.6-terra': 'gpt-6-sol',
  'gpt-5.6-sol': 'gpt-6-sol',
  'gpt-5.1': 'gpt-6-sol',
  'gpt-realtime-1.5': 'gpt-realtime-2.1',
}

export function replaceRetiredChatModel(model: string): string {
  return Object.prototype.hasOwnProperty.call(RETIRED_CHAT_MODEL_REPLACEMENTS, model)
    ? RETIRED_CHAT_MODEL_REPLACEMENTS[model]
    : model
}

export function isGptReasoningFamily(model: string | null | undefined): boolean {
  return typeof model === 'string' && /^gpt-[56](?:[.-]|$)/i.test(model)
}

export function supportsNoneReasoningEffort(model: string | null | undefined): boolean {
  return typeof model === 'string' && /^gpt-(?:5\.[1-9]|6(?:[.-]|$))/i.test(model)
}
