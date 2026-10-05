
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  describeCaughtError,
  describeUpstreamError,
  maskEmail,
  maskId,
  maskNumber,
  maskUrl,
  readUpstreamJson,
  safeLogDigest,
  safeLogId,
  safeLogNumber,
  safeLogRawNumber,
  safeLogToken,
} from './log-mask'

const revealsInOrder = (out: string, original: string): boolean => {
  let i = 0
  for (const ch of out) if (i < original.length && ch === original[i]) i++
  return i === original.length
}

test('original cannot be restored from the masked result (all lengths)', () => {
  for (let len = 1; len <= 12; len++) {
    const digits = '1234567890ab'.slice(0, len)

    for (const [name, fn] of [['maskNumber', maskNumber], ['maskId', maskId]] as const) {
      const out = fn(digits)
      assert.equal(
        revealsInOrder(out, digits),
        false,
        `${name}('${digits}') = '${out}' — 원문 글자가 순서대로 전부 보인다`,
      )
    }

    const local = 'abcdefghijkl'.slice(0, len)
    const email = `${local}@example.com`
    const out = maskEmail(email)
    assert.equal(
      revealsInOrder(out, email),
      false,
      `maskEmail('${email}') = '${out}' — 원문 글자가 순서대로 전부 보인다`,
    )
    assert.equal(
      revealsInOrder(out.split('@')[0], local),
      false,
      `maskEmail('${email}') = '${out}' — 로컬 파트가 통째로 남았다`,
    )
  }
})

test('pins both sides of the threshold (5 and 6 chars) to exact values; where a past bug occurred', () => {
  assert.equal(maskNumber('12345'), '****', 'maskNumber 는 3+2=5 를 남기므로 5자는 전부 가려야 한다')
  assert.equal(maskNumber('123456'), '123****56')
  assert.equal(maskId('12345'), '****', 'maskId 는 2+2=4 를 남기므로 5자는 전부 가려야 한다')
  assert.equal(maskId('123456'), '12***56')
})

test('maskEmail: keeps the domain (needed to diagnose config errors and typos)', () => {
  assert.equal(maskEmail('sample.user@aitalk.ch'), 'sa***@aitalk.ch')
  assert.equal(maskEmail('a@b.com'), '***@b.com')
  assert.equal(maskEmail('ab@b.com'), '***@b.com')
  assert.equal(maskEmail('abc@b.com'), 'ab***@b.com')
  assert.equal(maskEmail('not-an-email'), maskId('not-an-email'))
})

test('maskNumber: keeps the country code and masks the middle', () => {
  assert.equal(maskNumber('+41791234567'), '+41****67')
  assert.equal(maskNumber('+821012345678'), '+82****78')
  assert.equal(maskNumber('12345'), '****', '남기는 글자수(5) 이상인 값은 부분 마스킹이 무의미하다')
})

test('empty, null and undefined all become the fully masked value (so callers need not branch)', () => {
  for (const f of [maskEmail, maskNumber, maskId]) {
    assert.equal(f(null), '****')
    assert.equal(f(undefined), '****')
    assert.equal(f(''), '****')
  }
})

test('maskId also accepts numbers (Telegram chatId etc.)', () => {
  assert.equal(maskId(206093086), '20***86')
  assert.equal(maskId(12345), '****')
})

test('maskUrl: masks query values and keeps key names', () => {
  assert.equal(
    maskUrl('https://api.example.com/v1/send?token=SECRET&to=%2B41791234567'),
    'https://api.example.com/v1/send?<token,to>',
    '값이 하나라도 남으면 서명·토큰이 새는 자리다',
  )
  assert.equal(maskUrl('https://api.example.com/v1/send'), 'https://api.example.com/v1/send')
  assert.equal(maskUrl('/webhook?token=SECRET'), '/webhook?<masked>')
  assert.equal(maskUrl(null), '(no url)')
})

