
import {
  getAzureVoicesForLanguage,
  getDefaultHdFemaleVoice,
  isRealtimeVoice,
  REALTIME_VOICES,
  toRealtimeFamilyLocale,
} from '../constants/voice-constants'
import { findFirstAiNodeFrom, isRealtimeAiNode } from './nodeUtils'
import { isVoiceLocale } from '@/lib/call/voice-locales'

type NodeLike = { id?: unknown; data?: Record<string, unknown> | null }

function isPstnStart(n: NodeLike | null | undefined): boolean {
  const d = n?.data
  return !!d && d.nodeType === 'start' && d.triggerType === 'pstn'
}

export type PstnLanguagePatch = Record<string, unknown>

export function pstnLanguageSiblingCount(nodes: unknown, editedNodeId: string): number {
  const list = Array.isArray(nodes) ? (nodes as NodeLike[]) : []
  if (!isPstnStart(list.find((n) => n?.id === editedNodeId))) return 0
  return list.filter((n) => isPstnStart(n) && n.id !== editedNodeId && typeof n.id === 'string' && n.id !== '').length
}

const SYNCED_KEYS = ['language', 'languageMode', 'menuLanguages', 'autoDetectLanguages'] as const

export function pstnLanguageSyncWrites(
  nodes: unknown,
  edges: unknown,
  editedNodeId: string,
  patch: PstnLanguagePatch,
): Array<{ nodeId: string; patch: PstnLanguagePatch }> {
  const list = Array.isArray(nodes) ? (nodes as NodeLike[]) : []
  const edited = list.find((n) => n?.id === editedNodeId)
  if (!isPstnStart(edited)) return []

  const rawLanguage = typeof patch.language === 'string' ? patch.language.trim() : ''
  const nextLanguage = isVoiceLocale(rawLanguage) ? rawLanguage : ''
  const languageIsSyncable = nextLanguage !== ''
  const touchesLanguage = SYNCED_KEYS.some((k) => k in patch)
  const out: Array<{ nodeId: string; patch: PstnLanguagePatch }> = []

  for (const sib of list) {
    if (!isPstnStart(sib) || sib.id === editedNodeId) continue
    if (typeof sib.id !== 'string' || sib.id === '') continue

    const sibAiNode = findFirstAiNodeFrom(
      sib.id,
      Array.isArray(nodes) ? (nodes as any[]) : [],
      Array.isArray(edges) ? (edges as any[]) : [],
    )
    const sibRealtime = isRealtimeAiNode(sibAiNode)
    const sibPipelineKnown = sibAiNode !== null && sibAiNode !== undefined

    const sibPatch: PstnLanguagePatch = {}
    for (const k of SYNCED_KEYS) {
      if (!(k in patch)) continue
      if (sibRealtime && k === 'languageMode') { sibPatch.languageMode = 'single'; continue }
      if (k === 'language') {
        if (!languageIsSyncable) continue
        sibPatch.language = nextLanguage
        continue
      }
      const v = patch[k]
      sibPatch[k] = Array.isArray(v)
        ? v.map((e) => (e && typeof e === 'object' ? { ...(e as Record<string, unknown>) } : e))
        : v
    }

    let sibLanguage = nextLanguage
    if (sibRealtime && typeof sibPatch.language === 'string' && sibPatch.language !== '') {
      const familyLocale = toRealtimeFamilyLocale(sibPatch.language)
      if (familyLocale === null) {
        delete sibPatch.language
        sibLanguage = ''
      } else {
        sibPatch.language = familyLocale
        sibLanguage = familyLocale
      }
    }

    if (sibRealtime && touchesLanguage) sibPatch.languageMode = 'single'

    if (Object.keys(sibPatch).length === 0) continue

    if (sibLanguage) {
      const sibVoice = typeof sib.data?.voiceName === 'string' ? sib.data.voiceName : ''
      if (sibRealtime) {
        if (!isRealtimeVoice(sibVoice)) sibPatch.voiceName = REALTIME_VOICES[0].value
      } else if (isRealtimeVoice(sibVoice)) {
        if (sibPipelineKnown) {
          const fallbackVoice = getDefaultHdFemaleVoice(sibLanguage)
          if (fallbackVoice) sibPatch.voiceName = fallbackVoice
        }
      } else {
        const valid = getAzureVoicesForLanguage(sibLanguage).map((v) => v.value)
        if (!valid.includes(sibVoice)) {
          const fallbackVoice = getDefaultHdFemaleVoice(sibLanguage)
          if (fallbackVoice) sibPatch.voiceName = fallbackVoice
        }
      }
    }

    out.push({ nodeId: sib.id, patch: sibPatch })
  }

  return out
}
