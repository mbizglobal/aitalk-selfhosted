import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { S3Client } from '@aws-sdk/client-s3'
import { createS3FileStore } from './s3'

type Sent = { name: string; input: any }

function fakeClient(objects: Map<string, Buffer>, opts: { pageSize?: number; failKeys?: Set<string>; throwOnBatch?: number } = {}) {
  let batch = 0
  const sent: Sent[] = []
  const client = {
    async send(cmd: any) {
      const name = cmd.constructor.name as string
      const input = cmd.input
      sent.push({ name, input })
      if (name === 'PutObjectCommand') { objects.set(input.Key, Buffer.from(input.Body)); return {} }
      if (name === 'GetObjectCommand') {
        const b = objects.get(input.Key)
        if (!b) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })
        return { Body: { transformToByteArray: async () => new Uint8Array(b) } }
      }
      if (name === 'DeleteObjectCommand') { objects.delete(input.Key); return {} }
      if (name === 'ListObjectsV2Command') {
        const all = [...objects.keys()].filter((k) => k.startsWith(input.Prefix)).sort()
        const rest = input.ContinuationToken ? all.filter((k) => k > input.ContinuationToken) : all
        const size = opts.pageSize ?? 1000
        const page = rest.slice(0, size)
        const more = rest.length > size
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, NextContinuationToken: more ? page[page.length - 1] : undefined }
      }
      if (name === 'DeleteObjectsCommand') {
        if (++batch === opts.throwOnBatch) throw Object.assign(new Error('boom'), { name: 'InternalError' })
        const Errors: any[] = []
        for (const { Key } of input.Delete.Objects) {
          if (opts.failKeys?.has(Key)) Errors.push({ Key, Code: 'AccessDenied', Message: 'nope' })
          else objects.delete(Key)
        }
        return { Errors }
      }
      throw new Error(`unexpected ${name}`)
    },
  }
  return { client: client as unknown as S3Client, sent }
}

test('S3: upload, read, delete (a missing key also succeeds)', async () => {
  const objects = new Map<string, Buffer>()
  const { client } = fakeClient(objects)
  const s = createS3FileStore({ bucket: 'b' }, client)
  await s.put('u1/a/f.bin', Buffer.from('hello'))
  assert.equal((await s.get('u1/a/f.bin')).toString(), 'hello')
  await s.delete('u1/a/f.bin')
  await s.delete('u1/a/f.bin')
  await assert.rejects(s.get('u1/a/f.bin'), /NoSuchKey/)
})

test('S3: key rules are the same as disk, and are blocked before a request goes out', async () => {
  const { client, sent } = fakeClient(new Map())
  const s = createS3FileStore({ bucket: 'b' }, client)
  for (const k of ['', '/abs', 'a/../b', 'a//b', 'a\\b', './a']) await assert.rejects(s.put(k, Buffer.from('x')), /FileStore/, k)
  for (const p of ['', '/', 'u1', 'u1/../']) await assert.rejects(s.deletePrefix(p), /FileStore/, p)
  assert.equal(sent.length, 0)
})

test('S3: prefix delete goes page by page and deletes only beneath it', async () => {
  const objects = new Map<string, Buffer>()
  for (let i = 0; i < 7; i++) objects.set(`u1/p/${i}.bin`, Buffer.from('x'))
  objects.set('u1/q/keep.bin', Buffer.from('x'))
  objects.set('u10/p/keep.bin', Buffer.from('x'))
  const { client, sent } = fakeClient(objects, { pageSize: 3 })
  const s = createS3FileStore({ bucket: 'b' }, client)
  assert.equal(await s.deletePrefix('u1/p/'), 7)
  assert.deepEqual([...objects.keys()].sort(), ['u1/q/keep.bin', 'u10/p/keep.bin'])
  assert.ok(sent.filter((x) => x.name === 'ListObjectsV2Command').length >= 3)
  assert.equal(await s.deletePrefix('u1/p/'), 0)
})

test('S3: even if some fail, deletes the rest and throws (key names are not in the error message)', async () => {
  const objects = new Map<string, Buffer>()
  for (const k of ['u1/a.bin', 'u1/secret_salary.pdf', 'u1/c.bin']) objects.set(k, Buffer.from('x'))
  const { client } = fakeClient(objects, { failKeys: new Set(['u1/secret_salary.pdf']) })
  const s = createS3FileStore({ bucket: 'b' }, client)
  await assert.rejects(s.deletePrefix('u1/'), (e: Error) => /partially failed \(1\/3\)/.test(e.message) && !e.message.includes('salary'))
  assert.deepEqual([...objects.keys()], ['u1/secret_salary.pdf'])
})

test('S3: even if one page\'s delete request fails entirely, deletes the next page and throws at the end', async () => {
  const objects = new Map<string, Buffer>()
  for (let i = 0; i < 6; i++) objects.set(`u1/${i}.bin`, Buffer.from('x'))
  const { client } = fakeClient(objects, { pageSize: 2, throwOnBatch: 1 })
  const s = createS3FileStore({ bucket: 'b' }, client)
  await assert.rejects(s.deletePrefix('u1/'), /partially failed \(2\/6\)/)
  assert.deepEqual([...objects.keys()].sort(), ['u1/0.bin', 'u1/1.bin'])
})
