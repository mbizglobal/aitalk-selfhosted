import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKS, blocksForEdition, buildSpecMail, computeRow, computeSums, parseSpecNumber, specCounterName, specNumberFloors, specSendBlocked, validateSpec, specTableSchema, toFormInfo, type AppSpec } from './assembled'
import { alertDue } from './assembled-alerts'
import { workAppRegistry } from './registry'

const contracts = (): Record<string, unknown> => ({
  spec: 1,
  name: 'Contract renewals',
  about: 'Track supplier contracts.',
  tables: [{
    key: 'contracts',
    name: 'Contracts',
    columns: [
      { key: 'supplier', label: 'Supplier', kind: 'text', required: true },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'start', label: 'Start', kind: 'date' },
      { key: 'end', label: 'Expiry', kind: 'date', required: true },
      { key: 'owner', label: 'Owner', kind: 'person' },
      { key: 'auto', label: 'Auto-renew', kind: 'yesno' },
      { key: 'kind', label: 'Kind', kind: 'choice', options: ['Service', 'Lease'] },
    ],
    confirm: { by: 'column:owner' },
  }],
})
const ok = (raw: unknown, before: AppSpec | null = null): AppSpec => {
  const r = validateSpec(raw, before)
  if (!r.ok) assert.fail(JSON.stringify(r.issues))
  return r.spec
}
const codes = (raw: unknown, before: AppSpec | null = null, usage: Parameters<typeof validateSpec>[2] = null): string[] => {
  const r = validateSpec(raw, before, usage)
  return r.ok ? [] : r.issues.map((x) => x.code)
}

test('contract renewals (L1 part) passes and sheet columns keep their keys', () => {
  const s = ok(contracts())
  const schema = specTableSchema(s.tables[0])
  assert.deepEqual(schema.columns.map((c) => c.name), ['supplier', 'amount', 'amount_cur', 'start', 'end', 'owner', 'auto', 'kind', 'file', 'moreFileIds'])
  assert.equal(schema.columns.find((c) => c.name === 'owner')?.encrypted, true)
  assert.equal(schema.columns.find((c) => c.name === 'end')?.type, 'date')
})

test('all problems at once — path and reason', () => {
  const raw = contracts() as { tables: Array<Record<string, unknown>> }
  raw.tables[0].columns = [{ key: 'Bad Key', label: 'A', kind: 'text' }, { key: 'b', label: 'a', kind: 'nope' }]
  raw.tables[0].confirm = { by: 'column:missing' }
  const r = validateSpec(raw)
  assert.equal(r.ok, false)
  if (r.ok) return
  const got = r.issues.map((x) => `${x.path}:${x.code}`)
  assert.ok(got.includes('tables[0].columns[0].key:BAD_KEY'))
  assert.ok(got.includes('tables[0].columns[1].label:DUPLICATE'))
  assert.ok(got.includes('tables[0].columns[1].kind:BAD_KIND'))
  assert.ok(got.includes('tables[0].confirm.by:BAD_REF'))
})

test('unknown fields are refused, never silently dropped · all 10 blocks usable', () => {
  assert.ok(codes({ ...contracts(), color: 'red' }).includes('UNKNOWN_FIELD'))
  assert.ok(BLOCKS.every((b) => b.available), 'L4 뒤에는 아직 없는 블록이 없다')
})

test('edge values — empty table · empty columns · all hidden · limits', () => {
  assert.ok(codes({ ...contracts(), tables: [] }).includes('REQUIRED'))
  assert.ok(codes({ spec: 1, name: 'x', tables: [{ key: 't', name: 'T', columns: [] }] }).includes('REQUIRED'))
  assert.ok(codes({ spec: 1, name: 'x', tables: [{ key: 't', name: 'T', columns: [{ key: 'a', label: 'A', kind: 'text', hidden: true }] }] }).includes('REQUIRED'))
  assert.ok(codes({ spec: 1, name: 'x', tables: [{ key: 't', name: 'T', hidden: true, columns: [{ key: 'a', label: 'A', kind: 'text' }] }] }).includes('REQUIRED'))
  const many = Array.from({ length: 31 }, (_, i) => ({ key: `c${i}`, label: `C${i}`, kind: 'text' }))
  assert.ok(codes({ spec: 1, name: 'x', tables: [{ key: 't', name: 'T', columns: many }] }).includes('TOO_MANY'))
  assert.ok(codes({ spec: 2, name: 'x', tables: [{ key: 't', name: 'T', columns: [{ key: 'a', label: 'A', kind: 'text' }] }] }).includes('INVALID'))
  assert.ok(codes(null).includes('INVALID'))
  assert.ok(codes([]).includes('INVALID'))
})

test('keys that clash with server columns — money _cur · original file column', () => {
  const clash = { spec: 1, name: 'x', tables: [{ key: 't', name: 'T', columns: [{ key: 'amount', label: 'Amount', kind: 'money' }, { key: 'amount_cur', label: 'Cur', kind: 'text' }] }] }
  assert.ok(codes(clash).includes('KEY_CLASH'))
  assert.ok(codes({ spec: 1, name: 'x', tables: [{ key: 't', name: 'T', columns: [{ key: 'file', label: 'F', kind: 'text' }] }] }).includes('RESERVED'))
  assert.ok(codes({ spec: 1, name: 'x', tables: [{ key: 't', name: 'T', columns: [{ key: 'morefileids', label: 'F', kind: 'text' }] }] }).includes('RESERVED'))
})

test('choice columns · currency', () => {
  const t = (c: Record<string, unknown>) => ({ spec: 1, name: 'x', tables: [{ key: 't', name: 'T', columns: [c] }] })
  assert.ok(codes(t({ key: 'a', label: 'A', kind: 'choice' })).includes('REQUIRED'))
  assert.ok(codes(t({ key: 'a', label: 'A', kind: 'choice', options: [] })).includes('INVALID'))
  assert.ok(codes(t({ key: 'a', label: 'A', kind: 'choice', options: ['x', 'X'] })).includes('DUPLICATE'))
  assert.ok(codes(t({ key: 'a', label: 'A', kind: 'text', options: ['x'] })).includes('INVALID'))
  assert.ok(codes(t({ key: 'a', label: 'A', kind: 'money', options: ['CHFX'] })).includes('INVALID'))
  assert.deepEqual(ok(t({ key: 'a', label: 'A', kind: 'money', options: ['chf', 'eur'] })).tables[0].columns[0].options, ['CHF', 'EUR'])
})

test('confirmer — person columns only · not hidden columns', () => {
  const base = contracts() as { tables: Array<Record<string, unknown>> }
  base.tables[0].confirm = { by: 'column:supplier' }
  assert.ok(codes(base).includes('BAD_REF'))
  const hid = contracts() as { tables: Array<{ columns: Array<Record<string, unknown>> }> }
  hid.tables[0].columns[4].hidden = true
  assert.ok(codes(hid).includes('BAD_REF'))
  assert.ok(codes({ ...contracts(), tables: [{ ...(contracts().tables as object[])[0], confirm: { by: 'everyone' } }] }).includes('INVALID'))
  assert.equal(ok({ ...contracts(), tables: [{ ...(contracts().tables as object[])[0], confirm: { by: 'owner' } }] }).tables[0].confirm?.by, 'owner')
})

test('change rules — no removing (hide) · no kind change · no new required · choices only grow', () => {
  const before = ok(contracts())
  const next = () => JSON.parse(JSON.stringify(contracts())) as { tables: Array<{ key: string; columns: Array<Record<string, unknown>> } & Record<string, unknown>> }

  const removed = next(); removed.tables[0].columns.splice(5, 1)
  assert.ok(codes(removed, before).includes('COLUMN_REMOVED'))
  const hidden = next(); hidden.tables[0].columns[5].hidden = true
  assert.equal(validateSpec(hidden, before).ok, true)

  const kind = next(); kind.tables[0].columns[5].kind = 'text'
  assert.ok(codes(kind, before).includes('KIND_CHANGED'))
  const req = next(); req.tables[0].columns[2].required = true
  assert.ok(codes(req, before).includes('REQUIRED_ADDED'))
  const newReq = next(); newReq.tables[0].columns.push({ key: 'note', label: 'Note', kind: 'longtext', required: true })
  assert.ok(codes(newReq, before).includes('NEW_REQUIRED'))
  const newOpt = next(); newOpt.tables[0].columns.push({ key: 'note', label: 'Note', kind: 'longtext' })
  assert.equal(validateSpec(newOpt, before).ok, true)

  const lost = next(); lost.tables[0].columns[6].options = ['Service']
  assert.ok(codes(lost, before).includes('OPTION_REMOVED'))
  const more = next(); more.tables[0].columns[6].options = ['Lease', 'Service', 'Licence']
  assert.equal(validateSpec(more, before).ok, true)
  const recase = next(); recase.tables[0].columns[6].options = ['lease', 'Service']
  assert.ok(codes(recase, before).includes('OPTION_REMOVED'))
  const cur = next(); cur.tables[0].columns[1].options = ['CHF']
  assert.ok(codes(cur, before).includes('CURRENCY_LIMIT_ADDED'))

  const gone = next(); gone.tables = [{ key: 'other', name: 'Other', columns: [{ key: 'a', label: 'A', kind: 'text' }] }]
  assert.ok(codes(gone, before).includes('TABLE_REMOVED'))
  const hideReq = next(); hideReq.tables[0].columns[0].hidden = true
  const h = ok(hideReq, before)
  assert.equal(h.tables[0].columns[0].required, undefined)
})

