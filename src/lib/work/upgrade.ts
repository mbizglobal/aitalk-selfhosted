import { Prisma } from '@prisma/client'
import { appTemplateOf } from './app-templates'
import { WorkError } from './errors'
import { runAppTemplateCalc, prepareCalc, writeWorkEvent } from './projects'
import { computeReferenceViews, lockForSubmit } from './references'
import { decodeRow, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { assertColumnsOnlyAdded, findTemplate, templateId, templateSchema, type SheetTemplate } from './sheet-templates'
import type { SheetSchema } from './sheet-columns'
import { describeCaughtError } from '@/lib/log-mask'
import { fillSearchCopies } from './search-copy'

type Tx = Prisma.TransactionClient
const TX_TIMEOUT_MS = 30_000
const CHECK_CHUNK = 1000
const MAX_ATTEMPTS = 3
export const UPGRADE_ACTOR: SheetActor = { type: 'module', id: 'core.upgrade', version: 1 }

export interface SheetChange { sheetId: string; name: string; from: string; to: string; schema: SheetSchema }
export interface UpgradePlan {
  kind: string
  sheets: SheetChange[]
  create: Array<{ name: string; template: string }>
  modules: { next: string[]; seen: string[]; enabled: string[] } | null
  recount: string[]
  held: Array<{ sheetId?: string; template?: string; code: string; detail: string }>
}
export type UpgradeResult =
  | { status: 'none' }
  | { status: 'upgraded'; plan: UpgradePlan; attempts: number }
  | { status: 'held'; plan: UpgradePlan; code: 'ROW_CHECK' | 'CALC_DIFFERS' | 'BUSY' | 'NOTHING_SAFE'; detail: string }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function canonical(schema: SheetSchema): string {
  const sortKeys = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
  const cols = [...schema.columns].map((c) => sortKeys(c as unknown as Record<string, unknown>)).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return JSON.stringify({ columns: cols, unique: schema.unique ?? null })
}
const familyOf = (id: string) => id.slice(0, id.lastIndexOf('@'))
const versionOf = (id: string) => Number(id.slice(id.lastIndexOf('@') + 1))

export async function planProjectUpgrade(db: Tx | WorkSheetDeps['db'], templates: readonly SheetTemplate[], q: { userId: string; projectId: string }): Promise<UpgradePlan | null> {
  const proj = await db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, status: true, modules: true, modulesSeen: true } })
  if (!proj || proj.status !== 'active') return null
  const app = appTemplateOf(proj.kind)
  const sheets = await db.dataSheet.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'project', template: { not: null } }, select: { id: true, name: true, template: true, templateFamily: true, schema: true }, orderBy: { id: 'asc' } })
  const plan: UpgradePlan = { kind: proj.kind, sheets: [], create: [], modules: null, recount: [], held: [] }
  const appTarget = new Map((app?.sheets ?? []).map((s) => [familyOf(s.template), s.template]))

  for (const s of sheets) {
    let cur: SheetTemplate
    try { cur = findTemplate(templates, s.template!) } catch { plan.held.push({ sheetId: s.id, code: 'TEMPLATE_UNKNOWN', detail: s.template! }); continue }
    let target = cur
    const want = appTarget.get(cur.name)
    if (want && versionOf(want) > cur.version) {
      let t: SheetTemplate
      try { t = findTemplate(templates, want) } catch { plan.held.push({ sheetId: s.id, template: want, code: 'TEMPLATE_UNKNOWN', detail: want }); continue }
      if (t.upgrade === 'safe') target = t
      else plan.held.push({ sheetId: s.id, template: want, code: 'NOT_DECLARED_SAFE', detail: `${s.template} → ${want}` })
    }
    const stored = JSON.parse(s.schema) as SheetSchema
    const next = templateSchema(target)
    if (target === cur && canonical(stored) === canonical(next)) continue
    try {
      assertColumnsOnlyAdded(stored.columns, next.columns, templateId(target))
      if (!same(stored.unique ?? null, next.unique ?? null)) throw new WorkError('TEMPLATE_LOCKED', 'unique key differs')
    } catch (e) {
      plan.held.push({ sheetId: s.id, template: templateId(target), code: 'NOT_ADD_ONLY', detail: e instanceof WorkError ? (e.detail ?? e.code) : 'columns' })
      continue
    }
    plan.sheets.push({ sheetId: s.id, name: s.name, from: s.template!, to: templateId(target), schema: next })
  }

  if (app) {
    const have = new Set(sheets.map((s) => s.templateFamily))
    const names = new Set((await db.dataSheet.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'project' }, select: { name: true } })).map((s) => s.name))
    for (const s of app.sheets) {
      let t: SheetTemplate
      try { t = findTemplate(templates, s.template) } catch { plan.held.push({ template: s.template, code: 'TEMPLATE_UNKNOWN', detail: s.template }); continue }
      if (have.has(t.family)) continue
      if (names.has(s.name)) { plan.held.push({ template: s.template, code: 'NAME_TAKEN', detail: s.name }); continue }
      plan.create.push({ name: s.name, template: s.template })
      names.add(s.name)
      have.add(t.family)
    }
    const seen = Array.isArray(proj.modulesSeen) ? (proj.modulesSeen as unknown[]).filter((m): m is string => typeof m === 'string') : null
    const tpl = [...app.modules]
    const added = seen ? tpl.filter((m) => !seen.includes(m)) : []
    const enabled = added.filter((m) => !proj.modules.includes(m))
    if (!seen || added.length || !same([...seen].sort(), [...tpl].sort())) {
      plan.modules = { next: [...proj.modules, ...enabled], seen: tpl, enabled }
    }
  }
  const counts = await db.$queryRaw<Array<{ id: string }>>`
    SELECT d.id FROM data_sheets d WHERE d.project_id = ${q.projectId} AND d.user_id = ${q.userId}
      AND d.row_count IS DISTINCT FROM (SELECT count(*) FROM data_sheet_rows r WHERE r.sheet_id = d.id)
    ORDER BY d.id`
  plan.recount = counts.map((c) => c.id)
  return hasWork(plan) ? plan : (plan.held.length ? plan : null)
}

