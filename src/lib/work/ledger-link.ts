import type { Prisma } from '@prisma/client'
import { WorkError } from './errors'
import { decryptJson } from './sealed'
import { fingerprint, readProjectReferences, type ReferenceReader } from './references'
import { findTemplate } from './sheet-templates'
import { readProjectSheet, type SheetRowView, type WorkSheetDeps } from './sheet-gate'
import { recordWorkAppProposal, type WorkAppProposal } from './app-scope'
import { visibleTo } from './app-chat'

type Tx = Prisma.TransactionClient

export const LEDGER_LINES = 'ledger.lines'
export const LEDGER_EXPLANATIONS = 'ledger.explanations'
export const LEDGER_PROPOSE = 'ledger.propose'
export const LEDGER_LINK_MAX = 50

const APPS: Record<string, { kinds: Record<string, string>; back: readonly string[] }> = {
  receipts: { kinds: { supplier_bill: 'receipts.bills', receipts: 'receipts.receipts', expense_claim: 'receipts.claims' }, back: ['receipts.bills', 'receipts.receipts'] },
  invoices: { kinds: { customer_payment: 'invoices.invoices' }, back: ['invoices.invoices', 'invoices.customers', 'invoices.payments'] },
  'swiss-acc-invoice': { kinds: { customer_payment: 'swiss-acc.invoice.invoices' }, back: ['swiss-acc.invoice.invoices', 'swiss-acc.invoice.customers', 'swiss-acc.invoice.payments'] },
}

const KIND_BACK: Readonly<Record<string, string>> = { expense_claim: 'receipts.claims' }

export interface LedgerLinkAllocation { rowId: string; amountLine: string; amountTarget?: string; partKey?: string; replaces?: { paymentRowId: string }; separateFrom?: string[] }
export interface LedgerLinkItem { accountKey: string; lineKey: string; kind: string; allocations: LedgerLinkAllocation[]; chosen?: true }
export type LedgerLinkCard = Extract<WorkAppProposal, { type: 'ledger_link' }>
export type LedgerLinkSkip = { accountKey: string; lineKey: string; reason: string }
export interface LedgerLinkOwnUpdate { rowId: string; patch: Record<string, string>; confirm: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/
const positive = (v: string) => AMOUNT.test(v) && /[1-9]/.test(v)

export function normalizeLinkItems(appKind: string, raw: unknown): LedgerLinkItem[] {
  const app = APPS[appKind]
  if (!app) throw new WorkError('INVALID', 'this work app does not link bank lines')
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LEDGER_LINK_MAX) throw new WorkError('INVALID', `a bank link card holds 1 to ${LEDGER_LINK_MAX} lines`)
  const seen = new Set<string>()
  return raw.map((x, i) => {
    if (!isObj(x) || typeof x.accountKey !== 'string' || !x.accountKey || typeof x.lineKey !== 'string' || !x.lineKey) throw new WorkError('INVALID', `items[${i}] needs accountKey and lineKey`)
    const k = `${x.accountKey}|${x.lineKey}`
    if (seen.has(k)) throw new WorkError('INVALID', `items[${i}]: the same bank line twice — put both targets in one item`)
    seen.add(k)
    if (typeof x.kind !== 'string' || !(x.kind in app.kinds)) throw new WorkError('INVALID', `items[${i}]: kind must be ${Object.keys(app.kinds).join(' or ')}`)
    if (!Array.isArray(x.allocations) || x.allocations.length === 0 || x.allocations.length > 100) throw new WorkError('INVALID', `items[${i}]: allocations must list 1 to 100 targets`)
    const allocations = x.allocations.map((a, j) => {
      if (!isObj(a) || typeof a.rowId !== 'string' || !a.rowId || typeof a.amountLine !== 'string' || !positive(a.amountLine)) throw new WorkError('INVALID', `items[${i}].allocations[${j}] needs rowId and amountLine`)
      if (a.amountTarget !== undefined && (typeof a.amountTarget !== 'string' || !positive(a.amountTarget))) throw new WorkError('INVALID', `items[${i}].allocations[${j}].amountTarget`)
      if (a.partKey !== undefined && (typeof a.partKey !== 'string' || !a.partKey || a.partKey.length > 200)) throw new WorkError('INVALID', `items[${i}].allocations[${j}].partKey`)
      if (a.replaces !== undefined && (!isObj(a.replaces) || typeof a.replaces.paymentRowId !== 'string' || !a.replaces.paymentRowId)) throw new WorkError('INVALID', `items[${i}].allocations[${j}].replaces`)
      if (a.separateFrom !== undefined && (!Array.isArray(a.separateFrom) || a.separateFrom.length === 0 || a.separateFrom.length > 20 || a.separateFrom.some((x) => typeof x !== 'string' || !x))) throw new WorkError('INVALID', `items[${i}].allocations[${j}].separateFrom`)
      return {
        rowId: a.rowId, amountLine: a.amountLine, ...(a.amountTarget !== undefined ? { amountTarget: a.amountTarget as string } : {}),
        ...(a.partKey !== undefined ? { partKey: a.partKey as string } : {}),
        ...(a.replaces !== undefined ? { replaces: { paymentRowId: (a.replaces as { paymentRowId: string }).paymentRowId } } : {}),
        ...(a.separateFrom !== undefined ? { separateFrom: [...(a.separateFrom as string[])] } : {}),
      }
    })
    if (x.chosen !== undefined && typeof x.chosen !== 'boolean') throw new WorkError('INVALID', `items[${i}].chosen`)
    return { accountKey: x.accountKey, lineKey: x.lineKey, kind: x.kind, allocations, ...(x.chosen === true ? { chosen: true as const } : {}) }
  })
}