test('form shape — screen · person list the AI reads = team emails', () => {
  const s = ok(contracts())
  const info = toFormInfo(s.tables[0], ['owner@x.ch', 'anna@x.ch'])
  assert.deepEqual(info.people, ['owner@x.ch', 'anna@x.ch'])
  assert.equal(info.hint, undefined)
  assert.equal(info.columns.find((c) => c.key === 'owner')?.kind, 'person')
})

test('the registry has the assembled app shell (sheet templates · 0 modules)', () => {
  const r = workAppRegistry()
  const a = r.appTemplates.find((x) => x.kind === 'assembled')
  assert.ok(a)
  assert.equal(a!.sheets.length, 0)
  assert.equal(a!.modules.length, 0)
})

const withStatus = (status: unknown, number?: unknown) => ({ ...contracts(), tables: [{ ...(contracts().tables as object[])[0], status, ...(number !== undefined ? { number } : {}) }] })
const ST = { values: ['draft', 'active', 'renewing', 'ended'], start: 'draft', moves: [['draft', 'active'], ['active', 'renewing'], ['renewing', 'active'], { from: 'active', to: 'ended', by: 'owner' }, ['renewing', 'ended']], lockedIn: ['ended'] }

test('status — the design example passes and rows get status · number columns', () => {
  const s = ok(withStatus(ST, { prefix: 'CT-', year: true, digits: 3 }))
  assert.equal(s.tables[0].status?.moves.length, 5)
  assert.equal(s.tables[0].status?.moves[3].by, 'owner')
  const schema = specTableSchema(s.tables[0])
  const names = schema.columns.map((c) => c.name)
  assert.equal(names[0], 'number')
  assert.ok(names.includes('status'))
  assert.equal(schema.columns.find((c) => c.name === 'status')?.encrypted, undefined)
  assert.equal(schema.columns.find((c) => c.name === 'number')?.encrypted, undefined)
  const info = toFormInfo(s.tables[0], [])
  assert.deepEqual(info.columns.find((c) => c.key === 'status')?.options, ST.values)
})

test('status — trapped status · unreachable status · single value · wrong moves', () => {
  assert.ok(codes(withStatus({ ...ST, lockedIn: [] })).includes('DEAD_END'))
  assert.ok(codes(withStatus({ ...ST, moves: [['draft', 'active'], ['active', 'draft']], lockedIn: [] })).includes('UNREACHABLE'))
  assert.ok(codes(withStatus({ values: ['only'], start: 'only', moves: [] })).includes('REQUIRED'))
  assert.ok(codes(withStatus({ ...ST, start: 'nope' })).includes('BAD_REF'))
  assert.ok(codes(withStatus({ ...ST, moves: [...ST.moves, ['draft', 'draft']] })).includes('INVALID'))
  assert.ok(codes(withStatus({ ...ST, moves: [...ST.moves, ['draft', 'active']] })).includes('DUPLICATE'))
  assert.ok(codes(withStatus({ ...ST, moves: [...ST.moves, ['draft', 'gone']] })).includes('BAD_REF'))
  assert.ok(codes(withStatus({ ...ST, values: [...ST.values, 'Draft'] })).includes('DUPLICATE'))
  assert.ok(codes(withStatus({ ...ST, moves: [...ST.moves, { from: 'draft', to: 'ended', by: 'column:supplier' }] })).includes('BAD_REF'))
  assert.ok(codes(withStatus({ ...ST, color: 1 })).includes('UNKNOWN_FIELD'))
  assert.ok(codes(withStatus({ ...ST, moves: [] })).includes('REQUIRED'))
})

test('number — shape', () => {
  assert.equal(validateSpec(withStatus(ST, {})).ok, true)
  assert.ok(codes(withStatus(ST, { prefix: '-X' })).includes('INVALID'))
  assert.ok(codes(withStatus(ST, { prefix: 'A B' })).includes('INVALID'))
  assert.ok(codes(withStatus(ST, { digits: 0 })).includes('INVALID'))
  assert.ok(codes(withStatus(ST, { digits: 9 })).includes('INVALID'))
  assert.ok(codes(withStatus(ST, { year: 'yes' })).includes('INVALID'))
})

test('status · number — change rules (no removing · no used values)', () => {
  const before = ok(withStatus(ST, { prefix: 'CT-' }))
  assert.ok(codes(contracts(), before).includes('STATUS_REMOVED'))
  assert.ok(codes(withStatus(ST), before).includes('NUMBER_REMOVED'))
  const fewer = withStatus({ ...ST, values: ['draft', 'active', 'ended'], moves: [['draft', 'active'], ['active', 'ended']] }, { prefix: 'CT-' })
  assert.equal(validateSpec(fewer, before).ok, true)
  assert.ok(codes(fewer, before, { contracts: { renewing: 2 } }).includes('STATUS_VALUE_IN_USE'))
  assert.equal(validateSpec(fewer, before, { contracts: { draft: 3 } }).ok, true)
  const t = (k: string) => ({ spec: 1, name: 'x', tables: [{ key: 't', name: 'T', columns: [{ key: k, label: 'S', kind: 'text' }] }] })
  assert.ok(codes(t('status')).includes('RESERVED'))
  assert.ok(codes(t('number')).includes('RESERVED'))
})

const L2B = () => ({ spec: 1, name: 'Costs', tables: [{ key: 'costs', name: 'Costs', columns: [
  { key: 'what', label: 'What', kind: 'text' }, { key: 'kind', label: 'Kind', kind: 'choice', options: ['rent', 'it'] },
  { key: 'due', label: 'Due', kind: 'date' }, { key: 'net', label: 'Net', kind: 'money' }, { key: 'vat', label: 'VAT', kind: 'money' },
  { key: 'qty', label: 'Qty', kind: 'number' }, { key: 'qty2', label: 'Qty 2', kind: 'number' },
  { key: 'gross', label: 'Gross', kind: 'computed', block: 'sum', from: ['net', 'vat'] },
  { key: 'left', label: 'Days left', kind: 'computed', block: 'days_until', from: 'due' },
  { key: 'qd', label: 'Qty diff', kind: 'computed', block: 'diff', from: ['qty', 'qty2'] },
], status: { values: ['open', 'paid'], start: 'open', moves: [['open', 'paid']], lockedIn: ['paid'] },
  sums: [{ key: 'by_month', label: 'Net by month', column: 'net', by: 'month', date: 'due' }, { key: 'by_kind', label: 'Net by kind', column: 'net', by: 'column:kind', where: { status: ['open'] } }, { key: 'all', label: 'Qty', column: 'qty', by: 'all' }] }] })

test('computed columns · sums — pass · no computed columns in the sheet', () => {
  const sp = ok(L2B())
  const names = specTableSchema(sp.tables[0]).columns.map((c) => c.name)
  assert.ok(!names.includes('gross') && !names.includes('left') && names.includes('net'))
  assert.ok(!toFormInfo(sp.tables[0], []).columns.some((c) => c.key === 'gross'))
})

test('computed columns — wrong ones', () => {
  const t = (col: Record<string, unknown>) => { const x = L2B() as any; x.tables[0].columns.push(col); delete x.tables[0].sums; return x }
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'computed', block: 'days_until', from: 'net' })).includes('BAD_REF'))
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'computed', block: 'sum', from: ['net', 'qty'] })).includes('INVALID'))
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'computed', block: 'sum', from: ['net'] })).includes('INVALID'))
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'computed', block: 'diff', from: ['qty', 'qty2', 'qty'] })).includes('INVALID'))
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'computed', block: 'sum', from: ['gross', 'net'] })).includes('BAD_REF'))
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'computed', block: 'pow', from: 'due' })).includes('INVALID'))
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'computed' })).includes('REQUIRED'))
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'text', block: 'sum' })).includes('INVALID'))
  assert.ok(codes(t({ key: 'z', label: 'Z', kind: 'computed', block: 'days_until', from: 'due', required: true })).includes('INVALID'))
  const before = ok(L2B())
  const swap = L2B() as any; swap.tables[0].columns = swap.tables[0].columns.map((c: any) => (c.key === 'gross' ? { key: 'gross', label: 'Gross', kind: 'money', required: true } : c))
  assert.ok(codes(swap, before).includes('NEW_REQUIRED'))
  const big = ok(L2B()).tables[0]
  assert.equal(computeSums(big, [{ qty: 9007199254740991 }, { qty: 2 }, { qty: -9007199254740991 }])[2].groups[0].total, '2')
})

test('sums — wrong ones', () => {
  const t = (sum: Record<string, unknown>) => { const x = L2B() as any; x.tables[0].sums = [sum]; return x }
  assert.ok(codes(t({ key: 's', label: 'S', column: 'what', by: 'all' })).includes('BAD_REF'))
  assert.ok(codes(t({ key: 's', label: 'S', column: 'net', by: 'month' })).includes('BAD_REF'))
  assert.ok(codes(t({ key: 's', label: 'S', column: 'net', by: 'column:what' })).includes('BAD_REF'))
  assert.equal(validateSpec(t({ key: 's', label: 'S', column: 'net', by: 'column:status' })).ok, true)
  assert.ok(codes(t({ key: 's', label: 'S', column: 'net', by: 'all', date: 'due' })).includes('INVALID'))
  assert.ok(codes(t({ key: 's', label: 'S', column: 'net', by: 'all', where: { status: ['gone'] } })).includes('INVALID'))
  assert.ok(codes(t({ key: 's', label: 'S', column: 'gross', by: 'all' })).includes('BAD_REF'))
  const many = L2B() as any; many.tables[0].sums = Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, label: `S${i}`, column: 'net', by: 'all' }))
  assert.ok(codes(many).includes('TOO_MANY'))
})

