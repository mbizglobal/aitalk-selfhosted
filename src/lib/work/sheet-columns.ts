
import crypto from 'crypto'
import { isCalendarDate } from './dates'
import { isUnsafeTemplateSegment } from '@/lib/workflow/template-scope'
import { WorkError } from './errors'

export type ColumnType =
  | 'string' | 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json'
  | 'money'
  | 'decimal'

export interface ColumnDef {
  name: string
  type: ColumnType
  required?: boolean
  scale?: number
  encrypted?: boolean
}

export interface SheetSchema {
  columns: ColumnDef[]
  unique?: string[]
}

const TYPES: ReadonlySet<ColumnType> = new Set(['string', 'text', 'number', 'boolean', 'date', 'datetime', 'json', 'money', 'decimal'])
const ENCRYPTABLE: ReadonlySet<ColumnType> = new Set(['string', 'text', 'json'])
export const RESERVED_COLUMN_NAMES: ReadonlySet<string> = new Set(['id', 'createdAt', 'updatedAt', 'confirmed'])

export const MONEY_SCALE = 2

const FIXED_RE = /^([+-])?(\d+)(?:\.(\d+))?$/

export function parseFixed(raw: unknown, scale: number): bigint | null {
  let t: string
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null
    t = String(raw)
  } else if (typeof raw === 'string') {
    t = raw.trim()
  } else {
    return null
  }
  const m = FIXED_RE.exec(t)
  if (!m) return null
  const frac = m[3] ?? ''
  if (frac.length > scale) return null
  const v = BigInt(m[2] + frac.padEnd(scale, '0'))
  return m[1] === '-' ? -v : v
}

/** 10n (scale 2) → "0.10", -5n → "-0.05" */
export function formatFixed(v: bigint, scale: number): string {
  const neg = v < BigInt(0)
  const a = neg ? -v : v
  if (scale === 0) return `${neg ? '-' : ''}${a}`
  const p = BigInt(10) ** BigInt(scale)
  return `${neg ? '-' : ''}${a / p}.${(a % p).toString().padStart(scale, '0')}`
}

export function columnScale(col: ColumnDef): number {
  return col.type === 'money' ? MONEY_SCALE : (col.scale ?? 0)
}

const OFFSET_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

const zurichDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' })

export function zurichDate(iso: string): string {
  return zurichDay.format(new Date(iso))
}

export function calendarDateOf(col: ColumnDef, value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (col.type === 'date') return isCalendarDate(value) ? value : null
  if (col.type === 'datetime') return OFFSET_ISO_RE.test(value) ? zurichDate(value) : null
  return null
}

