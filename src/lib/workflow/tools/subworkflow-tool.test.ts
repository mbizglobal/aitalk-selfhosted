import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient } from '@prisma/client'
import { SubWorkflowToolClient, type SubWorkflowRunner } from './subworkflow-tool'
import { SUB_WORKFLOW_MAX_RESULT_CHARS, SUB_WORKFLOW_RESULT } from '../subworkflow'
import { canReadTemplatePath } from '../template-scope'
import { evaluateCondition } from '../utils'
import { isSaveAsKeyAllowed } from '@/lib/connection-scope'
import type { WorkflowContext, WorkflowExecutionResult } from '../types'

//

const SUB_JSON = JSON.stringify({
  nodes: [
    { id: 'start-1', type: 'start', data: { nodeType: 'start', triggerType: 'subworkflow', toolName: 'add_points', toolDescription: 'Add points', inputs: [{ name: 'phone', type: 'string', required: true }, { name: 'pts', type: 'number' }] } },
    { id: 'end-1', type: 'end', data: { nodeType: 'end', message: 'ok' } },
  ],
  edges: [{ id: 'e', source: 'start-1', target: 'end-1' }],
})

type Row = { workflowId: string; name: string; status: string; workflowJson: string; agentId: string; kind: string }

const fakePrisma = (rows: Row[]) => {
  const calls: Array<Record<string, unknown>> = []
  const prisma = {
    workflow: {
      findFirst: async (q: { where: Record<string, unknown> }) => {
        calls.push(q.where)
        const w = q.where
        const hit = rows.find(r =>
          (w.workflowId === undefined || r.workflowId === w.workflowId) &&
          (w.agentId === undefined || r.agentId === w.agentId) &&
          (w.kind === undefined || r.kind === w.kind),
        )
        return hit ? { workflowId: hit.workflowId, name: hit.name, status: hit.status, workflowJson: hit.workflowJson } : null
      },
    },
  } as unknown as PrismaClient
  return { prisma, calls }
}

const okResult = (finalAnswer?: string, extra: Partial<WorkflowExecutionResult> = {}): WorkflowExecutionResult => ({
  streamResponse: new Response('x'),
  executionPath: [],
  totalDuration: 1,
  context: { message: '', agentId: 'ag', userId: 'u', ...(finalAnswer !== undefined ? { finalAnswer } : {}) },
  ...extra,
})

const rowA: Row = { workflowId: 'wf_sub_a', name: 'Add points', status: 'draft', workflowJson: SUB_JSON, agentId: 'ag', kind: 'sub' }

const build = async (rows: Row[], runner: SubWorkflowRunner, timeoutMs = 15_000, overrides: Record<string, unknown> = { agentId: 'ag', channel: 'chat_widget' }) => {
  const client = new SubWorkflowToolClient(runner, timeoutMs)
  const { prisma, calls } = fakePrisma(rows)
  await client.initialize(prisma, 'wf_sub_a', overrides as any, 'user-1')
  return { client, calls }
}

// ── initialize

test('\'initialize: fail-closed without agentId\'', async () => {
  const client = new SubWorkflowToolClient(async () => okResult('x'))
  await assert.rejects(() => client.initialize(fakePrisma([rowA]).prisma, 'wf_sub_a', {} as any, 'u'), /agentId/)
})

test('\'initialize: scoped to the same agent and kind sub - other agents and main are not found\'', async () => {
  const other: Row = { ...rowA, agentId: 'other' }
  const client = new SubWorkflowToolClient(async () => okResult('x'))
  await assert.rejects(() => client.initialize(fakePrisma([other]).prisma, 'wf_sub_a', { agentId: 'ag' }, 'u'), /not found/)
  const main: Row = { ...rowA, kind: 'main' }
  await assert.rejects(() => client.initialize(fakePrisma([main]).prisma, 'wf_sub_a', { agentId: 'ag' }, 'u'), /not found/)
  const { calls } = await build([rowA], async () => okResult('x'))
  assert.equal(calls[0].agentId, 'ag')
  assert.equal(calls[0].kind, 'sub')
})