test('computed values — days left · sum in one currency · other currency = empty · empty values', () => {
  const t = ok(L2B()).tables[0]
  const r = computeRow(t, { due: '2026-12-01', net: '100.50', net_cur: 'CHF', vat: '8.14', vat_cur: 'CHF', qty: 5, qty2: 2 }, '2026-11-06')
  assert.deepEqual(r, { gross: 'CHF 108.64', left: '25', qd: '3' })
  assert.equal(computeRow(t, { due: '2026-11-01' }, '2026-11-06').left, '-5')
  assert.equal(computeRow(t, { net: '1.00', net_cur: 'CHF', vat: '1.00', vat_cur: 'EUR' }, '2026-11-06').gross, null)
  assert.equal(computeRow(t, { net: '1.00', net_cur: 'CHF' }, '2026-11-06').gross, 'CHF 1.00')
  assert.equal(computeRow(t, { net: '1.00', vat: '2.50' }, '2026-11-06').gross, '3.50')
  assert.equal(computeRow(t, { net: '1000000000000000.00', net_cur: 'CHF', vat: '0.01', vat_cur: 'CHF' }, '2026-11-06').gross, 'CHF 1000000000000000.01')
  assert.equal(computeRow(t, { qty: 9007199254740991, qty2: '0.5' }, '2026-11-06').qd, '9007199254740990.5')
  assert.equal(computeRow(t, { qty: 0.1, qty2: 0.3 }, '2026-11-06').qd, '-0.2')
  assert.equal(computeRow(t, { qty: 0.0000001, qty2: 0 }, '2026-11-06').qd, '0.0000001') // 1e-7
  assert.equal(computeRow(t, { qty: '0.1234567890123', qty2: 1e21 }, '2026-11-06').qd, '-999999999999999999999.8765432109877')
  assert.equal(computeRow(t, { qty: 5 }, '2026-11-06').qd, null)
  assert.equal(computeRow(t, {}, '2026-11-06').left, null)
  assert.equal(computeRow(t, { net: '-3.10', net_cur: 'CHF', vat: '0.05', vat_cur: 'CHF' }, '2026-11-06').gross, 'CHF -3.05')
})

test('sum values — month · per currency · status filter · empty values', () => {
  const t = ok(L2B()).tables[0]
  const rows = [
    { due: '2026-10-05', net: '10.00', net_cur: 'CHF', kind: 'rent', status: 'open', qty: 1 },
    { due: '2026-10-20', net: '5.50', net_cur: 'CHF', kind: 'rent', status: 'paid', qty: 2 },
    { due: '2026-11-01', net: '7.00', net_cur: 'EUR', kind: 'it', qty: 3 },
    { due: 'bad', net: '1.00', net_cur: 'CHF', kind: 'it', status: 'open' },
    { net: '', kind: 'it', status: 'open' },
  ]
  const [m, k, a] = computeSums(t, rows)
  assert.deepEqual(m.groups, [{ group: '2026-11', currency: 'EUR', total: '7.00', count: 1 }, { group: '2026-10', currency: 'CHF', total: '15.50', count: 2 }])
  assert.deepEqual(k.groups, [{ group: 'it', currency: 'CHF', total: '1.00', count: 1 }, { group: 'it', currency: 'EUR', total: '7.00', count: 1 }, { group: 'rent', currency: 'CHF', total: '10.00', count: 1 }])
  assert.deepEqual(a.groups, [{ group: 'all', currency: null, total: '6', count: 3 }])
})

const L3 = (extra: Record<string, unknown> = {}, sends?: unknown[]) => ({ spec: 1, name: 'Contracts', tables: [{ key: 'contracts', name: 'Contracts', columns: [
  { key: 'supplier', label: 'Supplier', kind: 'text' }, { key: 'end', label: 'Expiry', kind: 'date' }, { key: 'net', label: 'Net', kind: 'money' },
  { key: 'owner', label: 'Owner', kind: 'person' }, { key: 'left', label: 'Days left', kind: 'computed', block: 'days_until', from: 'end' },
], status: { values: ['draft', 'active', 'ended'], start: 'draft', moves: [['draft', 'active'], ['active', 'ended']], lockedIn: ['ended'] }, number: { prefix: 'CT-' }, file: { fill: ['supplier', 'end', 'net'] }, ...extra }],
  sends: sends ?? [{ key: 'renew', label: 'Renewal mail', table: 'contracts', to: 'column:owner', subject: 'Contract {number} with {supplier} ends {end}', body: 'Hi,\n{supplier} ends on {end} ({left} days). Net {net}. Stage {status}.', allowWhen: { status: ['active'], column: 'left', max: 30 } }] })

test('document to columns · mail — pass · wrong ones', () => {
  ok(L3())
  assert.ok(codes(L3({ file: { fill: ['left'] } })).includes('BAD_REF'))
  assert.ok(codes(L3({ file: { fill: [] } })).includes('INVALID'))
  assert.ok(codes(L3({}, [{ key: 'x', label: 'X', table: 'nope', to: 'owner', subject: 's', body: 'b' }])).includes('BAD_REF'))
  assert.ok(codes(L3({}, [{ key: 'x', label: 'X', table: 'contracts', to: 'column:supplier', subject: 's', body: 'b' }])).includes('BAD_REF'))
  assert.ok(codes(L3({}, [{ key: 'x', label: 'X', table: 'contracts', to: 'owner', subject: 'Hi {nope}', body: 'b' }])).includes('BAD_REF'))
  assert.ok(codes(L3({}, [{ key: 'x', label: 'X', table: 'contracts', to: 'owner', subject: 's', body: 'b', allowWhen: { column: 'supplier', max: 1 } }])).includes('BAD_REF'))
  assert.ok(codes(L3({}, [{ key: 'x', label: 'X', table: 'contracts', to: 'owner', subject: 's', body: 'b', allowWhen: { column: 'left' } }])).includes('INVALID'))
  assert.ok(codes(L3({}, [{ key: 'x', label: 'X', table: 'contracts', to: 'owner', subject: 's', body: 'b', allowWhen: { status: ['gone'] } }])).includes('BAD_REF'))
  assert.ok(codes(L3({}, Array.from({ length: 11 }, (_, i) => ({ key: `s${i}`, label: `S${i}`, table: 'contracts', to: 'owner', subject: 's', body: 'b' })))).includes('TOO_MANY'))
})

test('mail — placeholders · recipient · allowWhen', () => {
  const sp = ok(L3())
  const t = sp.tables[0]
  const s = sp.sends![0]
  const team = { ownerEmail: 'o@x.ch', members: [{ id: 1, email: 'a@x.ch', active: true }, { id: 2, email: 'gone@x.ch', active: false }] }
  const row = { number: 'CT-001', supplier: 'Acme', end: '2026-12-01', net: '10.00', net_cur: 'CHF', owner: 'a@x.ch', status: 'active' }
  const m = buildSpecMail(t, s, row, '2026-11-06', team, null)
  assert.deepEqual(m.to, ['a@x.ch'])
  assert.equal(m.subject, 'Contract CT-001 with Acme ends 2026-12-01')
  assert.ok(m.text.includes('(25 days)') && m.text.includes('Net CHF 10.00') && m.text.includes('Stage active'), m.text)
  assert.equal(buildSpecMail(t, s, { ...row, owner: 'gone@x.ch' }, '2026-11-06', team, null).to, null)
  assert.equal(specSendBlocked(t, s, row, '2026-11-06'), null)
  assert.ok(specSendBlocked(t, s, { ...row, status: 'draft' }, '2026-11-06')?.includes('only for rows in active'))
  assert.ok(specSendBlocked(t, s, { ...row, end: '2027-06-01' }, '2026-11-06')?.includes('at most 30'))
  assert.ok(specSendBlocked(t, s, { ...row, end: undefined }, '2026-11-06')?.includes('empty'))
  assert.equal(specSendBlocked(t, s, { ...row, status: undefined }, '2026-11-06')?.includes('only for rows in active'), true)
})

test('alert «is it time» window — daysBefore = target day to date + 7 · daysAfter = target day to target day + 30 · late when late', () => {
  const b = { daysBefore: 30 }
  assert.equal(alertDue(b, '2026-12-31', '2026-11-30'), null)
  assert.deepEqual(alertDue(b, '2026-12-31', '2026-12-01'), { target: '2026-12-01', late: false })
  assert.deepEqual(alertDue(b, '2026-12-31', '2026-12-05'), { target: '2026-12-01', late: true })
  assert.deepEqual(alertDue(b, '2026-12-31', '2027-01-07'), { target: '2026-12-01', late: true })
  assert.equal(alertDue(b, '2026-12-31', '2027-01-08'), null)
  const a = { daysAfter: 10 }
  assert.equal(alertDue(a, '2026-03-01', '2026-03-10'), null)
  assert.deepEqual(alertDue(a, '2026-03-01', '2026-03-11'), { target: '2026-03-11', late: false })
  assert.deepEqual(alertDue(a, '2026-03-01', '2026-04-10'), { target: '2026-03-11', late: true })
  assert.equal(alertDue(a, '2026-03-01', '2026-04-11'), null)
  assert.deepEqual(alertDue({ daysBefore: 0 }, '2028-02-29', '2028-02-29'), { target: '2028-02-29', late: false })
  assert.deepEqual(alertDue({ daysBefore: 1 }, '2027-01-01', '2026-12-31'), { target: '2026-12-31', late: false })
  assert.equal(alertDue(b, '', '2026-12-01'), null)
  assert.equal(alertDue(b, undefined, '2026-12-01'), null)
  assert.equal(alertDue(b, '2026-02-30', '2026-01-31'), null)
})