test('describeUpstreamError: free-text fields (message, description, body) are not logged', () => {
  const PII = 'sample.user@aitalk.ch'
  const bodies = [
    JSON.stringify({ error: { code: 'ItemNotFound', message: `Item not found for ${PII}` } }),
    JSON.stringify({ error: 'invalid_grant', error_description: `AADSTS50076 for ${PII}` }),
    `<html><body>Forbidden for ${PII}</body></html>`,
    JSON.stringify({ detail: `failed: ${PII}` }),
    JSON.stringify({ error: 'invalid_grant', error_codes: [PII] }),
    JSON.stringify({ error: PII }),
    JSON.stringify({ error: { code: PII } }),
  ]
  for (const body of bodies) {
    const out = describeUpstreamError(403, body)
    assert.equal(out.includes(PII), false, `본문의 PII 가 로그로 샜다: '${out}'`)
    assert.equal(out.includes('AADSTS50076'), false, `error_description 원문이 샜다: '${out}'`)
    assert.match(out, /^HTTP 403/, '진단에 필요한 status 는 남아야 한다')
  }
})

test('describeUpstreamError: extracts the code from both response shapes', () => {
  assert.equal(
    describeUpstreamError(400, JSON.stringify({ error: 'invalid_grant', error_codes: [70008] })),
    'HTTP 400, code=invalid_grant, aad=70008',
  )
  assert.equal(
    describeUpstreamError(401, JSON.stringify({ error: { code: 'InvalidAuthenticationToken', message: '비밀' } })),
    'HTTP 401, code=InvalidAuthenticationToken',
  )
})

test('describeUpstreamError: keeps only the length when no code is found', () => {
  assert.equal(describeUpstreamError(500, 'not json'), 'HTTP 500, code=unknown, 8 chars')
  assert.equal(describeUpstreamError(502, ''), 'HTTP 502, code=unknown, 0 chars')
  assert.equal(describeUpstreamError(502, null), 'HTTP 502, code=unknown, 0 chars')
})

test('describeUpstreamError: does not pass anything that is not code-shaped (allowlist)', () => {
  for (const notACode of ['x'.repeat(500), 'sample.user@aitalk.ch', 'Item not found', '한글 메시지', '']) {
    const out = describeUpstreamError(400, JSON.stringify({ error: notACode }))
    assert.match(out, /^HTTP 400, code=malformed, \d+ chars$/, `코드가 아닌 값이 통과했다: '${out}'`)
  }
  for (const realCode of ['invalid_grant', 'InvalidAuthenticationToken', 'resyncRequired', 'itemNotFound-2']) {
    assert.equal(describeUpstreamError(400, JSON.stringify({ error: realCode })), `HTTP 400, code=${realCode}`)
  }
})

test('🔴 describeUpstreamError: does not read a polluted Object.prototype (all 4 read sites)', () => {
  const proto = Object.prototype as Record<string, unknown>
  proto.code = 'polluted-code'
  proto.error = 'polluted-error'
  proto.error_codes = [999999]
  proto.error_code = 403
  try {
    for (const body of ['{}', '{"error":{}}', '{"other":1}']) {
      const out = describeUpstreamError(500, body)
      assert.equal(out.includes('polluted'), false, `오염값이 로그로 샜다: '${body}' → '${out}'`)
      assert.equal(out.includes('999999'), false, `오염된 error_codes 가 실렸다: '${body}' → '${out}'`)
      assert.equal(out.includes('403'), false, `오염된 error_code 가 실렸다: '${body}' → '${out}'`)
    }
  } finally {
    delete proto.code
    delete proto.error
    delete proto.error_codes
    delete proto.error_code
  }
})

test('🔴 describeUpstreamError: newlines in code cannot forge log lines', () => {
  const out = describeUpstreamError(400, JSON.stringify({ error: 'invalid_grant\n[SECURITY] all clear' }))
  assert.equal(out.includes('\n'), false, `개행이 그대로 남아 로그 줄이 갈라진다: ${JSON.stringify(out)}`)
  assert.equal(out.includes('\r'), false)
  assert.equal(out.split('\n').length, 1, '한 줄이어야 한다')
})

