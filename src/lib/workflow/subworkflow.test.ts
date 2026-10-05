import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUB_WORKFLOW_MAX_ARGS_BYTES,
  SUB_WORKFLOW_MAX_ARG_STRING_CHARS,
  SUB_WORKFLOW_MAX_RESULT_CHARS,
  SUB_WORKFLOW_RESULT,
  SUB_WORKFLOW_TOOL_NAME_RE,
  buildSubWorkflowToolDefinition,
  clampSubWorkflowResult,
  collectSubWorkflowRefs,
  normalizeWorkflowKind,
  readSubWorkflowDefinition,
  readSubWorkflowDefinitionFromStartData,
  suggestSubWorkflowToolName,
  buildSubWorkflowSkeleton,
  parseSubWorkflowTimeoutSeconds,
  subWorkflowTimeoutSecondsOf,
  validateSubWorkflowArgs,
  withClonedSubWorkflowToolName,
  type SubWorkflowDefinition,
} from './subworkflow'

//

const start = (data: Record<string, unknown>, id = 'start-1') => ({ id, type: 'start', data: { nodeType: 'start', triggerType: 'subworkflow', ...data } })
const wf = (nodes: unknown[]) => JSON.stringify({ nodes, edges: [] })

test('readSubWorkflowDefinition: fails when there is no Start/Sub-workflow', () => {
  const r = readSubWorkflowDefinition(wf([{ id: 's', type: 'start', data: { nodeType: 'start', triggerType: 'pstn' } }]))
  assert.equal(r.ok, false)
})

test('readSubWorkflowDefinition: fails when there are two Start/Sub-workflow (names the second id)', () => {
  const r = readSubWorkflowDefinition(wf([start({ toolName: 'a_b' }, 's1'), start({ toolName: 'c_d' }, 's2')]))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.startNodeId, 's2')
})

test('toolName regex - 2 to 40 chars total, starts lowercase', () => {
  const ok = (name: string) => readSubWorkflowDefinitionFromStartData({ toolName: name }).ok
  assert.equal(ok('ab'), true)
  assert.equal(ok('a'), false)
  assert.equal(ok('a'.repeat(40)), true)
  assert.equal(ok('a'.repeat(41)), false)
  assert.equal(ok('Add_points'), false)
  assert.equal(ok('1abc'), false)
  assert.equal(ok('add-points'), false)
  assert.equal(ok('  add_points  '), true) // trim
})

test('toolDescription falls back to default text when missing, fails above 1000 chars', () => {
  const r = readSubWorkflowDefinitionFromStartData({ toolName: 'add_points' })
  assert.equal(r.ok, true)
  if (r.ok) assert.match(r.def.toolDescription, /add_points/)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'x_y', toolDescription: 'd'.repeat(1001) }).ok, false)
})

test('optional fields must also have the right type - required:"true" and non-string description are rejected (fail-closed)', () => {
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: [{ name: 'p', type: 'string', required: 'true' }] }).ok, false)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: [{ name: 'p', type: 'string', description: 42 }] }).ok, false)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', toolDescription: ['x'] }).ok, false)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: [{ name: 'p', type: 'string', required: null, description: null }] }).ok, true)
})

test('validateSubWorkflowArgs: total size limit is by bytes - non-ASCII text is larger than .length', () => {
  const d: SubWorkflowDefinition = { toolName: 'k', toolDescription: 'k', inputs: Array.from({ length: 3 }, (_, i) => ({ name: `s${i}`, type: 'string' as const })) }
  const args = Object.fromEntries(d.inputs.map(i => [i.name, '가'.repeat(1000)]))
  assert.ok(JSON.stringify(args).length < SUB_WORKFLOW_MAX_ARGS_BYTES)
  assert.equal(validateSubWorkflowArgs(d, args).ok, false)
})