const withAlerts = (alerts: unknown, extra: Record<string, unknown> = {}) => {
  const raw = contracts() as Record<string, unknown> & { tables: Array<Record<string, unknown>> }
  raw.tables[0].status = { values: ['active', 'ended'], start: 'active', moves: [['active', 'ended']], lockedIn: ['ended'] }
  raw.tables[0].alerts = alerts
  return { ...raw, ...extra }
}

test('alert check — shape · date column · exactly one · 0 to 365 · when · to · send', () => {
  const ok = validateSpec(withAlerts([{ key: 'expiry30', label: 'Expires in 30 days', date: 'end', daysBefore: 30, when: { status: ['active'] }, to: 'column:owner', send: 'renewal' }], {
    sends: [{ key: 'renewal', label: 'Renewal', table: 'contracts', to: 'column:owner', subject: 'Contract {supplier} ends {end}', body: 'Hi' }],
  }))
  assert.ok(ok.ok, JSON.stringify(!ok.ok && ok.issues))
  assert.equal(ok.ok && ok.spec.tables[0].alerts?.[0].daysBefore, 30)
  const c = (al: unknown, extra?: Record<string, unknown>) => codes(withAlerts(al, extra))
  assert.ok(c([{ key: 'a', label: 'A', date: 'supplier', daysBefore: 1 }]).includes('BAD_REF'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end' }]).includes('INVALID'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 1, daysAfter: 1 }]).includes('INVALID'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 366 }]).includes('INVALID'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 1.5 }]).includes('INVALID'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: -1 }]).includes('INVALID'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 1, when: { status: ['nope'] } }]).includes('INVALID'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 1, to: 'column:supplier' }]).includes('BAD_REF'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 1 }, { key: 'a', label: 'B', date: 'end', daysAfter: 1 }]).includes('DUPLICATE'))
  assert.ok(c([{ key: 'a', date: 'end', daysBefore: 1 }]).includes('REQUIRED')) // label
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 1, color: 'x' }]).includes('UNKNOWN_FIELD'))
  assert.ok(c(Array.from({ length: 6 }, (_, i) => ({ key: `a${i}`, label: `A${i}`, date: 'end', daysBefore: i }))).includes('TOO_MANY'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 1, send: 'nope' }]).includes('BAD_REF'))
  assert.ok(c([{ key: 'a', label: 'A', date: 'end', daysBefore: 1, send: 'g' }], { sends: [{ key: 'g', label: 'G', table: 'contracts', to: 'given', subject: 's', body: 'b' }] }).includes('INVALID'))
  const hid = withAlerts([{ key: 'a', label: 'A', date: 'start', daysBefore: 1 }]) as { tables: Array<{ columns: Array<Record<string, unknown>> }> }
  hid.tables[0].columns.find((x) => x.key === 'start')!.hidden = true
  assert.ok(codes(hid).includes('BAD_REF'))
  const nost = withAlerts([{ key: 'a', label: 'A', date: 'end', daysBefore: 1, when: { status: ['active'] } }]) as { tables: Array<Record<string, unknown>> }
  delete nost.tables[0].status
  assert.ok(codes(nost).includes('INVALID'))
})

import { describeSpecChange } from './assembled-change'

test('change list — new app · same · tables · columns · status · alerts · sends', () => {
  const v = validateSpec(contracts())
  assert.ok(v.ok)
  const a = (v as { spec: AppSpec }).spec
  assert.deepEqual(describeSpecChange(a, a), [], '같으면 빈 목록')
  assert.deepEqual(describeSpecChange(null, a).map((c) => c.code), ['app_about', 'table_added'])
  const b: AppSpec = JSON.parse(JSON.stringify(a))
  b.name = 'Renewals'
  b.tables[0].columns.push({ key: 'note', label: 'Note', kind: 'text' })
  b.tables[0].columns[0].label = 'Vendor'
  b.tables[0].columns.find((c) => c.key === 'start')!.hidden = true
  b.tables[0].status = { values: ['active', 'ended'], start: 'active', moves: [{ from: 'active', to: 'ended' }], lockedIn: ['ended'] }
  b.tables[0].alerts = [{ key: 'x', label: 'Soon', date: 'end', daysBefore: 30 }]
  b.tables.push({ key: 'notes', name: 'Notes', columns: [{ key: 't', label: 'T', kind: 'text' }] })
  b.sends = [{ key: 'm', label: 'Mail', table: 'contracts', to: 'owner', subject: 's', body: 'b' }]
  const codesOf = describeSpecChange(a, b).map((c) => c.code)
  for (const c of ['app_name', 'column_added', 'column_renamed', 'column_hidden', 'status_added', 'alert_added', 'table_added', 'send_added'] as const) assert.ok(codesOf.includes(c), `${c} — ${codesOf.join(',')}`)
  const c2: AppSpec = JSON.parse(JSON.stringify(b))
  c2.tables[0].status!.values.push('renewing'); c2.tables[0].status!.moves.push({ from: 'active', to: 'renewing' }, { from: 'renewing', to: 'ended' })
  c2.tables[0].alerts = []; c2.sends = []; c2.tables[1].hidden = true
  const d2 = describeSpecChange(b, c2)
  assert.deepEqual(d2.find((x) => x.code === 'status_values_added')?.values, ['renewing'])
  for (const c of ['status_moves', 'alert_removed', 'send_removed', 'table_hidden'] as const) assert.ok(d2.some((x) => x.code === c), c)
  const h: AppSpec = JSON.parse(JSON.stringify(b))
  h.tables[0].hidden = true; h.tables[0].alerts = [{ key: 'x', label: 'Soon', date: 'end', daysBefore: 7 }]
  h.tables[0].columns.find((c) => c.key === 'note')!.hidden = true; h.tables[0].columns.find((c) => c.key === 'note')!.label = 'Memo'
  h.tables[1].columns.push({ key: 'z', label: 'Z', kind: 'text', hidden: true })
  const dh = describeSpecChange(b, h).map((x) => x.code)
  for (const c of ['table_hidden', 'alert_changed', 'column_hidden', 'column_renamed', 'column_added'] as const) assert.ok(dh.includes(c), `${c} — ${dh.join(',')}`)
  const k = JSON.parse(JSON.stringify(b)) as AppSpec
  k.tables[0].columns.push({ key: 'left', label: 'Left', kind: 'computed', block: 'days_until', from: 'end' })
  const k2 = JSON.parse(JSON.stringify(k)) as AppSpec
  k2.tables[0].columns = k2.tables[0].columns.filter((c) => c.key !== 'left')
  assert.deepEqual(describeSpecChange(k, k2).map((x) => x.code), ['computed_removed'])
  const k3 = JSON.parse(JSON.stringify(k)) as AppSpec
  k3.tables[0].columns = k3.tables[0].columns.map((c) => (c.key === 'left' ? { key: 'left', label: 'Left', kind: 'number' } : c))
  assert.deepEqual(describeSpecChange(k, k3).map((x) => x.code), ['computed_changed'])
  const nt = JSON.parse(JSON.stringify(b)) as AppSpec
  nt.tables.push({ key: 'n2', name: 'N2', columns: [{ key: 'a', label: 'A', kind: 'text' }, { key: 'b', label: 'B', kind: 'text', hidden: true }] })
  assert.ok(describeSpecChange(b, nt).some((x) => x.code === 'column_added' && x.name === 'B'))
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blockCatalogData, renderBlockCatalog } from '../mcp-server/resources/render-block-catalog'

test('the «contract renewals» example of the guide passes the validator · block list = same source as the validator', () => {
  const md = readFileSync(join(process.cwd(), 'src/lib/mcp-server/resources/work-app-guide.md'), 'utf8')
  const json = /```json\n([\s\S]*?)\n```/.exec(md)?.[1]
  assert.ok(json, '예 JSON 이 있다')
  const v = validateSpec(JSON.parse(json!))
  assert.ok(v.ok, JSON.stringify(!v.ok && v.issues))
  const d = blockCatalogData()
  assert.equal(d.blocks.length, blocksForEdition().filter((b) => b.available).length)
  assert.ok(d.blocks.some((b) => b.id === 'date_alert'))
  const cat = renderBlockCatalog()
  for (const b of d.blocks) assert.ok(cat.includes(`### ${b.id}`), b.id)
  const src = readFileSync(join(process.cwd(), 'src/lib/work/assembled.ts'), 'utf8')
  for (const m of md.matchAll(/`([A-Z_]{4,})`/g)) if (!['SPEC_INVALID'].includes(m[1])) assert.ok(src.includes(`'${m[1]}'`), `안내서 코드 ${m[1]} 가 검사기에 없다`)
})

test('L6 number floor — reads the number block shape as is and the highest value per counter name (design §19-14-2 3)', () => {
  assert.deepEqual(parseSpecNumber({ prefix: 'CT-', year: true }, 'CT-2026-007'), { year: '2026', value: 7 })
  assert.deepEqual(parseSpecNumber({ prefix: 'CT-', year: true }, 'CT-2026-1000'), { year: '2026', value: 1000 })
  assert.deepEqual(parseSpecNumber({ prefix: 'CT-' }, 'CT-042'), { year: null, value: 42 })
  assert.deepEqual(parseSpecNumber({}, '5'), { year: null, value: 5 })
  for (const bad of ['CT-042', 'XX-2026-001', 'CT-2026-', 'CT-2026-01a', 7, null]) assert.equal(parseSpecNumber({ prefix: 'CT-', year: true }, bad), null, String(bad))
  assert.equal(parseSpecNumber({ prefix: 'CT-' }, 'CT-2026-001'), null)
  const spec = { spec: 1, name: 'x', tables: [
    { key: 'contracts', name: 'C', columns: [], number: { prefix: 'CT-', year: true } },
    { key: 'plain', name: 'P', columns: [] },
  ] } as unknown as AppSpec
  const rows: Record<string, Array<Record<string, unknown>>> = { contracts: [{ number: 'CT-2025-009' }, { number: 'CT-2026-003' }, { number: 'CT-2026-001' }, { number: 'CT-2026-000' }, { number: 'CT-2026-9999999999' }, {}], plain: [{ number: '99' }] }
  const f = specNumberFloors(spec, 'p1', (k) => rows[k] ?? [])
  assert.deepEqual(f.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: specCounterName('p1', 'contracts', '2025'), value: 9 },
    { name: specCounterName('p1', 'contracts', '2026'), value: 3 },
  ].sort((a, b) => a.name.localeCompare(b.name)))
  assert.ok(specCounterName('p1', 'contracts', null).endsWith(':all') && specCounterName('p1', 'contracts', null).length <= 60)
})

