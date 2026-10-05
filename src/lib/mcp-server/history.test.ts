import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskSecrets } from './mask'
import {
  classifySource,
  readQuizSummary,
  windowMessagesToBudget,
  QUIZ_TEXT_MAX_CHARS,
  type ConversationMessage,
} from './history'

test('classifySource: channel classification per model value', () => {
  assert.equal(classifySource(null), 'text')
  assert.equal(classifySource(undefined), 'text')
  assert.equal(classifySource('gpt-4o-mini'), 'text')
  assert.equal(classifySource('voice-pstn'), 'voice-pstn')
  assert.equal(classifySource('voice-web-live'), 'voice-web')
  assert.equal(classifySource('voice-web-test'), 'voice-web-test')
  assert.equal(classifySource('miniapp-quiz'), 'quiz')
})

test('readQuizSummary: 240-char cap on title/memberDisplayName + numeric defaults', () => {
  const long = 'N'.repeat(5000)
  const s = readQuizSummary({ quiz: { title: long, memberDisplayName: long, questionsTotal: 5, correctCount: 5 } })
  assert.ok(s)
  assert.equal(s!.title.length, QUIZ_TEXT_MAX_CHARS)
  assert.equal(s!.memberDisplayName.length, QUIZ_TEXT_MAX_CHARS)
  assert.equal(s!.questionsTotal, 5)
  assert.equal(s!.correctCount, 5)
  assert.equal(s!.questionsAnswered, 0)
  assert.equal(s!.durationSeconds, 0)
})

test('readQuizSummary: null when there is no quiz; title defaults to "Quiz" when missing', () => {
  assert.equal(readQuizSummary({ messages: [] }), null)
  assert.equal(readQuizSummary({}), null)
  const s = readQuizSummary({ quiz: {} })
  assert.equal(s!.title, 'Quiz')
  assert.equal(s!.memberDisplayName, '')
})

const msg = (i: number, content: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({
  role: i % 2 ? 'assistant' : 'user',
  content,
  createdAt: new Date('2026-07-22T00:00:00Z'),
  lang: null,
  at: null,
  sessionId: null,
  source: null,
  ...extra,
})
const MAX_NOTE =
  '500 stored row(s) could not be decrypted and were skipped. ' +
  'This conversation exceeds the 500-row window; only messages from the first 500 rows are accessible over MCP.'
const finalWireBytes = (
  envelopeBase: Record<string, unknown>,
  messages: ConversationMessage[],
  nextMessageOffset: number | null,
): number => {
  const data = { ...envelopeBase, nextMessageOffset, messages, note: MAX_NOTE }
  return Buffer.byteLength(JSON.stringify(maskSecrets(data), null, 2), 'utf8')
}

test('windowMessagesToBudget: URL-secret spam (masking inflation) still stays within 100KB final output', () => {
  const spam = ('https://x.test/?token=abc123 '.repeat(280)).slice(0, 8000)
  const all = Array.from({ length: 60 }, (_, i) =>
    msg(i, spam, { lang: 'http://x/?key=x', sessionId: 'http://x/?token=' + 'y'.repeat(100) }),
  )
  const envelopeBase = maskSecrets({ conversationId: 'c1', agentTitle: 'A', totalInputTokens: 0, totalOutputTokens: 0 }) as Record<string, unknown>
  const { messages, nextMessageOffset } = windowMessagesToBudget(all, 0, 500, envelopeBase)
  assert.ok(messages.length < 60, `일부만 반환 (${messages.length})`)
  assert.equal(nextMessageOffset, messages.length)
  assert.ok(finalWireBytes(envelopeBase, messages, nextMessageOffset) <= 100_000, 'URL 비밀 값 미노출은 마스킹이 보장 — 여기선 크기만')
  assert.ok(!JSON.stringify(maskSecrets(messages)).includes('abc123'))
})

test('windowMessagesToBudget: control-character escapes + maximum wrapper still stay within 100KB final output', () => {
  const ctrl = String.fromCharCode(1).repeat(120)
  const all = Array.from({ length: 500 }, (_, i) => msg(i, ctrl, { lang: 'x'.repeat(40), sessionId: 'y'.repeat(140) }))
  const envelopeBase = maskSecrets({
    conversationId: 'e2e-' + 'z'.repeat(240), agentTitle: 'T'.repeat(200),
    totalInputTokens: 999999, totalOutputTokens: 999999,
  }) as Record<string, unknown>
  const { messages, nextMessageOffset } = windowMessagesToBudget(all, 0, 500, envelopeBase)
  assert.ok(messages.length < 500, `트리밍 발생 (${messages.length})`)
  assert.ok(finalWireBytes(envelopeBase, messages, nextMessageOffset) <= 100_000, '최종 반출 100KB 이내')
})

test('windowMessagesToBudget: 500 small messages fit within 100KB and are all accepted', () => {
  const all = Array.from({ length: 500 }, (_, i) => msg(i, 'ok ' + i))
  const envelopeBase = maskSecrets({ conversationId: 'c', agentTitle: 'A', totalInputTokens: 0, totalOutputTokens: 0 }) as Record<string, unknown>
  const { messages, nextMessageOffset } = windowMessagesToBudget(all, 0, 500, envelopeBase)
  assert.ok(finalWireBytes(envelopeBase, messages, nextMessageOffset) <= 100_000)
  assert.equal(messages.length, 500)
  assert.equal(nextMessageOffset, null)
})

test('windowMessagesToBudget: content over 8KB is marked as truncated', () => {
  const all = [msg(0, 'a'.repeat(20000))]
  const envelopeBase = maskSecrets({ conversationId: 'c', agentTitle: 'A', totalInputTokens: 0, totalOutputTokens: 0 }) as Record<string, unknown>
  const { messages } = windowMessagesToBudget(all, 0, 500, envelopeBase)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].contentTruncated, true)
  assert.ok(Buffer.byteLength(messages[0].content, 'utf8') <= 8_000)
})

test('windowMessagesToBudget: resumes from offset, respects limit, guarantees at least 1 message', () => {
  const all = Array.from({ length: 10 }, (_, i) => msg(i, 'm' + i))
  const envelopeBase = maskSecrets({ conversationId: 'c', agentTitle: 'A', totalInputTokens: 0, totalOutputTokens: 0 }) as Record<string, unknown>
  const p1 = windowMessagesToBudget(all, 0, 3, envelopeBase)
  assert.equal(p1.messages.length, 3)
  assert.equal(p1.nextMessageOffset, 3)
  const p2 = windowMessagesToBudget(all, 3, 100, envelopeBase)
  assert.equal(p2.messages.length, 7)
  assert.equal(p2.nextMessageOffset, null)
  assert.deepEqual([...p1.messages, ...p2.messages].map(m => m.content), all.map(m => m.content))
  const huge = maskSecrets({ conversationId: 'x'.repeat(200000), agentTitle: 'A', totalInputTokens: 0, totalOutputTokens: 0 }) as Record<string, unknown>
  const p3 = windowMessagesToBudget(all, 0, 500, huge)
  assert.equal(p3.messages.length, 1)
})