test('describeUpstreamError: error_codes accepts only finite integers and limits the count', () => {
  assert.equal(
    describeUpstreamError(400, JSON.stringify({ error: 'invalid_grant', error_codes: [70008, 'leaked@x.com', 50076] })),
    'HTTP 400, code=invalid_grant, aad=70008,50076',
  )
  assert.equal(
    describeUpstreamError(400, JSON.stringify({ error: 'invalid_grant', error_codes: ['leaked@x.com'] })),
    'HTTP 400, code=invalid_grant',
  )
  const many = describeUpstreamError(400, JSON.stringify({
    error: 'invalid_grant',
    error_codes: Array.from({ length: 1000 }, (_, i) => i + 1),
  }))
  assert.ok(many.length < 120, `로그 한 줄이 부풀었다: ${many.length}자`)

  assert.equal(
    describeUpstreamError(400, JSON.stringify({ error: 'invalid_grant', error_codes: [41791234567] })),
    'HTTP 400, code=invalid_grant',
    '전화번호 자릿수의 정수가 aad 로 새면 안 된다',
  )
})

test('describeUpstreamError: does not lose the code in the Telegram shape (integer error_code)', () => {
  const tg = (code: unknown, description = 'Forbidden: bot was blocked by the user') =>
    describeUpstreamError(403, JSON.stringify({ ok: false, error_code: code, description }))

  assert.equal(tg(403), 'HTTP 403, code=403')
  assert.equal(tg(429), 'HTTP 403, code=429')

  const leaky = tg(400, 'Bad Request: can\'t parse entities: Unsupported start tag "SECRET-AI-TEXT"')
  assert.equal(leaky, 'HTTP 403, code=400')
  assert.ok(!leaky.includes('SECRET-AI-TEXT'), `description 이 새면 안 된다: ${leaky}`)

  const bodyLen = (code: unknown) =>
    JSON.stringify({ ok: false, error_code: code, description: 'Forbidden: bot was blocked by the user' }).length
  assert.equal(tg(41791234567), `HTTP 403, code=malformed, ${bodyLen(41791234567)} chars`)
  assert.ok(tg('403\n[SECURITY] all clear').startsWith('HTTP 403, code=malformed'), '문자열 코드는 거부')

  assert.equal(tg(100), 'HTTP 403, code=100', '하한 포함')
  assert.equal(tg(599), 'HTTP 403, code=599', '상한 포함')
  assert.equal(tg(99), `HTTP 403, code=malformed, ${bodyLen(99)} chars`, '하한 미만은 거부')
  assert.equal(tg(600), `HTTP 403, code=malformed, ${bodyLen(600)} chars`, '상한 초과는 거부')
  assert.equal(tg(403.5), `HTTP 403, code=malformed, ${bodyLen(403.5)} chars`, '비정수는 거부')
  assert.equal(tg('403'), `HTTP 403, code=malformed, ${bodyLen('403')} chars`, '숫자 문자열은 거부')

  assert.equal(
    describeUpstreamError(400, JSON.stringify({ error: 'invalid_grant', error_code: 403 })),
    'HTTP 400, code=invalid_grant',
    '유효한 error 가 우선',
  )
  for (const badErr of [123, {}, null, 0, '', false] as unknown[]) {
    const body = JSON.stringify({ error: badErr, error_code: 403 })
    assert.equal(
      describeUpstreamError(400, body),
      `HTTP 400, code=malformed, ${body.length} chars`,
      `error 자리가 규격 밖이면 malformed 를 유지해야 한다: ${body}`,
    )
  }
  assert.equal(
    describeUpstreamError(400, JSON.stringify({ detail: 'x', error_code: 403 })),
    'HTTP 400, code=403',
    'error 필드가 없으면 error_code 로 폴백',
  )
})

