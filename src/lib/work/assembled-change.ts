import type { AppSpec, SpecColumn, SpecTable } from './assembled'

export type SpecChangeCode =
  | 'app_name' | 'app_about'
  | 'table_added' | 'table_hidden' | 'table_shown' | 'table_renamed' | 'table_about'
  | 'column_added' | 'column_hidden' | 'column_shown' | 'column_renamed' | 'column_hint' | 'column_optional' | 'options_added' | 'computed_changed' | 'computed_removed'
  | 'confirm_changed'
  | 'status_added' | 'status_values_added' | 'status_values_removed' | 'status_start' | 'status_moves' | 'status_locked' | 'status_label'
  | 'number_added' | 'number_label'
  | 'file_changed' | 'sums_changed'
  | 'alert_added' | 'alert_removed' | 'alert_changed'
  | 'send_added' | 'send_removed' | 'send_changed'
  | 'check_added' | 'check_removed' | 'check_changed'
  | 'doc_added' | 'doc_changed' | 'doc_hidden' | 'doc_shown'
  | 'intake_opened' | 'intake_changed' | 'intake_closed' | 'intake_identify_phone' | 'intake_identify_telegram' | 'intake_identify_off' | 'intake_form_on' | 'intake_form_off' | 'intake_webhook_on' | 'intake_webhook_off' | 'intake_webhook_changed'

