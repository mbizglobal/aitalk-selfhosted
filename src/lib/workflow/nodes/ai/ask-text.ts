import type { OpenAI } from 'openai'
import { reserveCpaForAiCall } from '../../ai-call-cpa'
import type { WorkflowContext } from '../../types'
import { isGptReasoningFamily } from '@/lib/managed/model-lineup'
import type { AskTextFn } from '@/lib/work/v3-handles'

export const ASK_TEXT_TIMEOUT_MS = 60_000
const ASK_TEXT_DEFAULT_OUTPUT = 2_000
const ASK_TEXT_MAX_OUTPUT = 8_000
const ASK_TEXT_MAX_INPUT_CHARS = 60_000

export function makeTextAsker(openai: OpenAI, model: string, context: WorkflowContext): AskTextFn {
  return async (prompt, opts) => {
    const max = Math.min(Math.max(Number.isInteger(opts?.maxTokens) ? (opts!.maxTokens as number) : ASK_TEXT_DEFAULT_OUTPUT, 1), ASK_TEXT_MAX_OUTPUT)
    const reservation = await reserveCpaForAiCall(context, model)
    let usage: { input_tokens?: number; output_tokens?: number } | null = null
    try {
      const r: any = await openai.responses.create({
        model,
        max_output_tokens: max,
        ...(isGptReasoningFamily(model) ? { reasoning: { effort: 'low' } } : {}),
        ...(opts?.json ? { text: { format: { type: 'json_object' } } } : {}),
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt.slice(0, ASK_TEXT_MAX_INPUT_CHARS) }] }],
      } as any, { signal: AbortSignal.timeout(ASK_TEXT_TIMEOUT_MS) })
      usage = r.usage ?? null
      if (usage) reservation.settle(usage.input_tokens, usage.output_tokens)
      return String(r.output_text ?? '').trim()
    } finally {
      reservation.finalize(!!usage)
    }
  }
}
