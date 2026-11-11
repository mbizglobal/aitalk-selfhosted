import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKS, validateSpec } from './assembled'
import { buildSpecHttp, canonicalJson, httpIdemKey, httpPrint, specHttpBlocked } from './assembled-http'
import { hostOf, httpUrlValid, mergeHttpCred, urlHint } from './http-target'
import { authHeaders } from './work-senders/http'

const orders = (): Record<string, unknown> & { tables: Array<Record<string, unknown>>; sends: Array<Record<string, unknown>> } => ({
  spec: 1, name: 'Orders',
  tables: [{
    key: 'orders', name: 'Orders', number: { prefix: 'OR' },
    columns: [
      { key: 'customer', label: 'Customer', kind: 'text' }, { key: 'amount', label: 'Amount', kind: 'money' }, { key: 'qty', label: 'Qty', kind: 'number' },
      { key: 'paid', label: 'Paid', kind: 'yesno' }, { key: 'due', label: 'Due', kind: 'date' }, { key: 'secret', label: 'Secret', kind: 'text', hidden: true },
    ],
    status: { values: ['new', 'confirmed', 'done'], start: 'new', moves: [['new', 'confirmed'], ['confirmed', 'done']], lockedIn: ['done'] },
    alerts: [{ key: 'soon', label: 'Soon', date: 'due', daysBefore: 1 }],
  }],
  sends: [
    { key: 'erp', label: 'ERP', table: 'orders', via: 'http', to: 'api', map: { order_no: 'number', customer: 'customer', amount: 'amount', qty: 'qty', paid: 'paid', state: 'status' }, allowWhen: { status: ['confirmed'], confirmed: true } },
    { key: 'mail', label: 'Mail', table: 'orders', to: 'owner', subject: 'Order {number}', body: 'x' },
  ],
})
const codes = (raw: unknown): string[] => { const r = validateSpec(raw, null); return r.ok ? [] : r.issues.map((i) => i.code) }
const v = (f: (x: ReturnType<typeof orders>) => void) => { const x = orders(); f(x); return codes(x) }

test('HTTP — passes · shape · block list', () => {
  const r = validateSpec(orders(), null)
  assert.ok(r.ok, JSON.stringify(!r.ok && r.issues))
  const s = r.spec.sends!.find((x) => x.key === 'erp')!
  assert.equal(s.via, 'http')
  assert.equal(s.to, 'api')
  assert.equal(s.subject, '')
  assert.equal(s.body, '')
  assert.deepEqual(Object.keys(s.map!), ['amount', 'customer', 'order_no', 'paid', 'qty', 'state'])
  assert.deepEqual(s.allowWhen, { status: ['confirmed'], confirmed: true })
  assert.ok(BLOCKS.some((b) => b.id === 'http_send'))
  assert.deepEqual(v((x) => { x.sends[0].allowWhen = { column: 'qty', min: 1 } }), [])
  const again = validateSpec(JSON.parse(JSON.stringify(r.spec)), null)
  assert.ok(again.ok, JSON.stringify(!again.ok && again.issues))
})

test('HTTP — wrong ones', () => {
  assert.deepEqual(v((x) => { x.sends[0].to = 'owner' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].subject = 'x' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].body = 'x' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].attachDoc = 'x' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].map = {} }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].map = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, 'qty'])) }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].map = { qty: 'nope' } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.sends[0].map = { qty: 'secret' } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.sends[0].map = { '1bad': 'qty' } }), ['BAD_KEY'])
  assert.deepEqual(v((x) => { x.sends[0].map = { 'has-dash': 'qty' } }), ['BAD_KEY'])
  assert.deepEqual(v((x) => { x.sends[0].allowWhen = { confirmed: false } }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].allowWhen = { status: ['nope'] } }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.sends[1].allowWhen = { confirmed: true } }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[1].map = { a: 'qty' } }), ['INVALID'])
  assert.deepEqual(v((x) => { ((x.tables[0].alerts as Array<Record<string, unknown>>)[0]).send = 'erp' }), ['INVALID'])
  assert.deepEqual(v((x) => { ((x.tables[0].alerts as Array<Record<string, unknown>>)[0]).telegram = 'erp' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].table = 'nope' }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.sends[1].key = 'erp' }), ['DUPLICATE'])
})

