
import type { SheetTemplate } from './sheet-templates'

export const HANDOFF_FAMILY = 'core.handoff'
export const HANDOFF_TEMPLATE_ID = `${HANDOFF_FAMILY}@1`
export const HANDOFF_MAX_FIELDS = 50
export const HANDOFF_MAX_TEXT = 2_000
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/

export const handoffSheetTemplate: SheetTemplate = {
  name: HANDOFF_FAMILY,
  version: 1,
  family: HANDOFF_FAMILY,
  columns: [
    { name: 'fromApp', type: 'string', required: true },
    { name: 'company', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'periodStart', type: 'string' },
    { name: 'periodEnd', type: 'string' },
    { name: 'submission', type: 'number', required: true },
    { name: 'sealedAt', type: 'string' },
    { name: 'fields', type: 'json', encrypted: true },
    { name: 'current', type: 'boolean', required: true },
    { name: 'memo', type: 'text' },
  ],
  confirm: { calcColumns: ['fields', 'submission'] },
  ui: { noManualRows: true },
}

export interface AppTemplateHandoff {
  export(output: unknown): Record<string, string | number>
}

export function handoffFieldsProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'export must return an object'
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.length > HANDOFF_MAX_FIELDS) return `export returns more than ${HANDOFF_MAX_FIELDS} fields`
  for (const [k, x] of entries) {
    if (!FIELD_RE.test(k)) return `field name "${k.slice(0, 70)}" is not allowed`
    if (typeof x === 'number') { if (!Number.isFinite(x)) return `field ${k} is not a finite number`; continue }
    if (typeof x !== 'string') return `field ${k} must be a number or text`
    if (x.length > HANDOFF_MAX_TEXT) return `field ${k} is longer than ${HANDOFF_MAX_TEXT} characters`
  }
  return null
}

export const acceptsHandoff = (t: { sheets: ReadonlyArray<{ template: string }> } | null | undefined): boolean =>
  !!t && t.sheets.some((s) => s.template.startsWith(`${HANDOFF_FAMILY}@`))

export const hasPeriodRule = (rule: string | null | undefined): rule is 'quarter' | 'month' | 'year' => rule === 'quarter' || rule === 'month' || rule === 'year'

const nextDay = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10)

export function senderPeriodsWithin(
  periodOf: (rule: string, date: string) => { periodStart: string; periodEnd: string } | null,
  rule: string,
  recv: { start: string; end: string },
): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = []
  let d = recv.start
  for (let i = 0; i < 400 && d <= recv.end; i++) {
    const p = periodOf(rule, d)
    if (!p) return []
    if (p.periodEnd >= recv.start && p.periodEnd <= recv.end) out.push({ start: p.periodStart, end: p.periodEnd })
    d = nextDay(p.periodEnd)
  }
  return out
}