const hasWork = (p: UpgradePlan) => p.sheets.length > 0 || p.create.length > 0 || p.modules !== null || p.recount.length > 0

async function checkRows(deps: WorkSheetDeps, key: Buffer, q: { userId: string; projectId: string }, changes: readonly SheetChange[]): Promise<{ sheetId: string; rowId: string; why: string } | null> {
  for (const c of changes) {
    const t = findTemplate(deps.templates, c.to)
    if (!t.checkRow) continue
    let after: string | undefined
    for (;;) {
      const rows = await deps.db.dataSheetRow.findMany({
        where: { sheetId: c.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' }, take: CHECK_CHUNK,
      })
      if (!rows.length) break
      for (const r of rows) {
        const why = t.checkRow(decodeRow(r, key).data)
        if (why) return { sheetId: c.sheetId, rowId: r.id, why }
      }
      after = rows[rows.length - 1].id
    }
  }
  return null
}

async function calcAll(tx: Tx, deps: WorkSheetDeps, key: Buffer, q: { userId: string; projectId: string }, tasks: ReadonlyArray<{ id: string; periodStart: Date | null; periodEnd: Date | null }>, references: Parameters<typeof computeReferenceViews>[4]) {
  const proj = await tx.workProject.findUniqueOrThrow({ where: { id: q.projectId }, select: { kind: true, modules: true, settings: true } })
  const calc = appTemplateOf(proj.kind)?.calcModule
  if (!calc || !tasks.length) return []
  const computed = await computeReferenceViews(tx, key, deps.templates, q.userId, references)
  const out: string[] = []
  const modes = calc.preview ? (['preview', 'submit'] as const) : (['submit'] as const)
  for (const task of tasks) {
    for (const mode of modes) {
      try {
        const run = await runAppTemplateCalc(tx, deps, key, { userId: q.userId, projectId: q.projectId, taskId: task.id, task, proj, computed, moduleInput: {} }, mode)
        out.push(JSON.stringify({ task: task.id, mode, output: run.output, unconfirmed: [...run.unconfirmed].sort() }))
      } catch (e) {
        if (!(e instanceof WorkError)) throw e
        out.push(JSON.stringify({ task: task.id, mode, stop: `${e.code}:${e.detail ?? ''}` }))
      }
    }
  }
  return out
}

async function applySheets(tx: Tx, templates: readonly SheetTemplate[], q: { userId: string; projectId: string }, plan: UpgradePlan) {
  for (const c of plan.sheets) {
    const t = findTemplate(templates, c.to)
    await tx.dataSheet.update({ where: { id: c.sheetId }, data: { template: c.to, templateFamily: t.family, schema: JSON.stringify(c.schema) } })
  }
  for (const s of plan.create) {
    const t = findTemplate(templates, s.template)
    await tx.dataSheet.create({ data: { kind: 'project', userId: q.userId, projectId: q.projectId, name: s.name, schema: JSON.stringify(templateSchema(t)), template: templateId(t), templateFamily: t.family, searchVer: t.search?.version ?? 0 } })
  }
}

async function applyRest(tx: Tx, key: Buffer, q: { userId: string; projectId: string }, plan: UpgradePlan) {
  if (plan.modules) await tx.workProject.update({ where: { id: q.projectId }, data: { modules: plan.modules.next, modulesSeen: plan.modules.seen } })
  await tx.$executeRaw`
    UPDATE data_sheets s SET row_count = c.n
    FROM (SELECT d.id, (SELECT count(*) FROM data_sheet_rows r WHERE r.sheet_id = d.id)::int AS n FROM data_sheets d WHERE d.project_id = ${q.projectId} AND d.user_id = ${q.userId}) c
    WHERE s.id = c.id AND s.row_count IS DISTINCT FROM c.n`
  await writeWorkEvent(tx, key, {
    userId: q.userId, projectId: q.projectId, actor: UPGRADE_ACTOR, action: 'template_upgrade',
    detail: { sheets: plan.sheets.map((c) => ({ sheetId: c.sheetId, from: c.from, to: c.to })), created: plan.create.map((s) => s.template), modulesEnabled: plan.modules?.enabled ?? [] },
  })
}

class CalcDiffers extends Error {}
class Busy extends Error {}

export async function upgradeProject(deps: WorkSheetDeps, q: { userId: string; projectId: string }): Promise<UpgradeResult> {
  const first = await planProjectUpgrade(deps.db, deps.templates, q)
  if (!first) return { status: 'none' }
  if (!hasWork(first)) return { status: 'held', plan: first, code: 'NOTHING_SAFE', detail: first.held.map((h) => h.code).join(',') }
  const key = await deps.dataKey(deps.db, q.userId)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const plan = await planProjectUpgrade(deps.db, deps.templates, q)
    if (!plan || !hasWork(plan)) return { status: 'none' }
    const seq0 = (await deps.db.workProjectChange.findUnique({ where: { projectId: q.projectId }, select: { seq: true } }))?.seq ?? null
    const bad = await checkRows(deps, key, q, plan.sheets)
    if (bad) {
      const now = (await deps.db.workProjectChange.findUnique({ where: { projectId: q.projectId }, select: { seq: true } }))?.seq ?? null
      if (now !== seq0) continue
      return { status: 'held', plan, code: 'ROW_CHECK', detail: `${bad.sheetId}/${bad.rowId}: ${bad.why}` }
    }
    const openTasks = await deps.db.workTask.findMany({ where: { projectId: q.projectId, userId: q.userId, status: 'open', periodStart: { not: null }, periodEnd: { not: null } }, select: { id: true, periodStart: true, periodEnd: true }, orderBy: { id: 'asc' } })
    for (const t of openTasks) await prepareCalc(deps, q.userId, t.id, q.projectId)
    try {
      await deps.db.$transaction(async (tx) => {
        const { references } = await lockForSubmit(tx, q.userId, q.projectId)
        const seq = (await tx.workProjectChange.findUnique({ where: { projectId: q.projectId }, select: { seq: true } }))?.seq ?? null
        if (seq !== seq0) throw new Busy()
        const again = await planProjectUpgrade(tx, deps.templates, q)
        if (!again || !same(again.sheets.map((c) => [c.sheetId, c.to, c.schema]), plan.sheets.map((c) => [c.sheetId, c.to, c.schema])) || !same(again.create, plan.create) || !same(again.modules, plan.modules) || !same(again.recount, plan.recount)) throw new Busy()
        if (plan.sheets.length || plan.create.length) {
          const before = await calcAll(tx, deps, key, q, openTasks, references)
          await applySheets(tx, deps.templates, q, plan)
          const after = await calcAll(tx, deps, key, q, openTasks, references)
          if (!same(before, after)) throw new CalcDiffers(`${before.length} open task(s) — the calculation result would change`)
        }
        await applyRest(tx, key, q, plan)
      }, { timeout: TX_TIMEOUT_MS })
      return { status: 'upgraded', plan, attempts: attempt }
    } catch (e) {
      if (e instanceof CalcDiffers) return { status: 'held', plan, code: 'CALC_DIFFERS', detail: e.message }
      if (e instanceof Busy) continue
      throw e
    }
  }
  return { status: 'held', plan: first, code: 'BUSY', detail: `changed during ${MAX_ATTEMPTS} attempts` }
}

