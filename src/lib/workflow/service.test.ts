import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planLimitsFor,
  trafficWeightFor,
  parseScheduleDirective,
  generateWorkflowId,
  VALID_WORKFLOW_STATUSES,
  prepareWorkflowCreate,
} from './service'

test('planLimitsFor: free/unsubscribed gets 10 total and 1 production', () => {
  for (const [plan, status] of [
    ['free', 'active'],
    [undefined, undefined],
    ['starter', 'pending_payment'],
  ] as const) {
    const limits = planLimitsFor(plan, status)
    assert.equal(limits.isPaid, false, `${plan}/${status} 는 비유료여야`)
    assert.equal(limits.maxWorkflows, 10)
    assert.equal(limits.maxProduction, 1)
  }
})

test('planLimitsFor: paid plans have production limits 10/20/30/40 and unlimited total count', () => {
  const cases: Array<[string, number]> = [
    ['starter', 10],
    ['managed_starter', 10],
    ['standard', 20],
    ['managed_standard', 20],
    ['growth', 30],
    ['pro', 40],
    ['managed_pro', 40],
  ]
  for (const [plan, expected] of cases) {
    const limits = planLimitsFor(plan, 'active')
    assert.equal(limits.isPaid, true, `${plan}/active 는 유료여야`)
    assert.equal(limits.maxProduction, expected, `${plan} → maxProduction ${expected}`)
    assert.equal(limits.maxWorkflows, null, `${plan} 총 개수 무제한`)
  }
})

test('trafficWeightFor: production=100, others 0 (normalizes the status-derived value)', () => {
  assert.equal(trafficWeightFor('production'), 100)
  assert.equal(trafficWeightFor('draft'), 0)
  assert.equal(trafficWeightFor('archived'), 0)
})

test('parseScheduleDirective: enabled is the conjunction of scheduleEnabled && cronExpression', () => {
  const json = (data: Record<string, unknown>) =>
    JSON.stringify({ nodes: [{ data: { nodeType: 'start', ...data } }] })

  const on = parseScheduleDirective(json({ scheduleEnabled: true, cronExpression: '0 9 * * *', scheduleTimezone: 'Europe/Zurich' }))
  assert.deepEqual(on, { enabled: true, cronExpression: '0 9 * * *', timezone: 'Europe/Zurich' })

  assert.equal(parseScheduleDirective(json({ scheduleEnabled: true }))?.enabled, false)
  assert.equal(parseScheduleDirective(json({ scheduleEnabled: false, cronExpression: '0 9 * * *' }))?.enabled, false)
  assert.equal(parseScheduleDirective(json({}))?.timezone, 'UTC')
  assert.equal(parseScheduleDirective(JSON.stringify({ nodes: [] }))?.enabled, false)
})

test('parseScheduleDirective: JSON parse failure gives null (no schedule action, and no deletion either)', () => {
  assert.equal(parseScheduleDirective('not-json'), null)
})

test('generateWorkflowId: wf_ + 20 lowercase alphanumerics (same format as the old duplicates in 4 files)', () => {
  const id = generateWorkflowId()
  assert.match(id, /^wf_[a-z0-9]{20}$/)
})

test('pins the VALID_WORKFLOW_STATUSES contract', () => {
  assert.deepEqual([...VALID_WORKFLOW_STATUSES], ['draft', 'production', 'archived'])
})

// ========================================
// ========================================

const BROKEN_GRAPH = JSON.stringify({
  nodes: [{ id: 'x', type: 'custom', data: {} }],
  edges: [{ id: 'e1', source: 'x', target: 'nope' }],
})

test('prepareWorkflowCreate: the name comes first; NAME_REQUIRED even if the structure is also broken', () => {
  const r = prepareWorkflowCreate({ name: '', workflowJson: BROKEN_GRAPH })
  assert.equal((r as { code?: string }).code, 'NAME_REQUIRED')
})

test('prepareWorkflowCreate: status comes before structure; INVALID_STATUS', () => {
  const r = prepareWorkflowCreate({ name: 'n', status: 'live', workflowJson: BROKEN_GRAPH })
  assert.equal((r as { code?: string }).code, 'INVALID_STATUS')
})

