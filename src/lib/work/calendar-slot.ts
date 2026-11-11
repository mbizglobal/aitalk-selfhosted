export interface CalSlotValue { connectionId: string; accountId: string; calendarId: string; calendarName?: string }

export function parseCalSlot(v: unknown): CalSlotValue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
  if (!s('connectionId') || !s('accountId') || !s('calendarId')) return null
  return { connectionId: s('connectionId'), accountId: s('accountId'), calendarId: s('calendarId'), ...(s('calendarName') ? { calendarName: s('calendarName').slice(0, 120) } : {}) }
}