test('HTTP — body to send · empty values · 0 · key · fingerprint', () => {
  const r = validateSpec(orders(), null)
  assert.ok(r.ok)
  const t = r.spec.tables[0]
  const s = r.spec.sends!.find((x) => x.key === 'erp')!
  const row = { customer: 'Muster AG', amount: '1250.00', amount_cur: 'CHF', qty: 0, paid: false, number: 'OR-2026-014', status: 'confirmed' }
  const body = buildSpecHttp(r.spec, t, s, 'row1', row, '2026-11-10', {})
  assert.deepEqual(body, { app: 'Orders', table: 'orders', send: 'erp', rowId: 'row1', data: { amount: { amount: '1250.00', currency: 'CHF' }, customer: 'Muster AG', order_no: 'OR-2026-014', paid: 'no', qty: '0', state: 'confirmed' } })
  const b2 = buildSpecHttp(r.spec, t, s, 'row1', { customer: '  ', amount: '', qty: null }, '2026-11-10', {})
  assert.equal(b2.data.customer, null)
  assert.equal(b2.data.amount, null)
  assert.equal(b2.data.qty, null)
  assert.equal(b2.data.state, 'new')
  assert.equal(b2.data.order_no, null)
  const shuffled = { data: { ...body.data }, rowId: 'row1', send: 'erp', table: 'orders', app: 'Orders' }
  assert.equal(canonicalJson(shuffled), canonicalJson(body))
  assert.equal(httpIdemKey('p1', shuffled), httpIdemKey('p1', body))
  assert.notEqual(httpIdemKey('p1', body), httpIdemKey('p2', body))
  assert.notEqual(httpIdemKey('p1', body), httpIdemKey('p1', { ...body, app: 'Orders 2' }))
  assert.equal(httpIdemKey('p1', body).length, 32)
  assert.notEqual(httpPrint(body), httpPrint(b2))
  const pr = validateSpec({ ...orders(), sends: [{ key: 'p', label: 'P', table: 'orders', via: 'http', to: 'api', map: JSON.parse('{"__proto__":"customer"}') }] }, null)
  assert.ok(pr.ok, JSON.stringify(!pr.ok && pr.issues))
  const pb = buildSpecHttp(pr.spec, pr.spec.tables[0], pr.spec.sends![0], 'r', { customer: 'Alice' }, '2026-11-10', {})
  assert.equal(Object.getOwnPropertyDescriptor(pb.data, '__proto__')?.value, 'Alice')
  assert.ok(canonicalJson(pb).includes('"__proto__":"Alice"'))
  // allowWhen + confirmed
  assert.equal(specHttpBlocked(t, s, row, true, '2026-11-10'), null)
  assert.match(specHttpBlocked(t, s, row, false, '2026-11-10') ?? '', /confirmed rows/)
  assert.match(specHttpBlocked(t, s, { ...row, status: 'new' }, true, '2026-11-10') ?? '', /only for rows in confirmed/)
})

test('HTTP — address · what is shown', () => {
  assert.equal(httpUrlValid('https://hooks.zapier.com/hooks/catch/123/abcdef/'), true)
  assert.equal(httpUrlValid('http://example.com/x'), false)
  assert.equal(httpUrlValid('https://user:pw@example.com/x'), false)
  assert.equal(httpUrlValid('not a url'), false)
  assert.equal(httpUrlValid(`https://e.com/${'a'.repeat(2000)}`), false)
  assert.equal(hostOf('https://hooks.zapier.com/hooks/catch/123/abcdef/'), 'hooks.zapier.com')
  const hint = urlHint('https://hooks.zapier.com/hooks/catch/123/abcdef/')
  assert.equal(hint, 'hooks.zapier.com/hooks/c…')
  assert.ok(!hint.includes('abcdef'))
})

