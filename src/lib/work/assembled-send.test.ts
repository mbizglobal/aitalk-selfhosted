import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appSendKindOk, validateSpec, type AppSpec } from './assembled'
import { appSendBlocked, appSendColumns, appSendRowProblem, appSendTargetProblem, buildAppSendRow, sameAppSendRow } from './assembled-send'

const orders = (appSends?: unknown): Record<string, unknown> => ({
  spec: 1,
  name: 'Orders',
  tables: [{
    key: 'orders', name: 'Orders',
    columns: [
      { key: 'customer', label: 'Customer', kind: 'text', required: true },
      { key: 'address', label: 'Address', kind: 'longtext' },
      { key: 'qty', label: 'Qty', kind: 'number' },
      { key: 'price', label: 'Price', kind: 'money' },
      { key: 'owner', label: 'Owner', kind: 'person' },
      { key: 'days', label: 'Days', kind: 'computed', block: 'days_until', from: 'due' },
      { key: 'due', label: 'Due', kind: 'date' },
    ],
    status: { values: ['new', 'confirmed', 'shipped'], start: 'new', moves: [{ from: 'new', to: 'confirmed' }, { from: 'confirmed', to: 'shipped' }], lockedIn: ['shipped'] },
    number: { prefix: 'OR-', year: true, digits: 3 },
  }],
  ...(appSends !== undefined ? { appSends } : {}),
})
const send = (over: Record<string, unknown> = {}) => ({ key: 'to_ship', label: 'To shipping', table: 'orders', to: { app: 'cmapp0000000000000000000b', table: 'shipments' }, map: { receiver: 'customer', addr: 'address', qty: 'qty', order_no: 'number' }, ...over })
const codes = (raw: unknown, before: AppSpec | null = null) => { const r = validateSpec(raw, before); return r.ok ? [] : r.issues.map((x) => x.code) }
const ok = (raw: unknown, before: AppSpec | null = null): AppSpec => { const r = validateSpec(raw, before); if (!r.ok) assert.fail(JSON.stringify(r.issues)); return r.spec }

const shipping: AppSpec = ok({
  spec: 1, name: 'Shipping',
  tables: [{
    key: 'shipments', name: 'Shipments',
    columns: [
      { key: 'receiver', label: 'Receiver', kind: 'text', required: true },
      { key: 'addr', label: 'Address', kind: 'longtext' },
      { key: 'qty', label: 'Qty', kind: 'number' },
      { key: 'order_no', label: 'Order', kind: 'text' },
      { key: 'cost', label: 'Cost', kind: 'money', options: ['CHF'] },
      { key: 'kind', label: 'Kind', kind: 'choice', options: ['Parcel', 'Letter'] },
      { key: 'who', label: 'Who', kind: 'person' },
      { key: 'old', label: 'Old', kind: 'text', hidden: true },
    ],
  }],
})

test('send-on shape — table · to · map (no person · computed columns · number · status only with their block) · allowWhen · 10', () => {
  const s = ok(orders([send({ allowWhen: { status: ['confirmed'], confirmed: true } })]))
  assert.deepEqual(s.appSends?.[0].map, { addr: 'address', order_no: 'number', qty: 'qty', receiver: 'customer' })
  assert.deepEqual(s.appSends?.[0].allowWhen, { status: ['confirmed'], confirmed: true })
  assert.deepEqual(codes(orders([send({ table: 'nope' })])), ['BAD_REF'])
  assert.deepEqual(codes(orders([send({ map: { receiver: 'owner' } })])), ['BAD_REF'])
  assert.deepEqual(codes(orders([send({ map: { receiver: 'days' } })])), ['BAD_REF'])
  assert.deepEqual(codes(orders([send({ map: {} })])), ['INVALID'])
  assert.deepEqual(codes(orders([send({ to: { app: 'x y', table: 'shipments' } })])), ['INVALID'])
  assert.deepEqual(codes(orders([send({ allowWhen: { status: ['zzz'] } })])), ['BAD_REF'])
  assert.deepEqual(codes(orders([send({ allowWhen: { confirmed: false } })])), ['INVALID'])
  assert.deepEqual(codes(orders([send(), send()])), ['DUPLICATE'])
  assert.deepEqual(codes(orders(Array.from({ length: 11 }, (_, i) => send({ key: `s${i}` })))), ['TOO_MANY'])
  assert.deepEqual(codes(orders([send({ extra: 1 })])), ['UNKNOWN_FIELD'])
})

test('send-on change rules — cannot be removed (hide) · table cannot change · to · map may change', () => {
  const before = ok(orders([send()]))
  assert.deepEqual(codes(orders([]), before), ['APP_SEND_REMOVED'])
  ok(orders([send({ hidden: true })]), before)
  ok(orders([send({ to: { app: 'cmapp0000000000000000000c', table: 'x' } })]), before)
  const two = ok({ ...orders([send()]), tables: [...(orders().tables as unknown[]), { key: 'other', name: 'Other', columns: [{ key: 'customer', label: 'C', kind: 'text' }] }] })
  assert.deepEqual(codes({ ...orders([send({ table: 'other', map: { receiver: 'customer' } })]), tables: [...(orders().tables as unknown[]), { key: 'other', name: 'Other', columns: [{ key: 'customer', label: 'C', kind: 'text' }] }] }, two), ['APP_SEND_TABLE_CHANGED'])
})