test('describeUpstreamError: pins the aad range boundaries to exact values', () => {
  const aadOf = (...codes: unknown[]) =>
    describeUpstreamError(400, JSON.stringify({ error: 'invalid_grant', error_codes: codes }))

  assert.equal(aadOf(50076), 'HTTP 400, code=invalid_grant, aad=50076')
  assert.equal(aadOf(5000224), 'HTTP 400, code=invalid_grant, aad=5000224', '7자리 실재 코드')
  assert.equal(aadOf(7500514), 'HTTP 400, code=invalid_grant, aad=7500514', '7자리 실재 코드')
  assert.equal(aadOf(9_999_999), 'HTTP 400, code=invalid_grant, aad=9999999', '상한은 포함')
  assert.equal(aadOf(10_000_000), 'HTTP 400, code=invalid_grant', '상한 초과는 버린다')
  for (const bad of [0, -1, 1.5, null, '70008']) {
    assert.equal(aadOf(bad), 'HTTP 400, code=invalid_grant', `코드가 아닌 값이 통과했다: ${String(bad)}`)
  }
})

test('describeUpstreamError: error present but wrong shape is malformed', () => {
  assert.match(describeUpstreamError(400, '{"error":123}'), /code=malformed/)
  assert.match(describeUpstreamError(400, '{"error":null}'), /code=malformed/)
  assert.match(describeUpstreamError(400, '{"error":{}}'), /code=malformed/)
  assert.match(describeUpstreamError(400, '{"detail":"x"}'), /code=unknown/, 'error 자체가 없으면 unknown')
})

test('🔴 anything code-shaped passes; known limitation', () => {
  assert.equal(describeUpstreamError(400, JSON.stringify({ error: 'sample.name' })), 'HTTP 400, code=sample.name')
  //
  //
})

test('🔴 readUpstreamJson: the body is not included in the parse-failure exception', async () => {
  const secret = 'SECRET-TOKEN-abc123'
  await assert.rejects(
    () => readUpstreamJson(new Response(secret, { status: 200 })),
    (e: Error) => {
      assert.equal(e.message.includes(secret), false, `예외 메시지로 본문이 샜다: ${e.message}`)
      assert.match(e.message, /HTTP 200/, 'status 는 남아야 진단이 된다')
      assert.match(e.message, /\d+ chars/, '길이는 남긴다')
      return true
    },
  )
  await assert.rejects(
    () => readUpstreamJson(new Response(`<html>error for ${secret}</html>`, { status: 200 })),
    (e: Error) => !e.message.includes(secret),
  )
})

test('readUpstreamJson: valid JSON is returned as is', async () => {
  const parsed = await readUpstreamJson(new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 })))
  assert.deepEqual(parsed, { access_token: 'x', expires_in: 3600 })
})

test('🔴 describeCaughtError: exception messages and polluted prototypes do not leak', () => {
  const PII = 'victim@example.com'

  const prismaLike = Object.assign(new Error(`Invalid \`prisma.upsert()\`: email=${PII}, encryptedToken=abc`), {
    name: 'PrismaClientValidationError',
  })
  const out = describeCaughtError(prismaLike)
  assert.equal(out.includes(PII), false, `예외 메시지가 로그로 샜다: '${out}'`)
  assert.equal(out.includes('encryptedToken'), false)
  assert.equal(out, 'PrismaClientValidationError')

  const proto = Object.prototype as Record<string, unknown>
  proto.constructor = { name: `${PII}\nFORGED` }
  try {
    const polluted = describeCaughtError({ name: 'bad name' })
    assert.equal(polluted.includes(PII), false, `프로토타입 오염값이 샜다: '${polluted}'`)
    assert.equal(polluted.includes('\n'), false, '개행으로 로그 줄을 위조할 수 있다')
    assert.equal(polluted, 'Error', '형태가 아니면 고정값')
  } finally {
    delete proto.constructor
  }
})

test('describeCaughtError: keeps only structured fields, after validating them', () => {
  assert.equal(describeCaughtError(Object.assign(new Error('x'), { name: 'E', code: 'P2002' })), 'E(P2002)')
  assert.equal(describeCaughtError(Object.assign(new Error('x'), { name: 'E', statusCode: 404 })), 'E(status=404)')
  assert.equal(describeCaughtError(Object.assign(new Error('x'), { name: 'E', statusCode: 'leak@x.com' })), 'E')
  assert.equal(describeCaughtError(Object.assign(new Error('x'), { name: 'E', statusCode: 99 })), 'E')
  assert.equal(describeCaughtError('some string'), 'string')
  assert.equal(describeCaughtError(null), 'object')
})

