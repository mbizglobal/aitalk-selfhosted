
import { Prisma, type PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import {
  ASSEMBLED_KIND, NUMBER_COLUMN, STATUS_COLUMN, appSendKindOk, appSendSourceKind, readSpec, specSheetName,
  type AppSpec, type SpecAppSend, type SpecIssue, type SpecTable,
} from './assembled'
import { decryptJson } from './sealed'

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

export const appSendSlot = (key: string) => `asend:${key}`
export const APP_SEND_HOLD = ['pending', 'sent'] as const

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim())
const NO_TARGET_KINDS = new Set(['person', 'ref', 'computed'])

export const liveAppSend = (a: AppSpec, s: SpecAppSend) => !s.hidden && !!a.tables.find((t) => t.key === s.table && !t.hidden)

export function appSendTargetProblem(b: AppSpec | null, a: SpecTable, s: SpecAppSend): string | null {
  if (!b) return 'that app is not an assembled app'
  const bt = b.tables.find((x) => x.key === s.to.table)
  if (!bt) return `"${s.to.table}" is not a table of that app`
  if (bt.hidden) return `"${s.to.table}" of that app is hidden`
  for (const [bk, ak] of Object.entries(s.map)) {
    const bc = bt.columns.find((x) => x.key === bk)
    if (!bc) return `"${bk}" is not a column of "${s.to.table}" of that app`
    if (bc.hidden) return `"${bk}" of "${s.to.table}" of that app is hidden`
    if (NO_TARGET_KINDS.has(bc.kind)) return `"${bk}" of that app is a ${bc.kind} column — it cannot be filled from another app`
    const from = appSendSourceKind(a, ak)
    if (!from) return `"${ak}" is not a visible stored column of "${a.key}"`
    if (!appSendKindOk(bc.kind, from)) return `"${ak}" (${from === 'serial' ? 'number block' : from}) cannot go into "${bk}" (${bc.kind})`
  }
  const missing = bt.columns.filter((c) => c.required && !c.hidden && c.kind !== 'computed' && !(c.key in s.map)).map((c) => c.key)
  if (missing.length) return `the required column(s) ${missing.join(', ')} of "${s.to.table}" of that app are not in map`
  return null
}

export async function appSendLineOpen(db: Db, q: { userId: string; fromWorkflowId: string | null; toWorkflowId: string | null; table: string }): Promise<boolean> {
  if (!q.fromWorkflowId || !q.toWorkflowId) return false
  const { findSendRoutes } = await import('./app-send')
  return (await findSendRoutes(db, q.userId, q.fromWorkflowId)).some((r) => r.toWorkflowId === q.toWorkflowId && r.family === specSheetName(q.table))
}

