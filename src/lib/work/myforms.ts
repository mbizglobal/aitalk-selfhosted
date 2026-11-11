import { randomBytes } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { encryptJson, decryptJson } from './sealed'
import { normalizeValue, validateSheetSchema, type ColumnDef, type SheetSchema } from './sheet-columns'
import { assertProjectWritable, lockProjectForWrite } from './sheet-gate'
import { isSelfHosted } from '@/lib/edition'
import { getManagedPlanFormLimit } from '@/lib/invoice/subscription/utils'
import type { WorkLang } from '@/lib/translations/work'
import type { SheetTemplate } from './sheet-templates'

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

export const MYFORMS_KIND = 'myforms'

export type FormShape = 'single' | 'items'
export type FormColumnKind = 'text' | 'longtext' | 'number' | 'money' | 'date' | 'choice' | 'person' | 'yesno' | 'items'
export type FormItemKind = 'text' | 'number' | 'money' | 'date' | 'choice' | 'yesno'

export interface FormItemColumn {
  key: string
  label: string
  kind: FormItemKind
  required?: boolean
  options?: string[]
}

export interface FormColumn {
  key: string
  label: string
  kind: FormColumnKind
  hint?: string
  required?: boolean
  options?: string[]
  hidden?: boolean
  items?: FormItemColumn[]
  readOnly?: boolean
}

export interface FormInfo {
  columns: FormColumn[]
  people: string[]
  hint?: string
}

export interface FormView {
  id: string
  projectId: string
  sheetId: string
  name: string
  shape: FormShape
  version: number
  info: FormInfo
  createdAt: Date
  deletedAt: Date | null
  assembled?: { table: import('./assembled').SpecTable }
}

export const FORM_LIMITS = {
  perDay: 5,
  columns: 30,
  name: 40,
  label: 40,
  options: 50,
  option: 60,
  people: 50,
  itemColumns: 10,
  itemsPerRow: 100,
  rowBytes: 64 * 1024,
  hint: 300,
  keepDays: 30,
} as const

const SAVE_KEY = /^[A-Za-z0-9_-]{8,64}$/

export async function formLimitOf(db: Db, userId: string): Promise<number | null> {
  if (isSelfHosted()) return null
  const u = await db.user.findUnique({ where: { id: userId }, select: { subscription: { select: { planType: true } } } })
  return getManagedPlanFormLimit(u?.subscription?.planType ?? 'starter')
}

const shortId = () => randomBytes(6).toString('hex')
const KEY_RE = /^f_[a-z0-9]{4,16}$/
const ITEM_KINDS: ReadonlySet<string> = new Set(['text', 'number', 'money', 'date', 'choice', 'yesno'])
const KINDS: ReadonlySet<string> = new Set([...ITEM_KINDS, 'longtext', 'person', 'items'])

function cleanText(v: unknown, max: number, what: string): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new WorkError('INVALID', `${what} is required`)
  if (s.length > max) throw new WorkError('INVALID', `${what} must be ${max} characters or fewer`)
  return s
}

function cleanOptions(v: unknown, what: string): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) throw new WorkError('INVALID', `${what}: options must be a list`)
  if (v.length > FORM_LIMITS.options) throw new WorkError('INVALID', `${what}: at most ${FORM_LIMITS.options} options`)
  const out = v.map((o) => cleanText(o, FORM_LIMITS.option, `${what}: option`))
  if (new Set(out.map((o) => o.toLowerCase())).size !== out.length) throw new WorkError('INVALID', `${what}: an option appears twice`)
  return out.length ? out : undefined
}