export function validateSheetSchema(schema: SheetSchema, extra: { dateColumns?: string[] } = {}): SheetSchema {
  if (!schema || !Array.isArray(schema.columns)) throw new WorkError('INVALID', 'columns must be an array')
  const seen = new Set<string>()
  const columns = schema.columns.map((c) => {
    if (!c || typeof c.name !== 'string' || c.name.trim() === '') throw new WorkError('INVALID', 'column name is required')
    const name = c.name
    if (RESERVED_COLUMN_NAMES.has(name) || isUnsafeTemplateSegment(name)) throw new WorkError('INVALID', `column name "${name}" is reserved`)
    if (seen.has(name)) throw new WorkError('INVALID', `column "${name}" appears twice`)
    seen.add(name)
    if (!TYPES.has(c.type)) throw new WorkError('INVALID', `column "${name}" has an unknown type`)
    const out: ColumnDef = { name, type: c.type }
    if (c.required) out.required = true
    if (c.type === 'decimal') {
      if (!Number.isInteger(c.scale) || (c.scale as number) < 0 || (c.scale as number) > 12) {
        throw new WorkError('INVALID', `decimal column "${name}" needs a scale between 0 and 12`)
      }
      out.scale = c.scale
    } else if (c.scale !== undefined) {
      throw new WorkError('INVALID', `column "${name}": scale is only for decimal columns`)
    }
    if (c.encrypted) {
      if (!ENCRYPTABLE.has(c.type)) throw new WorkError('INVALID', `column "${name}": only string, text and json columns can be encrypted`)
      out.encrypted = true
    }
    return out
  })
  const byName = new Map(columns.map((c) => [c.name, c]))
  let unique: string[] | undefined
  if (schema.unique !== undefined) {
    if (!Array.isArray(schema.unique) || schema.unique.length === 0) throw new WorkError('INVALID', 'unique must list at least one column')
    unique = [...schema.unique]
    for (const n of unique) {
      const col = byName.get(n)
      if (!col) throw new WorkError('INVALID', `unique column "${n}" does not exist`)
      if (col.encrypted) throw new WorkError('INVALID', `unique column "${n}" cannot be encrypted`)
      if (!col.required) throw new WorkError('INVALID', `unique column "${n}" must be required`)
    }
    if (new Set(unique).size !== unique.length) throw new WorkError('INVALID', 'unique lists a column twice')
  }
  for (const n of extra.dateColumns ?? []) {
    const col = byName.get(n)
    if (!col) throw new WorkError('INVALID', `date column "${n}" does not exist`)
    if (col.type !== 'date' && col.type !== 'datetime') throw new WorkError('INVALID', `date column "${n}" must be date or datetime`)
    if (col.encrypted) throw new WorkError('INVALID', `date column "${n}" cannot be encrypted`)
    if (!col.required) throw new WorkError('INVALID', `date column "${n}" must be required`)
  }
  return unique ? { columns, unique } : { columns }
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === ''
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

export function normalizeValue(col: ColumnDef, v: unknown): unknown {
  const bad = (what: string) => new WorkError('INVALID', `${col.name} must be ${what}`)
  switch (col.type) {
    case 'string':
    case 'text':
      if (typeof v === 'string') return v
      if (typeof v === 'number' && Number.isFinite(v)) return String(v)
      if (typeof v === 'boolean') return String(v)
      throw bad('text')
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && NUMBER_RE.test(v.trim()) ? Number(v.trim()) : NaN
      const underflow = n === 0 && typeof v === 'string' && /[1-9]/.test(v.trim().split(/e/i)[0])
      if (Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER && !underflow) return n
      throw bad('a number within ±9007199254740991')
    }
    case 'boolean':
      if (typeof v === 'boolean') return v
      if (v === 'true') return true
      if (v === 'false') return false
      throw bad('true or false')
    case 'date':
      if (isCalendarDate(v)) return v
      throw bad('a calendar date YYYY-MM-DD')
    case 'datetime':
      if (typeof v === 'string' && OFFSET_ISO_RE.test(v) && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString()
      throw bad('a date-time with an offset (Z or +hh:mm)')
    case 'json':
      return JSON.parse(JSON.stringify(v))
    case 'money':
    case 'decimal': {
      const scale = columnScale(col)
      const f = parseFixed(v, scale)
      if (f === null) throw bad(`a decimal number with at most ${scale} decimal places`)
      return formatFixed(f, scale)
    }
  }
}

export function normalizeRow(schema: SheetSchema, data: Record<string, unknown>): { plain: Record<string, unknown>; sealed: Record<string, unknown> | null } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WorkError('INVALID', 'row data must be an object')
  const byName = new Map(schema.columns.map((c) => [c.name, c]))
  for (const k of Object.keys(data)) {
    if (!byName.has(k)) throw new WorkError('INVALID', `the sheet has no column "${k}"`)
  }
  const plain: Record<string, unknown> = {}
  const sealed: Record<string, unknown> = {}
  let hasSealed = false
  for (const col of schema.columns) {
    const v = data[col.name]
    if (isBlank(v)) {
      if (col.required) throw new WorkError('INVALID', `${col.name} is required`)
      continue
    }
    const n = normalizeValue(col, v)
    if (col.encrypted) { sealed[col.name] = n; hasSealed = true } else plain[col.name] = n
  }
  return { plain, sealed: hasSealed ? sealed : null }
}

export function uniqueKeyHash(unique: string[], row: Record<string, unknown>): string {
  const parts = unique.map((n) => [n, row[n]])
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}