test('inputs - max 10, name rules, duplicates, type enum', () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ name: `i${i}`, type: 'string' }))
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: many }).ok, false)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: [{ name: 'Phone', type: 'string' }] }).ok, false)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: [{ name: 'a.b', type: 'string' }] }).ok, false)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: [{ name: 'p', type: 'string' }, { name: 'p', type: 'number' }] }).ok, false)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: [{ name: 'p', type: 'object' }] }).ok, false)
  assert.equal(readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: 'nope' }).ok, false)
  const r = readSubWorkflowDefinitionFromStartData({ toolName: 'a_b', inputs: [{ name: 'phone', type: 'string', description: ' E.164 ', required: true }, { name: 'pts', type: 'number' }] })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepEqual(r.def.inputs, [
      { name: 'phone', type: 'string', description: 'E.164', required: true },
      { name: 'pts', type: 'number' },
    ])
  }
})

test('buildSubWorkflowToolDefinition: subwf_ prefix, required, additionalProperties false', () => {
  const def: SubWorkflowDefinition = { toolName: 'add_points', toolDescription: 'Add points', inputs: [{ name: 'phone', type: 'string', required: true }, { name: 'pts', type: 'number' }], timeoutMs: 15_000 }
  const t = buildSubWorkflowToolDefinition(def)
  assert.equal(t.name, 'subwf_add_points')
  assert.equal(t.description, 'Add points')
  assert.deepEqual(t.parameters.required, ['phone'])
  assert.equal(t.parameters.additionalProperties, false)
  assert.deepEqual(Object.keys(t.parameters.properties), ['phone', 'pts'])
})

const def: SubWorkflowDefinition = {
  toolName: 'add_points',
  toolDescription: 'x',
  inputs: [
    { name: 'phone', type: 'string', required: true },
    { name: 'pts', type: 'number' },
    { name: 'optin', type: 'boolean' },
  ],
  timeoutMs: 15_000,
}

test('validateSubWorkflowArgs: missing required fails', () => {
  assert.equal(validateSubWorkflowArgs(def, {}).ok, false)
  assert.equal(validateSubWorkflowArgs(def, { phone: '' }).ok, false)
  assert.equal(validateSubWorkflowArgs(def, null).ok, false)
})

test('validateSubWorkflowArgs: type coercion (lenient) + extra keys removed', () => {
  const r = validateSubWorkflowArgs(def, { phone: 41761234567, pts: '42', optin: 'true', evil: 'x' })
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.value, { phone: '41761234567', pts: 42, optin: true })
})

test('validateSubWorkflowArgs: rejects bad numbers and booleans, rejects objects/arrays', () => {
  assert.equal(validateSubWorkflowArgs(def, { phone: 'a', pts: 'abc' }).ok, false)
  assert.equal(validateSubWorkflowArgs(def, { phone: 'a', pts: Infinity }).ok, false)
  assert.equal(validateSubWorkflowArgs(def, { phone: 'a', optin: 'yes' }).ok, false)
  assert.equal(validateSubWorkflowArgs(def, { phone: { a: 1 } }).ok, false)
  assert.equal(validateSubWorkflowArgs(def, { phone: ['a'] }).ok, false)
})

test('validateSubWorkflowArgs: string limit 2,000 chars, total 8KB', () => {
  assert.equal(validateSubWorkflowArgs(def, { phone: 'x'.repeat(SUB_WORKFLOW_MAX_ARG_STRING_CHARS) }).ok, true)
  assert.equal(validateSubWorkflowArgs(def, { phone: 'x'.repeat(SUB_WORKFLOW_MAX_ARG_STRING_CHARS + 1) }).ok, false)
  const wide: SubWorkflowDefinition = { toolName: 'w', toolDescription: 'w', inputs: Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, type: 'string' as const })), timeoutMs: 15_000 }
  const args = Object.fromEntries(wide.inputs.map(i => [i.name, 'y'.repeat(2000)]))
  const r = validateSubWorkflowArgs(wide, args)
  assert.equal(r.ok, false)
  assert.ok(JSON.stringify(args).length > SUB_WORKFLOW_MAX_ARGS_BYTES)
})