const stock = (): Record<string, unknown> & { tables: Array<Record<string, unknown> & { columns: Array<Record<string, unknown>> }> } => ({
  spec: 1,
  name: 'Stock',
  tables: [
    { key: 'items', name: 'Items', columns: [{ key: 'name', label: 'Name', kind: 'text', required: true }, { key: 'spec', label: 'Spec', kind: 'longtext' }], number: { prefix: 'IT-', digits: 3 } },
    { key: 'moves', name: 'Moves', columns: [{ key: 'item', label: 'Item', kind: 'ref', ref: { table: 'items', show: 'name' }, required: true }, { key: 'qty', label: 'Qty', kind: 'number' }], sums: [{ key: 'per_item', label: 'Per item', column: 'qty', by: 'column:item' }] },
  ],
})

test('ref column — passes · sheet column is plain · required kept · form rules use a text field', () => {
  const s = ok(stock())
  const col = specTableSchema(s.tables[1]).columns.find((c) => c.name === 'item')!
  assert.equal(col.encrypted, undefined)
  assert.equal(col.required, true)
  assert.equal(toFormInfo(s.tables[1], []).columns.find((c) => c.key === 'item')!.kind, 'text')
  assert.equal(specTableSchema(s.tables[0]).columns.find((c) => c.name === 'name')!.encrypted, true)
  assert.deepEqual(s.tables[1].columns[0].ref, { table: 'items', show: 'name' })
})

test('ref column — wrong: missing table · own table · wrong show · no number block · shape · ref on another kind', () => {
  const v = (f: (x: ReturnType<typeof stock>) => void) => { const x = stock(); f(x); return codes(x) }
  assert.deepEqual(v((x) => { x.tables[1].columns[0].ref = { table: 'nope', show: 'name' } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.tables[1].columns[0].ref = { table: 'moves', show: 'qty' } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.tables[1].columns[0].ref = { table: 'items', show: 'spec' } }), ['BAD_REF']) // longtext X
  assert.deepEqual(v((x) => { x.tables[1].columns[0].ref = { table: 'items', show: 'zzz' } }), ['BAD_REF'])
  ok((() => { const x = stock(); x.tables[1].columns[0].ref = { table: 'items', show: 'number' }; return x })())
  assert.deepEqual(v((x) => { delete x.tables[0].number; x.tables[1].columns[0].ref = { table: 'items', show: 'number' } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { delete x.tables[1].columns[0].ref }), ['REQUIRED'])
  assert.deepEqual(v((x) => { x.tables[1].columns[0].ref = { table: 'items', show: 'name', many: true } }), ['REQUIRED'])
  assert.deepEqual(v((x) => { x.tables[1].columns[1].ref = { table: 'items', show: 'name' } }), ['INVALID'])
  assert.deepEqual(v((x) => { x.tables[1].columns[0].options = ['a'] }), ['INVALID'])
})

test('ref column — hidden table · hidden show · hidden ref columns are left out of the check', () => {
  const v = (f: (x: ReturnType<typeof stock>) => void) => { const x = stock(); f(x); return codes(x) }
  assert.deepEqual(v((x) => { x.tables[0].hidden = true }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.tables[0].hidden = true; x.tables[1].columns[0].hidden = true; delete x.tables[1].sums }), [])
  assert.deepEqual(v((x) => { x.tables[0].columns.push({ key: 'code', label: 'Code', kind: 'text' }); x.tables[0].columns[0].hidden = true }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.tables[0].columns.push({ key: 'code', label: 'Code', kind: 'text' }); x.tables[0].columns[0].hidden = true; x.tables[1].hidden = true }), [])
})

test('ref column — no required circles · optional circles ok · three-way circle', () => {
  const two = stock()
  two.tables[0].columns.push({ key: 'last', label: 'Last move', kind: 'ref', ref: { table: 'moves', show: 'qty' }, required: true })
  assert.deepEqual(codes(two), ['REF_CYCLE'])
  delete two.tables[0].columns[2].required
  ok(two)
  const three = stock()
  three.tables.push({ key: 'shelves', name: 'Shelves', columns: [{ key: 'label', label: 'Label', kind: 'text' }, { key: 'move', label: 'Move', kind: 'ref', ref: { table: 'moves', show: 'qty' }, required: true }] })
  three.tables[0].columns.push({ key: 'shelf', label: 'Shelf', kind: 'ref', ref: { table: 'shelves', show: 'label' }, required: true })
  assert.deepEqual(codes(three), ['REF_CYCLE']) // items → shelves → moves → items
  three.tables[0].columns[2].hidden = true
  ok(three)
})

test('ref column — change rules: target table fixed · show free · no new required in an existing table · new table may be required', () => {
  const before = ok(stock())
  const a = stock(); a.tables[0].columns.push({ key: 'code', label: 'Code', kind: 'text' })
  a.tables.push({ key: 'other', name: 'Other', columns: [{ key: 'x', label: 'X', kind: 'text' }] })
  a.tables[1].columns[0].ref = { table: 'other', show: 'x' }
  assert.deepEqual(codes(a, before), ['REF_TABLE_CHANGED'])
  const b = stock(); b.tables[0].columns.push({ key: 'code', label: 'Code', kind: 'text' }); b.tables[1].columns[0].ref = { table: 'items', show: 'code' }
  ok(b, before)
  const c = stock(); c.tables[1].columns.push({ key: 'item2', label: 'Item 2', kind: 'ref', ref: { table: 'items', show: 'name' }, required: true })
  assert.deepEqual(codes(c, before), ['NEW_REQUIRED'])
  const d = stock(); d.tables.push({ key: 'loans', name: 'Loans', columns: [{ key: 'item', label: 'Item', kind: 'ref', ref: { table: 'items', show: 'name' }, required: true }] })
  ok(d, before)
  const e = stock(); delete e.tables[1].sums; e.tables[1].columns[1] = { key: 'qty', label: 'Qty', kind: 'ref', ref: { table: 'items', show: 'name' } }
  assert.deepEqual(codes(e, before), ['KIND_CHANGED'])
})

test('ref column — other blocks: document to columns no · computed no · alert to no · sum by yes · ref in the block guide', () => {
  const v = (f: (x: ReturnType<typeof stock>) => void) => { const x = stock(); f(x); return codes(x) }
  assert.deepEqual(v((x) => { x.tables[1].file = { fill: ['item'] } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.tables[1].columns.push({ key: 'd', label: 'D', kind: 'computed', block: 'days_until', from: 'item' }) }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.tables[1].columns.push({ key: 'when', label: 'When', kind: 'date' }); x.tables[1].alerts = [{ key: 'a', label: 'A', date: 'when', daysBefore: 1, to: 'column:item' }] }), ['BAD_REF'])
  ok(stock()) // sums by column:item
  assert.ok(BLOCKS.find((b) => b.id === 'table')!.about.includes('ref'))
})

