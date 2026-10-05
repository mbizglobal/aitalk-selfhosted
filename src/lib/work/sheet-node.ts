
import { isUnsafeTemplateSegment } from '@/lib/workflow/template-scope'
import { WorkError } from './errors'
import { columnScale, formatFixed, normalizeValue, parseFixed, type ColumnDef, type SheetSchema } from './sheet-columns'
import { readProjectSheet, withProjectSheetWrite, type SheetRowView, type WorkSheetDeps } from './sheet-gate'

export type SheetNodeOperation = 'read' | 'insert' | 'update' | 'delete' | 'upsert' | 'batch-insert' | 'increment'

export interface ProjectSheetTarget {
  userId: string
  projectId: string
  sheetId: string
  workflowId: string
}

export interface SheetNodeInput {
  filter?: unknown
  data?: unknown
  limit?: number
  batch?: Array<Record<string, unknown>>
}

const ROW_FIELDS = new Set(['id', 'createdAt', 'updatedAt'])

function outRow(r: SheetRowView): Record<string, unknown> {
  return { id: r.id, ...r.data, ...(r.confirmed === null ? {} : { confirmed: r.confirmed }), createdAt: r.createdAt, updatedAt: r.updatedAt }
}

function asObject(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new WorkError('INVALID', `${what} must be an object`)
  return v as Record<string, unknown>
}

function prepareFilter(schema: SheetSchema, filter: Record<string, unknown>): Record<string, unknown> | null {
  const byName = new Map(schema.columns.map((c) => [c.name, c]))
  const out: Record<string, unknown> = {}
  let impossible = false
  for (const [k, v] of Object.entries(filter)) {
    if (ROW_FIELDS.has(k)) { out[k] = v; continue }
    const col = byName.get(k)
    if (!col) throw new WorkError('INVALID', `the sheet has no column "${k}"`)
    if (col.encrypted) throw new WorkError('INVALID', `cannot filter by encrypted column "${k}"`)
    if (v === null || v === undefined) { out[k] = null; continue }
    try { out[k] = normalizeValue(col, v) } catch { impossible = true }
  }
  return impossible ? null : out
}

function matches(r: SheetRowView, filter: Record<string, unknown>): boolean {
  const full: Record<string, unknown> = { id: r.id, ...r.data, createdAt: r.createdAt, updatedAt: r.updatedAt }
  return Object.entries(filter).every(([k, v]) =>
    v === null ? full[k] === undefined || full[k] === null : JSON.stringify(full[k]) === JSON.stringify(v),
  )
}

function requireSelectingFilter(filter: unknown, op: string): Record<string, unknown> {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).length === 0) {
    throw new WorkError('INVALID', `filter must select specific rows for ${op} — an empty filter is refused because it would match every row`)
  }
  return filter as Record<string, unknown>
}

function addToColumn(col: ColumnDef, current: unknown, raw: unknown): unknown {
  if (col.type === 'number') {
    let d: number
    try { d = normalizeValue(col, raw) as number } catch { throw new WorkError('INVALID', `increment amount for "${col.name}" must be a number`) }
    const base = current === undefined || current === null ? 0 : (current as number)
    const next = base + d
    if (!Number.isFinite(next)) throw new WorkError('INVALID', `cannot increment "${col.name}": the result is out of range`)
    return next
  }
  const scale = columnScale(col)
  const d = parseFixed(raw, scale)
  if (d === null) throw new WorkError('INVALID', `increment amount for "${col.name}" must have at most ${scale} decimal places`)
  const base = current === undefined || current === null ? BigInt(0) : parseFixed(current, scale)
  if (base === null) throw new WorkError('INVALID', `cannot increment "${col.name}": the stored value is not a number`)
  return formatFixed(base + d, scale)
}

