
import type { Prisma } from '@prisma/client'
import { WorkError } from './errors'
import { validateSheetSchema, type ColumnDef, type SheetSchema } from './sheet-columns'
import type { SheetRowView, WorkMember, WorkPerson } from './sheet-gate'
import type { ReferenceReader } from './references'

export interface ConfirmCheckRow { id: string; data: Readonly<Record<string, unknown>>; before: Readonly<Record<string, unknown>> | null; confirmedBefore?: boolean }
export interface ConfirmProblem { index: number; code: string; params?: Record<string, string | number> }
export interface ConfirmCheckCtx {
  projectId: string
  rows(family: string): Promise<readonly SheetRowView[]>
  references(): Promise<ReferenceReader>
  settings?(): Promise<Readonly<Record<string, unknown>>>
  fxMonthly?(currency: string, date: string): Promise<{ rate: string; unit: number } | null>
  fingerprint?(label: string, value: unknown): Promise<string>
  serialize?(name: string): Promise<void>
  who?(): Promise<WorkPerson | null>
  members?(): Promise<readonly WorkMember[]>
}
export type WriteRule = (input: {
  before: Readonly<Record<string, unknown>> | null
  after: Readonly<Record<string, unknown>>
  confirmedBefore: boolean | null
  confirmedAfter: boolean | null
  actor: SheetActorKind
  who?: WorkPerson | null
  module?: string | null
}) => { code: string; params?: Record<string, string | number> } | null
export type DeleteRule = (input: {
  before: Readonly<Record<string, unknown>>
  confirmed: boolean | null
  actor: SheetActorKind
  who: WorkPerson | null
  module: string | null
}) => { code: string; params?: Record<string, string | number> } | null
export type SheetActorKind = 'human' | 'ai' | 'module' | 'import' | 'flow' | 'channel' | 'handoff' | 'app' | 'intake_form' | 'webhook'
export type ConfirmCheck = (ctx: ConfirmCheckCtx, input: { sheetId: string; by: 'human' | 'ai'; rows: readonly ConfirmCheckRow[]; others: readonly ConfirmCheckRow[] }) => Promise<readonly ConfirmProblem[]>

export interface ExceptionJudgeInput {
  tx: Prisma.TransactionClient
  projectId: string
  userId: string
  action: 'pair' | 'unpair'
  kind: string
  from: { id: string; sheetId: string; data: Record<string, unknown>; locked: boolean }
  to: { id: string; sheetId: string; data: Record<string, unknown>; locked: boolean }
  isDateLocked(date: string): boolean
}
export type ExceptionJudge = (input: ExceptionJudgeInput) => boolean | Promise<boolean>

export interface PairDef {
  kind: string
  toFamily: string
  periodSide: 'from' | 'to'
}

export interface SearchDecl {
  version: number
  dates?: readonly string[]
  amounts?: readonly string[]
  currency?: string
  keys?: readonly string[]
  party?: string
  link?: string
}
export const SEARCH_SLOTS = { dates: 4, amounts: 2, keys: 4 } as const

export type FilterFrom = { module: string; label: string } | { column: string; label: string }
export const FILTERS_MAX = 3
export const filtersOf = (t: Pick<SheetTemplate, 'ui'>): readonly FilterFrom[] => {
  const f = t.ui?.filterFrom
  return f === undefined ? [] : Array.isArray(f) ? (f as readonly FilterFrom[]) : [f as FilterFrom]
}

