import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectStreamFailure, makeStreamFailureError, getStreamFailureCode } from './utils'

test('error event: flat message (no response field)', () => {
  const f = detectStreamFailure({ type: 'error', code: 'server_error', message: 'boom', param: null })
  assert.equal(f?.message, 'boom')
  assert.equal(f?.usageInputTokens, undefined)
})

test('error event: falls back to code when there is no message', () => {
  assert.equal(detectStreamFailure({ type: 'error', code: 'rate_limit_exceeded', message: '' })?.message, 'rate_limit_exceeded')
  const unknown = detectStreamFailure({ type: 'error', code: 'rate_limit', message: '' })
  assert.equal(unknown?.message, 'rate_limit', '폴백 message 는 원문 그대로여야 한다')
  assert.equal(unknown?.code, 'other', '목록에 없는 코드는 로그용으로 other 여야 한다')
})

test('response.failed: returns response.error.message together with usage', () => {
  const f = detectStreamFailure({
    type: 'response.failed',
    response: { error: { message: 'model overloaded' }, usage: { input_tokens: 12_345 } },
  })
  assert.equal(f?.message, 'model overloaded')
  assert.equal(f?.usageInputTokens, 12_345, 'usage 가 있으면 실측 기준으로 정산해야 한다')
})

test('response.failed: undefined when there is no usage (output presence decides base settlement)', () => {
  const f = detectStreamFailure({ type: 'response.failed', response: { error: { message: 'x' } } })
  assert.equal(f?.usageInputTokens, undefined)
})

test('normal events are not misjudged as failures (a false positive kills a normal response as an error)', () => {
  for (const type of [
    'response.created',
    'response.in_progress',
    'response.output_text.delta',
    'response.completed',
    'response.incomplete',
    'response.output_item.added',
    'response.function_call_arguments.done',
  ]) {
    assert.equal(detectStreamFailure({ type }), null, `${type} 은 실패가 아니다`)
  }
  assert.equal(detectStreamFailure(null), null)
  assert.equal(detectStreamFailure(undefined), null)
})

//
test('code passes only in a validated shape; blocks log injection and PII', () => {
  const C = String.fromCharCode
  const codeOf = (code: unknown) => detectStreamFailure({ type: 'error', code, message: 'x' })?.code

  for (const ok of ['server_error', 'rate_limit_exceeded', 'invalid_request_error', 'content_filter']) {
    assert.equal(codeOf(ok), ok, `아는 코드가 거부됐다: ${ok}`)
  }

  const notCodes: Array<[string, unknown]> = [
    ['개행 주입', 'abc' + C(10) + '[CHAT] forged'],
    ['CR 주입', 'abc' + C(13) + 'forged'],
    ['ANSI ESC', 'abc' + C(27) + '[31m'],
    ['NUL', 'abc' + C(0) + 'def'],
    ['유니코드 개행 U+2028', 'abc' + C(0x2028) + 'def'],
    ['전화번호', '41791234567'],
    ['이메일', 'victim@example.com'],
    ['사람 이름 모양', 'Sample.Name'],
    ['점 포함 식별자 모양', 'IDSHAPE.0000.0000.00'],
    ['도메인 모양', 'victim.example.com'],
    ['공백 포함 문장', 'quota exceeded for org'],
    ['64자 초과', 'a'.repeat(65)],
    ['모양은 코드 같지만 미등록', 'some_unknown_code'],
  ]
  for (const [label, v] of notCodes) {
    assert.equal(codeOf(v), 'other', `${label} 가 원문으로 통과했다: ${JSON.stringify(v)}`)
  }

  for (const [label, v] of [['빈 문자열', ''], ['객체', { toString: () => 'x' }], ['숫자', 429], ['null', null]] as Array<[string, unknown]>) {
    assert.equal(codeOf(v), undefined, `${label} 에서 code 가 생겼다`)
  }

  assert.equal(
    detectStreamFailure({ type: 'response.failed', response: { error: { code: 'abc' + C(10) + 'x', message: 'm' } } })?.code,
    'other',
  )
  assert.equal(
    detectStreamFailure({ type: 'response.failed', response: { error: { code: 'server_error', message: 'm' } } })?.code,
    'server_error',
  )
})

test('a code used for user-facing classification survives as the original', () => {
  const f = detectStreamFailure({ type: 'error', code: 'invalid_json_schema', message: 'x' })
  assert.equal(f?.code, 'invalid_json_schema')
})

test('makeStreamFailureError: carries the code as a property and does not put the body in the message', () => {
  const err = makeStreamFailureError('OpenAI stream failed', {
    code: 'invalid_json_schema',
    responseId: 'resp_abc',
    message: 'x'.repeat(1234),
  })
  assert.equal(getStreamFailureCode(err), 'invalid_json_schema', '분류가 속성으로 안 실렸다')
  assert.ok(err.message.includes('1234 chars'), '길이만 남긴다는 계약이 깨졌다')
  assert.ok(!err.message.includes('x'.repeat(50)), '🔒 상류 본문이 메시지에 실렸다')
  assert.ok(err instanceof Error, '엔진이 Error 로 다룬다')
})

test('makeStreamFailureError: no property when there is no code (does not invent a nonexistent classification)', () => {
  const err = makeStreamFailureError('OpenAI stream failed', { message: 'boom' })
  assert.equal(getStreamFailureCode(err), undefined)
  assert.ok(err.message.includes('code=-'), '없음 표기는 유지한다')
})

test('getStreamFailureCode: undefined for an exception that is not a stream failure (not mixed with request-time errors)', () => {
  const sdkErr = Object.assign(new Error('Invalid schema for response_format'), { code: 'invalid_request_error' })
  assert.equal(getStreamFailureCode(sdkErr), undefined, 'SDK 의 code 속성을 스트림 코드로 오인했다')
  assert.equal(getStreamFailureCode(new Error('boom')), undefined)
  assert.equal(getStreamFailureCode(null), undefined)
  assert.equal(getStreamFailureCode(undefined), undefined)
  assert.equal(getStreamFailureCode('문자열'), undefined)
})

test('preserves the response ID of response.failed (a correlation handle after the body is removed)', () => {
  const f = detectStreamFailure({
    type: 'response.failed',
    response: { id: 'resp_677efb5139a88190b512bc3fef8e535d', error: { code: 'server_error', message: 'x' } },
  })
  assert.equal(f?.responseId, 'resp_677efb5139a88190b512bc3fef8e535d', '실제 형태의 응답 ID 가 뭉개졌다')
  const C = String.fromCharCode
  assert.equal(
    detectStreamFailure({ type: 'response.failed', response: { id: 'a' + C(10) + 'forged', error: {} } })?.responseId,
    'other',
  )
  assert.equal(detectStreamFailure({ type: 'error', code: 'server_error', message: 'x' })?.responseId, undefined)
})
