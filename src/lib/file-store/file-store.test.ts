import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDiskFileStore } from './disk'
import { selfHostedFileStore } from './index'

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'filestore-'))
}

test('disk: put, read, overwrite, delete (a missing key also succeeds)', async () => {
  const root = await tmpRoot()
  const s = createDiskFileStore(root)
  await s.put('u1/project/p1/file/a.bin', Buffer.from('one'))
  assert.equal((await s.get('u1/project/p1/file/a.bin')).toString(), 'one')
  await s.put('u1/project/p1/file/a.bin', Buffer.from('two'))
  assert.equal((await s.get('u1/project/p1/file/a.bin')).toString(), 'two')
  await s.delete('u1/project/p1/file/a.bin')
  await s.delete('u1/project/p1/file/a.bin')
  await assert.rejects(s.get('u1/project/p1/file/a.bin'), (e: any) => e.code === 'ENOENT')
  assert.deepEqual((await fs.readdir(path.join(root, 'u1/project/p1/file'))).filter((f) => f.endsWith('.tmp')), [])
})

test('disk: deleting succeeds and reading gives ENOENT even if the root does not exist yet', async () => {
  const root = path.join(await tmpRoot(), 'not-yet')
  const s = createDiskFileStore(root)
  await s.delete('u1/x.bin')
  assert.equal(await s.deletePrefix('u1/'), 0)
  await assert.rejects(s.get('u1/x.bin'), (e: any) => e.code === 'ENOENT')
})

test('disk: a key cannot escape outside the root', async () => {
  const root = await tmpRoot()
  const s = createDiskFileStore(root)
  for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a/./b', 'a//b', 'a\\b', 'a\0b', 'a/', '..']) {
    await assert.rejects(s.put(bad, Buffer.from('x')), /FileStore/, JSON.stringify(bad))
    await assert.rejects(s.get(bad), /FileStore/, JSON.stringify(bad))
    await assert.rejects(s.delete(bad), /FileStore/, JSON.stringify(bad))
  }
  for (const bad of ['', '/', 'u1', '../', 'u1/../', '/u1/', 'a//']) {
    await assert.rejects(s.deletePrefix(bad), /FileStore/, JSON.stringify(bad))
  }
  assert.throws(() => createDiskFileStore('relative/dir'), /absolute/)
})

test('disk: prefix delete only deletes beneath it', async () => {
  const root = await tmpRoot()
  const s = createDiskFileStore(root)
  await s.put('u1/project/p1/file/a.bin', Buffer.from('a'))
  await s.put('u1/project/p1/file/b.bin', Buffer.from('b'))
  await s.put('u1/project/p2/file/c.bin', Buffer.from('c'))
  await s.put('u10/project/p1/file/d.bin', Buffer.from('d'))
  assert.equal(await s.deletePrefix('u1/project/p1/'), 2)
  assert.equal(await s.deletePrefix('u1/project/p1/'), 0)
  assert.equal((await s.get('u1/project/p2/file/c.bin')).toString(), 'c')
  assert.equal(await s.deletePrefix('u1/'), 1)
  assert.equal((await s.get('u10/project/p1/file/d.bin')).toString(), 'd')
})

test('disk: symbolic links inside the volume cannot reach outside (folder links and file links)', async () => {
  const root = await tmpRoot()
  const outside = await tmpRoot()
  await fs.writeFile(path.join(outside, 'secret'), 'outside')
  await fs.symlink(outside, path.join(root, 'u1'))
  await fs.mkdir(path.join(root, 'u2'))
  await fs.symlink(path.join(outside, 'secret'), path.join(root, 'u2', 'f.bin'))
  const s = createDiskFileStore(root)
  await assert.rejects(s.get('u1/secret'), /link/)
  await assert.rejects(s.put('u1/new.bin', Buffer.from('x')), /link/)
  await assert.rejects(s.delete('u1/secret'), /link/)
  await assert.rejects(s.deletePrefix('u1/sub/'), /link/)
  await assert.rejects(s.get('u2/f.bin'), /symbolic link/)
  await assert.rejects(s.delete('u2/f.bin'), /symbolic link/)
  assert.equal(await fs.readFile(path.join(outside, 'secret'), 'utf8'), 'outside')
  await assert.rejects(fs.stat(path.join(outside, 'new.bin')), (e: any) => e.code === 'ENOENT')
})

test('selection: no FILE_STORE_DIR, unknown FILE_STORE, no S3_BUCKET = stops', () => {
  assert.throws(() => selfHostedFileStore({}), /FILE_STORE_DIR is not set/)
  assert.throws(() => selfHostedFileStore({ FILE_STORE: 'ftp', FILE_STORE_DIR: '/tmp/x' }), /unknown FILE_STORE/)
  assert.throws(() => selfHostedFileStore({ FILE_STORE: 's3', FILE_STORE_DIR: '/tmp/x' }), /S3_BUCKET is not set/)
  assert.throws(() => selfHostedFileStore({ FILE_STORE: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k' }), /both/)
  assert.ok(selfHostedFileStore({ FILE_STORE: 's3', S3_BUCKET: 'b', S3_ENDPOINT: 'http://127.0.0.1:9000', S3_FORCE_PATH_STYLE: 'true' }))
})

test('selfhosted edition: blob-storage functions go to disk, the read URL stops, cloud is untouched', async () => {
  const root = await tmpRoot()
  const prev = { e: process.env.AITALK_EDITION, d: process.env.FILE_STORE_DIR }
  const blob = await import('@/lib/managed/blob-storage')
  try {
    process.env.AITALK_EDITION = 'selfhosted'
    process.env.FILE_STORE_DIR = root
    await blob.uploadToBlob('any-region', 'u1/agent1/2026-10-02_abc123_x.pdf', Buffer.from('%PDF-1'))
    assert.equal((await fs.readFile(path.join(root, 'u1/agent1/2026-10-02_abc123_x.pdf'))).toString(), '%PDF-1')
    const d = await blob.downloadFromBlob('other-region', 'u1/agent1/2026-10-02_abc123_x.pdf')
    assert.equal(d.buffer.toString(), '%PDF-1')
    assert.equal(d.contentType, '')
    await assert.rejects(blob.generateReadSasUrl('r', 'u1/agent1/x'), /not available in the self-hosted/)
    await blob.uploadToBlob('r', 'u1/project/p1/file/a.bin', new Blob([Buffer.from('zz')]))
    await blob.deleteProjectBlobs('r', 'u1', 'p1')
    await assert.rejects(fs.stat(path.join(root, 'u1/project/p1')), (e: any) => e.code === 'ENOENT')
    await blob.deleteFromBlob('r', 'u1/agent1/2026-10-02_abc123_x.pdf')
    await blob.deleteUserBlobs('r', 'u1')
    await assert.rejects(fs.stat(path.join(root, 'u1')), (e: any) => e.code === 'ENOENT')
    delete process.env.AITALK_EDITION
    await assert.rejects(blob.uploadToBlob('no-such-region-for-test', 'u2/a/x', Buffer.from('x')))
    await assert.rejects(fs.stat(path.join(root, 'u2')), (e: any) => e.code === 'ENOENT')
  } finally {
    if (prev.e === undefined) delete process.env.AITALK_EDITION
    else process.env.AITALK_EDITION = prev.e
    if (prev.d === undefined) delete process.env.FILE_STORE_DIR
    else process.env.FILE_STORE_DIR = prev.d
  }
})
