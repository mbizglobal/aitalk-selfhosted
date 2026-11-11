import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeImageReader, packPages, pageHeader } from './read-images'

const ctx = { agentId: 'a', userId: 'u', isManaged: true } as any
process.env.AITALK_EDITION = 'selfhosted'

function fakeClient(answer: (pageLabel: string) => { text: string; incomplete?: boolean }) {
  const calls: Array<{ label: string; images: number }> = []
  const client = {
    responses: {
      create: async (req: any) => {
        const content = req.input[0].content
        const label = content[0].text
        calls.push({ label, images: content.filter((c: any) => c.type === 'input_image').length })
        const a = answer(label)
        return { output_text: a.text, status: a.incomplete ? 'incomplete' : 'completed', usage: { input_tokens: 10, output_tokens: 10 } }
      },
    },
  } as any
  return { client, calls }
}
const img = (n: number) => Array.from({ length: n }, () => ({ mime: 'image/jpeg', base64: 'AA==' }))

test('five pictures = five calls - one at a time - page numbers start at startPage', async () => {
  const { client, calls } = fakeClient((l) => ({ text: `T(${l})` }))
  const r = await makeImageReader(client, 'gpt-x', ctx)(img(5), 'File: a.pdf', { startPage: 3 })
  assert.equal(calls.length, 5)
  assert.ok(calls.every((c) => c.images === 1))
  assert.deepEqual(calls.map((c) => c.label).sort(), [3, 4, 5, 6, 7].map((p) => `File: a.pdf (page ${p})`))
  assert.equal(r.pages?.length, 5)
  assert.ok(r.text.startsWith(`${pageHeader(3)}\nT(File: a.pdf (page 3))`))
  assert.ok(r.text.includes(pageHeader(7)))
  assert.equal(r.truncated, false)
})

test('truncated when any page is cut', async () => {
  const { client } = fakeClient((l) => ({ text: 'x', incomplete: l.endsWith('page 2)') }))
  const r = await makeImageReader(client, 'gpt-x', ctx)(img(3), 'f')
  assert.equal(r.truncated, true)
})

test('one failed page keeps the others - only that page is null - throws when all fail', async () => {
  const flaky = { responses: { create: async (req: any) => {
    if (req.input[0].content[0].text.endsWith('page 2)')) throw new Error('timeout')
    return { output_text: 'ok', status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } }
  } } } as any
  const r = await makeImageReader(flaky, 'gpt-x', ctx)(img(3), 'f', { startPage: 1 })
  assert.deepEqual(r.pages, ['ok', null, 'ok'])
  assert.equal(r.truncated, true)
  const dead = { responses: { create: async () => { throw new Error('down') } } } as any
  await assert.rejects(makeImageReader(dead, 'gpt-x', ctx)(img(2), 'f', { startPage: 1 }), /down/)
})

test('continued scanned PDF reading (startPage) gives pages even for one picture - cut pages in cutPages', async () => {
  const { client } = fakeClient(() => ({ text: 'LAST', incomplete: true }))
  const r = await makeImageReader(client, 'gpt-x', ctx)(img(1), 'f', { startPage: 7 })
  assert.deepEqual(r.pages, ['LAST'])
  assert.deepEqual(r.cutPages, [0])
  assert.ok(r.text.startsWith(pageHeader(7)))
})

test('one picture = as before (no header and no pages)', async () => {
  const { client, calls } = fakeClient(() => ({ text: 'ONE' }))
  const r = await makeImageReader(client, 'gpt-x', ctx)(img(1), 'File: p.jpg')
  assert.deepEqual(r, { text: 'ONE', truncated: false })
  assert.equal(calls[0].label, 'File: p.jpg')
})

test('packPages - only whole pages within the limit - counts remaining pages', () => {
  const pages = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)]
  const all = packPages(pages, 1, 10_000)
  assert.equal(all.count, 3)
  assert.equal(all.cut, false)
  const two = packPages(pages, 4, 2 * (100 + pageHeader(4).length + 1) + 2)
  assert.equal(two.count, 2)
  assert.ok(two.text.startsWith(pageHeader(4)))
  assert.ok(two.text.includes(pageHeader(5)) && !two.text.includes('c'))
  const long = packPages(['z'.repeat(500), 'y'], 1, 100)
  assert.deepEqual({ count: long.count, cut: long.cut, len: long.text.length }, { count: 1, cut: true, len: 100 })
})