test('ref column — sums group by row id and add the name · two items with the same name = two groups · deleted rows · name order', async () => {
  const { refCellText } = await import('./sheet-text')
  const s = ok(stock())
  const refRows = { item: [{ id: 'r1', label: 'A4' }, { id: 'r2', label: 'A4' }, { id: 'r3', label: null }, { id: 'r0', label: 'Ink' }] }
  const rows = [{ item: 'r1', qty: 5 }, { item: 'r2', qty: 7 }, { item: 'r1', qty: 1 }, { item: 'gone', qty: 2 }, { item: 'r3', qty: 3 }, { item: 'r0', qty: 0 }]
  const g = computeSums(s.tables[1], rows, refRows)[0].groups
  assert.deepEqual(g.map((x) => [x.group, x.label ?? null, x.gone ?? false, x.total]), [['r1', 'A4', false, '6'], ['r2', 'A4', false, '7'], ['r0', 'Ink', false, '0'], ['r3', '', false, '3'], ['gone', null, true, '2']])
  assert.deepEqual(g.map((x) => x.group), ['r1', 'r2', 'r0', 'r3', 'gone'])
  assert.equal(g.find((x) => x.group === 'r1')!.total, '6')
  assert.equal(g.find((x) => x.group === 'gone')!.gone, true)
  assert.equal(refCellText('en', 'r1', refRows.item, null), 'A4')
  assert.equal(refCellText('en', 'r3', refRows.item, null), '(no name)')
  assert.equal(refCellText('ko', 'zz', refRows.item, null), '(지운 줄)')
  assert.equal(refCellText('en', '', refRows.item, null), '')
  assert.equal(refCellText('en', 'r0', [{ id: 'r0', label: '0' }], null), '0')
})

test('ref column — mail placeholder = name · deleted row = empty · a name change changes the fingerprint', async () => {
  const { specSendRefKey } = await import('./assembled')
  const x = stock()
  ;(x as Record<string, unknown>).sends = [{ key: 'm', label: 'M', table: 'moves', to: 'owner', subject: 'Moved {item}', body: 'Qty {qty} of {item}' }]
  const s = ok(x)
  const team = { ownerEmail: 'o@example.com', members: [] }
  const m1 = buildSpecMail(s.tables[1], s.sends![0], { item: 'r1', qty: 5 }, '2026-11-08', team, null, { item: [{ id: 'r1', label: 'A4 paper' }] })
  assert.equal(m1.subject, 'Moved A4 paper')
  assert.equal(m1.text, 'Qty 5 of A4 paper')
  const gone = buildSpecMail(s.tables[1], s.sends![0], { item: 'zz', qty: 5 }, '2026-11-08', team, null, { item: [{ id: 'r1', label: 'A4 paper' }] })
  assert.equal(gone.subject, 'Moved ')
  const m2 = buildSpecMail(s.tables[1], s.sends![0], { item: 'r1', qty: 5 }, '2026-11-08', team, null, { item: [{ id: 'r1', label: 'A4 Papier' }] })
  assert.notEqual(specSendRefKey(s.sends![0], m1).split(':')[2], specSendRefKey(s.sends![0], m2).split(':')[2])
})

const leave = (): Record<string, unknown> & { tables: Array<Record<string, unknown>>; sends?: Array<Record<string, unknown>> } => ({
  spec: 1, name: 'Leave',
  tables: [{
    key: 'requests', name: 'Leave requests',
    columns: [{ key: 'who', label: 'Requester', kind: 'person' }, { key: 'manager', label: 'Manager', kind: 'person' }, { key: 'days', label: 'Days', kind: 'number' }],
    status: { values: ['draft', 'submitted', 'approved', 'rejected'], start: 'draft', moves: [['draft', 'submitted'], { from: 'submitted', to: 'approved', by: 'column:manager' }, { from: 'submitted', to: 'rejected', by: 'column:manager' }, ['rejected', 'submitted']], lockedIn: ['approved'] },
    moveAlerts: [
      { key: 'up', label: 'Submitted', to: ['submitted'], notify: 'column:manager', send: 'ask' },
      { key: 'done', label: 'Decided', to: ['approved', 'rejected'], from: ['submitted'], notify: 'column:who' },
    ],
  }],
  sends: [{ key: 'ask', label: 'Ask', table: 'requests', to: 'column:manager', subject: 'Leave {days}', body: 'Please decide.' }],
})

test('move alert — passes · recipient column = permission column · block list', async () => {
  const { authorityColumnsOf } = await import('./assembled')
  const s = ok(leave())
  assert.equal(s.tables[0].moveAlerts?.length, 2)
  assert.ok(authorityColumnsOf(s.tables[0]).includes('who'))
  assert.ok(BLOCKS.some((b) => b.id === 'move_alert'))
})

test('move alert — wrong ones', () => {
  const v = (f: (x: ReturnType<typeof leave>) => void) => { const x = leave(); f(x); return codes(x) }
  const ma = (x: ReturnType<typeof leave>) => x.tables[0].moveAlerts as Array<Record<string, unknown>>
  assert.deepEqual(v((x) => { delete x.tables[0].status; delete x.tables[0].moveAlerts }), [])
  assert.deepEqual(v((x) => { delete x.tables[0].status }), ['INVALID'])
  assert.deepEqual(v((x) => { ma(x)[0].to = ['nope'] }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ma(x)[0].to = [] }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ma(x)[1].from = ['zzz'] }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ma(x)[1].from = ['draft'] }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ma(x)[1].notify = 'column:days' }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ma(x)[1].notify = 'next' }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ma(x)[1].key = 'up' }), ['DUPLICATE'])
  assert.deepEqual(v((x) => { ma(x)[0].extra = 1 }), ['UNKNOWN_FIELD'])
  assert.deepEqual(v((x) => { for (let i = 0; i < 4; i++) ma(x).push({ key: `k${i}`, label: 'K', to: ['draft'], notify: 'owner' }) }), ['TOO_MANY'])
  assert.deepEqual(v((x) => { ma(x)[0].send = 'nope' }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.sends![0].to = 'owner' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends![0].to = 'given' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends![0].allowWhen = { status: ['draft'] } }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends![0].allowWhen = { status: ['submitted', 'approved'] } }), [])
  assert.deepEqual(v((x) => { x.sends![0].allowWhen = { column: 'days', max: 30 } }), [])
  assert.deepEqual(v((x) => { (x.tables[0].columns as Array<Record<string, unknown>>)[0].hidden = true }), ['BAD_REF'])
})

test('move alert — picking the matching alerts · recipient (none = none — never falls back to the owner)', async () => {
  const { moveAlertsFor, moveRecipient } = await import('./assembled-alerts')
  const t = ok(leave()).tables[0]
  assert.deepEqual(moveAlertsFor(t, 'draft', 'submitted').map((a) => a.key), ['up'])
  assert.deepEqual(moveAlertsFor(t, 'rejected', 'submitted').map((a) => a.key), ['up'])
  assert.deepEqual(moveAlertsFor(t, 'submitted', 'approved').map((a) => a.key), ['done'])
  assert.deepEqual(moveAlertsFor(t, null, 'approved').map((a) => a.key), [])
  assert.deepEqual(moveAlertsFor(t, null, 'submitted').map((a) => a.key), ['up'])
  assert.deepEqual(moveAlertsFor(t, 'submitted', 'draft').map((a) => a.key), [])
  const team = { ownerEmail: 'o@x.ch', members: [{ id: 7, email: 'm@x.ch', active: true }, { id: 8, email: 'gone@x.ch', active: false }] }
  assert.equal(moveRecipient('owner', {}, team), 'human')
  assert.equal(moveRecipient('column:manager', { manager: 'M@x.ch' }, team), 'member:7')
  assert.equal(moveRecipient('column:manager', { manager: 'o@x.ch' }, team), 'human')
  assert.equal(moveRecipient('column:manager', { manager: 'gone@x.ch' }, team), undefined)
  assert.equal(moveRecipient('column:manager', {}, team), undefined)
  assert.equal(moveRecipient('owner', {}, { ownerEmail: null, members: [] }), undefined)
})

test('move alert — notice key · values pass the backup check (storedNoticeOf)', async () => {
  const { storedNoticeOf } = await import('./notices')
  for (const k of ['notice_move', 'notice_move_new', 'notice_move_nocard', 'notice_move_new_nocard']) {
    const n = storedNoticeOf({ text: '', notice: { key: k, params: { alert: 'Submitted', table: 'Leave requests', row: 'VR-001', from: '—', to: 'submitted', who: ' (AI)' }, by: 'member:7' } })
    assert.ok(n && n.key === k && n.by === 'member:7', k)
  }
})

const repairs = (): Record<string, unknown> & { tables: Array<Record<string, unknown>> } => ({
  spec: 1, name: 'Repairs',
  tables: [{
    key: 'jobs', name: 'Repair jobs',
    columns: [
      { key: 'customer', label: 'Customer', kind: 'text', required: true },
      { key: 'phone', label: 'Phone', kind: 'text', required: true },
      { key: 'problem', label: 'Problem', kind: 'longtext' },
      { key: 'day', label: 'Wanted day', kind: 'date' },
      { key: 'price', label: 'Price', kind: 'money' },
      { key: 'device', label: 'Device', kind: 'choice', options: ['Phone', 'Laptop'] },
      { key: 'tech', label: 'Technician', kind: 'person' },
      { key: 'note', label: 'Internal note', kind: 'text', hidden: true },
      { key: 'days_left', label: 'Days left', kind: 'computed', block: 'days_until', from: 'day' },
    ],
    status: { values: ['received', 'working', 'done'], start: 'received', moves: [['received', 'working'], ['working', 'done']], lockedIn: ['done'] },
    number: { prefix: 'RP' },
    intake: { columns: ['customer', 'phone', 'problem', 'day', 'device'], identify: { column: 'phone', by: 'phone' } },
  }],
})