export interface SheetTemplate {
  /** 'vat.transactions' */
  name: string
  version: number
  family: string
  columns: ColumnDef[]
  unique?: string[]
  upgrade?: 'safe'
  search?: SearchDecl
  dateColumn?: string
  effectiveFromColumn?: string
  confirm?: {
    calcColumns: string[]
    ai?: { reasonColumn: string; check?: (row: Readonly<Record<string, unknown>>) => string | null }
    before?: ConfirmCheck
    byModule?: true
    calcProject?: Readonly<Record<string, (v: unknown) => unknown>>
  }
  submitWarning?: (row: Readonly<Record<string, unknown>>) => string | null
  pairs?: PairDef[]
  exceptions?: Record<string, ExceptionJudge>
  checkRow?: (data: Readonly<Record<string, unknown>>) => string | null
  writeRule?: WriteRule
  rowNotice?: (e: { action: 'insert' | 'update' | 'confirm' | 'linked'; before: Readonly<Record<string, unknown>> | null; after: Readonly<Record<string, unknown>> }) => { key: string; params?: Record<string, string | number> } | null
  deleteRule?: DeleteRule
  aiWrite?: false
  moduleOnly?: true
  fileColumns?: readonly string[]
  recordFiles?: readonly string[]
  fileRules?: Readonly<Record<string, {
    mime: readonly string[]
    maxBytes: number
    check?: (bytes: Buffer) => Promise<string | null>
  }>>
  ui?: {
    options?: Readonly<Record<string, readonly string[]>>
    hidden?: readonly string[]
    order?: readonly string[]
    fxShown?: { currency: string; date: string; rate: string; unit: string; method: { family: string; column: string } }
    screenRowsFrom?: string
    derivedFrom?: { module: string; columns: ReadonlyArray<DerivedColumn>; rowScope?: 'linked' }
    filterFrom?: FilterFrom | readonly FilterFrom[]
    choicesFrom?: {
      module: string
      columns: readonly string[]
      follow?: Readonly<Record<string, { from: string; fillEmpty?: true }>>
    }
    help?: string
    refs?: Readonly<Record<string, { family: string; column: string }>>
    summary?: readonly string[]
    file?: string
    moreFiles?: string
    noManualRows?: true
    dotFrom?: string
    dotWhyFrom?: string
    closeActions?: ReadonlyArray<{ column: string; kind: 'reason' | 'today'; label: string; when?: { cell: string; in: readonly string[] } }>
    hideWhen?: string
    lockEditWhen?: string | { column: string; onlyItems?: readonly string[]; label?: string; exceptWhen?: { cell: string; in: readonly string[] } }
    confirmWhen?: { cell: string; in: readonly string[] }
    textButtons?: boolean
    colLabels?: Readonly<Record<string, string>>
    waitingWhenEmpty?: string
    waitingSkip?: { cell: string; in: readonly string[] }
    referenceOrder?: number
    image?: { column: string; help?: string }
    form?: { groups: ReadonlyArray<{ name: string; columns: readonly string[] }>; note?: string }
    rowActions?: ReadonlyArray<RowAction>
    sheetActions?: ReadonlyArray<SheetAction>
    select?: { module: string; inputKey: string; label: string; input?: Readonly<Record<string, string>>; when: { cell: string; in: readonly string[] }; summary?: SelectSummary; preview?: { module: string; inputKey: string } }
    hideCommon?: ReadonlyArray<'confirm' | 'confirmAll' | 'edit' | 'delete' | 'add' | 'editConfirm' | 'rowFile'>
    sortBy?: { column: string; dir: 'asc' | 'desc' }
    askButtons?: ReadonlyArray<{ label: string; ask: string }>
    download?: boolean
    viewOnly?: readonly string[]
    openFiles?: ReadonlyArray<{ column: string; label: string }>
    details?: { column: string; columns: readonly string[]; money?: readonly string[]; label: string; download?: boolean; sumOf?: string; sumTo?: string; newItem?: Readonly<Record<string, unknown>>; options?: Readonly<Record<string, readonly string[]>>; booleans?: readonly string[] }
    countryColumns?: readonly string[]
    noFirst?: readonly string[]
    confirmAs?: 'approve'
  }
  manualRow?: (key: Buffer, data: Record<string, unknown>, before: Readonly<Record<string, unknown>> | null, ctx: { fileSha256: string | null; actor?: string }) => Record<string, unknown>
}

export interface SheetAction {
  module: string
  label: string
  icon?: RowAction['icon'] | 'send'
  input?: Readonly<Record<string, string>>
  ask?: 'confirm'
  setting?: string
}
export interface SelectSummary { amount: string; currency: string; title?: string; details?: readonly string[]; flags?: readonly string[] }

export interface RowAction {
  module: string
  inputKey: string
  label: string
  icon?: 'copy' | 'receipt' | 'play' | 'check' | 'ban' | 'plus' | 'minus' | 'trash' | 'filter' | 'send'
  input?: Readonly<Record<string, string>>
  ask?: 'reason' | 'confirm'
  when?: { cell: string; in: readonly string[] }
  result?: 'pdf'
  withLang?: true
  primary?: true
  note?: string
}
export interface DerivedColumn { name: string; label: string; type: 'text' | 'money' | 'date' | 'status'; replaces?: string }
export const DERIVED_COLUMN_TYPES = ['text', 'money', 'date', 'status'] as const

