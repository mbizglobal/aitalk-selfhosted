import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient } from '@prisma/client'
import { loadAgentAppsTools } from './load-agent-tools'

//
//

const subJson = (toolName: string) => JSON.stringify({
  nodes: [
    { id: 's', type: 'start', data: { nodeType: 'start', triggerType: 'subworkflow', toolName, inputs: [{ name: 'phone', type: 'string', required: true }] } },
    { id: 'e', type: 'end', data: { nodeType: 'end', message: 'ok' } },
  ],
  edges: [{ id: 'x', source: 's', target: 'e' }],
})

const mainJson = (toolNodes: Array<Record<string, unknown>>) => JSON.stringify({
  nodes: [
    { id: 'start-1', type: 'start', data: { nodeType: 'start' } },
    { id: 'ai-1', type: 'ai', data: { nodeType: 'ai', model: 'gpt-5.1' } },
    { id: 'end-1', type: 'end', data: { nodeType: 'end' } },
    ...toolNodes.map((data, i) => ({ id: `tool-${i}`, type: 'tool', data })),
  ],
  edges: [
    { id: 'a', source: 'start-1', target: 'ai-1' },
    { id: 'b', source: 'ai-1', target: 'end-1' },
    ...toolNodes.map((_, i) => ({ id: `t${i}`, source: 'ai-1', target: `tool-${i}`, sourceHandle: 'tools' })),
  ],
})

type Row = { workflowId: string; agentId: string; kind: string; status: string; name: string; workflowJson: string }

const fakePrisma = (rows: Row[]) => {
  const subQueries: Array<Record<string, unknown>> = []
  return {
    prisma: {
      workflow: {
        findFirst: async (q: { where: Record<string, unknown> }) => {
          const w = q.where
          if (w.kind !== undefined) subQueries.push(w)
          const hit = rows.find(r =>
            (w.workflowId === undefined || r.workflowId === w.workflowId) &&
            (w.agentId === undefined || r.agentId === w.agentId) &&
            (w.status === undefined || r.status === w.status) &&
            (w.kind === undefined || r.kind === w.kind),
          )
          return hit ? { workflowId: hit.workflowId, name: hit.name, status: hit.status, workflowJson: hit.workflowJson } : null
        },
        findMany: async (q: { where: Record<string, unknown> }) => {
          const w = q.where
          return rows
            .filter(r => (w.agentId === undefined || r.agentId === w.agentId) && (w.status === undefined || r.status === w.status))
            .map(hit => ({ workflowId: hit.workflowId, name: hit.name, status: hit.status, workflowJson: hit.workflowJson }))
        },
      },
      callPhoneNumber: { findFirst: async () => null },
    } as unknown as PrismaClient,
    subQueries,
  }
}

const subA: Row = { workflowId: 'wf_sub_a', agentId: 'ag', kind: 'sub', status: 'draft', name: 'A', workflowJson: subJson('add_points') }
const subB: Row = { workflowId: 'wf_sub_b', agentId: 'ag', kind: 'sub', status: 'draft', name: 'B', workflowJson: subJson('add_points') }
const main = (json: string): Row => ({ workflowId: 'wf_main', agentId: 'ag', kind: 'main', status: 'production', name: 'M', workflowJson: json })

test('\'loader: the Sub-workflow tool is loaded by subWorkflowId reference (subwf_ name, looked up by same agent and kind sub)\'', async () => {
  const { prisma, subQueries } = fakePrisma([main(mainJson([{ toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' }])), subA])
  const r = await loadAgentAppsTools(prisma, 'ag', 'user-1', undefined, 'web_voice')
  assert.deepEqual(r.definitions.map(d => d.name), ['subwf_add_points'])
  assert.ok(r.clients.has('subwf_add_points'))
  assert.deepEqual(r.failedTools, [])
  assert.equal(subQueries.length, 1)
  assert.equal(subQueries[0].agentId, 'ag')
  assert.equal(subQueries[0].kind, 'sub')
})

test('\'loader: a missing subWorkflowId does not silently drop but shows up in failedTools\'', async () => {
  const { prisma } = fakePrisma([main(mainJson([{ toolType: 'subworkflow' }]))])
  const r = await loadAgentAppsTools(prisma, 'ag', 'user-1', undefined, 'web_voice')
  assert.equal(r.definitions.length, 0)
  assert.deepEqual(r.failedTools, [{ toolType: 'subworkflow', reason: 'no subWorkflowId' }])
})

test('\'loader: failedTools when the referenced target is missing (other agent) or archived\'', async () => {
  const other = { ...subA, agentId: 'someone-else' }
  const { prisma } = fakePrisma([main(mainJson([{ toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' }])), other])
  const r = await loadAgentAppsTools(prisma, 'ag', 'user-1', undefined, 'web_voice')
  assert.equal(r.definitions.length, 0)
  assert.equal(r.failedTools.length, 1)
  assert.equal(r.failedTools[0].toolType, 'subworkflow')
  assert.match(r.failedTools[0].reason, /SUB_WORKFLOW_NOT_FOUND/)

  const archived = { ...subA, status: 'archived' }
  const { prisma: p2 } = fakePrisma([main(mainJson([{ toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' }])), archived])
  const r2 = await loadAgentAppsTools(p2, 'ag', 'user-1', undefined, 'web_voice')
  assert.equal(r2.definitions.length, 0)
  assert.match(r2.failedTools[0].reason, /SUB_WORKFLOW_ARCHIVED/)
})

test('\'loader: two subs with the same toolName -> loads neither and reports them in failedTools (prevents Map.set overwrite)\'', async () => {
  const { prisma } = fakePrisma([
    main(mainJson([{ toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' }, { toolType: 'subworkflow', subWorkflowId: 'wf_sub_b' }])),
    subA, subB,
  ])
  const r = await loadAgentAppsTools(prisma, 'ag', 'user-1', undefined, 'web_voice')
  assert.equal(r.definitions.length, 0)
  assert.equal(r.clients.has('subwf_add_points'), false)
  assert.equal(r.failedTools.filter(f => /collision/.test(f.reason)).length, 2)
})