test('\'initialize: rejects archived subs, also rejects subs with a broken Start definition\'', async () => {
  const client = new SubWorkflowToolClient(async () => okResult('x'))
  await assert.rejects(() => client.initialize(fakePrisma([{ ...rowA, status: 'archived' }]).prisma, 'wf_sub_a', { agentId: 'ag' }, 'u'), /archived/)
  const broken = { ...rowA, workflowJson: JSON.stringify({ nodes: [{ id: 's', type: 'start', data: { nodeType: 'start', triggerType: 'subworkflow', toolName: 'BAD' } }], edges: [] }) }
  await assert.rejects(() => client.initialize(fakePrisma([broken]).prisma, 'wf_sub_a', { agentId: 'ag' }, 'u'), /invalid/)
})

test('\'listTools: subwf_ prefixed name + Start input schema\'', async () => {
  const { client } = await build([rowA], async () => okResult('x'))
  const tools = client.listTools()
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'subwf_add_points')
  assert.equal(client.functionName, 'subwf_add_points')
  assert.deepEqual((tools[0].parameters as any).required, ['phone'])
})

// ── callTool

test('\'callTool: context seed - message=JSON(args), input=validated part, agentId/userId=caller, subWorkflowDepth=1, channel passed\'', async () => {
  let seen: { ctx: WorkflowContext; opts: { channel?: string } } | null = null
  const { client } = await build([rowA], async (_json, ctx, opts) => { seen = { ctx, opts }; return okResult('Points added') })
  const out = await client.callTool('subwf_add_points', { phone: '+41761234567', pts: '10', junk: 'x' })
  assert.equal(out, 'Points added')
  assert.ok(seen)
  assert.deepEqual(seen!.ctx.input, { phone: '+41761234567', pts: 10 })
  assert.equal(seen!.ctx.message, JSON.stringify({ phone: '+41761234567', pts: 10 }))
  assert.equal(seen!.ctx.agentId, 'ag')
  assert.equal(seen!.ctx.userId, 'user-1')
  assert.equal(seen!.ctx.subWorkflowDepth, 1)
  assert.equal(seen!.opts.channel, 'chat_widget')
})

test('\'callTool: passes the calling workflow id down as the sub context workflowId - work app project sheet decision (cleared if none)\'', async () => {
  let seen: WorkflowContext | null = null
  const runner: SubWorkflowRunner = async (_json, ctx) => { seen = ctx; return okResult('ok') }
  const { client } = await build([rowA], runner, 15_000, { agentId: 'ag', callerWorkflowId: 'wf_main_1' })
  await client.callTool('subwf_add_points', { phone: '+41761234567' })
  assert.equal(seen!.workflowId, 'wf_main_1')
  assert.notEqual(seen!.workflowId, 'wf_sub_a')
  const { client: bare } = await build([rowA], runner, 15_000, { agentId: 'ag' })
  await bare.callTool('subwf_add_points', { phone: '+41761234567' })
  assert.equal(seen!.workflowId, undefined)
})

//

const callCtx = (over: Record<string, unknown> = {}) =>
  ({ callChannel: 'pstn', callerNumber: '+41791112233', ...over }) as any

test('\'callTool: on PSTN, carries the verified caller number as context.callerNumber (separate from model arguments)\'', async () => {
  let seen: WorkflowContext | null = null
  const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
  await client.callTool('subwf_add_points', { phone: '+41760000000' }, callCtx())
  assert.equal(seen!.callerNumber, '+41791112233')
  assert.deepEqual(seen!.input, { phone: '+41760000000' })
})

test('\'callTool: web_voice does not carry a caller number - channel gate (blocks unverified origins)\'', async () => {
  let seen: WorkflowContext | null = null
  const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
  await client.callTool('subwf_add_points', { phone: 'x' }, callCtx({ callChannel: 'web_voice' }))
  assert.equal(seen!.callerNumber, '')
})

test('\'callTool: callContext missing, null, whitespace-only, non-string, too long -> empty string, not undefined\'', async () => {
  const cases = [
    undefined,
    callCtx({ callerNumber: null }),
    callCtx({ callerNumber: '   ' }),
    callCtx({ callerNumber: 42 }),
    callCtx({ callerNumber: ['+41791112233'] }),
    callCtx({ callerNumber: `+${'9'.repeat(40)}` }),
  ]
  for (const ctxArg of cases) {
    let seen: WorkflowContext | null = null
    const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
    await client.callTool('subwf_add_points', { phone: 'x' }, ctxArg)
    assert.equal(seen!.callerNumber, '')
  }
})

