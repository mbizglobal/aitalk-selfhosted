import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateQuizSignupNotice } from './validate-quiz-notice'
import { VOICE_QUIZ_NOTICE_MAX } from '@/lib/call/voice-quiz/types'

const wf = (notice: any) => JSON.stringify({ nodes: [{ id: 'q1', data: { signupNotice: notice } }], edges: [] })

test('\'passes within the limit - exactly the limit also passes (boundary)\'', () => {
  assert.equal(validateQuizSignupNotice(wf({ 'ko-KR': '가'.repeat(VOICE_QUIZ_NOTICE_MAX) })).ok, true)
})

test('\'🔴 over the limit, the save is rejected - it is not truncated\'', () => {
  const r = validateQuizSignupNotice(wf({ 'ko-KR': '가'.repeat(VOICE_QUIZ_NOTICE_MAX + 1) }))
  assert.equal(r.ok, false)
  assert.equal((r as any).code, 'QUIZ_NOTICE_TOO_LONG')
  assert.ok((r as any).error.includes('ko-KR'), '어느 언어인지 말해야 오너가 고칠 수 있다')
})

test('\'🔴 counts by code point - length is off for emoji\'', () => {
  const emoji = '🙂'.repeat(VOICE_QUIZ_NOTICE_MAX)
  assert.equal(validateQuizSignupNotice(wf({ 'ko-KR': emoji })).ok, true)
  assert.equal(validateQuizSignupNotice(wf({ 'ko-KR': emoji + '🙂' })).ok, false)
})

test('\'empty text, missing language, nodes without any text pass - this is not the place to block\'', () => {
  assert.equal(validateQuizSignupNotice(wf({ 'ko-KR': '' })).ok, true)
  assert.equal(validateQuizSignupNotice(wf({})).ok, true)
  assert.equal(validateQuizSignupNotice(JSON.stringify({ nodes: [{ id: 'a', data: {} }] })).ok, true)
})

test('\'passes if the JSON is broken or empty - another guard looks at that\'', () => {
  assert.equal(validateQuizSignupNotice('{not json').ok, true)
  assert.equal(validateQuizSignupNotice(null).ok, true)
})

test('\'🔴 unsupported language fields are not looked at - fixed at four languages\'', () => {
  assert.equal(validateQuizSignupNotice(wf({ es: '가'.repeat(VOICE_QUIZ_NOTICE_MAX + 50) })).ok, true)
})