export function normalizeOwn(raw: unknown, items: readonly LedgerLinkItem[]): LedgerLinkOwnUpdate[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > LEDGER_LINK_MAX * 5) throw new WorkError('INVALID', 'own updates must be a list')
  const targets = new Set(items.flatMap((it) => it.allocations.map((a) => a.rowId)))
  const seen = new Set<string>()
  return raw.map((u, i) => {
    if (!isObj(u) || typeof u.rowId !== 'string' || !targets.has(u.rowId)) throw new WorkError('INVALID', `own[${i}] must update a row of this card`)
    if (seen.has(u.rowId)) throw new WorkError('INVALID', `own[${i}]: the same row twice`)
    seen.add(u.rowId)
    const patch = isObj(u.patch) ? u.patch : {}
    const keys = Object.keys(patch)
    if (keys.length > 5 || keys.some((k) => !/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k) || typeof patch[k] !== 'string' || (patch[k] as string).length > 200)) throw new WorkError('INVALID', `own[${i}].patch`)
    if (typeof u.confirm !== 'boolean') throw new WorkError('INVALID', `own[${i}].confirm`)
    return { rowId: u.rowId, patch: patch as Record<string, string>, confirm: u.confirm }
  }).filter((u) => Object.keys(u.patch).length > 0 || u.confirm)
}

export function sameLink(item: LedgerLinkItem, data: Readonly<Record<string, unknown>>): boolean {
  if (data.kind !== item.kind || !Array.isArray(data.allocations)) return false
  const opt = (v: unknown) => (v === undefined || v === null || v === '' ? '' : String(v))
  const key = (a: { rowId?: unknown; amountLine?: unknown; amountTarget?: unknown; partKey?: unknown; replaces?: unknown; separateFrom?: unknown }) =>
    [String(a.rowId), String(a.amountLine), opt(a.amountTarget), opt(a.partKey), isObj(a.replaces) ? opt(a.replaces.paymentRowId) : '', Array.isArray(a.separateFrom) ? a.separateFrom.map(String).sort().join(',') : ''].join('|')
  const have = (data.allocations as Array<Record<string, unknown>>).filter((a) => a && 'rowId' in a).map(key).sort()
  const want = item.allocations.map(key).sort()
  return (data.allocations as unknown[]).length === want.length && have.length === want.length && have.every((x, i) => x === want[i])
}

type Db = Pick<Tx, 'projectReference' | 'workProject'>

