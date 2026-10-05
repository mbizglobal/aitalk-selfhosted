
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { GET } from './route'

function makeRequest(host: string, query = '') {
  const base = host === 'localhost' ? 'http://localhost:3000' : 'https://www.aitalk.ch'
  return new NextRequest(`${base}/api/workflow-templates${query}`, { headers: { host } })
}

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    templateId: 'tpl_test',
    name: 'Test Template',
    description: 'desc',
    categoryCode: 'c1',
    category: { name: 'Cat One' },
    complexity: 'simple',
    keywords: '["alpha"]',
    nodeTypes: '[]',
    features: '[]',
    workflowJson: '{"nodes":[]}',
    explanation: null,
    isBuiltIn: false,
    sortOrder: 1,
    ...overrides,
  }
}

function stubFindMany(rows: unknown[]) {
  const model = prisma.workflowTemplate as any
  const original = model.findMany
  model.findMany = async () => rows
  return () => { model.findMany = original }
}

describe('GET /api/workflow-templates - dev branch (local JSON)', () => {
  it('host=localhost returns 200 + source:local - TDZ regression guard', async () => {
    const res = await GET(makeRequest('localhost'))

    assert.equal(res.status, 200, 'dev 분기가 500 이면 TDZ 회귀를 의심할 것 (route.ts parseField 주석)')
    const body = await res.json()
    assert.equal(body.source, 'local')
    assert.ok(Array.isArray(body.templates), 'templates 는 배열이어야 한다')
  })

  it('workflowJson is returned as a parsed object (a raw string would break the widget)', async () => {
    const res = await GET(makeRequest('localhost'))
    const body = await res.json()

    let checked = 0
    for (const t of body.templates) {
      assert.equal(typeof t.workflowJson, 'object', `${t.templateId}: workflowJson 이 파싱돼야 한다`)
      assert.ok(Array.isArray(t.keywords), `${t.templateId}: keywords 는 배열이어야 한다`)
      checked++
    }
    assert.ok(checked > 0, '검사한 템플릿이 0 개다 — 로컬 템플릿 로딩이 깨졌거나 데이터가 비었다')
  })
})

describe('GET /api/workflow-templates - prod branch (DB)', () => {
  it('host=www.aitalk.ch goes through the DB and parses the JSON string fields', async () => {
    const restore = stubFindMany([templateRow()])
    try {
      const res = await GET(makeRequest('www.aitalk.ch'))

      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.source, 'database')
      assert.equal(body.templates.length, 1)

      const t = body.templates[0]
      assert.equal(t.categoryName, 'Cat One', 'category 관계가 평탄화돼야 한다')
      assert.deepEqual(t.keywords, ['alpha'], '문자열이 아니라 파싱된 배열이어야 한다')
      assert.deepEqual(t.workflowJson, { nodes: [] })
    } finally {
      restore()
    }
  })

  it('if the stored JSON is corrupt it returns 500, and the raw exception text appears nowhere in the response', async () => {
    const secret = '{{LEAKED_WORKFLOW_BODY}}'
    const restore = stubFindMany([templateRow({ workflowJson: secret })])
    try {
      const res = await GET(makeRequest('www.aitalk.ch'))

      assert.equal(res.status, 500)

      const bodyRaw = JSON.stringify(await res.json())
      assert.equal(bodyRaw, JSON.stringify({ error: 'Failed to get templates' }), '본문은 고정 문구여야 한다')

      const headersRaw = JSON.stringify([...res.headers.entries()])
      for (const [label, channel] of [['헤더', headersRaw], ['statusText', res.statusText]] as const) {
        assert.ok(!channel.includes('LEAKED'), `${label}에 저장 문자열 조각이 새면 안 된다`)
        assert.ok(!channel.toLowerCase().includes('json at position'), `${label}에 파서 예외 원문이 새면 안 된다`)
      }
    } finally {
      restore()
    }
  })
})