export function cleanFormDef(raw: { name: unknown; shape: unknown; columns: unknown; people?: unknown; hint?: unknown }): { name: string; shape: FormShape; info: FormInfo } {
  const name = cleanText(raw.name, FORM_LIMITS.name, 'form name')
  if (raw.shape !== 'single' && raw.shape !== 'items') throw new WorkError('INVALID', 'shape must be single or items')
  const shape = raw.shape
  if (!Array.isArray(raw.columns) || raw.columns.length === 0) throw new WorkError('INVALID', 'a form needs at least one column')
  if (raw.columns.length > FORM_LIMITS.columns) throw new WorkError('INVALID', `a form has at most ${FORM_LIMITS.columns} columns`)
  const labels = new Set<string>()
  const columns: FormColumn[] = raw.columns.map((c: unknown, i: number) => {
    const o = (c && typeof c === 'object' && !Array.isArray(c) ? c : {}) as Record<string, unknown>
    const label = cleanText(o.label, FORM_LIMITS.label, `column ${i + 1}: name`)
    if (labels.has(label.toLowerCase())) throw new WorkError('INVALID', `column ${i + 1}: the name appears twice`)
    labels.add(label.toLowerCase())
    if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) throw new WorkError('INVALID', `column ${i + 1}: unknown kind`)
    const kind = o.kind as FormColumnKind
    const col: FormColumn = { key: `f_${shortId()}`, label, kind }
    if (typeof o.hint === 'string' && o.hint.trim()) col.hint = o.hint.trim().slice(0, FORM_LIMITS.hint)
    if (o.required === true) col.required = true
    const options = cleanOptions(o.options, `column ${i + 1}`)
    if (options && kind !== 'choice' && kind !== 'money') throw new WorkError('INVALID', `column ${i + 1}: only choice and money columns take options`)
    if (kind === 'choice' && !options) throw new WorkError('INVALID', `column ${i + 1}: a choice column needs options`)
    if (options) col.options = kind === 'money' ? options.map((x) => x.toUpperCase()) : options
    if (kind === 'money' && col.options?.some((x) => !/^[A-Z]{3}$/.test(x))) throw new WorkError('INVALID', `column ${i + 1}: currencies are 3-letter codes`)
    if (kind === 'items') {
      if (!Array.isArray(o.items) || o.items.length === 0) throw new WorkError('INVALID', `column ${i + 1}: an items column needs its own columns`)
      if (o.items.length > FORM_LIMITS.itemColumns) throw new WorkError('INVALID', `column ${i + 1}: at most ${FORM_LIMITS.itemColumns} item columns`)
      const sub = new Set<string>()
      col.items = o.items.map((x: unknown, j: number) => {
        const q = (x && typeof x === 'object' && !Array.isArray(x) ? x : {}) as Record<string, unknown>
        const l = cleanText(q.label, FORM_LIMITS.label, `column ${i + 1} item ${j + 1}: name`)
        if (sub.has(l.toLowerCase())) throw new WorkError('INVALID', `column ${i + 1} item ${j + 1}: the name appears twice`)
        sub.add(l.toLowerCase())
        if (typeof q.kind !== 'string' || !ITEM_KINDS.has(q.kind)) throw new WorkError('INVALID', `column ${i + 1} item ${j + 1}: unknown kind`)
        const it: FormItemColumn = { key: `f_${shortId()}`, label: l, kind: q.kind as FormItemKind }
        if (q.required === true) it.required = true
        const opts = cleanOptions(q.options, `column ${i + 1} item ${j + 1}`)
        if (opts && it.kind !== 'choice') throw new WorkError('INVALID', `column ${i + 1} item ${j + 1}: only choice columns take options`)
        if (it.kind === 'choice' && !opts) throw new WorkError('INVALID', `column ${i + 1} item ${j + 1}: a choice column needs options`)
        if (opts) it.options = opts
        return it
      })
    } else if (o.items !== undefined) throw new WorkError('INVALID', `column ${i + 1}: only an items column has item columns`)
    return col
  })
  const itemCols = columns.filter((c) => c.kind === 'items').length
  if (shape === 'items' ? itemCols !== 1 : itemCols !== 0) throw new WorkError('INVALID', shape === 'items' ? 'a form with items has exactly one items column' : 'a one-row form has no items column')
  let people: string[] = []
  if (raw.people !== undefined && raw.people !== null) {
    if (!Array.isArray(raw.people) || raw.people.length > FORM_LIMITS.people) throw new WorkError('INVALID', `people must be a list of at most ${FORM_LIMITS.people} names`)
    people = raw.people.map((p) => cleanText(p, FORM_LIMITS.option, 'person'))
    if (new Set(people.map((p) => p.toLowerCase())).size !== people.length) throw new WorkError('INVALID', 'a person appears twice')
  }
  if (columns.some((c) => c.kind === 'person') && !people.length) throw new WorkError('INVALID', 'a person column needs people to choose')
  const info: FormInfo = { columns, people }
  if (typeof raw.hint === 'string' && raw.hint.trim()) info.hint = raw.hint.trim().slice(0, FORM_LIMITS.hint)
  return { name, shape, info }
}