export async function appSendIssues(tx: Tx, key: Buffer, q: { userId: string; projectId: string; before: AppSpec | null; after: AppSpec }): Promise<SpecIssue[]> {
  const out: SpecIssue[] = []
  const projects = await tx.workProject.findMany({ where: { userId: q.userId, kind: ASSEMBLED_KIND, status: 'active' }, select: { id: true, workflowId: true } })
  const wf = new Map(projects.map((p) => [p.id, p.workflowId]))
  const specs = new Map<string, AppSpec | null>([[q.projectId, q.after]])
  const load = async (pid: string): Promise<AppSpec | null> => {
    if (!specs.has(pid)) {
      const r = wf.has(pid) ? await tx.workAppSpec.findFirst({ where: { userId: q.userId, projectId: pid }, select: { info: true } }) : null
      specs.set(pid, r ? decryptJson<AppSpec>(Buffer.from(r.info), key) : null)
    }
    return specs.get(pid)!
  }
  const me = wf.get(q.projectId) ?? (await tx.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { workflowId: true } }))?.workflowId ?? null
  // (1)
  for (const [i, s] of (q.after.appSends ?? []).entries()) {
    if (!liveAppSend(q.after, s)) continue
    const was = q.before?.appSends?.find((x) => x.key === s.key)
    if (was && q.before && liveAppSend(q.before, was) && JSON.stringify(was.to) === JSON.stringify(s.to) && JSON.stringify(was.map) === JSON.stringify(s.map)) continue
    const p = `appSends[${i}]`
    if (s.to.app === q.projectId) { out.push({ path: `${p}.to.app`, code: 'BAD_REF', message: 'to.app is this app — a send goes to another assembled app' }); continue }
    const a = q.after.tables.find((t) => t.key === s.table)!
    const why = wf.has(s.to.app) ? appSendTargetProblem(await load(s.to.app), a, s) : 'that app is not an open assembled app of this account'
    if (why) { out.push({ path: `${p}.to`, code: 'BAD_REF', message: why }); continue }
    if (!(await appSendLineOpen(tx, { userId: q.userId, fromWorkflowId: me, toWorkflowId: wf.get(s.to.app) ?? null, table: s.to.table }))) {
      out.push({ path: `${p}.to.app`, code: 'NO_LINE', message: `draw a send line on the canvas from this app to that app, choose "${s.to.table}" as its inbox and deploy — then save this again` })
    }
  }
  // (2)
  if (q.before) {
    for (const p of projects) {
      if (p.id === q.projectId) continue
      const as = await load(p.id)
      for (const s of as?.appSends ?? []) {
        if (s.to.app !== q.projectId || !liveAppSend(as!, s)) continue
        const a = as!.tables.find((t) => t.key === s.table)!
        if (appSendTargetProblem(q.before, a, s) !== null) continue
        const why = appSendTargetProblem(q.after, a, s)
        if (!why) continue
        if (!(await appSendLineOpen(tx, { userId: q.userId, fromWorkflowId: p.workflowId, toWorkflowId: me, table: s.to.table }))) continue
        const ti = q.after.tables.findIndex((x) => x.key === s.to.table)
        out.push({ path: ti >= 0 ? `tables[${ti}]` : 'tables', code: 'APP_SEND_IN_USE', message: `the app "${as!.name}" sends rows here with "${s.label}" — hide that send there first (${why})` })
      }
    }
  }
  return out
}

const statusOf = (t: SpecTable, data: Readonly<Record<string, unknown>>) => (blank(data[STATUS_COLUMN]) ? t.status?.start ?? null : String(data[STATUS_COLUMN]))

export function appSendBlocked(t: SpecTable, s: SpecAppSend, data: Readonly<Record<string, unknown>>, confirmed: boolean): string | null {
  const a = s.allowWhen
  if (!a) return null
  if (a.status) {
    const st = statusOf(t, data)
    if (!st || !a.status.includes(st)) return `"${s.label}" is only for rows in ${a.status.join(', ')}`
  }
  if (a.confirmed && !confirmed) return `"${s.label}" is only for confirmed rows`
  return null
}

export function buildAppSendRow(t: SpecTable, s: SpecAppSend, data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const bk of Object.keys(s.map).sort()) {
    const ak = s.map[bk]
    const v = ak === STATUS_COLUMN ? statusOf(t, data) : data[ak]
    if (blank(v)) continue
    out[bk] = v
    if (ak !== STATUS_COLUMN && ak !== NUMBER_COLUMN && t.columns.find((c) => c.key === ak)?.kind === 'money' && !blank(data[`${ak}_cur`])) out[`${bk}_cur`] = data[`${ak}_cur`]
  }
  return out
}

export function sameAppSendRow(x: Readonly<Record<string, unknown>>, y: Readonly<Record<string, unknown>>): boolean {
  const norm = (r: Readonly<Record<string, unknown>>) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]))
  return norm(x) === norm(y)
}