test('HTTP — merging on save', () => {
  const old = { authType: 'bearer', bearerToken: 'T1', url: 'https://a.example/x' }
  assert.deepEqual(mergeHttpCred(old, { authType: 'bearer', bearerToken: '' }, 'https://b.example/y'), { cred: { authType: 'bearer', bearerToken: 'T1', url: 'https://b.example/y' } })
  assert.deepEqual(mergeHttpCred(old, { authType: 'bearer', bearerToken: 'T2' }, undefined), { cred: { authType: 'bearer', bearerToken: 'T2', url: 'https://a.example/x' } })
  assert.deepEqual(mergeHttpCred(old, { authType: 'apiKey', authHeaderValue: '' }, undefined), { error: 'EMPTY_SECRET' })
  assert.deepEqual(mergeHttpCred(old, { authType: 'apiKey', authHeaderName: 'X-Key', authHeaderValue: 'v' }, undefined), { cred: { authType: 'apiKey', authHeaderName: 'X-Key', authHeaderValue: 'v', url: 'https://a.example/x' } })
  assert.deepEqual(mergeHttpCred(old, { authType: 'none' }, undefined), { cred: { authType: 'none', url: 'https://a.example/x' } })
  assert.deepEqual(mergeHttpCred({}, { authType: 'apiKey', authHeaderName: 'Idempotency-Key', authHeaderValue: 'v' }, 'https://a.example/'), { error: 'RESERVED_HEADER' })
  assert.deepEqual(mergeHttpCred({}, { authType: 'apiKey', authHeaderName: 'content-type', authHeaderValue: 'v' }, 'https://a.example/'), { error: 'RESERVED_HEADER' })
  assert.deepEqual(mergeHttpCred({}, { authType: 'apiKey', authHeaderName: 'bad name', authHeaderValue: 'v' }, 'https://a.example/'), { error: 'BAD_HEADER' })
  assert.deepEqual(mergeHttpCred({}, { authType: 'bearer', bearerToken: '' }, 'https://a.example/'), { error: 'EMPTY_SECRET' })
  assert.deepEqual(mergeHttpCred({}, { authType: 'basic', basicUser: ' ' }, 'https://a.example/'), { error: 'EMPTY_SECRET' })
  assert.deepEqual(mergeHttpCred({}, { authType: 'none' }, 'http://a.example/'), { error: 'BAD_URL' })
  assert.deepEqual(mergeHttpCred(old, { authType: 'bearer' }, null), { error: 'NO_URL' })
  assert.deepEqual(mergeHttpCred(old, { authType: 'bearer' }, ''), { cred: { authType: 'bearer', bearerToken: 'T1', url: 'https://a.example/x' } })
  assert.deepEqual(mergeHttpCred(old, { authType: 'bearer' }, '   '), { cred: { authType: 'bearer', bearerToken: 'T1', url: 'https://a.example/x' } })
  assert.deepEqual(mergeHttpCred({}, { authType: 'bearer', bearerToken: 'T' }, undefined), { error: 'NO_URL' })
  assert.deepEqual(mergeHttpCred({}, { authType: 'bearer', bearerToken: '   ' }, 'https://a.example/'), { error: 'EMPTY_SECRET' })
  assert.deepEqual(mergeHttpCred({}, { authType: 'apiKey', authHeaderName: 'X-K', authHeaderValue: ' ' }, 'https://a.example/'), { error: 'EMPTY_SECRET' })
  assert.deepEqual(mergeHttpCred({}, { authType: 'weird' }, undefined), { error: 'BAD_AUTH_TYPE' })
})

test('HTTP — auth header (empty value · blocked name = not sent)', () => {
  assert.equal(authHeaders({ authType: 'bearer', bearerToken: '' }), null)
  assert.equal(authHeaders({ authType: 'bearer', bearerToken: '   ' }), null)
  assert.equal(authHeaders({ authType: 'apiKey', authHeaderName: 'X-Key', authHeaderValue: '' }), null)
  assert.equal(authHeaders({ authType: 'apiKey', authHeaderName: 'Idempotency-Key', authHeaderValue: 'v' }), null)
  assert.equal(authHeaders({ authType: 'basic', basicUser: '' }), null)
  assert.deepEqual(authHeaders({ authType: 'bearer', bearerToken: 't' }), { Authorization: 'Bearer t' })
})
