
const TEMPLATE_VARS_KEY = '__templateVars'

export const TEMPLATE_READABLE_FIELDS: ReadonlySet<string> = new Set([
  'message',
  'aiResponse',
  'aiResponseRaw',
  'finalAnswer',
  'jsonData',
  'httpResult',
  'imapResult',
  'smtpResult',
  'sendGridResult',
  'telegramResult',
  'smsResult',
  'storeResult',
  'dataSheetsResult',
  'mcpResult',
  'mcpTools',
  'pstnResult',
  'whileResult',
  'ifElseResult',
  'toolResult',
  'ragProvider',
  'workflowAiModel',
  'searchResults',
  'vectorStoreId',
  'sourceVectorStoreId',
  'sourceVectorStoreName',
  'geminiFiles',
  'agentId',
  'conversationId',
  'clientId',
  'model',
  'pageContext',
  'uploadedFiles',
  'chatHistory',
  'forEachContext',
  // `bots/common/workflow-runner.ts` · `api/telegram/webhook/[workflowId]/route.ts`).
  'telegramChatId',
  'telegramUserId',
  'telegramUsername',
  'isTelegramWebhook',
  'input',
  //
  'callerNumber',
  'voiceQuiz',
])

const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export function isUnsafeTemplateSegment(name: unknown): boolean {
  return UNSAFE_SEGMENTS.has(String(name ?? '').trim())
}

export const CREDENTIAL_CONTEXT_FIELDS: ReadonlySet<string> = new Set([
  'azureSearchConfig',
  'pineconeApiKey',
  'pineconeConfig',
  'request',
])

const NEVER_READABLE = new Set([
  ...CREDENTIAL_CONTEXT_FIELDS,
  'userId',
  'skipAiCallCpa',
  'isTestMode',
  'isManaged',
  'managedRegion',
  'isScheduledTrigger',
  'scheduleRunKey',
  'workflowId',
  'previousResponseId',
  'chatSummary',
  TEMPLATE_VARS_KEY,
  '__debugEnabled',
  'context',
])

export function markTemplateVar(context: unknown, key: unknown): void {
  if (!context || typeof context !== 'object') return
  if (typeof key !== 'string' || !key || key === TEMPLATE_VARS_KEY || UNSAFE_SEGMENTS.has(key)) return

  const holder = context as Record<string, unknown>
  const current = holder[TEMPLATE_VARS_KEY]
  const list = Array.isArray(current) ? current.filter((v): v is string => typeof v === 'string') : []
  if (!list.includes(key)) list.push(key)
  holder[TEMPLATE_VARS_KEY] = list
}

export function preserveTemplateVars<T extends object>(merged: T, base: unknown): T {
  const original = (base as Record<string, unknown> | null | undefined)?.[TEMPLATE_VARS_KEY]
  const holder = merged as Record<string, unknown>

  if (Array.isArray(original)) {
    if (holder[TEMPLATE_VARS_KEY] !== original) holder[TEMPLATE_VARS_KEY] = original
  } else if (TEMPLATE_VARS_KEY in holder) {
    delete holder[TEMPLATE_VARS_KEY]
  }
  return merged
}

function segmentsOf(path: string): string[] {
  return path
    .split(/[.[\]]/)
    .map(s => s.trim())
    .filter(s => s !== '')
}

export function canReadTemplatePath(context: unknown, path: string): boolean {
  const segments = segmentsOf(String(path ?? '').trim())
  const head = segments[0]
  if (!head || NEVER_READABLE.has(head)) return false

  if (segments.some(s => UNSAFE_SEGMENTS.has(s))) return false

  if (TEMPLATE_READABLE_FIELDS.has(head)) return true

  const marked = (context as Record<string, unknown> | null | undefined)?.[TEMPLATE_VARS_KEY]
  if (Array.isArray(marked) && marked.includes(head)) return true

  console.warn(
    `[Workflow] 🔒 템플릿이 허용되지 않은 컨텍스트 경로를 읽으려 했다: "${path}" — 치환하지 않는다 (lib/workflow/template-scope.ts)`
  )
  return false
}