export const templateId = (t: Pick<SheetTemplate, 'name' | 'version'>) => `${t.name}@${t.version}`

export function templateFileColumns(t: Pick<SheetTemplate, 'ui' | 'fileColumns'>): string[] {
  return [...new Set([...(t.ui?.file ? [t.ui.file] : []), ...(t.fileColumns ?? [])])]
}

export function splitFileIds(v: unknown): string[] {
  return typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []
}

export function rowFileIds(t: Pick<SheetTemplate, 'ui' | 'fileColumns'>, data: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = []
  for (const c of templateFileColumns(t)) if (typeof data[c] === 'string' && data[c]) out.push(data[c] as string)
  if (t.ui?.moreFiles) out.push(...splitFileIds(data[t.ui.moreFiles]))
  return [...new Set(out)]
}

export function templateSchema(t: SheetTemplate): SheetSchema {
  return t.unique ? { columns: t.columns, unique: t.unique } : { columns: t.columns }
}

export function screenSchema(schema: SheetSchema, t: Pick<SheetTemplate, 'ui'> | null | undefined): SheetSchema {
  const order = t?.ui?.order
  if (!order?.length) return schema
  const rank = (name: string) => { const i = order.indexOf(name); return i < 0 ? order.length : i }
  return { ...schema, columns: [...schema.columns].sort((a, b) => rank(a.name) - rank(b.name)) }
}

function validateSearchDecl(t: SheetTemplate): void {
  const d = t.search!
  const id = templateId(t)
  const col = new Map(t.columns.map((c) => [c.name, c]))
  const bad = (why: string) => { throw new WorkError('TEMPLATE_LOCKED', `${id}: search ${why}`) }
  if (!Number.isInteger(d.version) || d.version < 1) bad('version must be 1 or more')
  const need = (name: string, ok: (c: NonNullable<ReturnType<typeof col.get>>) => boolean, what: string) => {
    const c = col.get(name)
    if (!c) bad(`column "${name}" does not exist`)
    if (!ok(c!)) bad(`column "${name}" must be ${what}`)
  }
  if ((d.dates?.length ?? 0) > SEARCH_SLOTS.dates || (d.amounts?.length ?? 0) > SEARCH_SLOTS.amounts || (d.keys?.length ?? 0) > SEARCH_SLOTS.keys) bad('has more columns than slots')
  for (const n of d.dates ?? []) need(n, (c) => c.type === 'date' && !c.encrypted, 'a plain date')
  for (const n of d.amounts ?? []) need(n, (c) => (c.type === 'money' || c.type === 'decimal') && !c.encrypted, 'plain money or decimal')
  for (const n of d.keys ?? []) need(n, (c) => c.type === 'string' && !c.encrypted, 'a plain string')
  if (d.currency) need(d.currency, (c) => c.type === 'string' && !c.encrypted, 'a plain string')
  if (d.party) need(d.party, (c) => c.type === 'string' && !!c.encrypted, 'an encrypted string')
  if (d.link) need(d.link, (c) => c.type === 'string' && !c.encrypted, 'a plain string')
  if ((d.amounts?.length ?? 0) > 0 && !d.currency) bad('amounts need a currency column')
}

