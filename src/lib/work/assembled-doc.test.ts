import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { validateSpec, specTableSchema, type AppSpec } from './assembled'
import { buildDocModel, docDate, docFileName, docHash, docMoney, docValue, parseDocFp, renderDoc } from './assembled-doc'
import { describeSpecChange } from './assembled-change'
import { checkPaper } from './pdf-paper'

const app = (docs: unknown[], extra: Record<string, unknown> = {}, sends?: unknown[]): Record<string, unknown> => ({
  spec: 1, name: 'Repairs',
  tables: [{
    key: 'jobs', name: 'Repair jobs',
    columns: [
      { key: 'customer', label: 'Customer', kind: 'text', required: true },
      { key: 'device', label: 'Device', kind: 'choice', options: ['Laptop', 'Phone'] },
      { key: 'problem', label: 'Problem', kind: 'longtext' },
      { key: 'received', label: 'Received', kind: 'date' },
      { key: 'price', label: 'Price', kind: 'money' },
      { key: 'urgent', label: 'Urgent', kind: 'yesno' },
      { key: 'secret', label: 'Internal', kind: 'text', hidden: true },
      { key: 'owner', label: 'Owner', kind: 'person' },
    ],
    number: { prefix: 'RP-', digits: 3 },
    status: { values: ['received', 'done'], start: 'received', moves: [['received', 'done']], lockedIn: ['done'] },
    docs,
    ...extra,
  }],
  ...(sends ? { sends } : {}),
})
const ok = (raw: unknown, before: AppSpec | null = null): AppSpec => { const r = validateSpec(raw, before); if (!r.ok) assert.fail(JSON.stringify(r.issues)); return r.spec }
const codes = (raw: unknown, before: AppSpec | null = null): string[] => { const r = validateSpec(raw, before); return r.ok ? [] : r.issues.map((x) => x.code) }
const receipt = { key: 'receipt', label: 'Repair receipt', title: 'Repair receipt {number}', intro: 'We received your {device} on {received}.', fields: ['customer', 'device', 'problem', 'price', 'urgent', 'number', 'status'], outro: 'Keep this receipt.', sign: ['Customer', 'Shop'], lang: 'de' }

test('validator — passes · two sheet columns · block list', () => {
  const s = ok(app([receipt]))
  const names = specTableSchema(s.tables[0]).columns.map((c) => c.name)
  assert.ok(names.includes('docfile_receipt') && names.includes('docfp_receipt'))
  const fc = specTableSchema(s.tables[0]).columns.find((c) => c.name === 'docfile_receipt')!
  assert.equal(fc.encrypted, undefined)
})

test('validator — wrong ones', () => {
  const one = (d: Record<string, unknown>) => codes(app([d]))
  assert.ok(one({ ...receipt, fields: ['secret'] }).includes('BAD_REF'), '숨긴 칸')
  assert.ok(one({ ...receipt, intro: 'see {secret}' }).includes('BAD_REF'), '글 속 숨긴 칸')
  assert.ok(one({ ...receipt, title: 'x {nope}' }).includes('BAD_REF'), '없는 칸')
  assert.ok(one({ ...receipt, lang: 'es' }).includes('INVALID'))
  assert.ok(one({ ...receipt, title: '' }).includes('REQUIRED'))
  assert.ok(one({ ...receipt, sign: ['a', 'b', 'c', 'd'] }).includes('INVALID'))
  assert.ok(one({ ...receipt, letterhead: { file: 'x', top: 500 } }).includes('INVALID'))
  assert.ok(one({ ...receipt, extra: 1 }).includes('UNKNOWN_FIELD'))
  assert.ok(codes(app([receipt, receipt])).includes('DUPLICATE'))
  const r = app([]) as { tables: Array<{ columns: Array<Record<string, unknown>> }> }
  r.tables[0].columns.push({ key: 'docfile_x', label: 'X', kind: 'text' })
  assert.ok(codes(r).includes('RESERVED'))
})

test('templates are hidden, never removed · a hidden template may use hidden columns · change list', () => {
  const a = ok(app([receipt]))
  assert.ok(codes(app([]), a).includes('DOC_REMOVED'))
  const hid = ok(app([{ ...receipt, hidden: true, fields: ['secret'] }]), a)
  assert.ok(specTableSchema(hid.tables[0]).columns.some((c) => c.name === 'docfile_receipt'), '숨겨도 칸은 남는다')
  const ch = describeSpecChange(a, hid).map((x) => x.code)
  assert.ok(ch.includes('doc_hidden'))
  assert.ok(describeSpecChange(null, a).some((x) => x.code === 'doc_added'))
})

test('send attachDoc — only visible templates of the same table · not on alerts', () => {
  const send = { key: 'mail', label: 'Mail', table: 'jobs', to: 'owner', subject: 'Receipt {number}', body: 'Attached.', attachDoc: 'receipt' }
  assert.deepEqual(codes(app([receipt], {}, [send])), [])
  assert.ok(codes(app([receipt], {}, [{ ...send, attachDoc: 'nope' }])).includes('BAD_REF'))
  assert.ok(codes(app([{ ...receipt, hidden: true }], {}, [send])).includes('BAD_REF'))
  const withAlert = app([receipt], { alerts: [{ key: 'a', label: 'A', date: 'received', daysAfter: 1, send: 'mail' }] }, [send])
  assert.ok(codes(withAlert).includes('INVALID'))
})