test('🔴 `status` is also read: where Azure Search errors went out without a status', () => {
  const azure = Object.assign(new Error('Azure AI Search DELETE /indexes/... failed — HTTP 403'), { status: 403 })
  assert.equal(describeCaughtError(azure), 'Error(status=403)')
  assert.equal(describeCaughtError(Object.assign(new Error('x'), { name: 'E', status: 'processing' })), 'E')
  assert.equal(describeCaughtError(Object.assign(new Error('x'), { name: 'E', status: 42 })), 'E')
  assert.equal(
    describeCaughtError(Object.assign(new Error('x'), { name: 'E', statusCode: 500, status: 403 })),
    'E(status=500)',
  )
})

test('🔴 describeCaughtError: also keeps errorCode of Prisma initialization errors (prevents losing diagnostics)', () => {
  assert.equal(
    describeCaughtError(Object.assign(new Error('x'), {
      name: 'PrismaClientInitializationError', errorCode: 'P1001',
    })),
    'PrismaClientInitializationError(P1001)',
  )
  assert.equal(
    describeCaughtError(Object.assign(new Error('x'), { name: 'E', code: 'P2002', errorCode: 'P1001' })),
    'E(P2002)',
  )
  for (const bad of [
    'leak@example.com', 'x\nFORGED', '41791234567', 'Sample.Name', '',
    'SECRET_TOKEN', 'Hyong', 'Sample_Name', 'P100', 'P10001', 'p1001',
  ]) {
    assert.equal(
      describeCaughtError(Object.assign(new Error('x'), {
        name: 'PrismaClientInitializationError', errorCode: bad,
      })),
      'PrismaClientInitializationError',
      `errorCode=${JSON.stringify(bad)} 가 통과하면 안 된다`,
    )
  }
  assert.equal(
    describeCaughtError(Object.assign(new Error('x'), { name: 'GitBookAPIError', errorCode: 'P1001' })),
    'GitBookAPIError',
  )
  const polluted: any = { name: 'E' }
  Object.setPrototypeOf(polluted, { errorCode: 'P9999' })
  assert.equal(describeCaughtError(polluted), 'E')
})

test('🔴 maskUrl cannot protect a secret that is in the path (known limitation)', () => {
  assert.equal(
    maskUrl('https://api.telegram.org/botSECRET-TOKEN/sendMessage'),
    'https://api.telegram.org/botSECRET-TOKEN/sendMessage',
  )
})

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

test('🔴 blobRef: a canonical path keeps only the file name, a non-canonical path keeps only the directory', async () => {
  const { blobRef } = await import('./managed/blob-storage')

  assert.equal(blobRef('u1/a1/2026-08-07_abc123_salary_Q3.pdf'), 'u1/a1/2026-08-07_abc123')
  assert.equal(blobRef('u1/a1/docs/2026-08-07_abc123_계약서.docx'), 'u1/a1/docs/2026-08-07_abc123')

  assert.equal(blobRef('u1/a1/report_with_salary.pdf'), 'u1/a1/')
  assert.equal(blobRef('u1/a1/급여명세서.pdf'), 'u1/a1/')
  assert.equal(blobRef('salary.pdf'), '')

  for (const p of ['u/a/report_with_salary.pdf', 'u/a/2026-08-07_x_salary.pdf', 'u/a/급여_명세.pdf']) {
    assert.equal(blobRef(p).includes('salary'), false, `파일명이 남았다: ${blobRef(p)}`)
    assert.equal(blobRef(p).includes('명세'), false, `파일명이 남았다: ${blobRef(p)}`)
  }
})

