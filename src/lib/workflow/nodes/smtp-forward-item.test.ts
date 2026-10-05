import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SmtpNodeExecutor } from './smtp'

//
//

const mail = (uid: number, subject: string) => ({
  uid,
  messageId: `<${uid}@x.ch>`,
  subject,
  from: `s${uid}@x.ch`,
  to: 'me@x.ch',
  date: '2026-08-07T00:00:00.000Z',
  body: `body-${uid}`,
})
const INBOX = [mail(1, '첫 번째'), mail(2, '두 번째'), mail(3, '세 번째')]

const CONFIG = { host: 'smtp.x.ch', port: 587, user: 'me@x.ch' }
const AUTH = { user: 'me@x.ch', pass: 'pw' }

interface Run { picked: any; errors: string[] }

async function run(context: Record<string, unknown>, nodeData: Record<string, unknown> = {}): Promise<Run> {
  const ex = new SmtpNodeExecutor() as any
  let picked: any = 'NOT_CALLED'
  ex.forwardEmail = async (email: any) => { picked = email; return { success: true } }
  const errors: string[] = []
  const originalError = console.error
  console.error = (...a: unknown[]) => { errors.push(a.join(' ')) }
  try {
    await ex.executeForward({ mode: 'forward', ...nodeData }, CONFIG, AUTH, context, 'fwd@x.ch')
  } finally {
    console.error = originalError
  }
  return { picked, errors }
}

const loopCtx = (item: unknown, index = 0, extra: Record<string, unknown> = {}) => ({
  imapResult: { emails: INBOX },
  forEachContext: { currentItem: item, currentIndex: index, totalCount: 3, sourceArray: INBOX },
  ...extra,
})

test('forward: a loop whose item variable name is currentEmail still works as is (existing usage preserved)', async () => {
  const { picked, errors } = await run(loopCtx(INBOX[2], 2, { currentEmail: INBOX[2] }))
  assert.equal(picked.uid, 3)
  assert.deepEqual(errors, [], '정상 경로에서 오류를 찍으면 안 된다')
})

test('forward: forwards that loop item even when the item variable name is not currentEmail', async () => {
  for (const [i, expectedUid] of [[0, 1], [1, 2], [2, 3]] as const) {
    const { picked } = await run(loopCtx(INBOX[i], i, { myMail: INBOX[i] }))
    assert.equal(picked.uid, expectedUid, `${i}번째 반복에서 uid=${expectedUid} 가 나와야`)
  }
})

test('forward: if the loop item is not an IMAP mail, it fails without sending', async () => {
  const row = { name: '홍길동', amount: 100 }
  await assert.rejects(
    () => run(loopCtx(row, 0, { currentRow: row })),
    /current ForEach item is missing the fields a forward needs/,
  )
})

test('forward: a half object with only uid and subject is not a mail (a loose check would send an empty mail)', async () => {
  const halfShaped = { uid: 10, subject: 'invoice' }
  await assert.rejects(
    () => run(loopCtx(halfShaped, 0, { myMail: halfShaped })),
    /missing the fields a forward needs/,
  )
})

test('forward: inside a loop, currentEmail is ignored whether it is falsy or anything else', async () => {
  for (const falsy of ['', 0, false]) {
    const { picked } = await run(loopCtx(INBOX[1], 1, { currentEmail: falsy }))
    assert.equal(picked.uid, 2, `currentEmail=${JSON.stringify(falsy)} 여도 루프 항목이 이겨야`)
  }
})

test('forward: outside a loop, if currentEmail is not mail-shaped, it fails without sending', async () => {
  await assert.rejects(
    () => run({ imapResult: { emails: INBOX }, currentEmail: { name: '홍길동' } }),
    /context.currentEmail is missing the fields a forward needs/,
  )
})

test('forward: inside a loop, a currentEmail left by the previous loop cannot beat the current item', async () => {
  const stale = INBOX[0]
  for (const [i, expectedUid] of [[1, 2], [2, 3]] as const) {
    const { picked } = await run(loopCtx(INBOX[i], i, { currentEmail: stale, myMail: INBOX[i] }))
    assert.equal(picked.uid, expectedUid, `현재 항목(uid=${expectedUid})이 이겨야 — 잔재(uid=1)가 이기면 안 된다`)
  }
})

test('forward: outside a loop, currentEmail beats emailIndex (standalone-run contract)', async () => {
  const { picked, errors } = await run({ imapResult: { emails: INBOX }, currentEmail: INBOX[2] }, { emailIndex: 0 })
  assert.equal(picked.uid, 3)
  assert.deepEqual(errors, [])
})

test('forward: standalone run outside a loop follows the emailIndex rule as is (no error log)', async () => {
  const a = await run({ imapResult: { emails: INBOX } })
  assert.equal(a.picked.uid, 1)
  assert.deepEqual(a.errors, [], '루프 밖은 정상 경로 — 경고 대상이 아니다')
  const b = await run({ imapResult: { emails: INBOX } }, { emailIndex: 2 })
  assert.equal(b.picked.uid, 3)
})

test('forward: throws when there is no IMAP result (existing contract)', async () => {
  await assert.rejects(() => run({}), /No IMAP result found/)
})

test('forward: if the emailIndex target is a half object, throws without sending', async () => {
  const broken = { uid: 9, subject: 'invoice' }
  await assert.rejects(
    () => run({ imapResult: { emails: [broken] } }),
    /imapResult.emails\[0\] is missing the fields a forward needs/,
  )
})

test('forward: a falsy currentEmail outside a loop fails as a present but unusable value', async () => {
  for (const falsy of ['', 0, false]) {
    await assert.rejects(
      () => run({ imapResult: { emails: INBOX }, currentEmail: falsy }),
      /context.currentEmail is missing the fields a forward needs/,
      `currentEmail=${JSON.stringify(falsy)} 는 실패해야`,
    )
  }
})

test('forward: if currentEmail is null/undefined there is no candidate, so it goes by emailIndex (no warning either)', async () => {
  for (const empty of [null, undefined]) {
    const { picked, errors } = await run({ imapResult: { emails: INBOX }, currentEmail: empty })
    assert.equal(picked.uid, 1)
    assert.deepEqual(errors, [], `currentEmail=${String(empty)} 는 경고 대상이 아니다`)
  }
})

test('forward: inside a loop with no item, it fails and does not leak to emailIndex (defensive guard)', async () => {
  await assert.rejects(
    () => run({ imapResult: { emails: INBOX }, forEachContext: { currentItem: undefined, currentIndex: 0, totalCount: 1, sourceArray: [] } }),
    /current iteration item is missing/,
  )
})