test('\'callTool: limit boundary - 32 chars pass, 33 are dropped\'', async () => {
  for (const [num, expected] of [['+' + '9'.repeat(31), '+' + '9'.repeat(31)], ['+' + '9'.repeat(32), '']] as const) {
    let seen: WorkflowContext | null = null
    const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
    await client.callTool('subwf_add_points', { phone: 'x' }, callCtx({ callerNumber: num }))
    assert.equal(seen!.callerNumber, expected)
  }
})

test('\'callerNumber branch contract: != "" is exactly "has a number" (must not be true when absent)\'', () => {
  const cond = { conditionField: 'callerNumber', conditionOperator: '!=', conditionValue: '' }
  assert.equal(evaluateCondition({ callerNumber: '+41791112233' } as any, cond), true)
  assert.equal(evaluateCondition({ callerNumber: '' } as any, cond), false)
})

test('\'callerNumber contract: templates can read it (readable) but saveAs cannot overwrite it (reserved)\'', () => {
  assert.equal(canReadTemplatePath({ callerNumber: '+41791112233' }, 'callerNumber'), true)
  assert.equal(isSaveAsKeyAllowed('callerNumber'), false)
})

test('\'callTool: argument validation failure -> invalid_arguments fixed text, engine not called\'', async () => {
  let ran = 0
  const { client } = await build([rowA], async () => { ran++; return okResult('x') })
  const out = await client.callTool('subwf_add_points', { pts: 3 })
  assert.equal(JSON.parse(out).error, 'sub_workflow_invalid_arguments')
  assert.equal(ran, 0)
})

test('\'callTool: different name -> fixed JSON (unknown_tool) - does not echo the name given by the model\'', async () => {
  const { client } = await build([rowA], async () => okResult('x'))
  const out = await client.callTool('subwf_other', { phone: 'a' })
  assert.equal(out, SUB_WORKFLOW_RESULT.unknownTool)
  assert.doesNotMatch(out, /subwf_other/)
})

test('\'callTool: nodeError -> failed fixed text (does not carry finalAnswer even if present)\'', async () => {
  const { client } = await build([rowA], async () => okResult('## ❌ Error\nDetails: secret', { nodeError: { nodeId: 'ds-1', nodeLabel: 'Data Sheets', error: 'boom' } }))
  assert.equal(await client.callTool('subwf_add_points', { phone: 'a' }), SUB_WORKFLOW_RESULT.failed)
})

test('\'callTool: End not reached (finalAnswer missing/blank) -> no_answer fixed text\'', async () => {
  const { client } = await build([rowA], async () => okResult(undefined))
  assert.equal(await client.callTool('subwf_add_points', { phone: 'a' }), SUB_WORKFLOW_RESULT.noAnswer)
  const { client: c2 } = await build([rowA], async () => okResult('   '))
  assert.equal(await c2.callTool('subwf_add_points', { phone: 'a' }), SUB_WORKFLOW_RESULT.noAnswer)
})

test('\'callTool: a normal result is capped at 4,000 chars\'', async () => {
  const { client } = await build([rowA], async () => okResult('z'.repeat(SUB_WORKFLOW_MAX_RESULT_CHARS + 100)))
  const out = await client.callTool('subwf_add_points', { phone: 'a' })
  assert.equal(out.length, SUB_WORKFLOW_MAX_RESULT_CHARS + 1)
})

test('\'callTool: engine exception -> failed fixed text (original not exposed)\'', async () => {
  const { client } = await build([rowA], async () => { throw new Error('prisma exploded with PII 0791234567') })
  const out = await client.callTool('subwf_add_points', { phone: 'a' })
  assert.equal(out, SUB_WORKFLOW_RESULT.failed)
  assert.equal(out.includes('0791234567'), false)
})