export async function findLedgerPair(db: Db, q: { userId: string; projectId: string }): Promise<{ appKind: string; ledgerProjectId: string } | { appKind: string | null; need: string[] }> {
  const me = await db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true } })
  if (!me) throw new WorkError('NOT_FOUND')
  const app = APPS[me.kind]
  if (!app) return { appKind: null, need: ['this work app does not link bank lines'] }
  const out = await db.projectReference.findMany({ where: { userId: q.userId, fromProjectId: q.projectId }, select: { toProjectId: true, sheets: true, includeUnconfirmed: true } })
  const ledgerIds = new Set((await db.workProject.findMany({ where: { userId: q.userId, id: { in: out.map((r) => r.toProjectId) }, kind: 'ledger' }, select: { id: true } })).map((p) => p.id))
  const reads = out.filter((r) => ledgerIds.has(r.toProjectId))
  if (reads.length === 0) return { appKind: me.kind, need: ['a reference line from the Bank ledger to this work app'] }
  if (reads.length > 1) return { appKind: me.kind, need: ['only one Bank ledger may be linked'] }
  const r = reads[0]
  const need: string[] = []
  for (const s of [LEDGER_LINES, LEDGER_EXPLANATIONS]) if (!r.sheets.includes(s)) need.push(`the reference line from the Bank ledger must read ${s}`)
  if (!r.includeUnconfirmed) need.push('the reference line from the Bank ledger must include unconfirmed rows')
  const back = await db.projectReference.findFirst({ where: { userId: q.userId, fromProjectId: r.toProjectId, toProjectId: q.projectId }, select: { sheets: true, includeUnconfirmed: true } })
  if (!back) need.push('a reference line from this work app to the Bank ledger')
  else {
    for (const s of app.back) if (!back.sheets.includes(s)) need.push(`the reference line to the Bank ledger must read ${s}`)
    if (!back.includeUnconfirmed) need.push('the reference line to the Bank ledger must include unconfirmed rows')
  }
  return need.length ? { appKind: me.kind, need } : { appKind: me.kind, ledgerProjectId: r.toProjectId }
}

interface LinkState {
  lines: Map<string, { line: SheetRowView | null; expl: SheetRowView | null }>
  targets: Map<string, { row: SheetRowView; family: string }>
  related: SheetRowView[]
}

export async function readLinkState(deps: WorkSheetDeps, q: { userId: string; projectId: string; ledgerProjectId: string; items: readonly LedgerLinkItem[]; reader?: ReferenceReader }): Promise<LinkState> {
  const reader = q.reader ?? await readProjectReferences(deps, { userId: q.userId, projectId: q.projectId })
  const ref = reader.references().find((r) => r.sourceProjectId === q.ledgerProjectId)
  if (!ref) throw new WorkError('STALE', 'the reference line to the Bank ledger is gone')
  const rowsOf = (family: string) => reader.sheets(ref.referenceId).filter((s) => s.family === family).flatMap((s) => reader.rows(ref.referenceId, s.id))
  const lineBy = new Map(rowsOf(LEDGER_LINES).map((r) => [`${String(r.data.accountKey)}|${String(r.data.lineKey)}`, r]))
  const explBy = new Map(rowsOf(LEDGER_EXPLANATIONS).map((r) => [`${String(r.data.accountKey)}|${String(r.data.lineKey)}`, r]))
  const lines = new Map(q.items.map((it) => { const k = `${it.accountKey}|${it.lineKey}`; return [k, { line: lineBy.get(k) ?? null, expl: explBy.get(k) ?? null }] }))
  const want = new Set(q.items.flatMap((it) => it.allocations.map((a) => a.rowId)))
  const related = [...explBy.entries()]
    .filter(([k, e]) => !lines.has(k) && Array.isArray(e.data.allocations) && (e.data.allocations as Array<{ rowId?: unknown }>).some((a) => a && typeof a.rowId === 'string' && want.has(a.rowId)))
    .map(([, e]) => e)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const targets = new Map<string, { row: SheetRowView; family: string }>()
  const sheets = await deps.db.dataSheet.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'project' }, select: { id: true, template: true } })
  for (const s of sheets) {
    const family = s.template ? findTemplate(deps.templates, s.template)?.family : undefined
    if (!family || !Object.values(APPS).some((a) => Object.values(a.kinds).includes(family))) continue
    for (const r of (await readProjectSheet(deps, { userId: q.userId, projectId: q.projectId, sheetId: s.id })).rows) if (want.has(r.id)) targets.set(r.id, { row: r, family })
  }
  return { lines, targets, related }
}

export function explFingerprints(key: Buffer, items: readonly LedgerLinkItem[], st: LinkState): string[] {
  return items.map((it) => { const e = st.lines.get(`${it.accountKey}|${it.lineKey}`)?.expl; return e ? fingerprint(key, 'ledger_link_expl', e.data) : 'none' })
}

