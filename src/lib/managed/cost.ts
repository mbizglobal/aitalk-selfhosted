export const CPA_PER_VOICE_MINUTE = 5
export const CPA_PER_REALTIME_VOICE_MINUTE = 15

export function getOutputMultiplier(_outputTokens?: number | null): number {
  return 1
}
export function getRealtimeCPAPerMinute(_model?: string | null): number {
  return CPA_PER_REALTIME_VOICE_MINUTE
}
export function quizGenerationCPAFromSettings(
  _settings: { questionCount?: unknown; studyLength?: unknown; includeStudy?: unknown } | null | undefined,
  _model?: string | null,
): number {
  return 0
}