export interface SpecChange {
  code: SpecChangeCode
  table?: string
  name?: string
  from?: string
  to?: string
  values?: string[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const by = <T extends { key: string }>(xs: readonly T[] | undefined) => new Map((xs ?? []).map((x) => [x.key, x]))

export function describeSpecChange(before: AppSpec | null, after: AppSpec): SpecChange[] {
  const out: SpecChange[] = []
  if (before && before.name !== after.name) out.push({ code: 'app_name', from: before.name, to: after.name })
  if ((before?.about ?? '') !== (after.about ?? '')) out.push({ code: 'app_about' })
  const bt = by(before?.tables)
  for (const t of after.tables) {
    const b = bt.get(t.key)
    if (!b) {
      out.push({ code: 'table_added', table: t.name, values: t.columns.filter((c) => !c.hidden).map((c) => c.label) })
      for (const c of t.columns) if (c.hidden) out.push({ code: 'column_added', table: t.name, name: c.label, to: c.kind, values: ['hidden'] })
      intakeChanges({ ...t, intake: undefined }, t, out)
      checkChanges({ ...t, checks: undefined }, t, out)
      docChanges({ ...t, docs: undefined }, t, out)
      continue
    }
    tableChanges(b, t, out)
  }
  const bs = by(before?.sends)
  const as = by(after.sends)
  for (const s of after.sends ?? []) {
    const x = bs.get(s.key)
    const table = after.tables.find((t) => t.key === s.table)?.name
    if (!x) out.push({ code: 'send_added', table, name: s.label })
    else if (!same(x, s)) out.push({ code: 'send_changed', table, name: s.label })
  }
  for (const s of before?.sends ?? []) if (!as.has(s.key)) out.push({ code: 'send_removed', table: before?.tables.find((t) => t.key === s.table)?.name, name: s.label })
  return out
}

function tableChanges(b: SpecTable, t: SpecTable, out: SpecChange[]): void {
  const table = t.name
  if (!b.hidden && t.hidden) out.push({ code: 'table_hidden', table })
  if (b.hidden && !t.hidden) out.push({ code: 'table_shown', table })
  if (b.name !== t.name) out.push({ code: 'table_renamed', table, from: b.name, to: t.name })
  if ((b.about ?? '') !== (t.about ?? '')) out.push({ code: 'table_about', table })
  const bc = by(b.columns)
  for (const c of t.columns) {
    const x = bc.get(c.key)
    if (!x) { out.push({ code: 'column_added', table, name: c.label, to: c.kind, ...(c.hidden ? { values: ['hidden'] } : {}) }); continue }
    columnChanges(x, c, table, out)
  }
  const tc = by(t.columns)
  for (const c of b.columns) if (c.kind === 'computed' && !tc.has(c.key)) out.push({ code: 'computed_removed', table, name: c.label })
  const whoOf = (x: SpecTable) => { const v = x.confirm?.by ?? 'anyone'; return v.startsWith('column:') ? `column:${x.columns.find((c) => c.key === v.slice(7))?.label ?? v.slice(7)}` : v }
  if (!same(b.confirm, t.confirm)) out.push({ code: 'confirm_changed', table, from: whoOf(b), to: whoOf(t) })
  if (!b.status && t.status) out.push({ code: 'status_added', table, values: [...t.status.values] })
  else if (b.status && t.status) {
    const added = t.status.values.filter((v) => !b.status!.values.includes(v))
    const removed = b.status.values.filter((v) => !t.status!.values.includes(v))
    if (added.length) out.push({ code: 'status_values_added', table, values: added })
    if (removed.length) out.push({ code: 'status_values_removed', table, values: removed })
    if (b.status.start !== t.status.start) out.push({ code: 'status_start', table, from: b.status.start, to: t.status.start })
    if (!same(b.status.moves, t.status.moves)) out.push({ code: 'status_moves', table })
    if (!same(b.status.lockedIn, t.status.lockedIn)) out.push({ code: 'status_locked', table, values: [...(t.status.lockedIn ?? [])] })
    if ((b.status.label ?? '') !== (t.status.label ?? '')) out.push({ code: 'status_label', table, from: b.status.label ?? '', to: t.status.label ?? '' })
  }
  if (!b.number && t.number) out.push({ code: 'number_added', table })
  else if (b.number && t.number && (b.number.label ?? '') !== (t.number.label ?? '')) out.push({ code: 'number_label', table, from: b.number.label ?? '', to: t.number.label ?? '' })
  if (!same(b.file, t.file)) out.push({ code: 'file_changed', table })
  if (!same(b.sums, t.sums)) out.push({ code: 'sums_changed', table })
  const ba = by(b.alerts)
  const aa = by(t.alerts)
  for (const a of t.alerts ?? []) {
    const x = ba.get(a.key)
    if (!x) out.push({ code: 'alert_added', table, name: a.label })
    else if (!same(x, a)) out.push({ code: 'alert_changed', table, name: a.label })
  }
  for (const a of b.alerts ?? []) if (!aa.has(a.key)) out.push({ code: 'alert_removed', table, name: a.label })
  intakeChanges(b, t, out)
  checkChanges(b, t, out)
  docChanges(b, t, out)
}

function docChanges(b: SpecTable, t: SpecTable, out: SpecChange[]): void {
  const bd = by(b.docs)
  for (const d of t.docs ?? []) {
    const x = bd.get(d.key)
    if (!x) out.push({ code: 'doc_added', table: t.name, name: d.label })
    else if (!x.hidden && d.hidden) out.push({ code: 'doc_hidden', table: t.name, name: d.label })
    else if (x.hidden && !d.hidden) out.push({ code: 'doc_shown', table: t.name, name: d.label })
    else if (!same(x, d)) out.push({ code: 'doc_changed', table: t.name, name: d.label })
  }
}

function checkChanges(b: SpecTable, t: SpecTable, out: SpecChange[]): void {
  const bc = by(b.checks)
  const ac = by(t.checks)
  for (const c of t.checks ?? []) {
    const x = bc.get(c.key)
    if (!x) out.push({ code: 'check_added', table: t.name, name: c.label })
    else if (!same(x, c)) out.push({ code: 'check_changed', table: t.name, name: c.label })
  }
  for (const c of b.checks ?? []) if (!ac.has(c.key)) out.push({ code: 'check_removed', table: t.name, name: c.label })
}

function intakeChanges(b: SpecTable, t: SpecTable, out: SpecChange[]): void {
  const table = t.name
  const intakeCols = (x: SpecTable) => (x.intake?.columns ?? []).map((k) => x.columns.find((c) => c.key === k)?.label ?? k)
  if (!b.intake && t.intake) out.push({ code: 'intake_opened', table, values: intakeCols(t) })
  else if (b.intake && !t.intake) out.push({ code: 'intake_closed', table })
  else if (b.intake && t.intake && !same(b.intake.columns, t.intake.columns)) out.push({ code: 'intake_changed', table, values: intakeCols(t) })
  if (t.intake?.form && !b.intake?.form) out.push({ code: 'intake_form_on', table })
  else if (b.intake?.form && t.intake && !t.intake.form) out.push({ code: 'intake_form_off', table })
  if (t.intake?.webhook && !b.intake?.webhook) out.push({ code: 'intake_webhook_on', table })
  else if (b.intake?.webhook && t.intake && !t.intake.webhook) out.push({ code: 'intake_webhook_off', table })
  else if (b.intake?.webhook && t.intake?.webhook && !same(b.intake.webhook, t.intake.webhook)) out.push({ code: 'intake_webhook_changed', table })
  if (t.intake && !same(b.intake?.identify, t.intake.identify)) {
    const id = t.intake.identify
    out.push(id ? { code: id.by === 'phone' ? 'intake_identify_phone' : 'intake_identify_telegram', table, name: t.columns.find((c) => c.key === id.column)?.label ?? id.column } : { code: 'intake_identify_off', table })
  }
}

function columnChanges(b: SpecColumn, c: SpecColumn, table: string, out: SpecChange[]): void {
  if (!b.hidden && c.hidden) out.push({ code: 'column_hidden', table, name: b.label })
  if (b.hidden && !c.hidden) out.push({ code: 'column_shown', table, name: c.label })
  if (b.label !== c.label) out.push({ code: 'column_renamed', table, from: b.label, to: c.label })
  if ((b.hint ?? '') !== (c.hint ?? '')) out.push({ code: 'column_hint', table, name: c.label })
  if (b.required && !c.required && !c.hidden) out.push({ code: 'column_optional', table, name: c.label })
  const added = (c.options ?? []).filter((o) => !(b.options ?? []).includes(o))
  if (added.length) out.push({ code: 'options_added', table, name: c.label, values: added })
  if ((c.kind === 'computed' || b.kind === 'computed') && (b.kind !== c.kind || b.block !== c.block || !same(b.from, c.from))) out.push({ code: 'computed_changed', table, name: c.label, from: b.kind, to: c.kind })
}