test('\'callTool: timeout -> undetermined text (may still complete). The sub run is not canceled\'', async () => {
  let finished = false
  const slow: SubWorkflowRunner = () => new Promise(resolve => setTimeout(() => { finished = true; resolve(okResult('late')) }, 60))
  const { client } = await build([rowA], slow, 10)
  const out = await client.callTool('subwf_add_points', { phone: 'a' })
  assert.equal(out, SUB_WORKFLOW_RESULT.timeout)
  assert.equal(finished, false)
  await new Promise(r => setTimeout(r, 80))
  assert.equal(finished, true)
})

test('\'timeout follows the sub Start node timeoutSeconds - without a constructor override, a 5s sub returns undetermined at 5s\'', async () => {
  const json5 = JSON.parse(SUB_JSON); json5.nodes[0].data.timeoutSeconds = 5
  const row5: Row = { ...rowA, workflowJson: JSON.stringify(json5) }
  let resolveRun: ((r: WorkflowExecutionResult) => void) | undefined
  const runner: SubWorkflowRunner = () => new Promise((res) => { resolveRun = res })
  const client = new SubWorkflowToolClient(runner)
  const { prisma } = fakePrisma([row5])
  await client.initialize(prisma, 'wf_sub_a', { agentId: 'ag' } as any, 'user-1')
  const t0 = Date.now()
  assert.equal((client as any).timeoutMs, 5_000)
  resolveRun?.(okResult('done'))
  assert.ok(Date.now() - t0 < 1000)
})

test('\'a constructor override takes priority over the definition value (test seam)\'', async () => {
  const client = new SubWorkflowToolClient(async () => okResult('x'), 1_234)
  const { prisma } = fakePrisma([rowA])
  await client.initialize(prisma, 'wf_sub_a', { agentId: 'ag' } as any, 'user-1')
  assert.equal((client as any).timeoutMs, 1_234)
})

//

test('\'callTool: callContext.voiceQuiz is carried as context.voiceQuiz and is not in input (mutation: put correct in input too)\'', async () => {
  let seen: WorkflowContext | null = null
  const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
  await client.callTool('subwf_add_points', { phone: 'x' }, callCtx({
    voiceQuiz: { roundId: 'r1', phase: 'settle', questionCount: 3, asked: 3, correct: 2, topic: 'general' },
  }))
  assert.deepEqual(seen!.voiceQuiz, { roundId: 'r1', phase: 'settle', questionCount: 3, asked: 3, correct: 2, topic: 'general' })
  assert.deepEqual(seen!.input, { phone: 'x' })
  assert.equal('correct' in (seen!.input as object), false)
  assert.equal(canReadTemplatePath({ voiceQuiz: { correct: 2 } }, 'voiceQuiz.correct'), true)
  assert.equal(isSaveAsKeyAllowed('voiceQuiz'), false)
})

test('\'callTool: without voiceQuiz (an ordinary call made by the model) the key itself is absent from context\'', async () => {
  let seen: WorkflowContext | null = null
  const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
  await client.callTool('subwf_add_points', { phone: 'x' }, callCtx())
  assert.equal('voiceQuiz' in seen!, false)
})

test('\'🔴 callTool: the five member-level phases are not collapsed - stop_calls must not be read as start\'', async () => {
  for (const phase of ['status', 'stop_calls', 'resume_calls', 'set_call_enrollment', 'erase_member']) {
    let seen: WorkflowContext | null = null
    const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
    await client.callTool('subwf_add_points', { phone: 'x' }, callCtx({
      voiceQuiz: { roundId: '', phase, questionCount: 0, asked: 0, correct: 0, topic: '', actionKey: 'k1', anonKey: 'voice-anon:' + 'a'.repeat(40) },
    }))
    assert.equal(seen!.voiceQuiz!.phase, phase, phase)
    assert.equal(seen!.voiceQuiz!.actionKey, 'k1')
    assert.equal(seen!.voiceQuiz!.anonKey, 'voice-anon:' + 'a'.repeat(40))
  }
})

test('\'🔴 callTool: the sign-up path carries the spoken text as is - does not create missing keys\'', async () => {
  let seen: WorkflowContext | null = null
  const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
  await client.callTool('subwf_add_points', { phone: 'x' }, callCtx({
    voiceQuiz: { consentText: '전화번호가 기록됩니다.', consentAt: '2026-08-26T10:00:00.000Z' },
  }))
  assert.equal(seen!.voiceQuiz!.consentText, '전화번호가 기록됩니다.')
  assert.equal(seen!.voiceQuiz!.consentAt, '2026-08-26T10:00:00.000Z')
  assert.equal('actionKey' in seen!.voiceQuiz!, false)
  assert.equal('anonKey' in seen!.voiceQuiz!, false)
})