test('intake — passes · block list', () => {
  const s = ok(repairs())
  assert.deepEqual(s.tables[0].intake, { columns: ['customer', 'phone', 'problem', 'day', 'device'], identify: { column: 'phone', by: 'phone' } })
  assert.ok(BLOCKS.some((b) => b.id === 'intake'))
  const x = repairs(); x.tables[0].intake = { columns: ['customer', 'phone', 'price'] }
  assert.deepEqual(ok(x).tables[0].intake, { columns: ['customer', 'phone', 'price'] })
})

test('intake — wrong ones', () => {
  const v = (f: (x: ReturnType<typeof repairs>) => void) => { const x = repairs(); f(x); return codes(x) }
  const ik = (x: ReturnType<typeof repairs>) => x.tables[0].intake as Record<string, unknown> & { columns: unknown[] }
  assert.deepEqual(v((x) => { ik(x).columns.push('nope') }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ik(x).columns.push('note') }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ik(x).columns.push('tech') }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).columns.push('days_left') }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).columns.push('status') }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ik(x).columns.push('number') }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ik(x).columns.push('customer') }), ['DUPLICATE'])
  assert.deepEqual(v((x) => { ik(x).columns = []; delete ik(x).identify }), ['REQUIRED'])
  assert.deepEqual(v((x) => { ik(x).columns = ['phone'] }), ['REQUIRED'])
  assert.deepEqual(v((x) => { ik(x).extra = 1 }), ['UNKNOWN_FIELD'])
  assert.deepEqual(v((x) => { ik(x).form = true }), [])
  assert.deepEqual(v((x) => { ik(x).form = 'yes' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.tables[0].hidden = true; x.tables.push({ key: 'other', name: 'Other', columns: [{ key: 'a', label: 'A', kind: 'text' }] }) }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).columns = ['customer', 'phone']; ik(x).identify = { column: 'problem', by: 'phone' } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ik(x).identify = { column: 'problem', by: 'phone' } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).identify = { column: 'phone', by: 'email' } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).identify = { column: 'phone', by: 'phone', x: 1 } }), ['INVALID'])
  assert.deepEqual(v((x) => { (x.tables[0].columns as Array<Record<string, unknown>>)[7].required = true }), [])
})

test('webhook — validator (webhook.md §6-5)', () => {
  const v = (f: (x: ReturnType<typeof repairs>) => void) => { const x = repairs(); f(x); return codes(x) }
  const ik = (x: ReturnType<typeof repairs>) => x.tables[0].intake as Record<string, unknown> & { columns: unknown[] }
  const withPrice = (x: ReturnType<typeof repairs>) => { ik(x).columns.push('price') }
  { const x = repairs(); ik(x).webhook = true; assert.deepEqual(ok(x).tables[0].intake!.webhook, {}) }
  { const x = repairs(); ik(x).webhook = false; assert.equal(ok(x).tables[0].intake!.webhook, undefined) }
  { const x = repairs(); withPrice(x); ik(x).webhook = { map: { customer: 'billing.name', phone: 'billing.phone', price: 'total', price_cur: 'currency' }, id: 'order_id' }
    assert.deepEqual(ok(x).tables[0].intake!.webhook, { map: { customer: 'billing.name', phone: 'billing.phone', price: 'total', price_cur: 'currency' }, id: 'order_id' }) }
  assert.ok(BLOCKS.some((b) => b.id === 'webhook'))
  assert.deepEqual(v((x) => { ik(x).webhook = 'yes' }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { x: 1 } }), ['UNKNOWN_FIELD'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: {} } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a', phone: 'b', tech: 'c' } } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a', phone: 'b', price_cur: 'c' } } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a', phone: 'b', problem_cur: 'c' } } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a' } } }), ['REQUIRED'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a..b', phone: 'b' } } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a.b.c.d.e.f.g.h.i.j.k', phone: 'b' } } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a.b.c.d.e.f.g.h.i.j', phone: 'b' } } }), [])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: `${'a'.repeat(64)}.${'b'.repeat(64)}.${'c'.repeat(64)}.dddddddd`, phone: 'b' } } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a b', phone: 'b' } } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { id: 'order_id' } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a', phone: 'b' }, id: '' } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'items.01.name', phone: 'b' } } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'items.0.name', phone: 'items.10.p' } } }), [])
  for (const bad of ['__proto__.x', 'a.constructor', 'prototype']) assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: bad, phone: 'b' } } }), ['INVALID'], bad)
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'billing', phone: 'billing.phone' } } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'billing.name', phone: 'billing.phone' } } }), [])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a', phone: 'b' }, id: '__proto__' } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'billing.name', phone: 'b' }, id: 'billing' } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a', phone: 'b' }, id: 'b.x' } }), ['INVALID'])
  assert.deepEqual(v((x) => { ik(x).webhook = { map: { customer: 'a', phone: 'order.id' }, id: 'order.id' } }), [])
  assert.deepEqual(v((x) => { (x.tables[0].columns as Array<Record<string, unknown>>)[7].required = true; ik(x).webhook = { map: { customer: 'a', phone: 'b' } } }), [])
})

test('webhook — change list (on · off · shape)', () => {
  const a = ok(repairs())
  const on: AppSpec = JSON.parse(JSON.stringify(a)); on.tables[0].intake!.webhook = {}
  assert.deepEqual(describeSpecChange(a, on).map((x) => x.code), ['intake_webhook_on'])
  assert.deepEqual(describeSpecChange(on, a).map((x) => x.code), ['intake_webhook_off'])
  const m: AppSpec = JSON.parse(JSON.stringify(on)); m.tables[0].intake!.webhook = { map: { customer: 'a', phone: 'b' } }
  assert.deepEqual(describeSpecChange(on, m).map((x) => x.code), ['intake_webhook_changed'])
})

test('intake — change list (opened · changed · closed)', () => {
  const a = ok(repairs())
  const none: AppSpec = JSON.parse(JSON.stringify(a)); delete none.tables[0].intake
  assert.deepEqual(describeSpecChange(none, a).filter((c) => c.code.startsWith('intake')), [{ code: 'intake_opened', table: 'Repair jobs', values: ['Customer', 'Phone', 'Problem', 'Wanted day', 'Device'] }, { code: 'intake_identify_phone', table: 'Repair jobs', name: 'Phone' }])
  assert.deepEqual(describeSpecChange(a, none).map((c) => c.code), ['intake_closed'])
  const b: AppSpec = JSON.parse(JSON.stringify(a)); delete b.tables[0].intake!.identify
  assert.deepEqual(describeSpecChange(a, b).map((c) => c.code), ['intake_identify_off'])
  const c: AppSpec = JSON.parse(JSON.stringify(a)); c.tables[0].intake!.columns.pop()
  assert.deepEqual(describeSpecChange(a, c).map((x) => x.code), ['intake_changed'])
  const f: AppSpec = JSON.parse(JSON.stringify(a)); f.tables[0].intake!.form = true
  assert.deepEqual(describeSpecChange(a, f).map((x) => x.code), ['intake_form_on'])
  assert.deepEqual(describeSpecChange(f, a).map((x) => x.code), ['intake_form_off'])
  const d: AppSpec = JSON.parse(JSON.stringify(a)); d.tables[0].intake!.identify!.by = 'telegram'
  assert.deepEqual(describeSpecChange(a, d).map((x) => x.code), ['intake_identify_telegram'])
  const e: AppSpec = JSON.parse(JSON.stringify(a)); e.tables.push({ ...JSON.parse(JSON.stringify(a.tables[0])), key: 'jobs2', name: 'Jobs 2' })
  assert.deepEqual(describeSpecChange(a, e).map((x) => x.code), ['table_added', 'column_added', 'intake_opened', 'intake_identify_phone'])
  assert.deepEqual(describeSpecChange(a, a), [])
})

const rooms = (): Record<string, unknown> => ({
  spec: 1, name: 'Rooms',
  tables: [{ key: 'bookings', name: 'Bookings', columns: [
    { key: 'day', label: 'Day', kind: 'date', required: true },
    { key: 'from', label: 'From', kind: 'time', required: true, hint: 'start' },
    { key: 'to', label: 'To', kind: 'time' },
    { key: 'room', label: 'Room', kind: 'choice', options: ['A', 'B'] },
  ], intake: { columns: ['day', 'from', 'to', 'room'] } }],
})

test('time column — passes · plain · text field with a hint in forms · intake column · block list', () => {
  const s = ok(rooms())
  const t = s.tables[0]
  const cols = specTableSchema(t).columns
  const from = cols.find((c) => c.name === 'from')!
  assert.equal(from.type, 'string')
  assert.equal(from.encrypted, undefined)
  assert.equal(from.required, true)
  assert.equal(cols.find((c) => c.name === 'to')!.encrypted, undefined)
  const info = toFormInfo(t, [])
  const f = info.columns.find((c) => c.key === 'from')!
  assert.equal(f.kind, 'text')
  assert.match(f.hint ?? '', /^a time of day as HH:MM.* — start$/)
  assert.ok(BLOCKS.find((b) => b.id === 'table')!.about.includes('time'))
})

test('time column — not for document to columns · cannot change to another kind', () => {
  const r = rooms() as { tables: Array<Record<string, unknown>> }
  r.tables[0].file = { fill: ['day', 'from'] }
  assert.deepEqual(codes(r), ['BAD_REF'])
  const before = ok(rooms())
  const changed = rooms() as { tables: Array<{ columns: Array<Record<string, unknown>> }> }
  changed.tables[0].columns[1].kind = 'text'
  assert.ok(codes(changed, before).length > 0)
})

