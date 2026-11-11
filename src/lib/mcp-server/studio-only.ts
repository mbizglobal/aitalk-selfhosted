
type NodeLike = { id?: unknown; data?: unknown }

function normalizeChats(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'string' && x.trim()) out[k] = x.trim()
  return out
}

function normalizeCalendars(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v === undefined || v === null) return out
  if (typeof v !== 'object' || Array.isArray(v)) return { '': `bad:${JSON.stringify(v)}` }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const o = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null
    const ok = o && ['connectionId', 'accountId', 'calendarId'].every((f) => typeof o[f] === 'string' && (o[f] as string).trim())
    out[k] = ok ? ['connectionId', 'accountId', 'calendarId'].map((f) => (o![f] as string).trim()).join('\n') : `bad:${JSON.stringify(x)}`
  }
  return out
}

const FIELDS: ReadonlyArray<{ field: string; normalize: (v: unknown) => Record<string, string>; what: string }> = [
  { field: 'telegramChats', normalize: normalizeChats, what: 'a Telegram team chat' },
  { field: 'calendarSlots', normalize: normalizeCalendars, what: 'a calendar (connection · account · calendar)' },
]
const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort()
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

export interface StudioOnlyIssue { nodeId: string; field: string; message: string }

export function guardStudioOnlyFields(incoming: { nodes?: unknown }, stored: { nodes?: unknown } | null): StudioOnlyIssue[] {
  const issues: StudioOnlyIssue[] = []
  if (!Array.isArray(incoming.nodes)) return issues
  const before = new Map<string, Record<string, unknown>>()
  for (const n of (Array.isArray(stored?.nodes) ? stored!.nodes : []) as NodeLike[]) {
    if (n && typeof n.id === 'string' && n.data && typeof n.data === 'object') before.set(n.id, n.data as Record<string, unknown>)
  }
  for (const n of incoming.nodes as NodeLike[]) {
    if (!n || typeof n.id !== 'string') continue
    const old = before.get(n.id)
    const data = n.data && typeof n.data === 'object' && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : null
    for (const { field: FIELD, normalize, what } of FIELDS) {
      const oldVal = normalize(old?.[FIELD])
      if (!data) {
        if (Object.keys(oldVal).length) issues.push({ nodeId: n.id, field: FIELD, message: `this node has ${what} set in the studio — send its data back (${FIELD} may be left out, not the whole data)` })
        continue
      }
      if (data[FIELD] === undefined) {
        if (Object.keys(oldVal).length) data[FIELD] = old![FIELD]
        continue
      }
      if (!same(normalize(data[FIELD]), oldVal)) {
        issues.push({ nodeId: n.id, field: FIELD, message: `${FIELD} (${what}) can only be set by the owner in the studio — send it back unchanged or leave it out` })
      }
    }
  }
  return issues
}
