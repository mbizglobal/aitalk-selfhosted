
export interface ToolTraceEntry {
  name: string
  arguments: string
  output: string
  nodeId?: string
}

export interface PreviousToolTrace {
  assistantMessage: string
  entries: ToolTraceEntry[]
}

export const TOOL_TRACE_MAX_ENTRIES = 6
const ARGS_MAX_CHARS = 600
const OUTPUT_MAX_CHARS = 900
const ARRAY_KEEP_MAX = 3
const STRING_MAX_CHARS = 240
export const TOOL_TRACE_TOTAL_MAX_CHARS = 2400

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text
}

function shrink(value: any, depth: number): any {
  if (typeof value === 'string') return value.length > STRING_MAX_CHARS ? `${value.slice(0, STRING_MAX_CHARS)}…` : value
  if (Array.isArray(value)) {
    if (value.length > ARRAY_KEEP_MAX) return `[${value.length} items omitted]`
    return value.map(v => shrink(v, depth + 1))
  }
  if (value && typeof value === 'object') {
    if (depth > 4) return '[object omitted]'
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = shrink(v, depth + 1)
    return out
  }
  return value
}

export function compactToolOutput(output: string): string {
  const text = String(output ?? '')
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') return cut(JSON.stringify(shrink(parsed, 0)), OUTPUT_MAX_CHARS)
  } catch { }
  return cut(text, OUTPUT_MAX_CHARS)
}

export function makeToolTraceEntry(name: string, args: string, output: string, nodeId?: string): ToolTraceEntry | null {
  let compactArgs: string
  try {
    const parsed = JSON.parse(String(args ?? '{}') || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    compactArgs = JSON.stringify(shrink(parsed, 0))
  } catch {
    return null
  }
  if (compactArgs.length > ARGS_MAX_CHARS) return null
  return {
    name,
    arguments: compactArgs,
    output: compactToolOutput(output),
    ...(nodeId ? { nodeId } : {}),
  }
}

export function readToolTraceEntries(value: unknown): ToolTraceEntry[] {
  if (!Array.isArray(value)) return []
  const valid = value.filter((e): e is ToolTraceEntry =>
    !!e && typeof e === 'object'
    && typeof (e as any).name === 'string' && (e as any).name.length > 0
    && typeof (e as any).arguments === 'string'
    && typeof (e as any).output === 'string'
    && ((e as any).nodeId === undefined || typeof (e as any).nodeId === 'string'))
  const seen = new Map<string, number>()
  const keep = new Array<boolean>(valid.length).fill(false)
  for (let i = valid.length - 1; i >= 0; i--) {
    const k = valid[i].nodeId ?? ''
    const n = seen.get(k) ?? 0
    if (n < TOOL_TRACE_MAX_ENTRIES) { keep[i] = true; seen.set(k, n + 1) }
  }
  return valid.filter((_, i) => keep[i])
}

export function insertPreviousToolTrace(
  historyMessages: Array<{ type?: string; role?: string; content?: unknown }>,
  trace: PreviousToolTrace | null | undefined,
  nodeId: string | undefined,
): number {
  if (!trace || !nodeId) return 0
  const last = historyMessages[historyMessages.length - 1]
  if (!last || last.role !== 'assistant' || last.content !== trace.assistantMessage) return 0
  const mine = trace.entries.filter(e => e.nodeId === nodeId)
  const picked: ToolTraceEntry[] = []
  let used = 0
  for (let i = mine.length - 1; i >= 0; i--) {
    const size = mine[i].arguments.length + mine[i].output.length
    if (used + size > TOOL_TRACE_TOTAL_MAX_CHARS) break
    used += size
    picked.unshift(mine[i])
  }
  if (picked.length === 0) return 0
  const items: any[] = []
  picked.forEach((e, i) => {
    const callId = `prev_turn_call_${i + 1}`
    items.push({ type: 'function_call', call_id: callId, name: e.name, arguments: e.arguments })
    items.push({ type: 'function_call_output', call_id: callId, output: e.output })
  })
  historyMessages.splice(historyMessages.length - 1, 0, ...items)
  return picked.length
}
