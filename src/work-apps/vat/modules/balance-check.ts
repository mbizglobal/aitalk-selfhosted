
import { WorkError } from '@/lib/work/errors'
import type { ActionWorkModule, ModuleRunCtx, ScreenRows, ScreenRowsCtx } from '@/lib/work/modules'
import { readProjectSheet, type SheetRowView } from '@/lib/work/sheet-gate'
import { reconcileBalance, type BalanceCheck } from '../bank/balance'
import { normalizeAmount } from '../bank/parse-csv'
import { formatCents, parseCents } from '../estv'
import { VAT_FAMILY } from '../templates'

export interface BalanceCheckOutput {
  period: { start: string; end: string }
  accounts: Array<{ accountKey: string; rows: number; source: 'sheet' | 'chain' | 'none' } & BalanceCheck>
}

interface Move { date: string; amount: string; direction: 'in' | 'out'; balanceAfter: string | null }

export function chainEnds(moves: readonly Move[]): { opening: string; closing: string; openingDate: string; closingDate: string } | null {
  if (moves.length === 0 || moves.some((m) => m.balanceAfter == null)) return null
  const rows = moves.map((m) => {
    const after = parseCents(m.balanceAfter!)
    return { date: m.date, before: after - (m.direction === 'in' ? parseCents(m.amount) : -parseCents(m.amount)), after }
  })
  const dates = rows.map((r) => r.date).sort()
  const firstDay = dayEnds(rows.filter((r) => r.date === dates[0]))
  const lastDay = dayEnds(rows.filter((r) => r.date === dates[dates.length - 1]))
  if (!firstDay || !lastDay) return null
  return { opening: formatCents(firstDay.first.before), closing: formatCents(lastDay.last.after), openingDate: dates[0], closingDate: dates[dates.length - 1] }
}

const DAY_PATH_MAX = 8

function dayEnds<T extends { before: bigint; after: bigint }>(day: T[]): { first: T; last: T } | null {
  if (day.length === 1) return { first: day[0], last: day[0] }
  if (day.length > DAY_PATH_MAX) return null
  const found = new Set<string>()
  let ends: { first: T; last: T } | null = null
  const used = new Array<boolean>(day.length).fill(false)
  const walk = (path: number[]) => {
    if (found.size > 1) return
    if (path.length === day.length) {
      const v = `${day[path[0]].before}>${day[path[path.length - 1]].after}`
      if (!found.has(v)) { found.add(v); ends = { first: day[path[0]], last: day[path[path.length - 1]] } }
      return
    }
    const tail = path.length ? day[path[path.length - 1]].after : null
    for (let i = 0; i < day.length; i++) {
      if (used[i] || (tail !== null && day[i].before !== tail)) continue
      used[i] = true; path.push(i); walk(path); path.pop(); used[i] = false
    }
  }
  walk([])
  return found.size === 1 ? ends : null
}

const SEVERITY: Record<string, number> = { ok: 0, no_data: 1, mismatch: 2 }

type AccountCheck = BalanceCheckOutput['accounts'][number] & {
  ends: { opening: { date: string; amount: string; rowId?: string }; closing: { date: string; amount: string; rowId?: string } } | null
}

export function checkPeriod(period: { start: string; end: string }, accounts: readonly string[], balances: readonly SheetRowView[], txs: readonly SheetRowView[]): AccountCheck[] {
  const inPeriod = (d: string) => d >= period.start && d <= period.end
  const sheetBalance = (acct: string, kind: 'opening' | 'closing') => {
    const hits = balances
      .filter((b) => b.data.accountKey === acct && b.data.kind === kind && inPeriod(String(b.data.date)))
      .sort((a, b) => (String(a.data.date) < String(b.data.date) ? -1 : 1))
    const hit = kind === 'opening' ? hits[0] : hits[hits.length - 1]
    return hit ? { date: String(hit.data.date), amount: String(hit.data.amount), rowId: hit.id } : null
  }
  return [...accounts].sort().map((acct) => {
    const all: Move[] = txs
      .filter((t) => t.data.accountKey === acct && inPeriod(String(t.data.date)))
      .map((t) => ({ date: String(t.data.date), amount: String(t.data.amount), direction: t.data.direction as 'in' | 'out', balanceAfter: t.data.balanceAfter == null ? null : normalizeAmount(String(t.data.balanceAfter)) }))
    const o = sheetBalance(acct, 'opening')
    const c = sheetBalance(acct, 'closing')
    if ((o && !c) || (!o && c) || (o && c && o.date > c.date)) return { accountKey: acct, rows: all.length, source: 'sheet' as const, ends: null, ...reconcileBalance(null, null, all) }
    if (o && c) {
      const moves = all.filter((m) => m.date >= o.date && m.date <= c.date)
      return { accountKey: acct, rows: moves.length, source: 'sheet' as const, ends: { opening: o, closing: c }, ...reconcileBalance(o.amount, c.amount, moves) }
    }
    const e = chainEnds(all)
    if (e) return { accountKey: acct, rows: all.length, source: 'chain' as const, ends: { opening: { date: e.openingDate, amount: e.opening }, closing: { date: e.closingDate, amount: e.closing } }, ...reconcileBalance(e.opening, e.closing, all) }
    return { accountKey: acct, rows: all.length, source: 'none' as const, ends: null, ...reconcileBalance(null, null, all) }
  })
}

