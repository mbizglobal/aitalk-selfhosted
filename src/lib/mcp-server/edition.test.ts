import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import { guideForEdition } from './guide-edition'
import { serverInstructions } from './instructions'

const GUIDE = readFileSync(join(process.cwd(), 'src/lib/mcp-server/resources/work-app-guide.md'), 'utf8')
const WORK_APP_TOOLS = ['list_work_blocks', 'get_work_app_spec', 'validate_work_app_spec', 'create_work_app', 'update_work_app_spec']

async function asEdition<T>(edition: 'cloud' | 'selfhosted', fn: () => T | Promise<T>): Promise<T> {
  const old = process.env.AITALK_EDITION
  process.env.AITALK_EDITION = edition
  try { return await fn() } finally { if (old === undefined) delete process.env.AITALK_EDITION; else process.env.AITALK_EDITION = old }
}

const smsCalSpec = () => ({
  spec: 1, name: 'Repairs',
  tables: [{
    key: 'repairs', name: 'Repairs',
    columns: [{ key: 'customer', label: 'Customer', kind: 'text', required: true }, { key: 'phone', label: 'Phone', kind: 'text' }, { key: 'due', label: 'Due', kind: 'date' }],
  }],
  sends: [
    { key: 'sms_done', label: 'Ready SMS', table: 'repairs', via: 'sms', to: 'column:phone', body: 'Repairs: {customer} is ready' },
    { key: 'cal_visit', label: 'Visit', table: 'repairs', via: 'calendar', to: 'cal', subject: 'Visit {customer}', event: { date: 'due' } },
  ],
})

test('MCP assembled app tools 5 · resources 2 = listed and readable in both editions · the block description follows the edition at call time (A2)', async () => {
  const { MCP_TOOLS, TOOL_REQUIRED_SCOPE } = await import('./tools')
  const { MCP_RESOURCES, readMcpResource } = await import('./mcp-resources')
  for (const ed of ['cloud', 'selfhosted'] as const) {
    await asEdition(ed, () => {
      for (const n of WORK_APP_TOOLS) {
        assert.ok(MCP_TOOLS.some((t) => t.name === n), `${ed}: ${n}`)
        assert.ok(TOOL_REQUIRED_SCOPE[n], `${ed}: scope ${n}`)
      }
      const lb = JSON.parse(JSON.stringify(MCP_TOOLS)).find((t: { name: string }) => t.name === 'list_work_blocks')
      assert.equal(/\bsms\b|\bcalendar\b/.test(lb.description), ed === 'cloud', lb.description)
      for (const uri of ['aitalk://work-app-guide', 'aitalk://block-catalog']) {
        assert.ok(MCP_RESOURCES.some((r) => r.uri === uri), `${ed}: list ${uri}`)
        const r = readMcpResource(uri)
        assert.ok(r && r.text.length > 500, `${ed}: read ${uri}`)
        assert.equal(r!.text.includes('Credit'), ed === 'cloud', `${ed}: ${uri} credits`)
      }
    })
  }
})

test('initialize text — self-hosted mentions assembled apps and not SMS · calendar · credits (A2)', () => {
  const sh = serverInstructions(true)
  const cl = serverInstructions(false)
  for (const s of [sh, cl]) assert.ok(s.includes('create_work_app') && s.includes('aitalk://work-app-guide'))
  assert.ok(!/sms|calendar|credit/i.test(sh), sh.match(/.{40}(sms|calendar|credit).{40}/i)?.[0])
  assert.ok(cl.includes('sendgrid/telegram/sms/smtp/calendar'))
})

test('guide edition split — self-hosted text has no SMS · calendar block guide · Credits · Cloud only loses the markers (A7)', () => {
  const sh = guideForEdition(GUIDE, true)
  const cl = guideForEdition(GUIDE, false)
  assert.ok(!sh.includes('Credit'))
  assert.ok(!sh.includes('Texting the customer') && !sh.includes('Putting a row into a calendar'))
  assert.ok(!sh.includes('"via": "sms", "to"') && !sh.includes('"via": "calendar", "to"'))
  assert.ok(!sh.includes('<!--') && !cl.includes('<!--'))
  assert.ok(cl.includes('Texting the customer') && cl.includes('Putting a row into a calendar') && cl.includes('Credits'))
  assert.ok(!cl.includes('This installation has no SMS'))
})

