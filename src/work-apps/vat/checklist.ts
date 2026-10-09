
import type { ChecklistItem, ScreenRowsCtx } from '@/lib/work/package-api'
import { checkPeriod, familyRows } from './modules/balance-check'
import { VAT_FAMILY, VAT_SHEET_TEMPLATES } from './templates'

const BALANCE_MODULE = 'bank.balance-check'

export async function vatChecklist(ctx: ScreenRowsCtx & { modules: readonly string[] }, period: { start: string; end: string }): Promise<ChecklistItem[]> {
  const inPeriod = (d: unknown) => typeof d === 'string' && d.slice(0, 10) >= period.start && d.slice(0, 10) <= period.end
  const [accountRows, txAll, basisRows, balances, invoiceRows] = await Promise.all([
    familyRows(ctx, VAT_FAMILY.accounts),
    familyRows(ctx, VAT_FAMILY.transactions),
    familyRows(ctx, VAT_FAMILY.basis),
    familyRows(ctx, VAT_FAMILY.balances),
    familyRows(ctx, VAT_FAMILY.invoices),
  ])
  const from = (r: (typeof basisRows)[number]) => String(r.data.from ?? '')
  const changes = basisRows.some((r) => from(r) > period.start && from(r) <= period.end)
  const basis = basisRows.filter((r) => from(r) !== '' && from(r) <= period.start).sort((a, b) => (from(a) < from(b) ? 1 : -1))[0]
  const agreed = !changes && basis?.data.basis === 'agreed'
  const bankTodo: ChecklistItem['state'] = agreed ? 'warn' : 'todo'
  const accounts = [...new Set(accountRows.map((r) => r.data.accountKey).filter((v): v is string => typeof v === 'string' && v !== ''))].sort()
  const txs = txAll.filter((r) => inPeriod(r.data.date))
  const items: ChecklistItem[] = []

  items.push(accounts.length ? { id: 'accounts', state: 'ok', params: { n: accounts.length } } : { id: 'accounts', state: bankTodo, goto: { family: VAT_FAMILY.accounts } })

  const missing = accounts.filter((a) => !txs.some((t) => t.data.accountKey === a))
  if (accounts.length) items.push(missing.length ? { id: 'statements', state: bankTodo, params: { accounts: missing.join(', ') }, goto: 'files' } : { id: 'statements', state: 'ok', params: { n: txs.length } })

  const unconfirmed = txs.filter((t) => t.confirmed === false).length
  items.push(!txs.length ? { id: 'tx_none', state: bankTodo, goto: 'files' }
    : unconfirmed ? { id: 'tx_confirm', state: 'todo', params: { n: unconfirmed }, goto: { family: VAT_FAMILY.transactions } }
    : { id: 'tx_confirm', state: 'ok', params: { n: txs.length } })

  const warn = VAT_SHEET_TEMPLATES.find((t) => t.family === VAT_FAMILY.transactions)?.submitWarning
  const receipts = warn ? txs.filter((t) => warn(t.data)).length : 0
  if (txs.length) items.push(receipts ? { id: 'receipts', state: 'warn', params: { n: receipts }, goto: { family: VAT_FAMILY.transactions } } : { id: 'receipts', state: 'ok' })

  if (ctx.modules.includes(BALANCE_MODULE) && accounts.length) {
    const r = checkPeriod(period, accounts, balances, txAll)
    const bad = r.filter((a) => a.status === 'mismatch')
    const none = r.filter((a) => a.status === 'no_data')
    items.push(bad.length ? { id: 'balance', state: 'todo', params: { accounts: bad.map((a) => `${a.accountKey} (${a.status === 'mismatch' ? a.diff : ''})`).join(', ') }, goto: { family: VAT_FAMILY.balances } }
      : none.length ? { id: 'balance', state: 'warn', params: { accounts: none.map((a) => a.accountKey).join(', ') }, goto: { family: VAT_FAMILY.balances } }
      : { id: 'balance', state: 'ok', params: { n: r.length } })
  }

  if (agreed) {
    const invs = invoiceRows.filter((r) => inPeriod(r.data.taxDate) && !/^-?0+(\.0+)?$/.test(String(r.data.amountGross ?? '')))
    const open = invs.filter((r) => r.confirmed === false).length
    items.push(!invs.length ? { id: 'invoices_none', state: 'todo', goto: { family: VAT_FAMILY.invoices } }
      : open ? { id: 'invoices_confirm', state: 'todo', params: { n: open }, goto: { family: VAT_FAMILY.invoices } }
      : { id: 'invoices', state: 'ok', params: { n: invs.length } })
  }

  items.push(changes ? { id: 'basis_change', state: 'todo', goto: { family: VAT_FAMILY.basis } }
    : !basis ? { id: 'basis', state: 'todo', goto: { family: VAT_FAMILY.basis } }
    : basis.confirmed === false ? { id: 'basis_confirm', state: 'todo', goto: { family: VAT_FAMILY.basis } }
    : { id: 'basis', state: 'ok' })
  return items
}