export async function familyRows(ctx: ScreenRowsCtx, family: string): Promise<SheetRowView[]> {
  const sheets = await ctx.deps.db.dataSheet.findMany({
    where: { kind: 'project', projectId: ctx.projectId, userId: ctx.userId, templateFamily: family },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const out: SheetRowView[] = []
  for (const s of sheets) out.push(...(await readProjectSheet(ctx.deps, { userId: ctx.userId, projectId: ctx.projectId, sheetId: s.id })).rows)
  return out
}

export const balanceCheckModule: ActionWorkModule<ModuleRunCtx> = {
  id: 'bank.balance-check',
  version: 1,
  kind: 'check',
  title: { en: 'Bank balance check', de: 'Saldoabgleich', fr: 'Contrôle des soldes', ko: '계좌 잔액 대조' },
  description: {
    en: 'For each account: opening balance + movements in the task period = closing balance.',
    de: 'Pro Konto: Anfangssaldo + Bewegungen der Periode = Schlusssaldo.',
    fr: 'Pour chaque compte : solde initial + mouvements de la période = solde final.',
    ko: '계좌마다 업무 기간의 시작 잔액 + 움직임 = 끝 잔액인지 본다.',
  },
  input: { type: 'object', additionalProperties: false, required: ['taskId'], properties: { taskId: { type: 'string' }, accountKey: { type: 'string' } } },
  output: { type: 'object' },
  needs: ['bank.accounts>=1', 'bank.balances>=1', 'vat.transactions>=1'],

  async screenRows(ctx: ScreenRowsCtx): Promise<ScreenRows> {
    const tasks = await ctx.deps.db.workTask.findMany({ where: { projectId: ctx.projectId, userId: ctx.userId, periodStart: { not: null }, periodEnd: { not: null } }, select: { periodStart: true, periodEnd: true }, orderBy: [{ periodStart: 'asc' }, { id: 'asc' }] })
    if (tasks.length === 0) return { virtual: [], notes: {} }
    const accounts = (await familyRows(ctx, VAT_FAMILY.accounts)).map((r) => String(r.data.accountKey))
    const balances = await familyRows(ctx, VAT_FAMILY.balances)
    const txs = await familyRows(ctx, VAT_FAMILY.transactions)
    const out: ScreenRows = { virtual: [], notes: {} }
    for (const t of tasks) {
      const period = { start: t.periodStart!.toISOString().slice(0, 10), end: t.periodEnd!.toISOString().slice(0, 10) }
      for (const a of checkPeriod(period, accounts, balances, txs)) {
        if (!a.ends) continue
        const result = { status: a.status, ...(a.status === 'mismatch' ? { diff: a.diff } : {}), source: a.source }
        for (const kind of ['opening', 'closing'] as const) {
          const e = a.ends[kind]
          if (e.rowId) { const cur = out.notes[e.rowId]; if (!cur || SEVERITY[result.status] > SEVERITY[cur.status]) out.notes[e.rowId] = result; continue }
          const key = `${a.accountKey}|${e.date}|${kind}`
          const at = out.virtual.findIndex((v) => v.key === key)
          const row = { key, data: { accountKey: a.accountKey, date: e.date, kind, amount: e.amount }, ...result }
          if (at < 0) out.virtual.push(row)
          else if (SEVERITY[result.status] > SEVERITY[out.virtual[at].status]) out.virtual[at] = row
        }
      }
    }
    return out
  },

  async run(ctx: ModuleRunCtx, raw: unknown): Promise<BalanceCheckOutput> {
    const o = (raw ?? {}) as Record<string, unknown>
    if (typeof o !== 'object' || Array.isArray(o)) throw new WorkError('INVALID', 'module input must be an object')
    for (const k of Object.keys(o)) if (k !== 'taskId' && k !== 'accountKey') throw new WorkError('INVALID', `unknown input ${k}`)
    if (typeof o.taskId !== 'string') throw new WorkError('INVALID', 'taskId is required')
    if (o.accountKey !== undefined && typeof o.accountKey !== 'string') throw new WorkError('INVALID', 'accountKey must be text')
    const task = await ctx.deps.db.workTask.findFirst({ where: { id: o.taskId, projectId: ctx.projectId, userId: ctx.userId }, select: { periodStart: true, periodEnd: true } })
    if (!task) throw new WorkError('NOT_FOUND')
    if (!task.periodStart || !task.periodEnd) throw new WorkError('INVALID', 'the task has no period')
    const period = { start: task.periodStart.toISOString().slice(0, 10), end: task.periodEnd.toISOString().slice(0, 10) }

    const accounts = (await familyRows(ctx, VAT_FAMILY.accounts)).map((r) => String(r.data.accountKey))
    const wanted = o.accountKey === undefined ? accounts : accounts.filter((a) => a === o.accountKey)
    if (o.accountKey !== undefined && wanted.length === 0) throw new WorkError('NOT_FOUND')
    const balances = await familyRows(ctx, VAT_FAMILY.balances)
    const txs = await familyRows(ctx, VAT_FAMILY.transactions)
    return { period, accounts: checkPeriod(period, wanted, balances, txs).map(({ ends: _ends, ...a }) => a) }
  },
}