test('collectSubWorkflowRefs: only tool+subworkflow, deduplicated, empty id excluded, ignored if type is not tool', () => {
  const json = wf([
    { id: 't1', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: 'wf_a' } },
    { id: 't2', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: ' wf_a ' } },
    { id: 't3', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: 'wf_b' } },
    { id: 't4', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: '' } },
    { id: 't5', type: 'tool', data: { toolType: 'sms', subWorkflowId: 'wf_c' } },
    { id: 'n1', type: 'note', data: { toolType: 'subworkflow', subWorkflowId: 'wf_d' } },
  ])
  assert.deepEqual(collectSubWorkflowRefs(json).sort(), ['wf_a', 'wf_b'])
  assert.deepEqual(collectSubWorkflowRefs('not json'), [])
})

test('clampSubWorkflowResult: 4,000 char limit - by code point (no surrogate cut)', () => {
  assert.equal(clampSubWorkflowResult('ok'), 'ok')
  const long = clampSubWorkflowResult('z'.repeat(SUB_WORKFLOW_MAX_RESULT_CHARS + 50))
  assert.equal(long.length, SUB_WORKFLOW_MAX_RESULT_CHARS + 1) // + '…'
  const emoji = clampSubWorkflowResult('😀'.repeat(SUB_WORKFLOW_MAX_RESULT_CHARS + 1))
  assert.equal(Array.from(emoji).length, SUB_WORKFLOW_MAX_RESULT_CHARS + 1)
  assert.equal(emoji.includes('\uFFFD'), false)
  assert.ok(emoji.endsWith('…'))
})

test('SUB_WORKFLOW_RESULT values are all valid JSON and timeout is marked as undetermined', () => {
  for (const v of [SUB_WORKFLOW_RESULT.failed, SUB_WORKFLOW_RESULT.noAnswer, SUB_WORKFLOW_RESULT.timeout, SUB_WORKFLOW_RESULT.unavailable, SUB_WORKFLOW_RESULT.invalidArgs('x')]) {
    JSON.parse(v)
  }
  assert.match(SUB_WORKFLOW_RESULT.timeout, /may still complete/)
})

test('normalizeWorkflowKind: everything except sub becomes main', () => {
  assert.equal(normalizeWorkflowKind('sub'), 'sub')
  assert.equal(normalizeWorkflowKind('main'), 'main')
  assert.equal(normalizeWorkflowKind(undefined), 'main')
  assert.equal(normalizeWorkflowKind('SUB'), 'main')
})

test('withClonedSubWorkflowToolName: _copy suffix, cut within 40 chars, re-cloning does not duplicate _copy', () => {
  const j1 = withClonedSubWorkflowToolName(wf([start({ toolName: 'add_points' })]))
  assert.equal(JSON.parse(j1).nodes[0].data.toolName, 'add_points_copy')
  const j2 = withClonedSubWorkflowToolName(j1)
  assert.equal(JSON.parse(j2).nodes[0].data.toolName, 'add_points_copy')
  const taken = new Set(['add_points_copy', 'add_points_copy2'])
  const j2b = withClonedSubWorkflowToolName(j1, (n) => taken.has(n))
  assert.equal(JSON.parse(j2b).nodes[0].data.toolName, 'add_points_copy3')
  const longName = 'a'.repeat(40)
  const j3 = withClonedSubWorkflowToolName(wf([start({ toolName: longName })]))
  const t3 = JSON.parse(j3).nodes[0].data.toolName
  assert.equal(t3.length, 40)
  assert.ok(t3.endsWith('_copy'))
  const plain = wf([{ id: 's', type: 'start', data: { nodeType: 'start' } }])
  assert.equal(withClonedSubWorkflowToolName(plain), plain)
})

test('inputs: name "constructor" passes the regex but is reserved, so it is rejected - the template gate cannot read it, and even in an empty object it is an inherited property that slips past the not-provided check', () => {
  const r = readSubWorkflowDefinitionFromStartData({ toolName: 'ok_name', inputs: [{ name: 'constructor', type: 'string', required: true }] })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.field, 'inputs')
})