test('cross-app ref column — shape only · same-app checks skipped · app · table cannot change · left out of same-app delete protection', async () => {
  const { refsPointingTo, crossTargetProblem } = await import('./assembled')
  const x = stock()
  x.tables[1].columns.push({ key: 'cust', label: 'Customer', kind: 'ref', ref: { app: 'cmotherapp001', table: 'items', show: 'name' } })
  const s = ok(x)
  assert.deepEqual(refsPointingTo(s, 'items').map((p) => p.column), ['item'])
  const y = stock(); y.tables[1].columns.push({ key: 'c2', label: 'C2', kind: 'ref', ref: { app: 'cmotherapp001', table: 'nope', show: 'zz' } }); ok(y)
  const bad1 = stock(); bad1.tables[1].columns.push({ key: 'c3', label: 'C3', kind: 'ref', ref: { app: 'Bad Id!', table: 'items', show: 'name' } })
  assert.deepEqual(codes(bad1), ['INVALID'])
  const bad2 = stock(); bad2.tables[1].columns.push({ key: 'c4', label: 'C4', kind: 'ref', ref: { app: 'cmotherapp001', table: 'items', show: 'name', extra: 1 } })
  assert.deepEqual(codes(bad2), ['REQUIRED'])
  const z = stock(); z.tables[1].columns.push({ key: 'cust', label: 'Customer', kind: 'ref', ref: { app: 'cmotherapp002', table: 'items', show: 'name' } })
  assert.deepEqual(codes(z, s), ['REF_TABLE_CHANGED'])
  const w = stock(); w.tables[1].columns.push({ key: 'cust', label: 'Customer', kind: 'ref', ref: { table: 'items', show: 'name' } })
  assert.deepEqual(codes(w, s), ['REF_TABLE_CHANGED'])
  const src = ok(stock())
  assert.equal(crossTargetProblem(src, { app: 'a', table: 'items', show: 'name' }), null)
  assert.equal(crossTargetProblem(src, { app: 'a', table: 'items', show: 'number' }), null)
  assert.match(crossTargetProblem(src, { app: 'a', table: 'moves', show: 'number' })!, /number block/)
  assert.match(crossTargetProblem(src, { app: 'a', table: 'moves', show: 'item' })!, /show names/)
  assert.match(crossTargetProblem(null, { app: 'a', table: 'items', show: 'name' })!, /not an assembled app/)
  const hid = stock(); (hid.tables[0] as Record<string, unknown>).hidden = true; hid.tables[1].columns[0] = { ...hid.tables[1].columns[0], hidden: true }; delete (hid.tables[1] as Record<string, unknown>).sums
  assert.match(crossTargetProblem(ok(hid), { app: 'a', table: 'items', show: 'name' })!, /hidden/)
})

test('cross-app ref column — four displays: name · unconfirmed · deleted row · unreadable (screen text · sums · mail · picking)', async () => {
  const { refCellText } = await import('./sheet-text')
  const { refChoices, refStateOf } = await import('./assembled')
  const items = [{ id: 'r1', label: 'A4' }, { id: 'r2', label: null, mark: 'unconfirmed' as const }]
  const unreadable = [{ id: '', label: null, mark: 'unreadable' as const }]
  assert.equal(refCellText('en', 'r1', items, null), 'A4')
  assert.equal(refCellText('ko', 'r2', items, null), '(확인 전)')
  assert.equal(refCellText('ko', 'zz', items, null), '(지운 줄)')
  assert.equal(refCellText('ko', 'r1', unreadable, null), '(읽을 수 없음)')
  assert.equal(refCellText('en', '', unreadable, null), '')
  assert.deepEqual(refChoices(items).map((x) => x.id), ['r1'])
  assert.deepEqual(refChoices(unreadable), [])
  assert.deepEqual(refStateOf(items, 'r2'), { mark: 'unconfirmed' })
  assert.deepEqual(refStateOf(unreadable, 'r1'), { mark: 'unreadable' })
  const x = stock(); x.tables[1].columns.push({ key: 'cust', label: 'Customer', kind: 'ref', ref: { app: 'cmotherapp001', table: 'items', show: 'name' } })
  ;(x.tables[1] as Record<string, unknown>).sums = [{ key: 'q', label: 'Q', column: 'qty', by: 'column:cust' }]
  const s = ok(x)
  const g = computeSums(s.tables[1], [{ cust: 'r1', qty: 1 }, { cust: 'r2', qty: 2 }, { cust: 'zz', qty: 3 }], { cust: items })[0].groups
  assert.deepEqual(g.map((y) => [y.group, y.label ?? null, y.mark ?? null, y.gone ?? false]), [['r1', 'A4', null, false], ['r2', null, 'unconfirmed', false], ['zz', null, null, true]])
  const g2 = computeSums(s.tables[1], [{ cust: 'r1', qty: 1 }], { cust: unreadable })[0].groups
  assert.equal(g2[0].mark, 'unreadable')
  ;(x as Record<string, unknown>).sends = [{ key: 'm', label: 'M', table: 'moves', to: 'owner', subject: 'For {cust}', body: '-' }]
  const s2 = ok(x)
  const team = { ownerEmail: 'o@example.com', members: [] }
  const mail = (v: string, rr: Record<string, Array<{ id: string; label: string | null; mark?: 'unconfirmed' | 'unreadable' }>>) => buildSpecMail(s2.tables[1], s2.sends![0], { item: 'i', cust: v, qty: 1 }, '2026-11-09', team, null, rr)
  assert.equal((mail('r1', { cust: items }) as { subject: string }).subject, 'For A4')
  assert.equal((mail('r2', { cust: items }) as { subject: string }).subject, 'For ')
  assert.equal((mail('r1', { cust: unreadable }) as { subject: string }).subject, 'For ')
})

test('company DB block companyDb — shape · rows by default · unknown keys refused (company-db.md D1)', () => {
  const base = { spec: 1, name: 'Stock', tables: [{ key: 'items', name: 'Items', columns: [{ key: 'sku', label: 'SKU', kind: 'text' }] }] }
  const ok = validateSpec({ ...base, companyDb: { label: 'ERP', about: ' items table ' } })
  assert.ok(ok.ok); if (ok.ok) assert.deepEqual(ok.spec.companyDb, { label: 'ERP', mode: 'rows', about: 'items table' })
  const ro = validateSpec({ ...base, companyDb: { label: 'ERP', mode: 'read' } })
  assert.ok(ro.ok); if (ro.ok) assert.equal(ro.spec.companyDb?.mode, 'read')
  const bad = (cdb: unknown) => { const r = validateSpec({ ...base, companyDb: cdb }); return r.ok ? null : r.issues.map((i) => `${i.path}:${i.code}`).join(',') }
  assert.equal(bad({ mode: 'rows' }), 'companyDb.label:REQUIRED')
  assert.equal(bad({ label: 'ERP', mode: 'all' }), 'companyDb.mode:INVALID')
  assert.equal(bad({ label: 'ERP', tables: ['items'] }), 'companyDb.tables:UNKNOWN_FIELD')
  assert.equal(bad({ label: 'ERP', about: 'x'.repeat(2001) }), 'companyDb.about:TOO_LONG')
  assert.equal(bad([]), 'companyDb:INVALID')
  const none = validateSpec(base)
  assert.ok(none.ok); if (none.ok) assert.equal(none.spec.companyDb, undefined)
  assert.ok(BLOCKS.some((b) => b.id === 'company_db' && b.field === 'companyDb'))
})

test('lookup block — only turned-on fields · true/false · at least one · unknown fields refused (search.md K1)', () => {
  const base = { spec: 1, name: 'Contracts', tables: [{ key: 'c', name: 'Contracts', columns: [{ key: 'party', label: 'Party', kind: 'text' }] }] }
  const ok = validateSpec({ ...base, lookup: { docs: true, webPages: true, webSearch: false } })
  assert.ok(ok.ok); if (ok.ok) assert.deepEqual(ok.spec.lookup, { docs: true, webPages: true })
  const search = validateSpec({ ...base, lookup: { webSearch: true } })
  assert.ok(search.ok); if (search.ok) assert.deepEqual(search.spec.lookup, { webSearch: true })
  const bad = (l: unknown) => { const r = validateSpec({ ...base, lookup: l }); return r.ok ? null : r.issues.map((i) => `${i.path}:${i.code}`).join(',') }
  assert.equal(bad({}), 'lookup:REQUIRED')
  assert.equal(bad({ docs: false, webPages: false }), 'lookup:REQUIRED')
  assert.equal(bad({ web: true }), 'lookup.web:UNKNOWN_FIELD')
  assert.equal(bad({ docs: 'yes' }), 'lookup.docs:INVALID')
  assert.equal(bad({ docs: 1 }), 'lookup.docs:INVALID')
  assert.equal(bad({ docs: null }), 'lookup.docs:INVALID')
  assert.equal(bad({ docs: true, web: true }), 'lookup.web:UNKNOWN_FIELD')
  assert.equal(bad(true), 'lookup:INVALID')
  assert.equal(bad([]), 'lookup:INVALID')
  assert.equal(bad(null), 'lookup:INVALID')
  const none = validateSpec(base)
  assert.ok(none.ok); if (none.ok) assert.equal(none.spec.lookup, undefined)
  assert.ok(BLOCKS.some((b) => b.id === 'lookup' && b.field === 'lookup'))
})
