import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LOOP_TOOL_NODE_KIND,
  PALETTE_ITEM_NODE_KIND,
  filterPaletteItems,
  isLoopToolAllowedForKind,
  isPaletteItemVisible,
} from './palette-visibility'
import { SUB_WORKFLOW_ALLOWED_NODE_KINDS } from '@/lib/workflow/subworkflow'

//
//

const PALETTE_IDS: string[] = (() => {
  const src = readFileSync(new URL('../constants/components.tsx', import.meta.url), 'utf8')
  const ids = [...src.matchAll(/^\s+\{ id: '([a-zA-Z_-]+)'/gm)].map(m => m[1])
  assert.ok(ids.length >= 20, `팔레트 id 파싱 실패(${ids.length}개) — 정규식이 소스와 어긋났다`)
  return [...new Set(ids)]
})()

test('every palette id is mapped - adding a new item without a mapping fails here', () => {
  for (const id of PALETTE_IDS) {
    assert.ok(PALETTE_ITEM_NODE_KIND[id], `팔레트 id "${id}" 의 엔진 실타입 매핑이 없다`)
  }
})

test('sub: hides AI, Wait, channel Start and tool-attached nodes', () => {
  for (const id of ['ai', 'wait', 'chat-widget', 'telegram-start', 'pstn-start', 'schedule', 'source', 'mcp', 'web-search', 'subworkflow']) {
    assert.equal(isPaletteItemVisible(id, 'sub'), false, `${id} 는 서브에서 보이면 안 된다`)
  }
})

test('sub: allowed nodes are visible - End, If/else, While, Data Sheets, RAG Store, Apps, HTTP, Note', () => {
  for (const id of ['subworkflow-start', 'end', 'condition', 'while', 'data-sheets', 'store', 'sendgrid', 'telegram', 'sms_infobip', 'imap', 'smtp', 'httpRequest', 'note']) {
    assert.equal(isPaletteItemVisible(id, 'sub'), true, `${id} 는 서브에서 보여야 한다`)
  }
})

test('main: hides only Start / Sub-workflow (everything else is visible) - placing them in main gets the save rejected', () => {
  assert.equal(isPaletteItemVisible('subworkflow-start', 'main'), false)
  for (const id of PALETTE_IDS.filter((i) => i !== 'subworkflow-start')) {
    assert.equal(isPaletteItemVisible(id, 'main'), true, `${id} 는 메인에서 보여야 한다`)
  }
})

test('allow-list consistency - every real type visible in sub, except note/start:sub, is inside SUB_WORKFLOW_ALLOWED_NODE_KINDS', () => {
  const visible = PALETTE_IDS.filter((id) => isPaletteItemVisible(id, 'sub'))
  for (const id of visible) {
    const kind = PALETTE_ITEM_NODE_KIND[id]
    if (kind === 'note' || kind === 'start:sub') continue
    assert.ok(SUB_WORKFLOW_ALLOWED_NODE_KINDS.has(kind), `${id}(${kind}) 는 검증기가 거부하는데 팔레트에 보인다`)
  }
  for (const id of PALETTE_IDS) {
    const kind = PALETTE_ITEM_NODE_KIND[id]
    if (kind.startsWith('start:') || kind === 'note' || kind === 'tool') continue
    assert.equal(
      isPaletteItemVisible(id, 'sub'),
      SUB_WORKFLOW_ALLOWED_NODE_KINDS.has(kind),
      `${id}(${kind}) 의 가시성이 허용 목록과 어긋난다`,
    )
  }
})

test('ids not in the mapping are shown - save-time validation beats a new palette item silently disappearing', () => {
  assert.equal(isPaletteItemVisible('brand-new-node', 'sub'), true)
  assert.equal(isPaletteItemVisible('brand-new-node', 'main'), true)
})

test('filterPaletteItems: list filter - the Tools section of a sub becomes empty (the caller hides the section)', () => {
  const tools = [{ id: 'source' }, { id: 'mcp' }, { id: 'web-search' }, { id: 'subworkflow' }]
  assert.deepEqual(filterPaletteItems(tools, 'sub'), [])
  assert.equal(filterPaletteItems(tools, 'main').length, 4)
  const basic = [{ id: 'chat-widget' }, { id: 'subworkflow-start' }, { id: 'ai' }, { id: 'end' }]
  assert.deepEqual(filterPaletteItems(basic, 'sub').map(i => i.id), ['subworkflow-start', 'end'])
  assert.deepEqual(filterPaletteItems(basic, 'main').map(i => i.id), ['chat-widget', 'ai', 'end'])
})

test('While loop body: in sub, AI, MCP and Wait cannot be added, the other 7 kinds can; main allows all', () => {
  const all = ['ai', 'mcp', 'wait', 'dataSheets', 'ifElse', 'continue', 'imap', 'smtp', 'telegram', 'sendgrid']
  const subAllowed = all.filter((t) => isLoopToolAllowedForKind(t, 'sub'))
  assert.deepEqual(subAllowed, ['dataSheets', 'ifElse', 'continue', 'imap', 'smtp', 'telegram', 'sendgrid'])
  for (const t of all) assert.equal(isLoopToolAllowedForKind(t, 'main'), true, `${t} 는 main 루프에서 허용`)
})

test('While loop body mapping drift - all 10 modal types are mapped, and only mcp is an attached node (tool)', () => {
  const src = readFileSync(new URL('../modals/WhileToolsModal.tsx', import.meta.url), 'utf8')
  const types = [...new Set([...src.matchAll(/addTool\('([a-zA-Z]+)'\)/g)].map(m => m[1]))]
  assert.ok(types.length >= 10, `addTool 파싱 실패(${types.length}종)`)
  for (const t of types) assert.ok(LOOP_TOOL_NODE_KIND[t], `루프 바디 "${t}" 의 엔진 실타입 매핑이 없다`)
  assert.equal(LOOP_TOOL_NODE_KIND.mcp, 'tool')
  assert.equal(isLoopToolAllowedForKind('mcp', 'sub'), false)
  assert.equal(isLoopToolAllowedForKind('brand_new_loop_tool', 'sub'), true)
})