test('validateSubWorkflowArgs: only own properties are values - inherited property (constructor) is not provided', () => {
  const d: SubWorkflowDefinition = { toolName: 'x', toolDescription: 'x', inputs: [{ name: 'constructor', type: 'string', required: true }], timeoutMs: 15_000 }
  assert.equal(validateSubWorkflowArgs(d, {}).ok, false)
})

test('validateSubWorkflowArgs: whitespace-only string is not provided (required rejects it) - extension of the "" = not provided contract', () => {
  assert.equal(validateSubWorkflowArgs(def, { phone: '   ' }).ok, false)
  const r = validateSubWorkflowArgs(def, { phone: ' a ' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.value.phone, ' a ')
})

test('validateSubWorkflowArgs: number accepts decimal, fraction and exponent only - "0x10", "0b1", "Infinity" rejected, " 42 " passes', () => {
  const ok = (v: unknown) => validateSubWorkflowArgs(def, { phone: 'a', pts: v })
  assert.equal(ok('0x10').ok, false)
  assert.equal(ok('0b1').ok, false)
  assert.equal(ok('Infinity').ok, false)
  assert.equal(ok('1e400').ok, false)
  const r1 = ok(' 42 '); assert.equal(r1.ok, true); if (r1.ok) assert.equal(r1.value.pts, 42)
  const r2 = ok('1e3'); assert.equal(r2.ok, true); if (r2.ok) assert.equal(r2.value.pts, 1000)
  const r3 = ok('-3.5'); assert.equal(r3.ok, true); if (r3.ok) assert.equal(r3.value.pts, -3.5)
  const r4 = ok(0); assert.equal(r4.ok, true); if (r4.ok) assert.equal(r4.value.pts, 0)
})

test('withClonedSubWorkflowToolName: a saved copy with surrounding whitespace is also cloned (base is trimmed) - the panel saves raw, so this really happens', () => {
  const j = withClonedSubWorkflowToolName(wf([start({ toolName: ' add_points ' })]))
  assert.equal(JSON.parse(j).nodes[0].data.toolName, 'add_points_copy')
})

test('SUB_WORKFLOW_RESULT.unknownTool is valid JSON', () => {
  assert.equal(JSON.parse(SUB_WORKFLOW_RESULT.unknownTool).error, 'sub_workflow_unknown_tool')
})

test('suggestSubWorkflowToolName / buildSubWorkflowSkeleton: appends _2, _3 when the slug is already used by the same agent', () => {
  const taken = new Set(['add_points', 'add_points_2'])
  assert.equal(suggestSubWorkflowToolName('Add Points', (n) => taken.has(n)), 'add_points_3')
  assert.equal(suggestSubWorkflowToolName('Add Points'), 'add_points')
  const long = 'a'.repeat(40)
  const t = suggestSubWorkflowToolName(long, (n) => n === long)
  assert.equal(t.length, 40)
  assert.ok(t.endsWith('_2'))
  const skel = JSON.parse(buildSubWorkflowSkeleton('Add Points', (n) => n === 'add_points'))
  assert.equal(skel.nodes[0].data.toolName, 'add_points_2')
})

test('suggestSubWorkflowToolName: a name without ASCII falls back to a random suffix - passes the rules and is not a fixed value', () => {
  const names = ['포인트 적립', '🎁🎁', '한글만', '적립', '포인트']
  const out = names.map((n) => suggestSubWorkflowToolName(n))
  for (const n of out) {
    assert.match(n, SUB_WORKFLOW_TOOL_NAME_RE, `폴백 "${n}" 이 toolName 규칙을 벗어났다`)
    assert.match(n, /^sub_workflow_[a-z0-9]+$/, `폴백 "${n}" 이 예상 형태가 아니다`)
  }
  assert.ok(new Set(out).size > 1, `폴백이 고정값이다: ${out[0]}`)
  assert.match(suggestSubWorkflowToolName('한글만', () => true), SUB_WORKFLOW_TOOL_NAME_RE)
})

test('timeoutSeconds: default 15s when missing, integer 5-60 is multiplied by 1000, numeric strings are accepted', () => {
  const r0 = readSubWorkflowDefinitionFromStartData({ toolName: 'ok_name' })
  assert.ok(r0.ok && r0.def.timeoutMs === 15_000)
  const r1 = readSubWorkflowDefinitionFromStartData({ toolName: 'ok_name', timeoutSeconds: 40 })
  assert.ok(r1.ok && r1.def.timeoutMs === 40_000)
  const r2 = readSubWorkflowDefinitionFromStartData({ toolName: 'ok_name', timeoutSeconds: '25' })
  assert.ok(r2.ok && r2.def.timeoutMs === 25_000)
  const r3 = readSubWorkflowDefinitionFromStartData({ toolName: 'ok_name', timeoutSeconds: '' })
  assert.ok(r3.ok && r3.def.timeoutMs === 15_000)
})

test('timeoutSeconds: 4, 61, negative, NaN, object, **fraction, exponent, sign** reject the definition itself (fail-closed, field=timeoutSeconds)', () => {
  for (const bad of [4, 61, -1, 0, 'abc', {}, [], true, Infinity, 7.5, '7.5', '1e1', '+10', '5.']) {
    const r = readSubWorkflowDefinitionFromStartData({ toolName: 'ok_name', timeoutSeconds: bad })
    assert.equal(r.ok, false, `timeoutSeconds=${JSON.stringify(bad)} 는 거부돼야 한다`)
    if (!r.ok) assert.equal(r.field, 'timeoutSeconds')
  }
})

test('timeoutSeconds: boundaries 5 and 60 pass', () => {
  const r5 = readSubWorkflowDefinitionFromStartData({ toolName: 'ok_name', timeoutSeconds: 5 })
  assert.ok(r5.ok && r5.def.timeoutMs === 5_000)
  const r60 = readSubWorkflowDefinitionFromStartData({ toolName: 'ok_name', timeoutSeconds: 60 })
  assert.ok(r60.ok && r60.def.timeoutMs === 60_000)
})

test('parseSubWorkflowTimeoutSeconds: unspecified (null/undefined/empty/whitespace), numeric string, integer coercion', () => {
  for (const unset of [undefined, null, '', '   ']) {
    const p = parseSubWorkflowTimeoutSeconds(unset)
    assert.ok(p.ok && p.seconds === null, `${JSON.stringify(unset)} 는 미지정`)
  }
  for (const [raw, sec] of [[25, 25], ['25', 25], [' 25 ', 25], ['05', 5], [5, 5], [60, 60]] as Array<[unknown, number]>) {
    const p = parseSubWorkflowTimeoutSeconds(raw)
    assert.ok(p.ok && p.seconds === sec, `${JSON.stringify(raw)} → ${sec}`)
  }
  for (const bad of [4, 61, 0, -1, 7.5, '7.5', '1e1', '+10', 'abc', NaN, Infinity, true, [], {}]) {
    assert.equal(parseSubWorkflowTimeoutSeconds(bad).ok, false, `${JSON.stringify(bad)} 는 무효`)
  }
  const err = parseSubWorkflowTimeoutSeconds(7.5)
  assert.ok(!err.ok && /whole number/.test(err.error))
})

test('subWorkflowTimeoutSecondsOf: effective seconds for display - reads numeric strings too, invalid or unspecified gives default 15', () => {
  assert.equal(subWorkflowTimeoutSecondsOf({ timeoutSeconds: 30 }), 30)
  assert.equal(subWorkflowTimeoutSecondsOf({ timeoutSeconds: '30' }), 30)
  assert.equal(subWorkflowTimeoutSecondsOf({ timeoutSeconds: ' 5 ' }), 5)
  assert.equal(subWorkflowTimeoutSecondsOf({ timeoutSeconds: 7.5 }), 15)
  assert.equal(subWorkflowTimeoutSecondsOf({}), 15)
  assert.equal(subWorkflowTimeoutSecondsOf(undefined), 15)
})
