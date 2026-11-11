import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSpec, type AppSpec } from './assembled'
import { extractWebhook, readPath, webhookIdOf, allowWebhookCall, __resetWebhookLimiter, WEBHOOK_PER_MINUTE } from './webhook'

const spec = (webhook: unknown): AppSpec => {
  const r = validateSpec({
    spec: 1, name: 'Orders',
    tables: [{
      key: 'orders', name: 'Orders',
      columns: [
        { key: 'customer', label: 'Customer', kind: 'text', required: true },
        { key: 'amount', label: 'Amount', kind: 'money' },
        { key: 'qty', label: 'Qty', kind: 'number' },
        { key: 'paid', label: 'Paid', kind: 'yesno' },
      ],
      intake: { columns: ['customer', 'amount', 'qty', 'paid'], webhook },
    }],
  }, null)
  if (!r.ok) assert.fail(JSON.stringify(r.issues))
  return r.spec
}
const t = (s: AppSpec) => s.tables[0]
const ex = (s: AppSpec, body: unknown, h: string | null = null) => extractWebhook(t(s), t(s).intake!.webhook!, body, h)

test('flat — accepted keys · _cur · unknown keys refused · nested refused · id = header only', () => {
  const s = spec(true)
  assert.deepEqual(ex(s, { customer: 'Kim', amount: '12.50', amount_cur: 'CHF', qty: 0, paid: false }), { ok: true, values: { customer: 'Kim', amount: '12.50', amount_cur: 'CHF', qty: 0, paid: false }, id: null })
  const r = ex(s, { customer: 'Kim', order_id: 'A1' })
  assert.equal(r.ok, false); assert.match((r as { detail: string }).detail, /order_id/)
  assert.equal(ex(s, { customer: ['x'] }).ok, false)
  assert.equal(ex(s, { customer: { a: 1 } }).ok, false)
  assert.deepEqual(ex(s, { customer: null }), { ok: true, values: { customer: null }, id: null })
  assert.deepEqual(ex(s, { customer: 'Kim' }, '  A-1 ').ok && (ex(s, { customer: 'Kim' }, '  A-1 ') as { id: string }).id, 'A-1')
  assert.equal((ex(s, { customer: 'Kim' }, '   ') as { id: string | null }).id, null)
  assert.equal((ex(s, { customer: 'Kim' }, '') as { id: string | null }).id, null)
  assert.equal(ex(s, { customer: 'Kim' }, 'x'.repeat(201)).ok, false)
  assert.equal(ex(s, { customer: 'Kim' }, 'x'.repeat(200)).ok, true)
  assert.equal(ex(s, ['x']).ok, false)
  assert.equal(ex(s, null).ok, false)
})

test('map — paths · extras ignored · arrays · missing · null · nested', () => {
  const s = spec({ map: { customer: 'billing.name', amount: 'total', amount_cur: 'cur', qty: 'items.0.qty', paid: 'flags.paid' } })
  const body = { billing: { name: 'Muster AG', street: 'x' }, total: '120.00', cur: 'EUR', items: [{ qty: 3 }, { qty: 9 }], flags: { paid: true }, extra: { deep: [1, 2] } }
  assert.deepEqual(ex(s, body), { ok: true, values: { customer: 'Muster AG', amount: '120.00', amount_cur: 'EUR', qty: 3, paid: true }, id: null })
  assert.deepEqual(ex(s, { billing: { name: 'A' }, total: null }), { ok: true, values: { customer: 'A', amount: null }, id: null })
  assert.equal(ex(s, { billing: { name: { first: 'A' } } }).ok, false)
  assert.equal(ex(s, { billing: { name: 'A' }, items: [{ qty: [1] }] }).ok, false)
  assert.deepEqual(ex(s, { billing: { name: '' }, items: [{ qty: 0 }], flags: { paid: false } }), { ok: true, values: { customer: '', qty: 0, paid: false }, id: null })
})

test('readPath — own keys only · array index · out of range', () => {
  const o = JSON.parse('{"a":{"b":[{"c":1}]},"__proto__":{"x":1}}')
  assert.equal(readPath(o, 'a.b.0.c'), 1)
  assert.equal(readPath(o, 'a.b.1.c'), undefined)
  assert.equal(readPath(o, 'a.b.x'), undefined)
  assert.equal(readPath({ a: {} }, 'a.constructor'), undefined)
  assert.equal(readPath({ a: {} }, 'a.toString'), undefined)
  assert.equal(readPath({}, '__proto__'), undefined)
  assert.deepEqual(readPath(o, '__proto__.x'), 1)
  assert.equal(readPath({ a: 'text' }, 'a.length'), undefined)
  assert.equal(readPath({ a: [1, 2] }, 'a.01'), undefined)
  assert.equal(readPath({ a: [1, 2] }, 'a.0'), 1)
})

test('request id — path then header then refused · 123 ≡ "123" · unusable values', () => {
  const s = spec({ map: { customer: 'name' }, id: 'order.id' })
  const id = (body: unknown, h: string | null = null) => { const r = ex(s, body, h); return r.ok ? r.id : `INVALID` }
  assert.equal(id({ name: 'A', order: { id: 123 } }), '123')
  assert.equal(id({ name: 'A', order: { id: '123' } }), '123')
  assert.equal(id({ name: 'A', order: { id: ' x ' } }), 'x')
  for (const bad of ['', '   ', null, true, 1.5, { a: 1 }, [1], 'x'.repeat(201)]) {
    assert.equal(id({ name: 'A', order: { id: bad } }), 'INVALID', JSON.stringify(bad))
    assert.equal(id({ name: 'A', order: { id: bad } }, 'H-1'), 'H-1', `머리말 대체 ${JSON.stringify(bad)}`)
    assert.equal(id({ name: 'A', order: { id: bad } }, 'x'.repeat(201)), 'INVALID', `못 쓰는 머리말 ${JSON.stringify(bad)}`)
  }
  assert.equal(id({ name: 'A' }), 'INVALID')
  assert.equal(id({ name: 'A' }, 'H-1'), 'H-1')
  assert.equal(id(JSON.parse('{"name":"A","order":{"id":9007199254740993}}')), 'INVALID')
  assert.equal(id(JSON.parse('{"name":"A","order":{"id":9007199254740991}}')), '9007199254740991')
  assert.equal(webhookIdOf(-5), '-5')
  assert.equal(webhookIdOf('x'.repeat(200)), 'x'.repeat(200))
})

test('one address 120 per minute — refused above · allowed again after a minute', () => {
  __resetWebhookLimiter()
  const now = 1_000_000
  for (let i = 0; i < WEBHOOK_PER_MINUTE; i++) assert.equal(allowWebhookCall('tok', now), true)
  assert.equal(allowWebhookCall('tok', now), false)
  assert.equal(allowWebhookCall('other', now), true)
  assert.equal(allowWebhookCall('tok', now + 60_001), true)
  __resetWebhookLimiter()
})