export function checkStoredFormInfo(raw: unknown, shape: unknown): FormInfo {
  const bad = (why: string): never => { throw new WorkError('INVALID', `form info: ${why}`) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('shape')
  const r = raw as Record<string, unknown>
  for (const k of Object.keys(r)) if (k !== 'columns' && k !== 'people' && k !== 'hint') bad(`unknown field ${k.slice(0, 20)}`)
  if (!Array.isArray(r.columns)) bad('columns')
  const cols = r.columns as unknown[]
  const flag = (v: unknown, what: string) => { if (v !== undefined && typeof v !== 'boolean') bad(`${what} must be true or false`) }
  const keys = new Set<string>()
  const key = (v: unknown) => { if (typeof v !== 'string' || !KEY_RE.test(v) || keys.has(v)) bad('column key'); keys.add(v as string) }
  for (const c of cols) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) bad('column shape')
    const o = c as Record<string, unknown>
    for (const k of Object.keys(o)) if (!['key', 'label', 'kind', 'hint', 'required', 'options', 'hidden', 'items'].includes(k)) bad(`unknown column field ${k.slice(0, 20)}`)
    key(o.key); flag(o.required, 'required'); flag(o.hidden, 'hidden')
    if (o.hint !== undefined && (typeof o.hint !== 'string' || o.hint.length > FORM_LIMITS.hint)) bad('column hint')
    if (Array.isArray(o.items)) for (const it of o.items) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) bad('item shape')
      const q = it as Record<string, unknown>
      for (const k of Object.keys(q)) if (!['key', 'label', 'kind', 'required', 'options'].includes(k)) bad(`unknown item field ${k.slice(0, 20)}`)
      key(q.key); flag(q.required, 'item required')
    }
  }
  if (r.hint !== undefined && (typeof r.hint !== 'string' || r.hint.length > FORM_LIMITS.hint)) bad('hint')
  if (!Array.isArray(r.people)) bad('people')
  const probe = cleanFormDef({ name: 'x', shape, people: r.people, columns: cols.map((c) => { const o = c as Record<string, unknown>; return { label: o.label, kind: o.kind, options: o.options, ...(o.items !== undefined ? { items: (o.items as Array<Record<string, unknown>>).map((q) => ({ label: q.label, kind: q.kind, options: q.options })) } : {}) } }) })
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  probe.info.columns.forEach((p, i) => {
    const o = cols[i] as Record<string, unknown>
    if (!same(p.label, o.label) || !same(p.options, o.options)) bad(`column ${i + 1} is not in the saved shape`)
    ;(p.items ?? []).forEach((q, j) => { const x = (o.items as Array<Record<string, unknown>>)[j]; if (!same(q.label, x.label) || !same(q.options, x.options)) bad(`column ${i + 1} item ${j + 1} is not in the saved shape`) })
  })
  if (!same(probe.info.people, r.people)) bad('people are not in the saved shape')
  return JSON.parse(JSON.stringify(raw)) as FormInfo
}

export const FORM_FILE_COLUMN = 'file'
export const FORM_FILE_SHAPE: Pick<SheetTemplate, 'ui' | 'fileColumns'> = { ui: { file: FORM_FILE_COLUMN, moreFiles: 'moreFileIds' } }
export const FORM_MORE_FILES_COLUMN = 'moreFileIds'
const FORM_MORE_FILES = /^[A-Za-z0-9_-]{1,64}(,[A-Za-z0-9_-]{1,64}){0,19}$/
export const currencyKey = (key: string) => `${key}_cur`

export function formSheetSchema(info: FormInfo): SheetSchema {
  const cols: ColumnDef[] = []
  for (const c of info.columns) {
    const req = c.required && !c.hidden ? { required: true } : {}
    switch (c.kind) {
      case 'text': case 'choice': case 'person': cols.push({ name: c.key, type: 'string', encrypted: true, ...req }); break
      case 'longtext': cols.push({ name: c.key, type: 'text', encrypted: true, ...req }); break
      case 'number': cols.push({ name: c.key, type: 'number', ...req }); break
      case 'money': cols.push({ name: c.key, type: 'money', ...req }, { name: currencyKey(c.key), type: 'string' }); break
      case 'date': cols.push({ name: c.key, type: 'date', ...req }); break
      case 'yesno': cols.push({ name: c.key, type: 'boolean', ...req }); break
      case 'items': cols.push({ name: c.key, type: 'json', encrypted: true, ...req }); break
    }
  }
  cols.push({ name: FORM_FILE_COLUMN, type: 'string' }, { name: FORM_MORE_FILES_COLUMN, type: 'string' })
  return validateSheetSchema({ columns: cols })
}

