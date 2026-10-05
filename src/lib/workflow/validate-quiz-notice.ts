import { VOICE_QUIZ_NOTICE_LOCALES, VOICE_QUIZ_NOTICE_MAX, isNoticeWithinLimit } from '@/lib/call/voice-quiz/types'

export type QuizNoticeGuardResult = { ok: true } | { ok: false; code: string; error: string }

export function validateQuizSignupNotice(
  workflowJson: string | Record<string, unknown> | null | undefined,
): QuizNoticeGuardResult {
  if (!workflowJson) return { ok: true }
  let wf: any
  try {
    wf = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson
  } catch {
    return { ok: true }
  }
  const nodes: any[] = Array.isArray(wf?.nodes) ? wf.nodes : []
  for (const n of nodes) {
    for (const field of NOTICE_FIELDS) {
      const notice = n?.data?.[field.key]
      if (!notice || typeof notice !== 'object') continue
      for (const locale of VOICE_QUIZ_NOTICE_LOCALES) {
        const v = (notice as Record<string, unknown>)[locale]
        if (typeof v !== 'string' || isNoticeWithinLimit(v)) continue
        return {
          ok: false,
          code: 'QUIZ_NOTICE_TOO_LONG',
          error: `${field.label} (${locale}) is ${[...v].length} characters — the limit is ${VOICE_QUIZ_NOTICE_MAX}. It is read aloud in full and never shortened, so please trim it.`,
        }
      }
    }
  }
  return { ok: true }
}

const NOTICE_FIELDS = [
  { key: 'signupNotice', label: 'Sign-up notice' },
  { key: 'callNotice', label: 'Call registration notice' },
] as const