test('text form — dates · money · yes/no · empty values', () => {
  assert.equal(docDate('2026-11-08', 'de'), '08.11.2026')
  assert.equal(docDate('2026-11-08', 'en'), '8 Nov 2026')
  assert.equal(docDate('2026-11-08', 'ko'), '2026. 11. 08.')
  assert.equal(docMoney('1250.00', 'CHF', 'de'), 'CHF 1’250.00')
  assert.equal(docMoney('1234567.5', 'EUR', 'en'), 'EUR 1,234,567.50')
  assert.equal(docMoney('-5', null, 'fr'), '-5.00')
  assert.equal(docMoney('0.005', 'CHF', 'en'), 'CHF 0.01')
  const t = ok(app([receipt])).tables[0]
  assert.equal(docValue(t, 'urgent', { urgent: true }, '2026-11-08', {}, 'fr'), 'Oui')
  assert.equal(docValue(t, 'urgent', { urgent: false }, '2026-11-08', {}, 'ko'), '아니요')
  assert.equal(docValue(t, 'problem', {}, '2026-11-08', {}, 'de'), '—')
  assert.equal(docValue(t, 'status', {}, '2026-11-08', {}, 'de'), 'received')
})

test('fingerprint — same values = same fingerprint · column names · changes when values change · name · fingerprint text', () => {
  const s = ok(app([receipt]))
  const t = s.tables[0], d = t.docs![0]
  const row = { customer: 'Maria', device: 'Laptop', received: '2026-11-08', price: '150.00', price_cur: 'CHF', number: 'RP-014' }
  const h1 = docHash(buildDocModel(t, d, 'Repairs', row, '2026-11-08', {}, null))
  assert.equal(h1, docHash(buildDocModel(t, d, 'Repairs', { ...row }, '2026-11-08', {}, null)))
  assert.notEqual(h1, docHash(buildDocModel(t, d, 'Repairs', { ...row, price: '160.00' }, '2026-11-08', {}, null)))
  const t2 = { ...t, columns: t.columns.map((c) => (c.key === 'customer' ? { ...c, label: 'Client' } : c)) }
  assert.notEqual(h1, docHash(buildDocModel(t2, d, 'Repairs', row, '2026-11-08', {}, null)), '칸 이름만 바뀌어도 다름(R3 codex)')
  assert.equal(docFileName(t, d, row), 'Repair receipt-RP-014.pdf')
  assert.equal(docFileName(t, { ...d, title: 'Receipt', fields: ['customer'] }, row), 'Repair receipt.pdf', '번호가 문서에 없으면 이름에도 없다')
  assert.deepEqual(parseDocFp('abc:2026-11-08'), { hash: 'abc', day: '2026-11-08' })
  assert.equal(parseDocFp('abc'), null)
})

test('drawing — portrait A4 · Korean · long text over several pages · refused above 20 pages · letterhead', async () => {
  const s = ok(app([{ ...receipt, lang: 'ko' }]))
  const t = s.tables[0], d = t.docs![0]
  const row = { customer: '김철수', device: 'Laptop', problem: '화면이 깨짐 '.repeat(400), received: '2026-11-08', number: 'RP-014' }
  const pdf = await renderDoc(buildDocModel(t, d, 'Repairs', row, '2026-11-08', {}, null), null, 'Repairs')
  const doc = await PDFDocument.load(pdf)
  assert.ok(doc.getPageCount() >= 2, `pages ${doc.getPageCount()}`)
  const p = doc.getPage(0).getSize()
  assert.ok(Math.abs(p.width - 595.28) < 1 && Math.abs(p.height - 841.89) < 1)
  await assert.rejects(renderDoc(buildDocModel(t, d, 'Repairs', { ...row, problem: '긴 글 '.repeat(30000) }, '2026-11-08', {}, null), null, 'Repairs'), /at most 20/)
  const lh = await PDFDocument.create(); lh.addPage([595.28, 841.89]).drawRectangle({ x: 0, y: 800, width: 595, height: 40 }); const paper = Buffer.from(await lh.save())
  const empty = await PDFDocument.create(); empty.addPage([595.28, 841.89])
  await assert.rejects(renderDoc(buildDocModel(t, { ...d, letterhead: { file: 'f1' } }, 'Repairs', { customer: 'x' }, '2026-11-08', {}, 'sha'), Buffer.from(await empty.save()), 'Repairs'), /cannot be used/)
  assert.equal(await checkPaper(paper), null)
  const wide = await PDFDocument.create(); wide.addPage([841.89, 595.28])
  assert.match(String(await checkPaper(Buffer.from(await wide.save()))), /portrait A4/)
  const withPaper = await renderDoc(buildDocModel(t, { ...d, letterhead: { file: 'f1', top: 140 } }, 'Repairs', row, '2026-11-08', {}, 'sha'), paper, 'Repairs')
  assert.ok((await PDFDocument.load(withPaper)).getPageCount() >= 2)
})