export async function readForms(db: Db, key: Buffer, q: { userId: string; projectId?: string; sheetIds?: readonly string[]; ids?: readonly string[]; deleted?: boolean }): Promise<FormView[]> {
  const rows = await db.workForm.findMany({
    where: { userId: q.userId, ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.sheetIds ? { sheetId: { in: [...q.sheetIds] } } : {}), ...(q.ids ? { id: { in: [...q.ids] } } : {}), ...(q.deleted ? {} : { deletedAt: null }) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map((r) => ({ id: r.id, projectId: r.projectId, sheetId: r.sheetId, name: r.name, shape: r.shape as FormShape, version: r.version, info: decryptJson<FormInfo>(r.info, key), createdAt: r.createdAt, deletedAt: r.deletedAt }))
}

export async function formRuleLocked(tx: Tx, key: Buffer, q: { userId: string; sheetId: string }): Promise<FormRule | null> {
  const r = await tx.workForm.findUnique({ where: { sheetId: q.sheetId }, select: { userId: true, deletedAt: true, info: true, version: true } })
  if (!r || r.userId !== q.userId) return null
  if (r.deletedAt) throw new WorkError('NOT_FOUND', 'the form was deleted')
  return { info: decryptJson<FormInfo>(r.info, key), version: r.version }
}

export interface FormRule {
  info: FormInfo
  version: number
}

export function prepareFormRow(rule: FormRule, data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }
  const blank = (v: unknown) => v === undefined || v === null || v === ''
  if (!blank(out[FORM_MORE_FILES_COLUMN]) && !(typeof out[FORM_MORE_FILES_COLUMN] === 'string' && FORM_MORE_FILES.test(out[FORM_MORE_FILES_COLUMN] as string))) throw new WorkError('INVALID', `${FORM_MORE_FILES_COLUMN}: up to 20 file ids separated by commas`)
  for (const c of rule.info.columns) {
    if (c.kind === 'money') {
      const cur = out[currencyKey(c.key)]
      if (!blank(cur)) {
        const code = String(cur).trim().toUpperCase()
        if (!/^[A-Z]{3}$/.test(code) || (c.options && !c.options.includes(code))) throw new WorkError('INVALID', `${c.label}: the currency is not one of the form's currencies`)
        out[currencyKey(c.key)] = code
      }
    }
    const v = out[c.key]
    if (blank(v)) continue
    if (c.kind === 'choice' && c.options && !c.options.includes(String(v))) throw new WorkError('INVALID', `${c.label}: choose one of the form's values`)
    if (c.kind === 'person' && !rule.info.people.includes(String(v))) throw new WorkError('INVALID', `${c.label}: choose one of the form's people`)
    if (c.kind === 'items') out[c.key] = prepareItems(c, v)
  }
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > FORM_LIMITS.rowBytes) throw new WorkError('INVALID', `a row is at most ${FORM_LIMITS.rowBytes / 1024} KB`)
  return out
}

function prepareItems(c: FormColumn, v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) throw new WorkError('INVALID', `${c.label}: items must be a list`)
  if (v.length > FORM_LIMITS.itemsPerRow) throw new WorkError('INVALID', `${c.label}: at most ${FORM_LIMITS.itemsPerRow} items`)
  if (c.required && !c.hidden && v.length === 0) throw new WorkError('INVALID', `${c.label} needs at least one item`)
  const byKey = new Map((c.items ?? []).map((it) => [it.key, it]))
  return v.map((item, n) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new WorkError('INVALID', `${c.label} ${n + 1}: an item must be an object`)
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(item)) if (!byKey.has(k)) throw new WorkError('INVALID', `${c.label} ${n + 1}: unknown item column "${k}"`)
    for (const it of c.items ?? []) {
      const x = (item as Record<string, unknown>)[it.key]
      if (x === undefined || x === null || x === '') {
        if (it.required) throw new WorkError('INVALID', `${c.label} ${n + 1}: ${it.label} is required`)
        continue
      }
      const type = it.kind === 'text' || it.kind === 'choice' ? 'string' : it.kind === 'yesno' ? 'boolean' : it.kind
      const val = normalizeValue({ name: `${c.label} ${n + 1}: ${it.label}`, type }, x)
      if (it.kind === 'choice' && it.options && !it.options.includes(String(val))) throw new WorkError('INVALID', `${c.label} ${n + 1}: ${it.label}: choose one of the form's values`)
      if (it.kind === 'text' && String(val).length > 500) throw new WorkError('INVALID', `${c.label} ${n + 1}: ${it.label} is at most 500 characters`)
      out[it.key] = val
    }
    return out
  })
}