test('prepareWorkflowCreate: sub+production comes before structure; SUB_WORKFLOW_NOT_DEPLOYABLE', () => {
  const r = prepareWorkflowCreate({ name: 'n', kind: 'sub', status: 'production', workflowJson: BROKEN_GRAPH })
  assert.equal((r as { code?: string }).code, 'SUB_WORKFLOW_NOT_DEPLOYABLE')
})

test('prepareWorkflowCreate: next comes structure validation; WORKFLOW_STRUCTURE_INVALID', () => {
  const r = prepareWorkflowCreate({ name: 'n', workflowJson: BROKEN_GRAPH })
  assert.equal((r as { code?: string }).code, 'WORKFLOW_STRUCTURE_INVALID')
})

test('prepareWorkflowCreate: defaults are empty graph, draft and nulls, with kind normalized', () => {
  const r = prepareWorkflowCreate({ name: 'n' })
  assert.ok(!('ok' in r), '성공이어야')
  const p = r as Exclude<typeof r, { ok: false }>
  assert.equal(p.workflowJson, JSON.stringify({ nodes: [], edges: [] }))
  assert.equal(p.status, 'draft')
  assert.equal(p.description, null)
  assert.equal(p.templateBinding, null)
  assert.equal(p.kind, 'main')
})

test('prepareWorkflowCreate: passed values are carried as is', () => {
  const graph = JSON.stringify({
    nodes: [
      { id: 'start-1', type: 'custom', data: { nodeType: 'start', triggerType: 'manual' } },
      { id: 'end-1', type: 'custom', data: { nodeType: 'end' } },
    ],
    edges: [{ id: 'e1', source: 'start-1', target: 'end-1' }],
  })
  const r = prepareWorkflowCreate({
    name: 'n', description: 'd', workflowJson: graph, status: 'draft', templateBinding: '{"a":1}',
  })
  assert.ok(!('ok' in r), '성공이어야')
  const p = r as Exclude<typeof r, { ok: false }>
  assert.equal(p.description, 'd')
  assert.equal(p.templateBinding, '{"a":1}')
  assert.equal(p.workflowJson, graph)
})

test('prepareWorkflowCreate: the notice-text length guard actually runs; removing it kills this test', () => {
  const graph = JSON.stringify({
    nodes: [
      { id: 'start-1', type: 'custom', data: { nodeType: 'start', triggerType: 'pstn' } },
      { id: 'ai-1', type: 'custom', data: { nodeType: 'ai' } },
      { id: 'end-1', type: 'custom', data: { nodeType: 'end' } },
      {
        id: 'quiz-1', type: 'tool',
        data: { toolType: 'miniapp', nodeType: 'miniapp', miniAppType: 'voice_quiz', signupNotice: { 'en-US': 'x'.repeat(301) } },
      },
    ],
    edges: [
      { id: 'e1', source: 'start-1', target: 'ai-1' },
      { id: 'e2', source: 'ai-1', target: 'end-1' },
      { id: 'e3', source: 'ai-1', target: 'quiz-1', sourceHandle: 'miniapps' },
    ],
  })
  const r = prepareWorkflowCreate({ name: 'n', workflowJson: graph })
  assert.equal((r as { code?: string }).code, 'QUIZ_NOTICE_TOO_LONG')
})

test('prepareWorkflowCreate: pins what stays as it is now (same behavior as before trimming)', () => {
  const blank = prepareWorkflowCreate({ name: '   ' })
  assert.ok(!('ok' in blank), '공백만 이름은 지금 통과한다')
  assert.equal((blank as { name: string }).name, '   ')

  const emptyStatus = prepareWorkflowCreate({ name: 'n', status: '' })
  assert.equal((emptyStatus as { status: string }).status, 'draft')

  const emptyDesc = prepareWorkflowCreate({ name: 'n', description: '' })
  assert.equal((emptyDesc as { description: string | null }).description, '')

  const emptyJson = prepareWorkflowCreate({ name: 'n', workflowJson: '' })
  assert.equal((emptyJson as { workflowJson: string }).workflowJson, JSON.stringify({ nodes: [], edges: [] }))
})
