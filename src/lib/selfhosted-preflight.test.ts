import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selfHostedPreflight, type PreflightDeps } from './selfhosted-preflight'

const GOOD = {
  AITALK_EDITION: 'selfhosted',
  NEXTAUTH_URL: 'https://ai.example.com',
  NEXTAUTH_SECRET: 'x'.repeat(32),
  ENCRYPTION_SECRET: 'a'.repeat(64),
  FILE_STORE_DIR: '/data/files',
}

const deps = (o: { rootDev?: number; dirDev?: number; writeErr?: string } = {}): PreflightDeps => ({
  stat: async (p) => ({ dev: p === '/' ? (o.rootDev ?? 1) : (o.dirDev ?? 2) }),
  mkdir: async () => {},
  probeWrite: async () => { if (o.writeErr) throw Object.assign(new Error(o.writeErr), { code: o.writeErr }) },
})

const run = (env: Record<string, string | undefined>, opts = { requireEdition: true, requireFileVolume: true }, d = deps()) => selfHostedPreflight(env, opts, d)

test('preflight: valid settings pass', async () => {
  assert.deepEqual(await run(GOOD), [])
})

test('preflight: edition value: empty or typo is a problem (install bundle only)', async () => {
  for (const v of [undefined, '', 'selfhost', 'cloud']) {
    const p = await run({ ...GOOD, AITALK_EDITION: v })
    assert.equal(p.length, 1, String(v))
    assert.match(p[0], /AITALK_EDITION/)
  }
  assert.deepEqual(await run({ ...GOOD, AITALK_EDITION: undefined }, { requireEdition: false, requireFileVolume: true }), [])
})

test('preflight: ENCRYPTION_SECRET is exactly 64 hex digits', async () => {
  for (const v of [undefined, '', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), ' '.repeat(64), ` ${'a'.repeat(64)}`, `${'a'.repeat(64)}\n`]) {
    const p = await run({ ...GOOD, ENCRYPTION_SECRET: v })
    assert.ok(p.some((x) => /ENCRYPTION_SECRET/.test(x)), String(v))
  }
  assert.deepEqual(await run({ ...GOOD, ENCRYPTION_SECRET: 'AbCdEf0123456789'.repeat(4) }), [])
  assert.ok((await run({ ...GOOD, ENCRYPTION_SECRET: undefined, AZURE_KEYVAULT_URL: 'https://kv', AZURE_KEYVAULT_SECRET_NAME: 'k' })).some((x) => /ENCRYPTION_SECRET/.test(x)))
})

test('preflight: NEXTAUTH_SECRET under 32 chars is a problem', async () => {
  for (const v of [undefined, '', 'x'.repeat(31), ' '.repeat(40)]) {
    assert.ok((await run({ ...GOOD, NEXTAUTH_SECRET: v })).some((x) => /NEXTAUTH_SECRET/.test(x)), String(v))
  }
})

test('preflight: NEXTAUTH_URL follows the same rule as app-url', async () => {
  for (const v of [undefined, '', 'ai.example.com', 'https://a.example.com/?x=1']) {
    assert.ok((await run({ ...GOOD, NEXTAUTH_URL: v })).some((x) => /NEXTAUTH_URL/.test(x)), String(v))
  }
})

test('preflight: file location: missing, relative path, not writable, not a volume', async () => {
  assert.ok((await run({ ...GOOD, FILE_STORE_DIR: undefined })).some((x) => /FILE_STORE_DIR is not set/.test(x)))
  assert.ok((await run({ ...GOOD, FILE_STORE_DIR: 'data/files' })).some((x) => /absolute/.test(x)))
  const denied = await run(GOOD, undefined, deps({ writeErr: 'EACCES' }))
  assert.ok(denied.some((x) => /not writable/.test(x) && /chown/.test(x)))
  const sameDev = await run(GOOD, undefined, deps({ rootDev: 7, dirDev: 7 }))
  assert.ok(sameDev.some((x) => /not on a volume/.test(x)))
  assert.deepEqual(await run(GOOD, { requireEdition: true, requireFileVolume: false }, deps({ rootDev: 7, dirDev: 7 })), [])
})

test('preflight: S3 and unknown FILE_STORE', async () => {
  assert.deepEqual(await run({ ...GOOD, FILE_STORE_DIR: undefined, FILE_STORE: 's3', S3_BUCKET: 'b' }), [])
  assert.ok((await run({ ...GOOD, FILE_STORE: 's3' })).some((x) => /S3_BUCKET/.test(x)))
  assert.ok((await run({ ...GOOD, FILE_STORE: 'ftp' })).some((x) => /FILE_STORE must be/.test(x)))
})

test('preflight: multiple problems are reported at once', async () => {
  const p = await run({ AITALK_EDITION: '', FILE_STORE_DIR: '' })
  assert.ok(p.length >= 4, p.join('\n'))
})