export function linkFingerprint(key: Buffer, q: { projectId: string; ledgerProjectId: string; items: readonly LedgerLinkItem[]; expl: readonly string[]; own?: readonly LedgerLinkOwnUpdate[] }, st: LinkState): string {
  const ids = [...new Set(q.items.flatMap((it) => it.allocations.map((a) => a.rowId)))].sort()
  return fingerprint(key, 'ledger_link', {
    p: q.projectId,
    l: q.ledgerProjectId,
    items: q.items,
    expl: q.expl,
    own: q.own ?? [],
    lines: q.items.map((it) => st.lines.get(`${it.accountKey}|${it.lineKey}`)?.line?.data ?? null),
    targets: ids.map((id) => { const t = st.targets.get(id); return t ? { id, d: t.row.data, c: t.row.confirmed } : { id, gone: true } }),
    related: st.related.map((e) => ({ id: e.id, d: e.data, c: e.confirmed })),
  })
}

function targetProblem(appKind: string, it: LedgerLinkItem, st: LinkState): string | null {
  const family = APPS[appKind].kinds[it.kind]
  for (const a of it.allocations) {
    const t = st.targets.get(a.rowId)
    if (!t || t.family !== family) return 'target_missing'
  }
  return null
}

function cardRows(items: readonly LedgerLinkItem[], st: LinkState, own: readonly LedgerLinkOwnUpdate[] = []): Array<{ date: string; amount: string; currency: string; counterparty: string; target: string; chosen: boolean; fix?: string; replacesHand?: true }> {
  const fixOf = new Map(own.map((u) => [u.rowId, Object.values(u.patch)[0]]))
  const pick = (d: Readonly<Record<string, unknown>>, keys: readonly string[]) => keys.map((k) => d[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return items.map((it) => {
    const l = st.lines.get(`${it.accountKey}|${it.lineKey}`)?.line?.data ?? {}
    const target = it.allocations.map((a) => {
      const d = st.targets.get(a.rowId)?.row.data ?? {}
      return [pick(d, ['billNumber', 'number', 'claimKey']), pick(d, ['supplier', 'merchant', 'customerName', 'person'])].filter(Boolean).join(' · ') || a.rowId
    }).join(' + ')
    const fix = it.allocations.map((a) => fixOf.get(a.rowId)).find((x) => !!x)
    const replacesHand = it.allocations.some((a) => !!a.replaces)
    return { date: String(l.date ?? ''), amount: String(l.amount ?? ''), currency: String(l.currency ?? ''), counterparty: String(l.counterparty ?? '').slice(0, 80), target: target.slice(0, 160), chosen: it.chosen === true, ...(fix ? { fix } : {}), ...(replacesHand ? { replacesHand: true as const } : {}) }
  })
}

export async function ledgerLinkSetup(deps: WorkSheetDeps, q: { userId: string; projectId: string }): Promise<string[] | null> {
  const pair = await findLedgerPair(deps.db, q)
  return 'need' in pair ? pair.need : null
}

export async function buildLedgerLinkCard(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string; items: unknown; own?: unknown; detail: string; reader?: ReferenceReader },
): Promise<{ card: LedgerLinkCard | null; skipped: LedgerLinkSkip[]; setup?: string[] }> {
  const pair = await findLedgerPair(deps.db, q)
  if ('need' in pair) return { card: null, skipped: [], setup: pair.need }
  const items = normalizeLinkItems(pair.appKind, q.items)
  const st = await readLinkState(deps, { ...q, ledgerProjectId: pair.ledgerProjectId, items })
  const skipped: LedgerLinkSkip[] = []
  const keep: LedgerLinkItem[] = []
  for (const it of items) {
    const s = st.lines.get(`${it.accountKey}|${it.lineKey}`)!
    const skip = (reason: string) => skipped.push({ accountKey: it.accountKey, lineKey: it.lineKey, reason })
    if (!s.line) { skip('line_missing'); continue }
    if (s.expl?.confirmed) { skip('confirmed'); continue }
    if (s.expl && s.expl.data.kind !== it.kind) { skip('other_kind'); continue }
    const tp = targetProblem(pair.appKind, it, st)
    if (tp) { skip(tp); continue }
    keep.push(it)
  }
  const extra = [...new Set(keep.map((it) => KIND_BACK[it.kind]).filter((x): x is string => !!x))]
  if (extra.length) {
    const back = await deps.db.projectReference.findFirst({ where: { userId: q.userId, fromProjectId: pair.ledgerProjectId, toProjectId: q.projectId }, select: { sheets: true } })
    const missing = extra.filter((x) => !back?.sheets.includes(x))
    if (missing.length) {
      const blocked = keep.filter((it) => missing.includes(KIND_BACK[it.kind]))
      for (const it of blocked) skipped.push({ accountKey: it.accountKey, lineKey: it.lineKey, reason: `setup — the reference line to the Bank ledger must read ${KIND_BACK[it.kind]}` })
      keep.splice(0, keep.length, ...keep.filter((it) => !blocked.includes(it)))
      if (keep.length === 0) return { card: null, skipped, setup: missing.map((x) => `the reference line to the Bank ledger must read ${x}`) }
    }
  }
  if (keep.length === 0) return { card: null, skipped }
  const kept = await readLinkState(deps, { ...q, ledgerProjectId: pair.ledgerProjectId, items: keep })
  const key = await deps.dataKey(deps.db, q.userId)
  const expl = explFingerprints(key, keep, kept)
  const keptTargets = new Set(keep.flatMap((it) => it.allocations.map((a) => a.rowId)))
  const own = normalizeOwn(Array.isArray(q.own) ? (q.own as Array<{ rowId?: unknown }>).filter((u) => typeof u?.rowId === 'string' && keptTargets.has(u.rowId)) : q.own, keep)
  return {
    card: {
      type: 'ledger_link',
      ledgerProjectId: pair.ledgerProjectId,
      items: keep,
      expl,
      ...(own.length ? { own } : {}),
      fingerprint: linkFingerprint(key, { projectId: q.projectId, ledgerProjectId: pair.ledgerProjectId, items: keep, expl, own }, kept),
      count: keep.length,
      replaces: keep.filter((it) => kept.lines.get(`${it.accountKey}|${it.lineKey}`)?.expl).length,
      rows: cardRows(keep, kept, own),
      detail: q.detail.slice(0, 1500),
    },
    skipped,
  }
}

export async function proposeLedgerLink(deps: WorkSheetDeps, q: { userId: string; projectId: string; runId: string; items: unknown; own?: unknown; detail: string; reader?: ReferenceReader }) {
  const r = await buildLedgerLinkCard(deps, q)
  if (r.card && !recordWorkAppProposal(q.runId, r.card)) throw new WorkError('INVALID', 'no open conversation turn to show the card in')
  return { proposed: !!r.card, count: r.card?.count ?? 0, skipped: r.skipped, ...(r.setup ? { setup: r.setup } : {}) }
}

export async function ledgerLinkCardState(deps: WorkSheetDeps, q: { userId: string; projectId: string; card: LedgerLinkCard }): Promise<{ linked: number; total: number }> {
  const items = (q.card.items ?? []) as LedgerLinkItem[]
  let st: LinkState
  try {
    st = await readLinkState(deps, { userId: q.userId, projectId: q.projectId, ledgerProjectId: q.card.ledgerProjectId, items })
  } catch (e) {
    if (e instanceof WorkError && e.code === 'STALE') return { linked: 0, total: items.length }
    throw e
  }
  const linked = items.filter((it) => { const e = st.lines.get(`${it.accountKey}|${it.lineKey}`)?.expl; return e?.confirmed === true && sameLink(it, e.data) }).length
  return { linked, total: items.length }
}

export async function storedLedgerLinkCard(deps: WorkSheetDeps, q: { userId: string; projectId: string; messageId: string; index: number; reader: string | null }): Promise<LedgerLinkCard> {
  const m = await deps.db.workMessage.findFirst({ where: { id: q.messageId, projectId: q.projectId, userId: q.userId, role: 'assistant', ...visibleTo(q.reader) }, select: { body: true } })
  if (!m) throw new WorkError('NOT_FOUND')
  const body = decryptJson<{ proposals?: WorkAppProposal[] }>(m.body, await deps.dataKey(deps.db, q.userId))
  const p = body.proposals?.[q.index]
  if (!p || p.type !== 'ledger_link') throw new WorkError('NOT_FOUND')
  return p
}