const running = new Set<string>()
const heldPlans = new Map<string, string>()
export function scheduleProjectUpgrade(deps: WorkSheetDeps, q: { userId: string; projectId: string }): void {
  if (running.has(q.projectId)) return
  running.add(q.projectId)
  void (async () => {
    try {
      const fill = await fillSearchCopies(deps, q)
      if (fill.filled || fill.broken) console.log(`[work-search] filled project=${q.projectId} rows=${fill.filled} broken=${fill.broken} skipped=${fill.skipped}`)
      const plan = await planProjectUpgrade(deps.db, deps.templates, q)
      if (!plan) return
      const seq = (await deps.db.workProjectChange.findUnique({ where: { projectId: q.projectId }, select: { seq: true } }))?.seq ?? null
      const sig = JSON.stringify([String(seq), plan.sheets.map((c) => [c.sheetId, c.to]), plan.create, plan.modules, plan.recount, plan.held.map((h) => h.code)])
      if (heldPlans.get(q.projectId) === sig) return
      const r = await upgradeProject(deps, q)
      if (r.status === 'held') { heldPlans.set(q.projectId, sig); console.warn(`[work-upgrade] held project=${q.projectId} code=${r.code} ${r.detail}`) }
      else if (r.status === 'upgraded') console.log(`[work-upgrade] upgraded project=${q.projectId} sheets=${r.plan.sheets.length} created=${r.plan.create.length} modules=${r.plan.modules?.enabled.length ?? 0}`)
    } catch (e) {
      console.error('[work-upgrade] failed', describeCaughtError(e))
    } finally {
      running.delete(q.projectId)
    }
  })()
}