test('safeLogId: blocks log injection (newlines, control characters)', () => {
  const C = String.fromCharCode
  const BAD = new RegExp('[' + C(0) + '-' + C(31) + C(127) + '-' + C(159) + C(0x2028) + C(0x2029) + ']')
  const attacks = [
    'abc' + C(10) + '[CHAT] forged line',
    'abc' + C(13) + 'forged',
    'abcdef' + C(10),
    C(10) + 'abcdef',
    'abc' + C(0x2028) + 'def',
    'abc' + C(0x2029) + 'def',
    'abc' + C(0x85) + 'def',
    'abc' + C(0) + 'def',
    'abc' + C(27) + '[31mRED',
    'abc' + C(9) + 'def',
  ]
  for (const a of attacks) {
    const out = safeLogId(a)
    assert.ok(!BAD.test(out), `제어문자가 로그로 나간다: ${JSON.stringify(out)}`)
  }
})

test('safeLogId: PII that passes the shape check still does not go out as the original', () => {
  //
  for (const pii of ['41791234567', 'Hyong_Kim', '0791234567', 'a'.repeat(64),
                     'voice-web:' + 'cd34'.repeat(8), '3f2504e0-4f89-11d3-9a0c-0305e82c3301']) {
    const out = safeLogId(pii)
    assert.ok(
      !revealsInOrder(out, pii),
      `마스킹 결과에서 원문을 순서대로 복원할 수 있다: ${pii} -> ${out}`
    )
  }
})

test('safeLogNumber: passes only number shapes, and even those are not restorable', () => {
  const C = String.fromCharCode
  for (const bad of ['A' + C(10) + 'B12345', 'victim@example.com', 'abc', '', 'x'.repeat(30)]) {
    assert.equal(safeLogNumber(bad), '****', `번호가 아닌데 통과했다: ${JSON.stringify(bad)}`)
  }
  for (const v of [null, undefined, 41791234567, {}]) {
    assert.equal(safeLogNumber(v as unknown), '****')
  }
  for (const num of ['+41791234567', '079 123 45 67', '+82-10-1234-5678']) {
    const out = safeLogNumber(num)
    assert.notEqual(out, '****', `정상 번호가 거부됐다: ${num}`)
    assert.ok(!revealsInOrder(out, num.replace(/\D/g, '')), `원문 복원 가능: ${num} -> ${out}`)
  }
})

test('safeLogId: does not swallow real clientId shapes (no over-rejection)', () => {
  for (const id of [
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    'ab12'.repeat(8),                          // 32 hex (HMAC)
    'voice-web:' + 'cd34'.repeat(8),           // Web Voice
    'playground_1754700000000_a1b2c3d4e',      // Playground
  ]) {
    assert.notEqual(safeLogId(id), 'invalid', `정상 clientId 가 거부됐다: ${id}`)
  }
})

test('safeLogId: non-strings and over-long values become a fixed value', () => {
  for (const v of [null, undefined, 123, {}, [], true, 'a'.repeat(129)]) {
    assert.equal(safeLogId(v as unknown), 'invalid')
  }
})

test('safeLogToken: blocks injection and keeps enum values (cannot stop PII; that is the contract)', () => {
  const C = String.fromCharCode
  for (const ok of ['gpt-5.6-luna', 'gpt-realtime-1.5', 'completed', 'in_progress',
                    'search', 'open_page', 'max_output_tokens', 'content_filter']) {
    assert.equal(safeLogToken(ok), ok, `정상 토큰이 뭉개졌다: ${ok}`)
  }
  for (const bad of ['a' + C(10) + 'forged', 'a' + C(13) + 'x', 'a' + C(27) + '[31m',
                     'a' + C(0) + 'b', 'a' + C(0x2028) + 'b', 'has space', 'x'.repeat(65), '', '-leading']) {
    assert.equal(safeLogToken(bad), 'other', `주입 가능한 값이 통과했다: ${JSON.stringify(bad)}`)
  }
  for (const v of [null, undefined, 123, {}, []]) assert.equal(safeLogToken(v as unknown), 'other')
  assert.equal(safeLogToken('sample.name'), 'sample.name')
})