export function appSendRowProblem(bt: SpecTable, row: Readonly<Record<string, unknown>>): string | null {
  if (!Object.keys(row).length) return 'every column this send fills is empty on this row'
  for (const c of bt.columns) {
    if (c.hidden || c.kind === 'computed') continue
    if (c.required && blank(row[c.key])) return `"${c.label}" is required in "${bt.name}" but empty on this row`
    if (c.kind === 'choice' && !blank(row[c.key]) && !(c.options ?? []).includes(String(row[c.key]))) return `"${row[c.key]}" is not one of the choices of "${c.label}" in "${bt.name}"`
    if (c.kind === 'money' && c.options && !blank(row[`${c.key}_cur`]) && !c.options.includes(String(row[`${c.key}_cur`]).toUpperCase())) return `"${bt.name}" takes ${c.options.join(', ')} in "${c.label}", not ${row[`${c.key}_cur`]}`
  }
  return null
}

export function appSendColumns(bt: SpecTable, s: SpecAppSend): string[] {
  const out: string[] = []
  for (const bk of Object.keys(s.map)) {
    out.push(bk)
    if (bt.columns.find((c) => c.key === bk)?.kind === 'money') out.push(`${bk}_cur`)
  }
  return out
}

export async function appSendSourceRow(db: Db, q: { userId: string; projectId: string; table: string; rowId: string }) {
  if (typeof q.rowId !== 'string' || !q.rowId) return null
  return db.dataSheetRow.findFirst({ where: { id: q.rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(q.table), template: null } } })
}

export type AppSendMark = { status: 'sent' | 'pending'; number?: string; to?: string; at?: string; sendId: string }
export async function appSendMarks(db: Db, key: Buffer, q: { userId: string; projectId: string; rowIds?: readonly string[]; sends?: readonly string[]; limit?: number }): Promise<Map<string, Record<string, AppSendMark>>> {
  const detail = !!q.rowIds
  const rows = await db.workSend.findMany({
    where: { userId: q.userId, projectId: q.projectId, kind: 'work_app', status: { in: [...APP_SEND_HOLD] }, ref: q.rowIds ? { in: [...q.rowIds] } : { not: null }, slot: q.sends ? { in: q.sends.map(appSendSlot) } : { startsWith: 'asend:' } },
    select: { id: true, slot: true, ref: true, status: true, decidedAt: true, result: detail, payload: detail },
    orderBy: { createdAt: 'desc' },
    ...(q.limit ? { take: q.limit } : {}),
  })
  const out = new Map<string, Record<string, AppSendMark>>()
  for (const r of rows) {
    if (!r.ref) continue
    const m = out.get(r.ref) ?? {}
    const k = r.slot.slice('asend:'.length)
    if (m[k]) continue
    let number: string | undefined
    let to: string | undefined
    if (detail) {
      try { if (r.status === 'sent' && r.result) number = decryptJson<{ numbers?: Array<string | null> }>(r.result, key).numbers?.[0] ?? undefined } catch { number = undefined }
      try { if (r.payload) to = decryptJson<{ appSend?: { toLabel?: string } }>(r.payload, key).appSend?.toLabel } catch { to = undefined }
    }
    m[k] = { status: r.status as 'sent' | 'pending', sendId: r.id, ...(number ? { number } : {}), ...(to ? { to } : {}), ...(r.decidedAt ? { at: r.decidedAt.toISOString() } : {}) }
    out.set(r.ref, m)
  }
  return out
}

export async function appSendTarget(db: Db, key: Buffer, q: { userId: string; toProjectId: string }): Promise<{ projectId: string; workflowId: string; spec: AppSpec; version: number } | null> {
  const p = await db.workProject.findFirst({ where: { id: q.toProjectId, userId: q.userId }, select: { id: true, kind: true, status: true, workflowId: true } })
  if (!p || p.kind !== ASSEMBLED_KIND || p.status !== 'active' || !p.workflowId) return null
  const sp = await readSpec(db, key, { userId: q.userId, projectId: p.id })
  return sp ? { projectId: p.id, workflowId: p.workflowId, spec: sp.spec, version: sp.version } : null
}