test('kind matching', () => {
  assert.equal(appSendKindOk('text', 'text'), true)
  assert.equal(appSendKindOk('longtext', 'text'), true)
  assert.equal(appSendKindOk('text', 'longtext'), false)
  assert.equal(appSendKindOk('text', 'serial'), true)
  assert.equal(appSendKindOk('text', 'status'), true)
  assert.equal(appSendKindOk('choice', 'text'), true)
  assert.equal(appSendKindOk('number', 'text'), false)
  assert.equal(appSendKindOk('choice', 'status'), false)
  assert.equal(appSendKindOk('money', 'number'), false)
  assert.equal(appSendKindOk('date', 'date'), true)
})

test('receiving side check — table · hidden · person column · kind · required columns', () => {
  const a = ok(orders([send()]))
  const at = a.tables[0]
  const s = a.appSends![0]
  assert.equal(appSendTargetProblem(shipping, at, s), null)
  assert.match(appSendTargetProblem(null, at, s)!, /not an assembled app/)
  assert.match(appSendTargetProblem(shipping, at, { ...s, to: { ...s.to, table: 'nope' } })!, /not a table/)
  assert.match(appSendTargetProblem(shipping, at, { ...s, map: { ...s.map, old: 'customer' } })!, /hidden/)
  assert.match(appSendTargetProblem(shipping, at, { ...s, map: { ...s.map, who: 'customer' } })!, /person column/)
  assert.match(appSendTargetProblem(shipping, at, { ...s, map: { ...s.map, qty: 'customer' } })!, /cannot go into/)
  const { receiver: _r, ...rest } = s.map
  assert.match(appSendTargetProblem(shipping, at, { ...s, map: rest })!, /required/)
  const hiddenT: AppSpec = { ...shipping, tables: [{ ...shipping.tables[0], hidden: true }] }
  assert.match(appSendTargetProblem(hiddenT, at, s)!, /hidden/)
})

test('row building — empty values dropped · 0 · false kept · empty status = start value · currency only with an amount · same regardless of key order', () => {
  const a = ok(orders())
  const at = a.tables[0]
  const s = { key: 'k', label: 'L', table: 'orders', to: { app: 'x', table: 'shipments' }, map: { receiver: 'customer', addr: 'address', qty: 'qty', cost: 'price', st: 'status', order_no: 'number' } }
  const r = buildAppSendRow(at, s, { customer: 'Kim', address: '  ', qty: 0, price: '12.50', price_cur: 'CHF', number: 'OR-2026-001' })
  assert.deepEqual(r, { cost: '12.50', cost_cur: 'CHF', order_no: 'OR-2026-001', qty: 0, receiver: 'Kim', st: 'new' })
  assert.deepEqual(buildAppSendRow(at, s, { customer: 'Kim', price_cur: 'CHF' }), { receiver: 'Kim', st: 'new' })
  assert.equal(sameAppSendRow({ a: 1, b: 2 }, { b: 2, a: 1 }), true)
  assert.equal(sameAppSendRow({ a: 1 }, { a: '1' }), false)
  assert.deepEqual(appSendColumns(shipping.tables[0], { ...s, map: { cost: 'price', receiver: 'customer' } }), ['cost', 'cost_cur', 'receiver'])
})

test('allowWhen — status (empty = start value) · confirmed (row column)', () => {
  const at = ok(orders()).tables[0]
  const s = { key: 'k', label: 'L', table: 'orders', to: { app: 'x', table: 'y' }, map: { a: 'customer' }, allowWhen: { status: ['new'], confirmed: true as const } }
  assert.equal(appSendBlocked(at, s, {}, true), null)
  assert.match(appSendBlocked(at, s, {}, false)!, /confirmed/)
  assert.match(appSendBlocked(at, s, { status: 'shipped' }, true)!, /only for rows in new/)
})

test('values fit for the receiving table — empty row · empty required value · outside choices · outside currencies', () => {
  const bt = shipping.tables[0]
  assert.match(appSendRowProblem(bt, {})!, /empty/)
  assert.match(appSendRowProblem(bt, { qty: 1 })!, /Receiver.*required/)
  assert.equal(appSendRowProblem(bt, { receiver: 'Kim', kind: 'Parcel' }), null)
  assert.match(appSendRowProblem(bt, { receiver: 'Kim', kind: 'Box' })!, /not one of the choices/)
  assert.match(appSendRowProblem(bt, { receiver: 'Kim', cost: '1', cost_cur: 'EUR' })!, /takes CHF/)
})