test('guide edition markers — unmatched markers throw (A7)', () => {
  assert.throws(() => guideForEdition('a\n<!-- cloud-only -->\nb', true))
  assert.throws(() => guideForEdition('a\n<!-- /cloud-only -->\nb', true))
  assert.throws(() => guideForEdition('a\n<!--cloud-only-->\nb\n<!--/cloud-only-->', true))
  assert.throws(() => guideForEdition('a <!-- cloud-only -->\nb\n<!-- /cloud-only -->', true))
  assert.throws(() => guideForEdition('<!-- cloud-only -->\n<!-- selfhosted-only -->\n<!-- /selfhosted-only -->\n<!-- /cloud-only -->', false))
  assert.equal(guideForEdition('a\n<!-- cloud-only -->\nb\n<!-- /cloud-only -->\n<!-- selfhosted-only -->\nc\n<!-- /selfhosted-only -->\nd', true), 'a\nc\nd')
  assert.equal(guideForEdition('a\n<!-- cloud-only -->\nb\n<!-- /cloud-only -->\n<!-- selfhosted-only -->\nc\n<!-- /selfhosted-only -->\nd', false), 'a\nb\nd')
})

test('block list — self-hosted has no SMS · calendar and no credit words · Cloud unchanged (A3 · A4)', async () => {
  const { blockCatalogData, renderBlockCatalog } = await import('./resources/render-block-catalog')
  await asEdition('selfhosted', () => {
    const ids = blockCatalogData().blocks.map((b) => b.id)
    assert.ok(!ids.includes('sms') && !ids.includes('calendar'))
    assert.equal(ids.length, 20)
    const md = renderBlockCatalog()
    assert.ok(!md.includes('Credit'), md.match(/.{60}Credit.{20}/)?.[0])
    assert.ok(!/via "sms"|via "calendar"/.test(md))
  })
  await asEdition('cloud', () => {
    const ids = blockCatalogData().blocks.map((b) => b.id)
    assert.ok(ids.includes('sms') && ids.includes('calendar'))
    assert.ok(renderBlockCatalog().includes('Credits'))
  })
})

test('validator — self-hosted refuses a spec with SMS · calendar sends as «not in this edition» · Cloud accepts (A4)', async () => {
  const { validateSpec } = await import('@/lib/work/assembled')
  await asEdition('selfhosted', () => {
    const v = validateSpec(smsCalSpec())
    assert.equal(v.ok, false)
    if (v.ok) return
    const na = v.issues.filter((i) => i.code === 'NOT_AVAILABLE').map((i) => i.path)
    assert.deepEqual(na.sort(), ['sends[0].via', 'sends[1].via'])
  })
  await asEdition('cloud', () => {
    const v = validateSpec(smsCalSpec())
    assert.ok(v.ok, JSON.stringify(!v.ok && v.issues))
  })
})

test('MCP validate_work_app_spec — self-hosted handles it (not UNAVAILABLE) · SMS refused with a reason (A2 · A4)', async () => {
  const { executeWorkAppTool } = await import('./work-apps')
  const auth = { tokenId: 't', userId: 'u', scopes: ['read'] } as unknown as Parameters<typeof executeWorkAppTool>[0]
  await asEdition('selfhosted', async () => {
    const r = await executeWorkAppTool(auth, 'validate_work_app_spec', { spec: smsCalSpec() })
    assert.ok(r.ok, JSON.stringify(r))
    if (!r.ok) return
    const d = r.data as { ok: boolean; issues?: { code: string }[] }
    assert.equal(d.ok, false)
    assert.ok(d.issues?.some((i) => i.code === 'NOT_AVAILABLE'))
    const l = await executeWorkAppTool(auth, 'list_work_blocks', {})
    assert.ok(l.ok)
    if (l.ok) assert.ok(!(l.data as { blocks: { id: string }[] }).blocks.some((b) => b.id === 'sms' || b.id === 'calendar'))
  })
})
