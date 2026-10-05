import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { ensureUserDataKey, DataKeyError } from './user-data-key'
import { generateDataKey, encryptDataKey, decryptDataKey } from './encryption'

//

process.env.ENCRYPTION_SECRET ||= 'a'.repeat(64)

type UserRow = {
  encryptedDataKey: Uint8Array | null
  zkiId: number | null
  zki: { masterKey: string } | null
  isAnonymized: boolean
}

function makeDb(
  initial: UserRow | null,
  opts: { beforeUpdate?: (setKey: (buf: Uint8Array) => void) => void } = {}
) {
  const calls = { findUnique: 0, updateMany: [] as any[] }
  let row = initial

  const db = {
    user: {
      async findUnique(_args: any) {
        calls.findUnique++
        return row ? { ...row } : null
      },
      async updateMany(args: any) {
        calls.updateMany.push(args.where)
        opts.beforeUpdate?.(buf => {
          if (row) row = { ...row, encryptedDataKey: buf, zkiId: null, zki: null }
        })
        if (!row) return { count: 0 }
        if (args.where.encryptedDataKey === null && row.encryptedDataKey) return { count: 0 }
        if (args.where.isAnonymized === false && row.isAnonymized) return { count: 0 }
        row = { ...row, ...args.data }
        return { count: 1 }
      },
    },
  }
  return { db: db as unknown as PrismaClient, calls, current: () => row }
}

const emptyUser = (): UserRow =>
  ({ encryptedDataKey: null, zkiId: null, zki: null, isAnonymized: false })

const LEGACY_MASTER = 'b'.repeat(64)

function legacyEncryptDataKey(dataKey: Buffer, legacyMasterHex: string): Uint8Array {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(legacyMasterHex, 'hex'), iv)
  const enc = Buffer.concat([cipher.update(dataKey), cipher.final()])
  return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), enc]))
}

// ========================================
// ========================================

test('decrypts as is without writing when the key already exists', async () => {
  const dek = generateDataKey()
  const { db, calls } = makeDb({
    encryptedDataKey: new Uint8Array(await encryptDataKey(dek)),
    zkiId: null,
    zki: null,
    isAnonymized: false,
  })

  const got = await ensureUserDataKey(db, 'u1')

  assert.deepEqual(got, dek)
  assert.equal(calls.updateMany.length, 0, '기존 키가 있는데 쓰기가 일어나면 안 된다')
})

test('plants the key when missing, and a round trip works with the planted key', async () => {
  const { db, calls, current } = makeDb(emptyUser())

  const got = await ensureUserDataKey(db, 'u1')

  assert.equal(calls.updateMany.length, 1)
  assert.ok(current()?.encryptedDataKey, '키가 실제로 심겨야 한다')
  const stored = await decryptDataKey(Buffer.from(current()!.encryptedDataKey!))
  assert.deepEqual(got, stored)
})

test('the update must be conditional on `encryptedDataKey: null` (the basis of atomicity)', async () => {
  const { db, calls } = makeDb(emptyUser())

  await ensureUserDataKey(db, 'u1')

  assert.equal(calls.updateMany[0].encryptedDataKey, null,
    'where 절에서 NULL 조건이 빠지면 경쟁 요청의 키를 덮어쓴다')
  assert.equal(calls.updateMany[0].id, 'u1')
})

// ========================================
// ========================================

test('race: if a competing request planted first, discards my key and uses the planted key', async () => {
  const winner = generateDataKey()
  const winnerCiphertext = new Uint8Array(await encryptDataKey(winner))

  const { db, current } = makeDb(emptyUser(), {
    beforeUpdate: setKey => setKey(winnerCiphertext),
  })

  const got = await ensureUserDataKey(db, 'u1')

  assert.deepEqual(got, winner,
    '진 쪽이 자기가 만든 키를 반환하면, 그 키로 암호화한 대화는 영구 복호화 불가가 된다')
  assert.deepEqual(current()!.encryptedDataKey, winnerCiphertext,
    '경쟁 요청의 키를 덮어쓰면 안 된다')
})

// ========================================
// ========================================

test('throws if the user does not exist', async () => {
  const { db } = makeDb(null)
  await assert.rejects(() => ensureUserDataKey(db, 'nope'), /USER_NOT_FOUND/)
})

test('does not put userId in the exception message (the public API returns it in the response as is)', async () => {
  const SECRET_ID = 'usr_should_not_leak'

  for (const [label, db] of [
    ['사용자 부재', makeDb(null).db],
    ['익명화 계정', makeDb({ encryptedDataKey: null, zkiId: null, zki: null, isAnonymized: true }).db],
  ] as const) {
    const err = await ensureUserDataKey(db, SECRET_ID).then(() => null, e => e)
    assert.ok(err instanceof DataKeyError, `${label}: DataKeyError 여야 code 로 응답을 가를 수 있다`)
    assert.ok(!err.message.includes(SECRET_ID), `${label}: 메시지에 userId 가 새면 안 된다`)
  }
})

test('throws if the key still cannot be read after planting (no plaintext fallback)', async () => {
  const db = {
    user: {
      async findUnique() { return emptyUser() },
      async updateMany() { return { count: 1 } },
    },
  } as unknown as PrismaClient

  await assert.rejects(() => ensureUserDataKey(db, 'u1'), /PROVISIONING_BLOCKED/)
})

// ========================================
// ========================================

test('a newly planted key also clears zkiId, so the second call also decrypts with the current master', async () => {
  const { db, current } = makeDb({
    encryptedDataKey: null, zkiId: 7, zki: { masterKey: LEGACY_MASTER }, isAnonymized: false,
  })

  const first = await ensureUserDataKey(db, 'u1')
  assert.equal(first.length, 32)
  assert.equal(current()!.zkiId, null, '새 키는 현재 마스터로 감쌌으므로 레거시 표시가 남으면 안 된다')

  const second = await ensureUserDataKey(db, 'u1')
  assert.deepEqual(second, first, '두 번째 호출이 같은 DEK 를 돌려주지 못하면 데이터가 깨진다')
})

test('does not plant a key again for an anonymized account (GDPR)', async () => {
  const { db, calls, current } = makeDb({
    encryptedDataKey: null, zkiId: null, zki: null, isAnonymized: true,
  })

  await assert.rejects(() => ensureUserDataKey(db, 'u1'), /PROVISIONING_BLOCKED/)
  assert.equal(calls.updateMany[0].isAnonymized, false, 'where 절에 익명화 제외 조건이 있어야 한다')
  assert.equal(current()!.encryptedDataKey, null, '익명화 계정에 키가 심기면 안 된다')
})

test('a pre-existing legacy key is decrypted with the zki master key (positive branch of the gate)', async () => {
  const dek = generateDataKey()
  const { db, calls } = makeDb({
    encryptedDataKey: legacyEncryptDataKey(dek, LEGACY_MASTER),
    zkiId: 7,
    zki: { masterKey: LEGACY_MASTER },
    isAnonymized: false,
  })

  const got = await ensureUserDataKey(db, 'u1')

  assert.deepEqual(got, dek)
  assert.equal(calls.updateMany.length, 0, '기존 키가 있으므로 쓰기가 없어야 한다')
})
