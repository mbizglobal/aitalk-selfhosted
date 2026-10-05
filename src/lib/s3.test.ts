import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uploadIconToS3, deleteIconFromS3, isUserOwnerOfIcon, isStoredIconUrl } from './s3'

const PNG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64')

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
  try { await fn() } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k] }
  }
}

test('selfhosted: upload, serve and delete icons', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'icons-'))
  await withEnv({ AITALK_EDITION: 'selfhosted', FILE_STORE: undefined, FILE_STORE_DIR: root, NEXTAUTH_URL: 'https://ai.company.example/app/' }, async () => {
    const r = await uploadIconToS3(PNG, 'user1', 'agent/../x')
    assert.match(r.url, /^https:\/\/ai\.company\.example\/api\/icons\/user1-agentx-[A-Za-z0-9_-]+\.png$/)
    assert.equal(r.key, `icons/${r.fileName}`)
    assert.equal((await fs.readFile(path.join(root, r.key))).toString(), 'fake-png-bytes')
    assert.equal(isUserOwnerOfIcon(r.url, 'user1'), true)
    assert.equal(isUserOwnerOfIcon(r.url, 'user2'), false)
    assert.equal(isStoredIconUrl(r.url), true)
    for (const u of ['https://aitalkblog.blob.core.windows.net/user-icons/icons/user1-a.png', `https://other.example/api/icons/${r.fileName}`, `http://ai.company.example/api/icons/${r.fileName}`, 'https://x/api/icons/../secret.png', 'https://x/api/icons/a/b.png', '/api/icons/user1-a.png', null])
      assert.equal(isStoredIconUrl(u), false, String(u))

    const { GET } = await import('@/app/api/icons/[fileName]/route')
    const get = (name: string) => GET({} as any, { params: Promise.resolve({ fileName: name }) })
    const ok = await get(r.fileName)
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type'), 'image/png')
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), 'fake-png-bytes')
    assert.equal((await get('..%2Fsecret.png')).status, 404)
    assert.equal((await get('user1-nothing.png')).status, 404)
    assert.equal((await get('user1-a.svg')).status, 404)

    await assert.rejects(deleteIconFromS3('https://ai.company.example/api/icons/../../etc.png'), /Not a stored icon/)
    await assert.rejects(deleteIconFromS3(`https://other.example/api/icons/${r.fileName}`), /Not a stored icon/)
    assert.ok(await fs.stat(path.join(root, r.key)), '다른 호스트 주소로는 안 지워진다')
    await deleteIconFromS3(r.url)
    await assert.rejects(fs.stat(path.join(root, r.key)), (e: any) => e.code === 'ENOENT')
    assert.equal((await get(r.fileName)).status, 404)
  })
  await withEnv({ AITALK_EDITION: 'selfhosted', FILE_STORE_DIR: root, NEXTAUTH_URL: undefined }, async () => {
    await assert.rejects(uploadIconToS3(PNG, 'user1'), /NEXTAUTH_URL/)
  })
})

test('cloud: icon route returns 404; only Azure addresses are deleted as icons', async () => {
  await withEnv({ AITALK_EDITION: undefined }, async () => {
    const { GET } = await import('@/app/api/icons/[fileName]/route')
    assert.equal((await GET({} as any, { params: Promise.resolve({ fileName: 'user1-a.png' }) })).status, 404)
    assert.equal(isStoredIconUrl('https://aitalkblog.blob.core.windows.net/user-icons/icons/user1-a.png'), true)
    assert.equal(isStoredIconUrl('https://ai.company.example/api/icons/user1-a.png'), false)
  })
})
