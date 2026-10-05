import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderNodeCatalog } from './render-node-catalog'

test('render: exposes Version 5 + new mechanisms (Shape/one-of/Advisory/clamped/defaultsTo)', () => {
  const md = renderNodeCatalog()
  assert.match(md, /Version: 5 \(2026-09-13\)/)
  assert.match(md, /\{\{context\.callerNumber\}\}/)
  assert.match(md, /do NOT add a 'phone' input/)
  assert.match(md, /The 'else' handle is NOT automatic/)
  assert.match(md, /type:'else'/)
  assert.match(md, /## Canvas node types/)
  assert.match(md, /\| `dataSheets` \| `dataSheets` \|/)
  assert.match(md, /\| `branch` \(ifElse \/ condition\) \| `ifElse` \|/)
  // ifElse arrayRequirements → Shape
  assert.match(md, /\*\*Shape:\*\* `conditions` must be a non-empty array/)
  // dataSheets batch-insert requireAnyOf → one of
  assert.match(md, /one of `batchData` \/ `data`/)
  // imap markRead requireAnyOf
  assert.match(md, /one of `emailUid` \/ `uidToMark`/)
  // httpRequest multi requireArray
  assert.match(md, /`requests` as a non-empty array \(≥1 entry with `enabled` set\)/)
  // file_search advisory
  assert.match(md, /\*\*Advisory:\*\* without `vectorStoreId` the node runs but is a no-op/)
  assert.match(md, /`loopMode` ∈ \[while, forEach\] \(invalid values fall back to the default at runtime — warning only/)
  assert.match(md, /`mode` ∈ \[single, multi\] \(invalid values fall back to the default at runtime — warning only/)
  assert.match(md, /\*\*Required when `mode`="single":\*\* `url` — also applies when `mode` is absent or invalid/)
})

test('render: the four Sub-workflow slots of voice_quiz + required/optional + position of the sign-up field', () => {
  const md = renderNodeCatalog()
  for (const field of ['data.hooks.onRoundStart', 'data.hooks.onRoundSettle', 'data.signupSubWorkflowId', 'data.hooks.onMemberChange']) {
    assert.ok(md.includes(field), `카탈로그가 ${field} 를 말하지 않는다 — 저작 AI 는 그 칸이 없는 줄 안다`)
  }
  const required = md.slice(md.indexOf('REQUIRED: data.hooks.onRoundStart'), md.indexOf('OPTIONAL: data.signupSubWorkflowId'))
  const optional = md.slice(md.indexOf('OPTIONAL: data.signupSubWorkflowId'))
  assert.ok(required.length > 0 && optional.length > 0, '필수/선택 구간을 못 갈랐다 — 아래 검사가 헛돈다')
  assert.ok(required.includes('onRoundStart') && required.includes('onRoundSettle'), '필수 구간에 훅 둘이 다 있지 않다')
  assert.ok(required.includes('deploy is refused'), '필수인데 «비면 배포가 막힌다»를 안 말한다 — 선택으로 읽힌다')
  assert.equal(required.includes('signupSubWorkflowId'), false, '가입 칸이 «필수» 구간에 들어가 있다')
  assert.equal(required.includes('onMemberChange'), false, '그만두기 칸이 «필수» 구간에 들어가 있다')
  assert.ok(optional.includes('signupSubWorkflowId') && optional.includes('onMemberChange'), '선택 구간에 둘이 다 있지 않다')
  assert.ok(optional.includes('silent when empty'), '선택인데 «비면 조용히 꺼진다»를 안 말한다')
  assert.ok(optional.includes('ONLY the feature in that slot is disabled'), '선택 칸을 하나만 비운 경우를 안 말한다')
  assert.match(md, /signupSubWorkflowId sits directly on data, NOT inside hooks/)
  assert.match(md, /SAME AI node's 'tools' handle/)
})