export async function runProjectSheetNode(deps: WorkSheetDeps, t: ProjectSheetTarget, operation: SheetNodeOperation, input: SheetNodeInput): Promise<Record<string, unknown>> {
  const actor = { type: 'ai' as const, workflowId: t.workflowId }
  const write = <T>(fn: Parameters<typeof withProjectSheetWrite<T>>[2]) =>
    withProjectSheetWrite(deps, { userId: t.userId, projectId: t.projectId, sheetIds: [t.sheetId], actor }, fn)

  switch (operation) {
    case 'read': {
      const limit = input.limit ?? 100
      if (!Number.isInteger(limit) || limit < 1) throw new WorkError('INVALID', 'limit must be a positive whole number')
      const sheet = await readProjectSheet(deps, { userId: t.userId, projectId: t.projectId, sheetId: t.sheetId, workflowId: t.workflowId })
      let rows = sheet.rows
      if (input.filter !== undefined && input.filter !== null) {
        const f = asObject(input.filter, 'filter')
        if (Object.keys(f).length > 0) {
          const prepared = prepareFilter(sheet.schema, f)
          rows = prepared ? rows.filter((r) => matches(r, prepared)) : []
        }
      }
      rows = rows.slice(0, limit)
      return { operation: 'read', success: true, message: `Successfully retrieved ${rows.length} row(s) from the sheet.`, rowCount: rows.length, rows: rows.map(outRow) }
    }

    case 'insert': {
      const data = asObject(input.data, 'data')
      const row = await write((w) => w.insert(t.sheetId, data))
      return { operation: 'insert', success: true, message: 'Data has been successfully inserted into the sheet.', row: outRow(row) }
    }

    case 'batch-insert': {
      const list = input.batch ?? []
      if (list.length === 0) return { operation: 'batch-insert', success: true, message: 'No data to insert', insertedCount: 0, rows: [] }
      const rows = await write(async (w) => {
        const out: SheetRowView[] = []
        for (const d of list) out.push(await w.insert(t.sheetId, asObject(d, 'each row')))
        return out
      })
      return { operation: 'batch-insert', success: true, message: `Successfully inserted ${rows.length} row(s) into the sheet.`, insertedCount: rows.length, rows: rows.map(outRow) }
    }

    case 'update': {
      const filter = requireSelectingFilter(input.filter, 'update')
      const data = asObject(input.data, 'data')
      const n = await write(async (w) => {
        const prepared = prepareFilter(await w.sheetSchema(t.sheetId), filter)
        const hits = prepared ? (await w.rows(t.sheetId)).filter((r) => matches(r, prepared)) : []
        for (const r of hits) await w.update(t.sheetId, r.id, data)
        return hits.length
      })
      return { operation: 'update', success: true, message: `Successfully updated ${n} row(s).`, updatedCount: n }
    }

    case 'delete': {
      const filter = requireSelectingFilter(input.filter, 'delete')
      const n = await write(async (w) => {
        const prepared = prepareFilter(await w.sheetSchema(t.sheetId), filter)
        const hits = prepared ? (await w.rows(t.sheetId)).filter((r) => matches(r, prepared)) : []
        for (const r of hits) await w.remove(t.sheetId, r.id)
        return hits.length
      })
      return n === 0
        ? { operation: 'delete', success: true, deletedCount: 0 }
        : { operation: 'delete', success: true, message: `Successfully deleted ${n} row(s).`, deletedCount: n }
    }

    case 'upsert': {
      const data = asObject(input.data, 'data')
      const f = input.filter
      if (f !== undefined && f !== null && (typeof f !== 'object' || Array.isArray(f))) {
        throw new WorkError('INVALID', 'filter for upsert must be an object — a string or array is refused because it would silently insert a new row every call')
      }
      const filter = (f ?? {}) as Record<string, unknown>
      return write(async (w) => {
        if (Object.keys(filter).length > 0) {
          const prepared = prepareFilter(await w.sheetSchema(t.sheetId), filter)
          const hits = prepared ? (await w.rows(t.sheetId)).filter((r) => matches(r, prepared)) : []
          if (hits.length > 0) {
            for (const r of hits) await w.update(t.sheetId, r.id, data)
            return { operation: 'update', action: 'updated', success: true, message: `Successfully updated ${hits.length} row(s).`, updatedCount: hits.length }
          }
        }
        const insertData: Record<string, unknown> = { ...data }
        for (const [k, v] of Object.entries(filter)) if (!ROW_FIELDS.has(k)) insertData[k] = v
        const row = await w.insert(t.sheetId, insertData)
        return { operation: 'insert', action: 'inserted', success: true, message: 'Data has been successfully inserted into the sheet.', row: outRow(row) }
      })
    }

    case 'increment': {
      const filter = requireSelectingFilter(input.filter, 'increment')
      const data = asObject(input.data, 'data')
      if (Object.keys(data).length === 0) throw new WorkError('INVALID', 'data is required for increment operation — give each field the amount to add, e.g. {"points": 10}')
      const rows = await write(async (w) => {
        const schema = await w.sheetSchema(t.sheetId)
        const byName = new Map(schema.columns.map((c) => [c.name, c]))
        for (const k of Object.keys(data)) {
          if (isUnsafeTemplateSegment(k) || ROW_FIELDS.has(k)) throw new WorkError('INVALID', `cannot increment "${k}": that name is reserved`)
          const col = byName.get(k)
          if (!col) throw new WorkError('INVALID', `cannot increment "${k}": the sheet has no such column`)
          if (col.type !== 'number' && col.type !== 'money' && col.type !== 'decimal') throw new WorkError('INVALID', `cannot increment "${k}": the column is "${col.type}", not a number column`)
        }
        const prepared = prepareFilter(schema, filter)
        const hits = prepared ? (await w.rows(t.sheetId)).filter((r) => matches(r, prepared)) : []
        const out: SheetRowView[] = []
        for (const r of hits) {
          const patch: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(data)) patch[k] = addToColumn(byName.get(k)!, r.data[k], v)
          out.push(await w.update(t.sheetId, r.id, patch))
        }
        return out
      })
      return { operation: 'increment', success: true, message: `Successfully incremented ${rows.length} row(s).`, updatedCount: rows.length, rowCount: rows.length, rows: rows.map((r) => ({ id: r.id, ...r.data })) }
    }
    default:
      throw new WorkError('INVALID', `Unknown operation: ${String(operation)}`)
  }
}