test('safeLogRawNumber: leaves numbers readable and only blocks injection (cannot stop PII by contract)', () => {
  const C = String.fromCharCode
  for (const ok of ['+41791234567', '+41 79 123 45 67', '0041(79)1234567',
                    '4:+41791234567', '8:acs:8e3a4b2c-1111-2222-3333-444455556666_0']) {
    assert.equal(safeLogRawNumber(ok), ok, `정상 번호가 변형됐다: ${ok}`)
  }
  for (const bad of ['+41' + C(10) + '79', '+41' + C(13) + '79', '+41' + C(27) + '[31m',
                     '+41' + C(0) + '79', '+41' + C(0x2028) + '79', '+41' + C(0x85) + '79']) {
    const out = safeLogRawNumber(bad)
    assert.ok(!/[\u0000-\u001F\u0085\u2028\u2029]/.test(out),
      `제어문자가 살아남았다: ${JSON.stringify(out)}`)
  }
  assert.match(safeLogRawNumber('+41' + C(10) + '79'), /\[sanitized len=6\]$/)
  assert.equal(safeLogRawNumber(C(10) + C(10)), '[invalid len=2]')
  const long = safeLogRawNumber('9'.repeat(300))
  assert.ok(long.length < 100, '길이 제한이 안 걸렸다')
  assert.match(long, /\[sanitized len=300\]$/)
  for (const v of [null, undefined, '', 123, {}]) assert.equal(safeLogRawNumber(v as unknown), '(none)')
  assert.equal(safeLogRawNumber('41791234567'), '41791234567')
})

test('safeLogDigest: values can be told apart but the original is not revealed', () => {
  const C = String.fromCharCode
  assert.notEqual(safeLogDigest('read'), safeLogDigest('send'))
  assert.equal(safeLogDigest('read'), safeLogDigest('read'))
  for (const v of ['victim@example.com', 'Sample.Name', 'a' + C(10) + 'forged', '41791234567']) {
    const out = safeLogDigest(v)
    assert.match(out, /^[0-9a-f]{8}$/, `지문 형태가 아니다: ${out}`)
    assert.ok(!out.includes(v.slice(0, 4)), '원문 조각이 남았다')
  }
  for (const v of [null, undefined, '', 123, {}]) assert.equal(safeLogDigest(v as unknown), 'none')
})

test('🔴 no over-rejection: normal values at real log sites are not mangled', () => {
  const KEEP: [string, string, (v: unknown) => string][] = [
    ['모델 id', 'gpt-4.1-mini', safeLogToken],
    ['모델 id (realtime)', 'gpt-realtime-1.5', safeLogToken],
    ['Azure 배포명', 'gpt-realtime-2-1-eu', safeLogToken],
    ['Azure voice', 'de-CH-LeniNeural', safeLogToken],
    ['Azure HD voice (콜론)', 'en-US-Ava:DragonHDLatestNeural', safeLogToken],
    ['realtime voice', 'realtime:marin', safeLogToken],
    ['locale', 'de-CH', safeLogToken],
    ['locale (3-part)', 'zh-Hant-TW', safeLogToken],
    ['노드 id (짧음)', 'ai', safeLogToken],
    ['노드 id (숫자)', '2', safeLogToken],
    ['워크플로 cuid', 'clx3k2j9a0000abcdteleg', safeLogToken],
    ['상류 이벤트 타입', 'response.output_audio_transcript.done', safeLogToken],
    ['상류 item_id', 'item_BxYz12ab34Cd', safeLogToken],
    ['상류 오류 code', 'response_cancel_not_active', safeLogToken],
  ]
  for (const [what, value, fn] of KEEP) {
    assert.equal(fn(value), value, `${what} 가 뭉개졌다: ${value} → ${fn(value)}`)
  }

  for (const [what, value] of [['chatId', '206093086'], ['그룹 chatId(음수)', '-1001234567890']] as const) {
    const out = safeLogId(value)
    assert.notEqual(out, 'invalid', `${what} 가 invalid 로 떨어졌다 — String() 누락 형태의 회귀`)
    assert.notEqual(out, '****', `${what} 가 전부 가려져 상관분석이 불가능하다`)
  }

  assert.equal(safeLogRawNumber('+41 79 123 45 67'), '+41 79 123 45 67')
})
