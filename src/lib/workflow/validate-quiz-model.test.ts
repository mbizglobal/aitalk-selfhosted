import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateQuizGenerationModel,
  isQuizAllowedModel,
  QUIZ_ALLOWED_MODELS,
  QUIZ_BLOCKED_MODELS,
} from './validate-quiz-model'

const aiNode = (id: string, model?: string) => ({ id, type: 'ai', data: { nodeType: 'ai', ...(model ? { model } : {}) } })
const quizNode = (id: string) => ({ id, type: 'tool', data: { nodeType: 'miniapp', miniAppType: 'quiz' } })
const sourceNode = (id: string) => ({ id, type: 'tool', data: { nodeType: 'tool', toolType: 'source' } })
const edge = (source: string, target: string, sourceHandle: string) => ({ source, target, sourceHandle })

const wf = (nodes: any[], edges: any[]) => JSON.stringify({ nodes, edges })

const PREMIUM = 'gpt-x-premium'
const G = { blockedModels: [PREMIUM] }

test('\'allow list is the four base CPA 1 tier models (2026-09-24 GPT-6 - sol is also 1 CPA)\'', () => {
  assert.deepEqual([...QUIZ_ALLOWED_MODELS], ['gpt-4.1-mini', 'gpt-4.1', 'gpt-6-luna', 'gpt-6-sol'])
  assert.ok(isQuizAllowedModel('gpt-6-luna'))
  assert.ok(isQuizAllowedModel('gpt-6-sol'))
  assert.ok(!isQuizAllowedModel('gpt-5.6-luna'), '퇴역 모델은 새로 고를 수 없다')
  assert.ok(!isQuizAllowedModel('gpt-5.6-terra'))
  assert.ok(!isQuizAllowedModel('gpt-5.6-sol'))
})

test('\'rejects when the AI node with Quiz attached uses a deny-listed model\'', () => {
  const r = validateQuizGenerationModel(wf([aiNode('ai1', PREMIUM), quizNode('q1')], [edge('ai1', 'q1', 'miniapps')]), G)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'QUIZ_MODEL_NOT_SUPPORTED')
  assert.match(r.error!, new RegExp(PREMIUM), '어떤 모델이 문제인지 메시지에 나와야 한다')
})

test('\'🔴 does not reject retired 5.6-terra and sol - they are called as gpt-6-sol (1 CPA) at run time (2026-09-24)\'', () => {
  assert.deepEqual([...QUIZ_BLOCKED_MODELS], [])
  for (const m of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.1']) {
    assert.equal(validateQuizGenerationModel(wf([aiNode('ai1', m), quizNode('q1')], [edge('ai1', 'q1', 'miniapps')])).ok, true, m)
  }
  assert.equal(
    validateQuizGenerationModel(wf([aiNode('ai1', 'gpt-5.6-sol'), quizNode('q1')], [edge('ai1', 'q1', 'miniapps')]), { blockedModels: ['gpt-6-sol'] }).ok,
    false
  )
})

test('\'passes with an allowed model\'', () => {
  for (const good of QUIZ_ALLOWED_MODELS) {
    assert.equal(validateQuizGenerationModel(wf([aiNode('ai1', good), quizNode('q1')], [edge('ai1', 'q1', 'miniapps')])).ok, true, good)
  }
})

test('\'🔴 touches no model when Quiz is not attached\'', () => {
  assert.equal(validateQuizGenerationModel(wf([aiNode('ai1', PREMIUM)], []), G).ok, true)
  assert.equal(
    validateQuizGenerationModel(wf([aiNode('ai1', PREMIUM), sourceNode('s1')], [edge('ai1', 's1', 'tools')]), G).ok,
    true
  )
})

test('\'a quiz node connected through a handle other than miniapps does not apply (same as the engine)\'', () => {
  assert.equal(
    validateQuizGenerationModel(wf([aiNode('ai1', PREMIUM), quizNode('q1')], [edge('ai1', 'q1', 'tools')]), G).ok,
    true
  )
})

test('\'multiple AI nodes - only the one with Quiz attached is checked\'', () => {
  const nodes = [aiNode('ai1', PREMIUM), aiNode('ai2', 'gpt-6-luna'), quizNode('q1')]
  assert.equal(validateQuizGenerationModel(wf(nodes, [edge('ai2', 'q1', 'miniapps')]), G).ok, true)
  assert.equal(validateQuizGenerationModel(wf(nodes, [edge('ai1', 'q1', 'miniapps')]), G).ok, false)
})

test('\'unset model passes - the runtime default (luna) is allowed\'', () => {
  assert.equal(validateQuizGenerationModel(wf([aiNode('ai1'), quizNode('q1')], [edge('ai1', 'q1', 'miniapps')])).ok, true)
})

test('\'empty input and broken JSON pass, rejected with failOnInvalidJson\'', () => {
  assert.equal(validateQuizGenerationModel(null).ok, true)
  assert.equal(validateQuizGenerationModel('{not json').ok, true)
  assert.equal(validateQuizGenerationModel('{not json', { failOnInvalidJson: true }).ok, false)
})

test('\'🔴 rejection is only for Managed higher tiers - Self/BYO and legacy are not blocked for the wrong reason\'', () => {
  for (const m of ['claude-3-5-sonnet', 'gemini-2.0-flash', 'gpt-5.1', 'deepseek-chat']) {
    assert.equal(
      validateQuizGenerationModel(wf([aiNode('ai1', m), quizNode('q1')], [edge('ai1', 'q1', 'miniapps')]), G).ok,
      true,
      m
    )
  }
})
