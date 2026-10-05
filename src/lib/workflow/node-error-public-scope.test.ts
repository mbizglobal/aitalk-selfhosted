
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { WorkflowEngine } from './engine'
import { WorkflowContext, WorkflowNode } from './types'

const FAIL_LABEL = 'internal-billing-sync (do-not-expose)'
const PUBLIC_MESSAGE = 'Sorry, I could not process your request.'

const node = (id: string, nodeType: string, data: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type: 'custom',
  data: { nodeType, label: id, ...data },
  position: { x: 0, y: 0 },
} as unknown as WorkflowNode)

const failingGraph = () => ({
  nodes: [
    node('start', 'start'),
    node('fail', 'dataSheets', { operation: 'insert', label: FAIL_LABEL }),
    node('end', 'end'),
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'fail' },
    { id: 'e2', source: 'fail', target: 'end' },
  ],
})

const run = (options?: { debugEnabled: true }) =>
  new WorkflowEngine().execute(
    failingGraph() as never,
    { message: 'hi' } as WorkflowContext,
    options as never,
  )

const streamText = async (res: unknown): Promise<string> =>
  res ? await new Response((res as Response).body ?? (res as BodyInit)).text() : ''

test('public path: neither the raw node error nor the label goes to the stream; a fixed message goes out', async () => {
  const result = await run()
  const body = await streamText(result.streamResponse)

  assert.ok(body.includes('"type":"error"'), `에러 이벤트 자체가 없다: ${body.slice(0, 200)}`)
  assert.ok(body.includes(PUBLIC_MESSAGE), `고정 문구가 없다: ${body.slice(0, 300)}`)
  assert.equal(
    body.includes('sheetId'),
    false,
    `노드 오류 원문이 공개 스트림에 실렸다: ${body.slice(0, 300)}`,
  )
  assert.equal(
    body.includes(FAIL_LABEL),
    false,
    `노드 라벨이 공개 스트림에 실렸다: ${body.slice(0, 300)}`,
  )
})

test('even on the public path, the server-internal nodeError stays raw (analytics, telegram, scheduler read it)', async () => {
  const result = await run()

  assert.ok(result.nodeError, 'nodeError 가 없다 — 실패가 표면화되지 않았다')
  assert.equal(result.nodeError!.nodeId, 'fail')
  assert.match(result.nodeError!.error, /sheetId/i)
  assert.equal(result.nodeError!.nodeLabel, FAIL_LABEL)
})

test('Test panel (debugEnabled): the raw message comes through as is (prevents over-rejection)', async () => {
  const result = await run({ debugEnabled: true })
  const body = await streamText(result.streamResponse)

  assert.ok(
    body.includes('sheetId'),
    `오너 진단 경로인데 원문이 사라졌다 — 게이트가 과하게 막았다: ${body.slice(0, 300)}`,
  )
  assert.ok(body.includes(FAIL_LABEL), '어느 노드에서 실패했는지가 사라졌다')
  assert.equal(
    body.includes(PUBLIC_MESSAGE),
    false,
    'Test 패널에 공개용 고정 문구가 대신 나갔다',
  )
})
