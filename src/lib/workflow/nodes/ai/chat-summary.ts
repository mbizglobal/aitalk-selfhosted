import { OpenAI } from 'openai'
import { estimateTokens } from '@/lib/ai-assistant/token-counter'
import { isGptReasoningFamily } from '@/lib/managed/model-lineup'

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export const CHAT_SUMMARY_TRIGGER_TOKENS = 2_000
export const CHAT_SUMMARY_MAX_TOKENS = 600
export const CHAT_SUMMARY_MODEL = 'gpt-6-luna'
const FOLD_INPUT_CAP_TOKENS = 8_000

const SUMMARY_INSTRUCTIONS = `You maintain a running summary of a customer chat conversation for an AI assistant.
Update the previous summary by folding in the new messages. Preserve:
- The visitor's goal, open questions and unresolved requests
- Concrete facts and decisions: names, dates, times, bookings, contact details, reference numbers
- Preferences and constraints the visitor stated
- What the assistant already answered or promised
Write in the language of the conversation. Plain text only, no headings. Keep the summary under 600 tokens.`

export const MESSAGE_OVERHEAD_TOKENS = 4

function messageTokens(message: ChatHistoryMessage): number {
  return estimateTokens(message.content || '') + MESSAGE_OVERHEAD_TOKENS
}

export function estimateChatHistoryTokens(history: ChatHistoryMessage[]): number {
  return history.reduce((sum, m) => sum + messageTokens(m), 0)
}

export function capChatHistoryTokens(
  history: ChatHistoryMessage[],
  budgetTokens: number
): ChatHistoryMessage[] {
  const count = countTailWithinBudget(history, budgetTokens)
  if (count > 0) return history.slice(history.length - count)

  const latest = history[history.length - 1]
  if (!latest) return []
  const truncated = truncateToTokenBudgetFromEnd(latest.content ?? '', budgetTokens - MESSAGE_OVERHEAD_TOKENS)
  return truncated ? [{ ...latest, content: truncated }] : []
}

function countTailWithinBudget(history: ChatHistoryMessage[], budgetTokens: number): number {
  let used = 0
  let count = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = messageTokens(history[i])
    if (used + cost > budgetTokens) break
    used += cost
    count++
  }
  return count
}

function countHeadWithinBudget(history: ChatHistoryMessage[], budgetTokens: number): number {
  let used = 0
  let count = 0
  for (const m of history) {
    const cost = messageTokens(m)
    if (used + cost > budgetTokens) break
    used += cost
    count++
  }
  return count
}

export function splitHistoryForFold(
  history: ChatHistoryMessage[],
  keepTailTokens = CHAT_SUMMARY_TRIGGER_TOKENS
): { toFold: ChatHistoryMessage[]; keepTail: ChatHistoryMessage[] } {
  const tailCount = countTailWithinBudget(history, keepTailTokens)
  const splitAt = history.length - tailCount
  return { toFold: history.slice(0, splitAt), keepTail: history.slice(splitAt) }
}

export function clampSummaryText(text: string, maxTokens = CHAT_SUMMARY_MAX_TOKENS): string {
  return truncateToTokenBudget(text, maxTokens)
}

function truncateToTokenBudget(text: string, budgetTokens: number): string {
  if (!text) return ''
  if (budgetTokens <= 0) return ''
  if (estimateTokens(text) <= budgetTokens) return text

  let lo = 0
  let hi = text.length
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (estimateTokens(text.slice(0, mid)) <= budgetTokens) lo = mid
    else hi = mid
  }
  if (lo > 0) {
    const lastCode = text.charCodeAt(lo - 1)
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) lo -= 1
  }
  return text.slice(0, lo)
}

function truncateToTokenBudgetFromEnd(text: string, budgetTokens: number): string {
  if (!text) return ''
  if (budgetTokens <= 0) return ''
  if (estimateTokens(text) <= budgetTokens) return text

  let lo = 0
  let hi = text.length
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (estimateTokens(text.slice(mid)) <= budgetTokens) hi = mid
    else lo = mid
  }
  const firstCode = text.charCodeAt(hi)
  if (firstCode >= 0xdc00 && firstCode <= 0xdfff) hi += 1
  return text.slice(hi)
}