export function validateTemplateRegistry(list: readonly SheetTemplate[]): void {
  const byName = new Map<string, SheetTemplate[]>()
  for (const t of list) {
    if (!t.name || !Number.isInteger(t.version) || t.version < 1 || !t.family) throw new WorkError('TEMPLATE_LOCKED', `bad template header ${t.name}`)
    const dateColumns = [t.dateColumn, t.effectiveFromColumn].filter((c): c is string => !!c)
    if (t.dateColumn && t.effectiveFromColumn) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: a sheet is either dated or effective-dated, not both`)
    validateSheetSchema(templateSchema(t), { dateColumns })
    const names = new Set(t.columns.map((c) => c.name))
    if (t.search) validateSearchDecl(t)
    for (const c of t.confirm?.calcColumns ?? []) {
      if (!names.has(c)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: calc column "${c}" does not exist`)
    }
    if (t.confirm?.ai && !names.has(t.confirm.ai.reasonColumn)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: AI reason column "${t.confirm.ai.reasonColumn}" does not exist`)
    for (const [c, f] of Object.entries(t.confirm?.calcProject ?? {})) if (!t.confirm!.calcColumns.includes(c) || typeof f !== 'function') throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: confirm.calcProject "${c}" must be a calc column with a function`)
    for (const c of t.fileColumns ?? []) {
      if (!names.has(c)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: file column "${c}" does not exist`)
    }
    const waiting = t.ui?.waitingWhenEmpty
    if (waiting && !t.columns.some((c) => c.name === waiting && !c.encrypted)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: waiting column "${waiting}" must be a plain column`)
    const fileCols = templateFileColumns(t)
    for (const c of t.recordFiles ?? []) if (!fileCols.includes(c)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: record file column "${c}" is not a file column`)
    for (const [c, r] of Object.entries(t.fileRules ?? {})) {
      if (!fileCols.includes(c)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: file rule for "${c}", which is not a file column`)
      if (!r.mime.length || !(r.maxBytes > 0)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: file rule for "${c}" needs types and a size`)
    }
    if (t.ui?.image && t.ui.image.column !== t.ui.file) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: image column must be the file column (ui.file)`)
    for (const g of t.ui?.form?.groups ?? []) {
      for (const c of g.columns) if (!names.has(c)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: form column "${c}" does not exist`)
    }
    const kinds = new Set<string>()
    for (const p of t.pairs ?? []) {
      if (kinds.has(p.kind)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: pair kind "${p.kind}" twice`)
      kinds.add(p.kind)
    }
    const arr = byName.get(t.name) ?? []
    arr.push(t)
    byName.set(t.name, arr)
  }
  const familyKey = new Map<string, { id: string; sig: string }>()
  for (const t of list) {
    const cols = new Map(t.columns.map((c) => [c.name, c]))
    const sig = JSON.stringify((t.unique ?? []).map((n) => [n, cols.get(n)?.type, cols.get(n)?.scale ?? null]))
    const seen = familyKey.get(t.family)
    if (!seen) familyKey.set(t.family, { id: templateId(t), sig })
    else if (seen.sig !== sig) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: unique key differs from ${seen.id} in family ${t.family}`)
  }
  for (const [name, versions] of byName) {
    versions.sort((a, b) => a.version - b.version)
    versions.forEach((t, i) => {
      if (t.version !== i + 1) throw new WorkError('TEMPLATE_LOCKED', `${name}: versions must run 1, 2, 3 … (found @${t.version})`)
      if (i === 0) return
      const prev = versions[i - 1]
      if (prev.family !== t.family) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: family changed`)
      if (prev.dateColumn !== t.dateColumn || prev.effectiveFromColumn !== t.effectiveFromColumn) {
        throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: date column changed`)
      }
      if (JSON.stringify(prev.unique ?? null) !== JSON.stringify(t.unique ?? null)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: unique key changed`)
      assertColumnsOnlyAdded(prev.columns, t.columns, templateId(t))
    })
  }
}

export function assertColumnsOnlyAdded(before: readonly ColumnDef[], after: readonly ColumnDef[], where: string): void {
  const next = new Map(after.map((c) => [c.name, c]))
  for (const c of before) {
    const n = next.get(c.name)
    if (!n) throw new WorkError('TEMPLATE_LOCKED', `${where}: column "${c.name}" removed or renamed`)
    if (n.type !== c.type || (n.scale ?? null) !== (c.scale ?? null) || !!n.encrypted !== !!c.encrypted || !!n.required !== !!c.required) {
      throw new WorkError('TEMPLATE_LOCKED', `${where}: column "${c.name}" changed its type`)
    }
  }
  const old = new Set(before.map((c) => c.name))
  for (const c of after) {
    if (!old.has(c.name) && c.required) throw new WorkError('TEMPLATE_LOCKED', `${where}: added column "${c.name}" must be optional`)
  }
}

export function findTemplate(list: readonly SheetTemplate[], id: string): SheetTemplate {
  const t = list.find((x) => templateId(x) === id)
  if (!t) throw new WorkError('TEMPLATE_UNKNOWN', id)
  return t
}
