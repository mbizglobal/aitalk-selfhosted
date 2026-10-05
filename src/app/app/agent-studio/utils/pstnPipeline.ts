
import { replaceRetiredChatModel } from '@/lib/managed/model-lineup'

export type PstnPipeline = 'realtime' | 'talk' | 'mix'

export function isMenuLanguageMode(rawLanguageMode: unknown): boolean {
  return rawLanguageMode === 'menu' || rawLanguageMode === 'auto'
}

export function derivePstnPipeline(isRealtimeAi: boolean, rawLanguageMode: unknown): PstnPipeline {
  if (isRealtimeAi) return 'realtime'
  return isMenuLanguageMode(rawLanguageMode) ? 'mix' : 'talk'
}

export function pstnPipelinePatch(
  target: PstnPipeline,
  opts: {
    realtimeModel: string
    chatDefaultModel: string
    currentAiModel?: string
    previousChatModel?: string
    menuLanguages?: unknown[]
    seedMenuLanguages?: unknown[]
  }
): { aiPatch: Record<string, unknown>; nodePatch: Record<string, unknown> } {
  const isRealtimeName = (m: unknown) => typeof m === 'string' && /^gpt-realtime/i.test(m)

  if (target === 'realtime') {
    const preserved = isRealtimeName(opts.currentAiModel) ? undefined : opts.currentAiModel
    return {
      aiPatch: {
        model: opts.realtimeModel,
        ...(preserved ? { previousChatModel: preserved } : {}),
      },
      nodePatch: { languageMode: 'single' },
    }
  }

  //
  const comingFromRealtime = isRealtimeName(opts.currentAiModel)
  const restore = isRealtimeName(opts.previousChatModel) || typeof opts.previousChatModel !== 'string' || !opts.previousChatModel
    ? undefined
    : replaceRetiredChatModel(opts.previousChatModel)
  const aiPatch: Record<string, unknown> = comingFromRealtime
    ? { model: restore || opts.chatDefaultModel }
    : {}

  if (target === 'talk') return { aiPatch, nodePatch: { languageMode: 'single' } }

  const existing = Array.isArray(opts.menuLanguages) ? opts.menuLanguages : []
  return {
    aiPatch,
    nodePatch: {
      languageMode: 'menu',
      menuLanguages: existing.length > 0 ? existing : (opts.seedMenuLanguages ?? []),
    },
  }
}

export function mixMenuProblem(
  entries: Array<{ engine?: string }> | undefined | null
): 'empty' | 'no-talk-slot' | null {
  const list = Array.isArray(entries) ? entries : []
  if (list.length === 0) return 'empty'
  return list.some((e) => e?.engine !== 'realtime') ? null : 'no-talk-slot'
}

export function isLastTalkSlot(entries: Array<{ engine?: string }> | undefined | null, idx: number): boolean {
  const list = Array.isArray(entries) ? entries : []
  return list[idx]?.engine !== 'realtime' && list.filter((e) => e?.engine !== 'realtime').length === 1
}

export function shouldLockTalkSlot(
  allowEngineChoice: boolean,
  entries: Array<{ engine?: string }> | undefined | null,
  idx: number
): boolean {
  return allowEngineChoice && isLastTalkSlot(entries, idx)
}