async function lockAccount(tx: Tx, userId: string): Promise<void> {
  const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${userId} FOR NO KEY UPDATE`
  if (!u.length) throw new WorkError('NOT_FOUND')
}

async function myformsProject(db: Db, userId: string): Promise<{ id: string; workflowId: string }> {
  const p = await db.workProject.findFirst({ where: { userId, kind: MYFORMS_KIND, status: 'active', workflowId: { not: null } }, select: { id: true, workflowId: true }, orderBy: { createdAt: 'asc' } })
  if (!p?.workflowId) throw new WorkError('NOT_FOUND', 'no my forms work app')
  return { id: p.id, workflowId: p.workflowId }
}

const liveCount = (tx: Tx, projectId: string) => tx.workForm.count({ where: { projectId, deletedAt: null } })

export interface FormDeps {
  db: PrismaClient
  dataKey: (db: PrismaClient, userId: string) => Promise<Buffer>
}

export async function createForm(deps: FormDeps, i: { userId: string; isOwner: boolean; saveKey: unknown; name: unknown; shape: unknown; columns: unknown; people?: unknown; hint?: unknown; onlyIfEmpty?: boolean }): Promise<FormView & { created: boolean }> {
  if (!i.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner makes forms')
  if (typeof i.saveKey !== 'string' || !SAVE_KEY.test(i.saveKey)) throw new WorkError('INVALID', 'saveKey must be 8-64 letters, digits, - or _')
  const saveKey = i.saveKey
  const def = cleanFormDef(i)
  const schema = formSheetSchema(def.info)
  const key = await deps.dataKey(deps.db, i.userId)
  const limit = await formLimitOf(deps.db, i.userId)
  const r = await deps.db.$transaction(async (tx) => {
    await lockAccount(tx, i.userId)
    const project = await myformsProject(tx, i.userId)
    if (i.onlyIfEmpty) {
      const first = await tx.workForm.findFirst({ where: { projectId: project.id, deletedAt: null }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      if (first) return { id: first.id, created: false }
    }
    const had = await tx.workForm.findUnique({ where: { userId_saveKey: { userId: i.userId, saveKey } }, select: { id: true, deletedAt: true } })
    if (had) {
      if (had.deletedAt) throw new WorkError('INVALID', 'this save key belongs to a deleted form — save again')
      return { id: had.id, created: false }
    }
    assertProjectWritable(await lockProjectForWrite(tx, i.userId, project.id))
    if (limit !== null && (await liveCount(tx, project.id)) >= limit) throw new WorkError('FORM_LIMIT', `at most ${limit} forms on this plan`)
    const day = await tx.workForm.count({ where: { userId: i.userId, createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } } })
    if (day >= FORM_LIMITS.perDay) throw new WorkError('RATE_LIMITED', `at most ${FORM_LIMITS.perDay} new forms a day`)
    await assertNameFree(tx, project.id, def.name, null)
    const id = `m${randomBytes(12).toString('hex')}`
    const sheet = await tx.dataSheet.create({ data: { kind: 'project', userId: i.userId, projectId: project.id, name: `form_${id}`, schema: JSON.stringify(schema) } })
    await tx.workForm.create({ data: { id, userId: i.userId, projectId: project.id, sheetId: sheet.id, name: def.name, shape: def.shape, info: encryptJson(def.info, key), saveKey } })
    return { id, created: true }
  })
  const [f] = await readForms(deps.db, key, { userId: i.userId, ids: [r.id], deleted: true })
  return { ...f, created: r.created }
}

async function assertNameFree(tx: Tx, projectId: string, name: string, exceptId: string | null): Promise<void> {
  const same = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM work_form WHERE project_id = ${projectId} AND deleted_at IS NULL AND lower(name) = lower(${name}) ${exceptId ? Prisma.sql`AND id <> ${exceptId}` : Prisma.empty} LIMIT 1`)
  if (same.length) throw new WorkError('DUPLICATE', 'a form with this name exists')
}

async function lockForm(tx: Tx, userId: string, formId: unknown): Promise<{ id: string; projectId: string; name: string; deletedAt: Date | null }> {
  if (typeof formId !== 'string' || !formId) throw new WorkError('NOT_FOUND')
  const f = await tx.$queryRaw<Array<{ id: string; projectId: string; name: string; deletedAt: Date | null }>>`
    SELECT id, project_id AS "projectId", name, deleted_at AS "deletedAt" FROM work_form WHERE id = ${formId} AND user_id = ${userId} FOR UPDATE`
  if (!f.length) throw new WorkError('NOT_FOUND')
  return f[0]
}

