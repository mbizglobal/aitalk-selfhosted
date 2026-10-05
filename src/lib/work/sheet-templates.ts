
import type { Prisma } from '@prisma/client'
import { WorkError } from './errors'
import { validateSheetSchema, type ColumnDef, type SheetSchema } from './sheet-columns'

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

export interface SheetTemplate {
  /** 'vat.transactions' */
  name: string
  version: number
  family: string
  columns: ColumnDef[]
  unique?: string[]
  dateColumn?: string
  effectiveFromColumn?: string
  confirm?: {
    calcColumns: string[]
    ai?: { reasonColumn: string; check?: (row: Readonly<Record<string, unknown>>) => string | null }
  }
  submitWarning?: (row: Readonly<Record<string, unknown>>) => string | null
  pairs?: PairDef[]
  exceptions?: Record<string, ExceptionJudge>
  checkRow?: (data: Readonly<Record<string, unknown>>) => string | null
  aiWrite?: false
  ui?: {
    options?: Readonly<Record<string, readonly string[]>>
    hidden?: readonly string[]
    order?: readonly string[]
    fxShown?: { currency: string; date: string; rate: string; unit: string; method: { family: string; column: string } }
    screenRowsFrom?: string
    help?: string
    refs?: Readonly<Record<string, { family: string; column: string }>>
    summary?: readonly string[]
    file?: string
    noManualRows?: true
  }
  manualRow?: (key: Buffer, data: Record<string, unknown>, before: Readonly<Record<string, unknown>> | null, ctx: { fileSha256: string | null }) => Record<string, unknown>
}

export const templateId = (t: Pick<SheetTemplate, 'name' | 'version'>) => `${t.name}@${t.version}`

export function templateSchema(t: SheetTemplate): SheetSchema {
  return t.unique ? { columns: t.columns, unique: t.unique } : { columns: t.columns }
}

export function screenSchema(schema: SheetSchema, t: Pick<SheetTemplate, 'ui'> | null | undefined): SheetSchema {
  const order = t?.ui?.order
  if (!order?.length) return schema
  const rank = (name: string) => { const i = order.indexOf(name); return i < 0 ? order.length : i }
  return { ...schema, columns: [...schema.columns].sort((a, b) => rank(a.name) - rank(b.name)) }
}

export function validateTemplateRegistry(list: readonly SheetTemplate[]): void {
  const byName = new Map<string, SheetTemplate[]>()
  for (const t of list) {
    if (!t.name || !Number.isInteger(t.version) || t.version < 1 || !t.family) throw new WorkError('TEMPLATE_LOCKED', `bad template header ${t.name}`)
    const dateColumns = [t.dateColumn, t.effectiveFromColumn].filter((c): c is string => !!c)
    if (t.dateColumn && t.effectiveFromColumn) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: a sheet is either dated or effective-dated, not both`)
    validateSheetSchema(templateSchema(t), { dateColumns })
    const names = new Set(t.columns.map((c) => c.name))
    for (const c of t.confirm?.calcColumns ?? []) {
      if (!names.has(c)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: calc column "${c}" does not exist`)
    }
    if (t.confirm?.ai && !names.has(t.confirm.ai.reasonColumn)) throw new WorkError('TEMPLATE_LOCKED', `${templateId(t)}: AI reason column "${t.confirm.ai.reasonColumn}" does not exist`)
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
