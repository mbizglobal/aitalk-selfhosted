
import { describe, it } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
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
      const res = await GET(makeRequest('www.aitalk.ch', '?kind=workflow'))

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

describe('GET /api/workflow-templates - work app templates come from the code list', () => {
  function stubHonoringNotIn(rows: Array<Record<string, unknown>>) {
    const model = prisma.workflowTemplate as any
    const original = model.findMany
    const calls: unknown[] = []
    model.findMany = async (args: { where?: { templateId?: { notIn?: string[] } } }) => {
      calls.push(args)
      const notIn = args?.where?.templateId?.notIn ?? []
      return rows.filter((r) => !notIn.includes(r.templateId as string))
    }
    return { calls, restore: () => { model.findMany = original } }
  }

  it('kind=workApp - no DB read even in prod - countries, maker and included apps are attached', cloudOnly, async () => {
    const s = stubHonoringNotIn([])
    try {
      const res = await GET(makeRequest('www.aitalk.ch', '?kind=workApp'))
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.source, 'code')
      assert.equal(s.calls.length, 0, 'DB 를 읽으면 안 된다')
      const by = Object.fromEntries(body.templates.map((t: { templateId: string }) => [t.templateId, t]))
      assert.deepEqual(Object.keys(by).sort(), ['work-app', 'work-app-approvals', 'work-app-invoice', 'work-app-invoices', 'work-app-ledger', 'work-app-receipts', 'work-app-vat'])
      assert.deepEqual(by['work-app-vat'].countries, ['CH'])
      assert.equal(by['work-app'].countries, 'all')
      assert.deepEqual(by['work-app-vat'].publisher, { kind: 'aitalk' })
      assert.equal(by['work-app-invoice'].includes.length, 2)
      assert.equal(typeof by['work-app'].workflowJson, 'object')
    } finally {
      s.restore()
    }
  })

  it('kind=workApp - search and category filters also apply to code entries', cloudOnly, async () => {
    const hit = await (await GET(makeRequest('www.aitalk.ch', '?kind=workApp&search=receipts'))).json()
    assert.ok(hit.templates.some((t: { templateId: string }) => t.templateId === 'work-app-receipts'))
    assert.ok(!hit.templates.some((t: { templateId: string }) => t.templateId === 'work-app-vat'))
    const spaced = await (await GET(makeRequest('www.aitalk.ch', '?kind=workApp&search=%20RECEIPTS%20'))).json()
    assert.deepEqual(spaced.templates.map((t: { templateId: string }) => t.templateId), hit.templates.map((t: { templateId: string }) => t.templateId), '대소문자 · 앞뒤 공백 무시')
    const blank = await (await GET(makeRequest('www.aitalk.ch', '?kind=workApp&search=%20%20'))).json()
    assert.equal(blank.templates.length, 7, '공백뿐인 검색 = 검색 없음')
    const none = await (await GET(makeRequest('www.aitalk.ch', '?kind=workApp&category=no_such_category'))).json()
    assert.deepEqual(none.templates, [])
  })

  it('same id with a broken old DB copy still returns 200 - dropped before parsing - kind=workflow has no work apps', cloudOnly, async () => {
    const s = stubHonoringNotIn([templateRow({ templateId: 'work-app-vat', workflowJson: '{' }), templateRow()])
    try {
      const res = await GET(makeRequest('www.aitalk.ch', '?kind=workflow'))
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.deepEqual(body.templates.map((t: { templateId: string }) => t.templateId), ['tpl_test'])
      const notIn = (s.calls[0] as { where: { templateId: { notIn: string[] } } }).where.templateId.notIn
      assert.ok(notIn.includes('work-app-vat') && notIn.includes('work-app'))
    } finally {
      s.restore()
    }
  })

  it('no kind - general + work apps - a shared id appears once, from code', async () => {
    const s = stubHonoringNotIn([templateRow({ templateId: 'work-app', name: 'OLD DB COPY', workflowJson: '{' }), templateRow()])
    try {
      const body = await (await GET(makeRequest('www.aitalk.ch'))).json()
      const ids = body.templates.map((t: { templateId: string }) => t.templateId)
      assert.equal(ids.filter((x: string) => x === 'work-app').length, 1)
      assert.ok(ids.includes('tpl_test'))
      assert.notEqual(body.templates.find((t: { templateId: string }) => t.templateId === 'work-app').name, 'OLD DB COPY')
    } finally {
      s.restore()
    }
  })

  it('development code path kind=workflow - work app templates are not mixed in', async () => {
    const body = await (await GET(makeRequest('localhost', '?kind=workflow'))).json()
    assert.ok(body.templates.length > 0)
    assert.ok(body.templates.every((t: { templateId: string }) => !t.templateId.startsWith('work-app')))
  })
})