export async function changeFormColumns(deps: FormDeps, i: { userId: string; isOwner: boolean; formId: unknown; body: Record<string, unknown> }): Promise<FormView> {
  if (!i.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner changes forms')
  const b = i.body
  if (!Number.isInteger(b.version)) throw new WorkError('INVALID', 'version is required')
  const key = await deps.dataKey(deps.db, i.userId)
  const id = await deps.db.$transaction(async (tx) => {
    await lockAccount(tx, i.userId)
    const f = await lockForm(tx, i.userId, i.formId)
    if (f.deletedAt) throw new WorkError('NOT_FOUND')
    assertProjectWritable(await lockProjectForWrite(tx, i.userId, f.projectId))
    const row = await tx.workForm.findUniqueOrThrow({ where: { id: f.id }, select: { version: true, info: true, sheetId: true, shape: true } })
    if (row.version !== b.version) throw new WorkError('STALE', 'the form was changed meanwhile — reload it')
    const sheet = await tx.$queryRaw<Array<{ schema: string }>>`SELECT schema FROM data_sheets WHERE id = ${row.sheetId} FOR UPDATE`
    if (!sheet.length) throw new WorkError('NOT_FOUND')
    const info = decryptJson<FormInfo>(row.info, key)
    const next = applyColumnChanges(info, row.shape as FormShape, b)
    const before = JSON.parse(sheet[0].schema) as SheetSchema
    const after = formSheetSchema(next)
    assertSchemaGrowsOnly(before, after)
    await tx.dataSheet.update({ where: { id: row.sheetId }, data: { schema: JSON.stringify(after) } })
    await tx.workForm.update({ where: { id: f.id }, data: { info: encryptJson(next, key), version: row.version + 1 } })
    return f.id
  })
  const [f] = await readForms(deps.db, key, { userId: i.userId, ids: [id] })
  return f
}

export function applyColumnChanges(info: FormInfo, shape: FormShape, b: Record<string, unknown>): FormInfo {
  const cols: FormColumn[] = info.columns.map((c) => ({ ...c, ...(c.options ? { options: [...c.options] } : {}), ...(c.items ? { items: c.items.map((x) => ({ ...x })) } : {}) }))
  const byKey = new Map(cols.map((c) => [c.key, c]))
  const known = (k: string, what: string) => { const c = byKey.get(k); if (!c) throw new WorkError('INVALID', `${what}: no column ${k.slice(0, 20)}`); return c }
  const obj = (v: unknown, what: string) => { if (v === undefined) return {}; if (!v || typeof v !== 'object' || Array.isArray(v)) throw new WorkError('INVALID', `${what} must be an object`); return v as Record<string, unknown> }
  const list = (v: unknown, what: string) => { if (v === undefined) return []; if (!Array.isArray(v)) throw new WorkError('INVALID', `${what} must be a list`); return v }
  for (const [k, v] of Object.entries(obj(b.rename, 'rename'))) known(k, 'rename').label = cleanText(v, FORM_LIMITS.label, 'column name')
  for (const k of list(b.hide, 'hide')) { const c = known(String(k), 'hide'); c.hidden = true; delete c.required }
  for (const k of list(b.show, 'show')) delete known(String(k), 'show').hidden
  for (const [k, v] of Object.entries(obj(b.addOptions, 'addOptions'))) {
    const c = known(k, 'addOptions')
    if (c.kind !== 'choice' && c.kind !== 'money') throw new WorkError('INVALID', `${c.label}: only choice and money columns take options`)
    if (c.kind === 'money' && !c.options) throw new WorkError('INVALID', `${c.label}: this amount takes any currency`)
    const add = (cleanOptions(v, c.label) ?? []).map((x) => (c.kind === 'money' ? x.toUpperCase() : x))
    if (c.kind === 'money' && add.some((x) => !/^[A-Z]{3}$/.test(x))) throw new WorkError('INVALID', `${c.label}: currencies are 3-letter codes`)
    c.options = [...(c.options ?? []), ...add.filter((x) => !(c.options ?? []).some((o) => o.toLowerCase() === x.toLowerCase()))]
    if (c.options.length > FORM_LIMITS.options) throw new WorkError('INVALID', `${c.label}: at most ${FORM_LIMITS.options} options`)
  }
  const people = [...info.people]
  for (const p of list(b.addPeople, 'addPeople')) {
    const n = cleanText(p, FORM_LIMITS.option, 'person')
    if (!people.some((x) => x.toLowerCase() === n.toLowerCase())) people.push(n)
  }
  if (people.length > FORM_LIMITS.people) throw new WorkError('INVALID', `at most ${FORM_LIMITS.people} people`)
  if (b.add !== undefined) {
    const added: Array<Record<string, unknown>> = list(b.add, 'add').map((c) => ({ ...(c && typeof c === 'object' ? (c as Record<string, unknown>) : {}), required: false }))
    if (added.some((c) => c.kind === 'items')) throw new WorkError('INVALID', 'an items column cannot be added later')
    const probe = cleanFormDef({ name: 'x', shape, people: people.length ? people : undefined, columns: [...cols.map((c) => ({ label: c.label, kind: c.kind, options: c.options, ...(c.items ? { items: c.items } : {}) })), ...added] })
    cols.push(...probe.info.columns.slice(cols.length))
  }
  if (cols.length > FORM_LIMITS.columns) throw new WorkError('INVALID', `a form has at most ${FORM_LIMITS.columns} columns`)
  if (new Set(cols.map((c) => c.label.toLowerCase())).size !== cols.length) throw new WorkError('INVALID', 'two columns have the same name')
  const out: FormInfo = { ...info, columns: cols, people }
  if (b.hint !== undefined) { if (typeof b.hint === 'string' && b.hint.trim()) out.hint = b.hint.trim().slice(0, FORM_LIMITS.hint); else delete out.hint }
  return out
}

export function assertSchemaGrowsOnly(before: SheetSchema, after: SheetSchema): void {
  const next = new Map(after.columns.map((c) => [c.name, c]))
  for (const c of before.columns) {
    const n = next.get(c.name)
    if (!n || n.type !== c.type || !!n.encrypted !== !!c.encrypted || (!c.required && n.required)) throw new WorkError('INVALID', `column ${c.name.slice(0, 20)} cannot change`)
  }
  const old = new Set(before.columns.map((c) => c.name))
  for (const c of after.columns) if (!old.has(c.name) && c.required) throw new WorkError('INVALID', 'a new column is optional')
}

export async function deleteForm(deps: FormDeps, i: { userId: string; isOwner: boolean; formId: unknown }): Promise<{ id: string; deletedAt: Date }> {
  if (!i.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner deletes forms')
  return deps.db.$transaction(async (tx) => {
    await lockAccount(tx, i.userId)
    const f = await lockForm(tx, i.userId, i.formId)
    if (f.deletedAt) return { id: f.id, deletedAt: f.deletedAt }
    assertProjectWritable(await lockProjectForWrite(tx, i.userId, f.projectId))
    const deletedAt = new Date()
    await tx.workForm.update({ where: { id: f.id }, data: { deletedAt } })
    return { id: f.id, deletedAt }
  })
}

export async function restoreForm(deps: FormDeps, i: { userId: string; isOwner: boolean; formId: unknown }): Promise<{ id: string }> {
  if (!i.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner restores forms')
  const limit = await formLimitOf(deps.db, i.userId)
  return deps.db.$transaction(async (tx) => {
    await lockAccount(tx, i.userId)
    const f = await lockForm(tx, i.userId, i.formId)
    if (!f.deletedAt) return { id: f.id }
    if (f.deletedAt.getTime() < Date.now() - FORM_LIMITS.keepDays * 24 * 3600 * 1000) throw new WorkError('NOT_FOUND', 'the form was deleted more than 30 days ago')
    assertProjectWritable(await lockProjectForWrite(tx, i.userId, f.projectId))
    await assertNameFree(tx, f.projectId, f.name, f.id)
    if (limit !== null && (await liveCount(tx, f.projectId)) >= limit) throw new WorkError('FORM_LIMIT', `at most ${limit} forms on this plan`)
    await tx.workForm.update({ where: { id: f.id }, data: { deletedAt: null } })
    return { id: f.id }
  })
}

export async function purgeDeletedForms(db: PrismaClient, now = new Date(), limit = 50): Promise<number> {
  const old = await db.workForm.findMany({ where: { deletedAt: { lt: new Date(now.getTime() - FORM_LIMITS.keepDays * 24 * 3600 * 1000) } }, select: { id: true, userId: true, projectId: true, sheetId: true }, take: limit, orderBy: { deletedAt: 'asc' } })
  let n = 0
  for (const f of old) {
    await db.$transaction(async (tx) => {
      await lockAccount(tx, f.userId)
      const still = await lockForm(tx, f.userId, f.id).catch(() => null)
      if (!still?.deletedAt || still.deletedAt.getTime() >= now.getTime() - FORM_LIMITS.keepDays * 24 * 3600 * 1000) return
      await lockProjectForWrite(tx, f.userId, f.projectId)
      await tx.dataSheet.delete({ where: { id: f.sheetId } })
      n++
    })
  }
  return n
}

const BILLS: Record<WorkLang, { name: string; cols: [string, string, string, string, string, string, string, string, string]; what: string[] }> = {
  en: { name: 'Family bills', cols: ['From', 'What', 'For whom', 'Bill date', 'Due date', 'Amount', 'Bill number', 'Paid', 'Note'], what: ['Phone · internet', 'Insurance', 'School', 'Utilities', 'Rent', 'Other'] },
  de: { name: 'Familienrechnungen', cols: ['Von', 'Was', 'Für wen', 'Rechnungsdatum', 'Fällig am', 'Betrag', 'Rechnungsnummer', 'Bezahlt', 'Notiz'], what: ['Telefon · Internet', 'Versicherung', 'Schule', 'Nebenkosten', 'Miete', 'Andere'] },
  fr: { name: 'Factures de la famille', cols: ['De', 'Quoi', 'Pour qui', 'Date de facture', 'Échéance', 'Montant', 'Numéro de facture', 'Payé', 'Note'], what: ['Téléphone · internet', 'Assurance', 'École', 'Charges', 'Loyer', 'Autre'] },
  ko: { name: '가족 청구서', cols: ['보낸 곳', '무엇', '누구 몫', '청구 날짜', '낼 날', '금액', '청구 번호', '낸 것', '메모'], what: ['통신', '보험', '학교', '공과금', '집세', '기타'] },
}

const OTHERS_NAME: Record<string, string> = { en: 'Others', de: 'Sonstiges', fr: 'Autres', ko: '기타' }

export function defaultOthersForm(lang: WorkLang): { name: string; shape: FormShape; columns: unknown[]; people: string[] } {
  const b = BILLS[lang] ?? BILLS.en
  const [from, what, , billDate, , amount, no, , note] = b.cols
  return {
    name: OTHERS_NAME[lang] ?? OTHERS_NAME.en,
    shape: 'single',
    people: [],
    columns: [
      { label: from, kind: 'text', hint: 'the company or person who issued the document' },
      { label: what, kind: 'text', hint: 'what this document is, in a few words' },
      { label: billDate, kind: 'date' },
      { label: amount, kind: 'money' },
      { label: no, kind: 'text', hint: 'the invoice or reference number on the document' },
      { label: note, kind: 'longtext' },
    ],
  }
}

export function defaultBillsForm(lang: WorkLang, me: string): { name: string; shape: FormShape; columns: unknown[]; people: string[] } {
  const b = BILLS[lang] ?? BILLS.en
  const [from, what, who, billDate, due, amount, no, paid, note] = b.cols
  return {
    name: b.name,
    shape: 'single',
    people: [me],
    columns: [
      { label: from, kind: 'text', hint: 'the company or person who sent the bill' },
      { label: what, kind: 'choice', options: b.what },
      { label: who, kind: 'person', hint: 'whose bill it is' },
      { label: billDate, kind: 'date' },
      { label: due, kind: 'date', hint: 'the day the bill must be paid' },
      { label: amount, kind: 'money' },
      { label: no, kind: 'text', hint: 'the invoice or reference number on the bill' },
      { label: paid, kind: 'yesno', hint: 'leave empty unless the document says it is paid' },
      { label: note, kind: 'longtext' },
    ],
  }
}

export async function addFormMoreFilesColumn(db: PrismaClient, opts: { apply: boolean }): Promise<{ forms: number; changed: number }> {
  const forms = await db.workForm.findMany({ select: { sheetId: true } })
  let changed = 0
  for (const { sheetId } of forms) {
    await db.$transaction(async (tx) => {
      const row = await tx.$queryRaw<Array<{ schema: string }>>`SELECT schema FROM data_sheets WHERE id = ${sheetId} FOR UPDATE`
      if (!row.length) return
      const schema = JSON.parse(row[0].schema) as SheetSchema
      if (schema.columns.some((c) => c.name === FORM_MORE_FILES_COLUMN)) return
      changed++
      if (opts.apply) await tx.dataSheet.update({ where: { id: sheetId }, data: { schema: JSON.stringify({ ...schema, columns: [...schema.columns, { name: FORM_MORE_FILES_COLUMN, type: 'string' }] }) } })
    })
  }
  return { forms: forms.length, changed }
}