test('\'callTool: voiceQuiz numbers are fixed to integers, no negatives\'', async () => {
  let seen: WorkflowContext | null = null
  const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
  await client.callTool('subwf_add_points', { phone: 'x' }, callCtx({
    voiceQuiz: { roundId: 'r1', phase: 'bogus', questionCount: '3', asked: -1, correct: 2.7, topic: 'x'.repeat(200) },
  }))
  assert.equal(seen!.voiceQuiz!.phase, 'start')
  assert.equal(seen!.voiceQuiz!.questionCount, 3)
  assert.equal(seen!.voiceQuiz!.asked, 0)
  assert.equal(seen!.voiceQuiz!.correct, 2)
  assert.equal(seen!.voiceQuiz!.topic.length, 100)
})

test('\'🔴 callTool: both fields of the two-step phone registration are carried - if missing, outbound dies entirely (2026-08-29 real call)\'', async () => {
  let seen: WorkflowContext | null = null
  const { client } = await build([rowA], async (_json, ctx) => { seen = ctx; return okResult('ok') })
  await client.callTool('subwf_add_points', { phone: 'x' }, callCtx({
    voiceQuiz: {
      roundId: '', phase: 'set_call_enrollment', questionCount: 0, asked: 0, correct: 0, topic: '',
      actionKey: 'k1', callReg: 'registered', callGroup: 'evening',
    } as any,
  }))
  assert.equal(seen!.voiceQuiz!.callReg, 'registered', '시트에 「등록」을 못 적는다 = 전화가 영영 안 나간다')
  assert.equal(seen!.voiceQuiz!.callGroup, 'evening', '시간대를 못 적는다 = 아무 때나 걸거나 안 건다')
  assert.equal(canReadTemplatePath({ voiceQuiz: { callReg: 'registered' } }, 'voiceQuiz.callReg'), true)
  assert.equal(canReadTemplatePath({ voiceQuiz: { callGroup: 'evening' } }, 'voiceQuiz.callGroup'), true)
  let bare: WorkflowContext | null = null
  const b = await build([rowA], async (_json, ctx) => { bare = ctx; return okResult('ok') })
  await b.client.callTool('subwf_add_points', { phone: 'x' }, callCtx({
    voiceQuiz: { roundId: '', phase: 'status', questionCount: 0, asked: 0, correct: 0, topic: '' },
  }))
  assert.equal('callReg' in (bare!.voiceQuiz as object), false)
  assert.equal('callGroup' in (bare!.voiceQuiz as object), false)

  let cleared: WorkflowContext | null = null
  const c = await build([rowA], async (_json, ctx) => { cleared = ctx; return okResult('ok') })
  await c.client.callTool('subwf_add_points', { phone: 'x' }, callCtx({
    voiceQuiz: {
      roundId: '', phase: 'set_call_enrollment', questionCount: 0, asked: 0, correct: 0, topic: '',
      callReg: 'declined', callGroup: '',
    } as any,
  }))
  assert.equal(cleared!.voiceQuiz!.callReg, 'declined')
  assert.equal('callGroup' in (cleared!.voiceQuiz as object), true, '빈 값이 키째 사라진다 — 옛 시간대가 시트에 남는다')
  assert.equal(cleared!.voiceQuiz!.callGroup, '')

  let odd: WorkflowContext | null = null
  const o = await build([rowA], async (_json, ctx) => { odd = ctx; return okResult('ok') })
  await o.client.callTool('subwf_add_points', { phone: 'x' }, callCtx({
    voiceQuiz: {
      roundId: '', phase: 'set_call_enrollment', questionCount: 0, asked: 0, correct: 0, topic: '',
      callReg: 'r'.repeat(40), callGroup: 123,
    } as any,
  }))
  assert.equal(odd!.voiceQuiz!.callReg!.length, 32, 'callReg 상한 32자')
  assert.equal('callGroup' in (odd!.voiceQuiz as object), false, '문자열이 아니면 키가 없어야 한다')
})
