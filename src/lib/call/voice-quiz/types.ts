
import { VOICE_LOCALES, type VoiceLocale } from '@/lib/call/voice-locales'

export type VoiceQuizStatus =
  | 'generating' | 'ready' | 'asked' | 'graded' | 'settling' | 'paying' | 'settled' | 'settle_failed'
  | 'failed' | 'rejected' | 'abandoned'

export const VOICE_QUIZ_OPEN_STATUSES: readonly VoiceQuizStatus[] = ['generating', 'ready', 'asked', 'graded', 'settling', 'paying']

export type VoiceQuizQuestionType = 'true_false' | 'multiple_choice'

export interface VoiceQuizQuestion {
  id: string
  type: VoiceQuizQuestionType
  question: string
  choices: string[] | null
  answerIndex: number | null
  answerBool: boolean | null
  explanation: string
}

export interface VoiceQuizPublicQuestion {
  type: VoiceQuizQuestionType
  text: string
  options?: string[]
}

export interface VoiceQuizResultEntry {
  index: number
  answered: number | boolean | null
  correct: boolean
  hintsUsed: number
  unrecognized: number
  forced?: 'unrecognized_limit' | 'hints_exhausted'
  raw?: string
}

export interface VoiceQuizRoundState {
  status: VoiceQuizStatus
  questions: VoiceQuizQuestion[]
  currentIndex: number
  revision: number
  results: VoiceQuizResultEntry[]
  hintsUsed: number
  unrecognized: number
}

export interface VoiceQuizNodeData {
  title?: string
  programId?: string
  questionCount: number
  hintLimit: number
  dailyRoundLimit?: number
  programCountry?: string
  programHolidays?: Array<{ date: string; name: string; origin?: 'auto' | 'manual' }>
  programStartDate?: string   // 'YYYY-MM-DD'
  roundIntervalDays?: number
  totalRounds?: number
  programTimezone?: string
  studyLength: 'none' | 'short' | 'standard'
  questionTypes?: string[]
  difficulty?: string
  language?: string
  topicHint?: string
  hooks: { onRoundStart: string | null; onRoundSettle: string | null; onMemberChange?: string | null }
  signupSubWorkflowId?: string | null
  signupNotice?: Partial<Record<VoiceQuizNoticeLocale, string>>
  callNotice?: Partial<Record<VoiceQuizNoticeLocale, string>>
}

export interface VoiceQuizLimits {
  hintLimit: number
  unrecognizedLimit: number
}

export type VoiceQuizIntent =
  | { kind: 'repeat' }
  | { kind: 'hint' }
  | { kind: 'answer'; value: number | boolean }
  | { kind: 'unrecognized' }

export interface VoiceQuizHookContext {
  roundId: string
  phase: VoiceQuizHookPhase
  questionCount: number
  asked: number
  correct: number
  topic: string
  actionKey?: string
  anonKey?: string
  callReg?: string
  callGroup?: string
}

export const VOICE_QUIZ_HOOK_PHASES = ['start', 'settle', 'status', 'stop_calls', 'resume_calls', 'set_call_enrollment', 'erase_member', 'signup'] as const
export type VoiceQuizHookPhase = (typeof VOICE_QUIZ_HOOK_PHASES)[number] 

export function mergeVoiceQuizHooks(
  hooks: Record<string, string | null | undefined> | null | undefined,
  key: 'onRoundStart' | 'onRoundSettle' | 'onMemberChange',
  value: string,
): Record<string, string | null | undefined> {
  return { ...(hooks ?? {}), [key]: value.trim() || null }
}

export const VOICE_QUIZ_NOTICE_LOCALES: readonly VoiceLocale[] = VOICE_LOCALES.map((l) => l.value)
export type VoiceQuizNoticeLocale = VoiceLocale

export const VOICE_QUIZ_NOTICE_MAX = 300

export function isNoticeWithinLimit(text: string): boolean {
  return [...text].length <= VOICE_QUIZ_NOTICE_MAX
}

export function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}