export async function foldChatHistory(
  openai: OpenAI,
  previousSummary: string | null,
  history: ChatHistoryMessage[],
  logContext: FoldLogContext = {}
): Promise<{ summary: string; foldedCount: number } | null> {
  const tokensBefore = estimateChatHistoryTokens(history)
  const emit = (event: Record<string, unknown>) => logFoldEvent({
    ...logContext,
    msgsBefore: history.length,
    tokensBefore,
    ...event,
  })
  const usage = { llmCalls: 0, usageIn: 0, usageOut: 0 }
  const summaryModel = logContext.model || CHAT_SUMMARY_MODEL
  const done = (
    outcome: string,
    result: { summary: string; foldedCount: number } | null,
    extra: Record<string, unknown> = {}
  ) => {
    emit({
      outcome,
      ...usage,
      ...(result
        ? {
            foldedCount: result.foldedCount,
            tokensAfter: estimateChatHistoryTokens(history.slice(result.foldedCount)),
            summaryTokens: estimateTokens(result.summary),
          }
        : {}),
      ...extra,
    })
    return result
  }

  const { toFold } = splitHistoryForFold(history, CHAT_SUMMARY_TRIGGER_TOKENS)
  if (toFold.length === 0) return done('nothing-to-fold', null)

  const headCount = countHeadWithinBudget(toFold, FOLD_INPUT_CAP_TOKENS)

  if (headCount === 0) {
    const chunks = splitTextIntoTokenChunks(toFold[0].content, FOLD_INPUT_CAP_TOKENS)
    if (!chunks) {
      //
      //
      const tokens = estimateTokens(toFold[0].content)
      const marker =
        `[A very large ${toFold[0].role} message (~${tokens} tokens) was shared at this point. ` +
        `It was too large to summarize, so its content is not available.]`
      const prevBudget = Math.max(0, CHAT_SUMMARY_MAX_TOKENS - estimateTokens(marker) - 2)
      const prevPart = previousSummary && prevBudget > 0
        ? clampSummaryText(previousSummary, prevBudget)
        : ''
      return done(
        'tombstoned',
        { summary: prevPart ? `${prevPart}\n\n${marker}` : marker, foldedCount: 1 },
        { oversizedTokens: tokens, chunkLimit: MAX_OVERSIZED_CHUNKS }
      )
    }
    let acc = previousSummary
    for (const chunk of chunks) {
      const partial = await requestSummary(openai, summaryModel, acc, [{ role: toFold[0].role, content: chunk }], usage)
      if (!partial) return done('chunk-fold-failed', null, { chunks: chunks.length })
      acc = partial
    }
    return acc
      ? done('chunk-folded', { summary: clampSummaryText(acc), foldedCount: 1 }, { chunks: chunks.length })
      : done('chunk-fold-empty', null, { chunks: chunks.length })
  }

  const capped = toFold.slice(0, headCount)
  const summary = await requestSummary(openai, summaryModel, previousSummary, capped, usage)
  return summary
    ? done('folded', { summary: clampSummaryText(summary), foldedCount: capped.length })
    : done('fold-failed', null, { attemptedCount: capped.length })
}

export interface FoldLogContext {
  model?: string
  agentId?: string
  conversationId?: string
  clientId?: string
}

function logFoldEvent(event: Record<string, unknown>): void {
  const line = `[ChatSummary] ${JSON.stringify({ model: CHAT_SUMMARY_MODEL, ...event })}`
  const outcome = typeof event.outcome === 'string' ? event.outcome : ''
  if (outcome.includes('fail') || outcome.includes('tombstone')) console.warn(line)
  else console.log(line)
}

async function requestSummary(
  openai: OpenAI,
  model: string,
  previousSummary: string | null,
  messages: ChatHistoryMessage[],
  usage: { llmCalls: number; usageIn: number; usageOut: number }
): Promise<string | null> {
  const conversationText = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  usage.llmCalls += 1
  try {
    const response: any = await openai.responses.create({
      model,
      max_output_tokens: 1024,
      ...(isGptReasoningFamily(model) ? { reasoning: { effort: 'low' }, text: { verbosity: 'low' } } : {}),
      instructions: SUMMARY_INSTRUCTIONS,
      input:
        `### Previous summary (may be empty):\n${previousSummary ? clampSummaryText(previousSummary) : '(none)'}\n\n` +
        `### New messages to fold in:\n${conversationText}\n\n### Updated summary:`,
      stream: false,
    })

    usage.usageIn += Number(response?.usage?.input_tokens) || 0
    usage.usageOut += Number(response?.usage?.output_tokens) || 0

    let text: string = response?.output_text || ''
    if (!text && Array.isArray(response?.output)) {
      for (const item of response.output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const content of item.content) {
            if ((content?.type === 'output_text' || content?.type === 'text') && content.text) {
              text += content.text
            }
          }
        }
      }
    }
    text = text.trim()
    return text || null
  } catch (e) {
    console.warn('[ChatSummary] summary call failed:', (e as Error)?.message)
    return null
  }
}

const MAX_OVERSIZED_CHUNKS = 8

function splitTextIntoTokenChunks(text: string, budgetTokens: number): string[] | null {
  if (!text) return null
  if (estimateTokens(text) <= budgetTokens) return [text]

  const chunks: string[] = []
  let rest = text
  while (rest.length > 0) {
    if (chunks.length >= MAX_OVERSIZED_CHUNKS) return null
    let head = truncateToTokenBudget(rest, budgetTokens)
    if (head.length === 0) return null
    const nextCode = rest.charCodeAt(head.length)
    if (nextCode >= 0xdc00 && nextCode <= 0xdfff && head.length > 1) {
      head = head.slice(0, head.length - 1)
    }
    chunks.push(head)
    rest = rest.slice(head.length)
  }
  return chunks.length > 0 ? chunks : null
}
