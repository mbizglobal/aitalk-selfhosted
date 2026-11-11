import type { OpenAI } from 'openai'
import { holdFixedCpaForAiCall, type FixedCpaHold } from '../../ai-call-cpa'
import type { WorkflowContext } from '../../types'
import { isGptReasoningFamily } from '@/lib/managed/model-lineup'
import { CARD_INSTRUCTIONS, IMAGE_CARD_WITH_TRANSCRIPT_FORMAT, TEXT_CARD_FORMAT, normalizeModelCard, type ModelCard } from '@/lib/work/doc-card-check'
import type { ImageForReading } from './read-images'

export const DOC_CARD_CPA = 2
const CARD_MAX_OUTPUT = 1_200
const CARD_TRANSCRIPT_MAX_OUTPUT = 2_500
export const DOC_CARD_TEXT_CHARS = 24_000

export interface DocCardFns {
  readonly canReadImages: boolean
  hold(): Promise<FixedCpaHold>
  fromText(text: string, label: string, signal: AbortSignal): Promise<ModelCard | null>
  fromImages(images: ImageForReading[], label: string, withTranscript: boolean, signal: AbortSignal): Promise<{ card: ModelCard; transcript: string | null } | null>
}

function parse(r: any): unknown {
  if (r?.status === 'incomplete') return null
  try { return JSON.parse(String(r?.output_text ?? '')) } catch { return null }
}

export function makeDocumentCarder(openai: OpenAI, textModel: string, imageModel: string | null, context: WorkflowContext): DocCardFns {
  const effort = (m: string) => (isGptReasoningFamily(m) ? { reasoning: { effort: 'low' } } : {})
  return {
    canReadImages: !!imageModel,
    hold: () => holdFixedCpaForAiCall(context, textModel, DOC_CARD_CPA),
    async fromText(text, label, signal) {
      const r: any = await openai.responses.create({
        model: textModel,
        instructions: CARD_INSTRUCTIONS,
        max_output_tokens: CARD_MAX_OUTPUT,
        ...effort(textModel),
        text: { format: TEXT_CARD_FORMAT },
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `${label}\n\n${text.slice(0, DOC_CARD_TEXT_CHARS)}` }] }],
      } as any, { signal })
      return normalizeModelCard(parse(r))
    },
    async fromImages(images, label, withTranscript, signal) {
      if (!imageModel) return null
      const r: any = await openai.responses.create({
        model: imageModel,
        instructions: CARD_INSTRUCTIONS,
        max_output_tokens: withTranscript ? CARD_TRANSCRIPT_MAX_OUTPUT : CARD_MAX_OUTPUT,
        ...effort(imageModel),
        text: { format: withTranscript ? IMAGE_CARD_WITH_TRANSCRIPT_FORMAT : TEXT_CARD_FORMAT },
        input: [{
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: label },
            ...images.map((im) => ({ type: 'input_image', image_url: `data:${im.mime};base64,${im.base64}`, detail: 'high' })),
          ],
        }],
      } as any, { signal })
      const out = parse(r)
      if (!withTranscript) {
        const card = normalizeModelCard(out)
        return card ? { card, transcript: null } : null
      }
      const o = out as { card?: unknown; transcript?: unknown } | null
      const card = normalizeModelCard(o?.card)
      if (!card) return null
      const t = typeof o?.transcript === 'string' ? o.transcript.trim() : ''
      return { card, transcript: t ? t.slice(0, DOC_CARD_TEXT_CHARS) : null }
    },
  }
}
