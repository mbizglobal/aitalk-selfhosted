import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBundleSpec,
  checkWiringBeforeSubstitution,
  checkWiringAfterSubstitution,
  substituteBundleTokens,
  findForbiddenLiterals,
  findTokenCandidates,
  readWholeToken,
  checkResolvedIds,
  nextFreeDisplayName,
  nextFreeToolName,
  withBundleSubToolName,
  type BundleGraphs,
  type BundleSpec,
  type ResolvedBundleIds,
} from './bundle'

const codes = (ps: { code: string }[]) => ps.map((p) => p.code).sort()

function spec(over: Partial<BundleSpec> = {}): BundleSpec {
  return {
    bundleVersion: 1,
    dataSheets: [{ key: 'members', name: 'Quiz Reward Members', columns: [{ name: 'phone', type: 'string' }] }],
    subWorkflows: [{ key: 'signup', name: 'Signup', workflowJson: '{}' }],
    wiring: [
      { graph: 'signup', node: 'read', field: 'sheetId', ref: 'sheet', key: 'members' },
      { graph: 'signup', node: 'read', field: 'sheetName', ref: 'sheetName', key: 'members' },
      { graph: '@main', node: 'tool-1', field: 'subWorkflowId', ref: 'sub', key: 'signup' },
    ],
    ...over,
  }
}

function graphs(over: { mainTool?: unknown; sheetId?: unknown; sheetName?: unknown; sys?: string } = {}): BundleGraphs {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(over, k)
  return {
    '@main': {
      nodes: [
        { id: 'ai-1', data: { nodeType: 'ai', systemMessage: over.sys ?? 'Call @subtool:signup to join.' } },
        { id: 'tool-1', data: { toolType: 'subworkflow', subWorkflowId: has('mainTool') ? over.mainTool : '@sub:signup' } },
      ],
      edges: [],
    },
    signup: {
      nodes: [
        {
          id: 'read',
          data: {
            sheetId: has('sheetId') ? over.sheetId : '@sheet:members',
            sheetName: has('sheetName') ? over.sheetName : '@sheetName:members',
          },
        },
      ],
      edges: [],
    },
  }
}

const IDS: ResolvedBundleIds = {
  subIds: { signup: 'wf_new0000000000000001' },
  subToolNames: { signup: 'subwf_quiz_reward_signup_2' },
  sheetIds: { members: 'cm_newsheet0001' },
  sheetNames: { members: 'Quiz Reward Members (2)' },
}

// ========================================
// ========================================

test('readWholeToken: accepted only when the whole field is a token', () => {
  assert.deepEqual(readWholeToken('@sub:signup'), { kind: 'sub', key: 'signup' })
  assert.deepEqual(readWholeToken('@sheetName:members'), { kind: 'sheetName', key: 'members' })
  for (const v of [' @sub:signup', '@sub:signup ', 'call @sub:signup now', '@Sub:signup', '@sub:round-start', '@sub:', '@sub', 'wf_real0001', '', null, 42]) {
    assert.equal(readWholeToken(v), null, `${JSON.stringify(v)} 는 기호가 아니어야`)
  }
})

test('findTokenCandidates: broadly catches even tokens with wrong syntax', () => {
  const hits = findTokenCandidates({ a: '@sub:round-start', b: { c: '@Sub:signup' }, d: ['@sheetName:', 'ok'] })
  assert.equal(hits.length, 3, `잡힌 것: ${JSON.stringify(hits)}`)
})

// ========================================
// ========================================

test('parseBundleSpec: without bundleVersion it is "not a bundle" (null); existing templates do not leak into the new path', () => {
  assert.equal(parseBundleSpec({ templateId: 'text-generation', workflowJson: '{}' }), null)
  assert.equal(parseBundleSpec({ dataSheets: [], subWorkflows: [] }), null, '배열이 있어도 bundleVersion 이 없으면 아니다')
  assert.equal(parseBundleSpec(null), null)
})

test('parseBundleSpec: an unknown version is rejected rather than falling back', () => {
  const r = parseBundleSpec({ bundleVersion: 2 })
  assert.deepEqual(codes((r as { problems: { code: string }[] }).problems), ['BUNDLE_VERSION_UNSUPPORTED'])
})

test('parseBundleSpec: cannot coexist with the old dataSheetSchema', () => {
  const r = parseBundleSpec({ bundleVersion: 1, ...spec(), dataSheetSchema: { name: 'x', columns: [] } })
  assert.ok(codes((r as { problems: { code: string }[] }).problems).includes('BUNDLE_LEGACY_SHEET_MIXED'))
})

test('parseBundleSpec: not a bundle if there are neither subs nor sheets', () => {
  const r = parseBundleSpec({ bundleVersion: 1, dataSheets: [], subWorkflows: [], wiring: [] })
  assert.ok(codes((r as { problems: { code: string }[] }).problems).includes('BUNDLE_EMPTY'))
})

test('parseBundleSpec: key rules: empty, uppercase, hyphen, duplicate', () => {
  for (const bad of ['', 'Members', 'mem-bers', ' members']) {
    const r = parseBundleSpec({
      bundleVersion: 1,
      dataSheets: [{ key: bad, name: 'S', columns: [{ name: 'a', type: 'string' }] }],
      subWorkflows: [], wiring: [],
    })
    assert.ok(codes((r as { problems: { code: string }[] }).problems).includes('BUNDLE_KEY_INVALID'), `${JSON.stringify(bad)} 는 거절돼야`)
  }
  const dup = parseBundleSpec({
    bundleVersion: 1,
    dataSheets: [
      { key: 'members', name: 'A', columns: [{ name: 'a', type: 'string' }] },
      { key: 'members', name: 'B', columns: [{ name: 'a', type: 'string' }] },
    ],
    subWorkflows: [], wiring: [],
  })
  assert.ok(codes((dup as { problems: { code: string }[] }).problems).includes('BUNDLE_KEY_DUPLICATE'))
})

test('parseBundleSpec: a declaration nobody points to is an orphan', () => {
  const s = spec()
  const r = parseBundleSpec({ bundleVersion: 1, ...s, wiring: s.wiring.filter((w) => w.ref === 'sub') })
  assert.ok(codes((r as { problems: { code: string }[] }).problems).includes('BUNDLE_KEY_UNUSED'))
})

test('parseBundleSpec: a field that is not a structural field is rejected', () => {
  const s = spec()
  const r = parseBundleSpec({
    bundleVersion: 1, ...s,
    wiring: [...s.wiring, { graph: '@main', node: 'ai-1', field: 'systemMessage', ref: 'sub', key: 'signup' }],
  })
  assert.ok(codes((r as { problems: { code: string }[] }).problems).includes('BUNDLE_WIRING_FIELD_UNKNOWN'))
})

test('parseBundleSpec: a complete bundle passes', () => {
  const r = parseBundleSpec({ bundleVersion: 1, ...spec() })
  assert.equal(r?.ok, true, JSON.stringify(r))
})

// ========================================
// ========================================

test('before substitution: a complete graph has 0 problems', () => {
  assert.deepEqual(checkWiringBeforeSubstitution(graphs(), spec()), [])
})

test('before substitution: catches the mistake of leaving a field empty; this is what v3 could not catch', () => {
  for (const bad of ['', '   ', null]) {
    const p = checkWiringBeforeSubstitution(graphs({ mainTool: bad }), spec())
    assert.ok(codes(p).includes('BUNDLE_WIRING_TOKEN_MISMATCH'), `${JSON.stringify(bad)} 는 잡혀야`)
  }
})

test('before substitution: catches a field holding another account\'s id', () => {
  const p = checkWiringBeforeSubstitution(graphs({ mainTool: 'wf_qexjljlcbnk0v6x952rr' }), spec())
  assert.ok(codes(p).includes('BUNDLE_WIRING_TOKEN_MISMATCH'))
})

test('before substitution: catches typo tokens (hyphen, uppercase, empty key)', () => {
  for (const bad of ['@sub:sign-up', '@Sub:signup', '@sub:', '@sub:unknown_key']) {
    const p = checkWiringBeforeSubstitution(graphs({ mainTool: bad }), spec())
    assert.ok(codes(p).includes('BUNDLE_WIRING_TOKEN_MISMATCH'), `${bad} 는 잡혀야`)
  }
})

test('before substitution: catches a structural field missing from the wiring list; a forgotten wiring', () => {
  const g = graphs()
  ;(g['@main'].nodes as { id: string; data: Record<string, unknown> }[])[1].data.signupSubWorkflowId = '@sub:signup'
  const p = checkWiringBeforeSubstitution(g, spec())
  assert.deepEqual(codes(p), ['BUNDLE_WIRING_UNDECLARED'])
})

test('before substitution: catches nonexistent nodes and nonexistent fields', () => {
  const s = spec()
  const missNode = checkWiringBeforeSubstitution(graphs(), { ...s, wiring: [{ graph: '@main', node: 'nope', field: 'subWorkflowId', ref: 'sub', key: 'signup' }] })
  assert.ok(codes(missNode).includes('BUNDLE_WIRING_NODE_MISSING'))
  const g = graphs()
  delete (g.signup.nodes as { id: string; data: Record<string, unknown> }[])[0].data.sheetName
  assert.ok(codes(checkWiringBeforeSubstitution(g, s)).includes('BUNDLE_WIRING_FIELD_MISSING'))
})

// ========================================
// ========================================

test('substitution: only wiring fields and body @subtool change', () => {
  const g = graphs()
  const g2 = substituteBundleTokens(g, spec(), IDS)
  const main = g2['@main'].nodes as { id: string; data: Record<string, unknown> }[]
  const sub = g2.signup.nodes as { id: string; data: Record<string, unknown> }[]
  assert.equal(main[1].data.subWorkflowId, 'wf_new0000000000000001')
  assert.equal(sub[0].data.sheetId, 'cm_newsheet0001')
  assert.equal(sub[0].data.sheetName, 'Quiz Reward Members (2)')
  assert.equal(main[0].data.systemMessage, 'Call subwf_quiz_reward_signup_2 to join.')
  assert.deepEqual(checkWiringAfterSubstitution(g2, spec(), IDS), [])
})

test('substitution: the same token appearing multiple times in the body is all replaced', () => {
  const g = graphs({ sys: 'call @subtool:signup, then @subtool:signup again' })
  const g2 = substituteBundleTokens(g, spec(), IDS)
  const main = g2['@main'].nodes as { id: string; data: Record<string, unknown> }[]
  assert.equal(main[0].data.systemMessage, 'call subwf_quiz_reward_signup_2, then subwf_quiz_reward_signup_2 again')
})

test('substitution: strings not in the wiring are left alone; a sentence that happens to resemble a token', () => {
  const g = graphs()
  ;(g['@main'].nodes as { id: string; data: Record<string, unknown> }[])[0].data.label = 'see @sub:signup in the docs'
  const g2 = substituteBundleTokens(g, spec(), IDS)
  assert.equal((g2['@main'].nodes as { id: string; data: Record<string, unknown> }[])[0].data.label, 'see @sub:signup in the docs')
  assert.ok(codes(checkWiringAfterSubstitution(g2, spec(), IDS)).includes('BUNDLE_TOKEN_LEFTOVER'))
})

// ========================================
// ========================================

test('after substitution: measures "is the id created this time", not "is not empty"', () => {
  const g = graphs()
  const g2 = substituteBundleTokens(g, spec(), IDS)
  ;(g2['@main'].nodes as { id: string; data: Record<string, unknown> }[])[1].data.subWorkflowId = 'wf_qexjljlcbnk0v6x952rr'
  assert.deepEqual(codes(checkWiringAfterSubstitution(g2, spec(), IDS)), ['BUNDLE_WIRING_UNRESOLVED'])
})

test('after substitution: also catches pointing to a different member of this bundle', () => {
  const s = spec({
    subWorkflows: [
      { key: 'signup', name: 'Signup', workflowJson: '{}' },
      { key: 'settle', name: 'Settle', workflowJson: '{}' },
    ],
    wiring: [
      { graph: 'signup', node: 'read', field: 'sheetId', ref: 'sheet', key: 'members' },
      { graph: 'signup', node: 'read', field: 'sheetName', ref: 'sheetName', key: 'members' },
      { graph: '@main', node: 'tool-1', field: 'subWorkflowId', ref: 'sub', key: 'settle' },
    ],
  })
  const ids: ResolvedBundleIds = { ...IDS, subIds: { signup: 'wf_a', settle: 'wf_b' }, subToolNames: { signup: 'subwf_a', settle: 'subwf_b' } }
  const g = graphs({ mainTool: '@sub:settle' })
  const g2 = substituteBundleTokens(g, s, ids)
  ;(g2['@main'].nodes as { id: string; data: Record<string, unknown> }[])[1].data.subWorkflowId = 'wf_a'
  assert.deepEqual(codes(checkWiringAfterSubstitution(g2, s, ids)), ['BUNDLE_WIRING_WRONG_TARGET'])
})

test('after substitution: catches an unresolved token wherever it remains', () => {
  const g = graphs({ sys: 'call @subtool:sign_up' })
  const g2 = substituteBundleTokens(g, spec(), IDS)
  assert.ok(codes(checkWiringAfterSubstitution(g2, spec(), IDS)).includes('BUNDLE_TOKEN_LEFTOVER'))
})

// ========================================
// ========================================

test('no literals: catches a tool function name written directly in the body', () => {
  const g = graphs({ sys: 'call subwf_quiz_reward_signup (no arguments)' })
  assert.deepEqual(codes(findForbiddenLiterals(g, spec())), ['BUNDLE_LITERAL_TOOL_NAME'])
})

test('no literals: catches a sheet name written directly in the body; the second copy is " (2)"', () => {
  const g = graphs({ sys: 'the sheet is called Quiz Reward Members' })
  assert.deepEqual(codes(findForbiddenLiterals(g, spec())), ['BUNDLE_LITERAL_SHEET_NAME'])
})

test('no literals: a body that uses tokens correctly passes', () => {
  assert.deepEqual(findForbiddenLiterals(graphs(), spec()), [])
})

// ========================================
// ========================================

test('wiring: rejects a mismatch between field and reference kind; a workflow id going into a sheet field', () => {
  const s = spec()
  for (const bad of [
    { graph: 'signup', node: 'read', field: 'sheetId', ref: 'sub', key: 'signup' },
    { graph: '@main', node: 'tool-1', field: 'subWorkflowId', ref: 'sheetName', key: 'members' },
    { graph: '@main', node: 'tool-1', field: 'hooks.onRoundStart', ref: 'sheet', key: 'members' },
  ]) {
    const r = parseBundleSpec({ bundleVersion: 1, ...s, wiring: [bad] })
    assert.ok(codes((r as { problems: { code: string }[] }).problems).includes('BUNDLE_WIRING_REF_MISMATCH'), `${JSON.stringify(bad)} 는 거절돼야`)
  }
})

test('sheet fields: actually checks name, type, required and description one by one', () => {
  const base = { key: 'members', name: 'S' }
  const bads: unknown[] = [
    [{ name: '', type: 'string' }],
    [{ name: '   ', type: 'string' }],
    [{ name: 'phone' }],
    [{ name: 'phone', type: null }],
    [{ name: 'phone', type: 'uuid' }],
    [{ name: 'phone', type: 'string', required: 'yes' }],
    [{ name: 'phone', type: 'string', description: 123 }],
    [{ name: 'phone', type: 'string' }, { name: 'phone', type: 'number' }],
    ['phone'],
    [],
  ]
  for (const columns of bads) {
    const r = parseBundleSpec({ bundleVersion: 1, dataSheets: [{ ...base, columns }], subWorkflows: [], wiring: [] })
    assert.ok(
      codes((r as { problems: { code: string }[] }).problems).includes('BUNDLE_SHAPE_INVALID'),
      `${JSON.stringify(columns)} 는 거절돼야`,
    )
  }
})

test('sheet fields: a complete field is carried as is (missing optional fields are not made undefined)', () => {
  const r = parseBundleSpec({
    bundleVersion: 1,
    dataSheets: [{ key: 'members', name: 'S', columns: [
      { name: 'phone', type: 'string', required: true, description: 'key' },
      { name: 'points', type: 'number' },
    ] }],
    subWorkflows: [], wiring: [{ graph: '@main', node: 'n', field: 'sheetId', ref: 'sheet', key: 'members' }],
  })
  assert.equal(r?.ok, true, JSON.stringify(r))
  const cols = (r as { value: BundleSpec }).value.dataSheets[0].columns
  assert.deepEqual(cols[0], { name: 'phone', type: 'string', required: true, description: 'key' })
  assert.deepEqual(cols[1], { name: 'points', type: 'number' })
})

// ========================================
// ========================================

test('path reading: an inherited property counts as absent; prototype pollution must not let wiring pass', () => {
  const g = graphs()
  const nodes = g['@main'].nodes as { id: string; data: Record<string, unknown> }[]
  delete nodes[1].data.subWorkflowId
  nodes[1].data = Object.create({ subWorkflowId: '@sub:signup' }) as Record<string, unknown>
  nodes[1].data.toolType = 'subworkflow'
  const p = checkWiringBeforeSubstitution(g, spec())
  assert.ok(codes(p).includes('BUNDLE_WIRING_FIELD_MISSING'), `잡힌 것: ${JSON.stringify(codes(p))}`)
})

test('path reading: if the middle hooks is an array, string or null it counts as absent', () => {
  const s = spec({ wiring: [{ graph: '@main', node: 'tool-1', field: 'hooks.onRoundStart', ref: 'sub', key: 'signup' }] })
  for (const hooks of [[], 'x', null, 0]) {
    const g = graphs()
    const nodes = g['@main'].nodes as { id: string; data: Record<string, unknown> }[]
    delete nodes[1].data.subWorkflowId
    nodes[1].data.hooks = hooks
    const p = checkWiringBeforeSubstitution(g, s)
    assert.ok(codes(p).includes('BUNDLE_WIRING_FIELD_MISSING'), `hooks=${JSON.stringify(hooks)} 는 없는 것이어야`)
  }
})

test('path reading and writing: nested hooks are read and written properly', () => {
  const s = spec({ wiring: [
    { graph: '@main', node: 'tool-1', field: 'hooks.onRoundStart', ref: 'sub', key: 'signup' },
    { graph: 'signup', node: 'read', field: 'sheetId', ref: 'sheet', key: 'members' },
    { graph: 'signup', node: 'read', field: 'sheetName', ref: 'sheetName', key: 'members' },
  ] })
  const g = graphs()
  const nodes = g['@main'].nodes as { id: string; data: Record<string, unknown> }[]
  delete nodes[1].data.subWorkflowId
  nodes[1].data.hooks = { onRoundStart: '@sub:signup' }
  assert.deepEqual(checkWiringBeforeSubstitution(g, s), [])
  const g2 = substituteBundleTokens(g, s, IDS)
  assert.equal(((g2['@main'].nodes as { id: string; data: Record<string, unknown> }[])[1].data.hooks as Record<string, unknown>).onRoundStart, 'wf_new0000000000000001')
})

test('candidate detection: also catches namespace typos, and does not catch other people\'s words', () => {
  const caught = ['@sub2:signup', '@sub_tool:signup', '@sheet-name:members', '@Sheet:members', '@subtool:']
  for (const v of caught) {
    assert.equal(findTokenCandidates({ a: v }).length, 1, `${v} 는 잡혀야`)
  }
  for (const v of ['@support:team', '@example:value', 'mail@host: 9', '@quiz:start']) {
    assert.equal(findTokenCandidates({ a: v }).length, 0, `${v} 는 «안» 잡혀야`)
  }
})

test('duplicate node id: blocks first if the second node holds another\'s id', () => {
  const g = graphs()
  const nodes = g['@main'].nodes as { id: string; data: Record<string, unknown> }[]
  nodes.push({ id: 'tool-1', data: { toolType: 'subworkflow', subWorkflowId: 'wf_qexjljlcbnk0v6x952rr' } })
  assert.deepEqual(codes(checkWiringBeforeSubstitution(g, spec())), ['BUNDLE_NODE_ID_DUPLICATE'])
})

test('no literals: catches two-character sheet names too, regardless of case', () => {
  const s = spec({ dataSheets: [{ key: 'members', name: 'AI', columns: [{ name: 'a', type: 'string' }] }] })
  assert.deepEqual(codes(findForbiddenLiterals(graphs({ sys: 'see the AI sheet' }), s)), ['BUNDLE_LITERAL_SHEET_NAME'])
  const s2 = spec()
  assert.deepEqual(codes(findForbiddenLiterals(graphs({ sys: 'see quiz reward members' }), s2)), ['BUNDLE_LITERAL_SHEET_NAME'])
})

test('@sheetName can also be used in the body; the escape hatch of the no-literals rule', () => {
  const g = graphs({ sys: 'the sheet is @sheetName:members' })
  assert.deepEqual(findForbiddenLiterals(g, spec()), [])
  const g2 = substituteBundleTokens(g, spec(), IDS)
  const nodes2 = g2['@main'].nodes as { id: string; data: Record<string, unknown> }[]
  assert.equal(nodes2[0].data.systemMessage, 'the sheet is Quiz Reward Members (2)')
})

test('resolved table: catches missing values, identical values and undeclared keys', () => {
  const s = spec()
  assert.deepEqual(checkResolvedIds(s, IDS), [])
  const missing = { ...IDS, subIds: {} }
  assert.ok(codes(checkResolvedIds(s, missing)).includes('BUNDLE_RESOLVED_MISSING'))
  const extra = { ...IDS, sheetIds: { ...IDS.sheetIds, ghost: 'cm_x' } }
  assert.ok(codes(checkResolvedIds(s, extra)).includes('BUNDLE_RESOLVED_EXTRA'))
  const s2 = spec({ subWorkflows: [
    { key: 'signup', name: 'A', workflowJson: '{}' },
    { key: 'settle', name: 'B', workflowJson: '{}' },
  ], wiring: [
    { graph: '@main', node: 'tool-1', field: 'subWorkflowId', ref: 'sub', key: 'signup' },
    { graph: 'signup', node: 'read', field: 'sheetId', ref: 'sheet', key: 'members' },
    { graph: 'signup', node: 'read', field: 'sheetName', ref: 'sheetName', key: 'members' },
  ] })
  const dup = { ...IDS, subIds: { signup: 'wf_same', settle: 'wf_same' }, subToolNames: { signup: 'a', settle: 'b' } }
  assert.ok(codes(checkResolvedIds(s2, dup)).includes('BUNDLE_RESOLVED_DUPLICATE'))
})

// ========================================
// ========================================

test('catches an old id in a structural field outside the wiring, even if it is not a token', () => {
  const g = graphs()
  const nodes = g['@main'].nodes as { id: string; data: Record<string, unknown> }[]
  nodes.push({ id: 'tool-2', data: { toolType: 'subworkflow', subWorkflowId: 'wf_qexjljlcbnk0v6x952rr' } })
  assert.deepEqual(codes(checkWiringBeforeSubstitution(g, spec())), ['BUNDLE_WIRING_UNDECLARED'])
})

test('catches an empty structural field outside the wiring too', () => {
  for (const v of ['', null, '   ']) {
    const g = graphs()
    const nodes = g['@main'].nodes as { id: string; data: Record<string, unknown> }[]
    nodes.push({ id: 'tool-2', data: { toolType: 'subworkflow', subWorkflowId: v } })
    assert.deepEqual(codes(checkWiringBeforeSubstitution(g, spec())), ['BUNDLE_WIRING_UNDECLARED'], `${JSON.stringify(v)}`)
  }
})

test('substitution is pure: the graph passed in does not change', () => {
  const g = graphs()
  const before = JSON.stringify(g)
  const g2 = substituteBundleTokens(g, spec(), IDS)
  assert.equal(JSON.stringify(g), before, '원본이 그대로여야')
  assert.notEqual(JSON.stringify(g2), before, '새 것은 바뀌어야')
})

test('even if the post-substitution check fails, the original stays as tokens; can retry', () => {
  const g = graphs()
  const broken: ResolvedBundleIds = { ...IDS, subIds: {} }
  const g2 = substituteBundleTokens(g, spec(), broken)
  assert.ok(codes(checkWiringAfterSubstitution(g2, spec(), broken)).includes('BUNDLE_WIRING_UNRESOLVED'))
  const nodes = g['@main'].nodes as { id: string; data: Record<string, unknown> }[]
  assert.equal(nodes[1].data.subWorkflowId, '@sub:signup', '원본은 손대지 않아야')
})

test('token boundaries in the body: two adjacent, punctuation, Korean text, multiple lines', () => {
  const s = spec({ subWorkflows: [
    { key: 'signup', name: 'A', workflowJson: '{}' },
    { key: 'settle', name: 'B', workflowJson: '{}' },
  ], wiring: [
    { graph: 'signup', node: 'read', field: 'sheetId', ref: 'sheet', key: 'members' },
    { graph: 'signup', node: 'read', field: 'sheetName', ref: 'sheetName', key: 'members' },
    { graph: '@main', node: 'tool-1', field: 'subWorkflowId', ref: 'sub', key: 'signup' },
  ] })
  const ids: ResolvedBundleIds = {
    subIds: { signup: 'wf_a', settle: 'wf_b' },
    subToolNames: { signup: 'subwf_a', settle: 'subwf_b' },
    sheetIds: { members: 'cm_s' }, sheetNames: { members: 'S' },
  }
  const cases: Array<[string, string]> = [
    ['@subtool:signup@subtool:settle', 'subwf_asubwf_b'],
    ['call @subtool:signup.', 'call subwf_a.'],
    ['call @subtool:signup) now', 'call subwf_a) now'],
    ['@subtool:signup 을 부른다', 'subwf_a 을 부른다'],
    ['@subtool:signup한테', 'subwf_a한테'],
    ['a\n@subtool:signup\nb', 'a\nsubwf_a\nb'],
    ['@subtool:signup and @subtool:signup', 'subwf_a and subwf_a'],
  ]
  for (const [sys, expected] of cases) {
    const g = graphs({ sys })
    const g2 = substituteBundleTokens(g, s, ids)
    const got = (g2['@main'].nodes as { id: string; data: Record<string, unknown> }[])[0].data.systemMessage
    assert.equal(got, expected, JSON.stringify(sys))
    assert.deepEqual(codes(checkWiringAfterSubstitution(g2, s, ids)), [], `${JSON.stringify(sys)} 뒤에 기호가 남으면 안 됨`)
  }
})

// ========================================
// ========================================

test('name picking: a number on collision, null when exhausted (does not return the original)', () => {
  assert.equal(nextFreeDisplayName('S', () => false), 'S')
  assert.equal(nextFreeDisplayName('  S  ', () => false), 'S')
  assert.equal(nextFreeDisplayName('S', (n) => n === 'S'), 'S (2)')
  assert.equal(nextFreeDisplayName('S', (n) => n === 'S' || n === 'S (2)'), 'S (3)')
  assert.equal(nextFreeDisplayName('S', () => true), null)
})

test('tool name: _2 on collision, trims the tail to stay within 40 chars, null when exhausted', () => {
  assert.equal(nextFreeToolName('a_b', () => false), 'a_b')
  assert.equal(nextFreeToolName('a_b', (n) => n === 'a_b'), 'a_b_2')
  const long = 'z'.repeat(40)
  const got = nextFreeToolName(long, (n) => n === long)
  assert.ok(got && got.length <= 40, `${got} (${got?.length})`)
  assert.ok(got!.endsWith('_2'), got!)
  assert.equal(nextFreeToolName('a_b', () => true), null)
  assert.equal(nextFreeToolName('', () => false), null)
})

test('rename: if Start is not exactly one, null rather than the original; prevents only the instruction text getting the new name', () => {
  const one = JSON.stringify({ nodes: [
    { id: 's', type: 'custom', data: { nodeType: 'start', triggerType: 'subworkflow', toolName: 'old', toolDescription: 'd', inputs: [] } },
  ], edges: [] })
  const renamed = withBundleSubToolName(one, 'fresh')
  assert.ok(renamed && JSON.parse(renamed).nodes[0].data.toolName === 'fresh')
  assert.equal(withBundleSubToolName(JSON.stringify({ nodes: [], edges: [] }), 'fresh'), null)
  const two = JSON.stringify({ nodes: [
    { id: 's1', type: 'custom', data: { nodeType: 'start', triggerType: 'subworkflow', toolName: 'a', toolDescription: 'd', inputs: [] } },
    { id: 's2', type: 'custom', data: { nodeType: 'start', triggerType: 'subworkflow', toolName: 'b', toolDescription: 'd', inputs: [] } },
  ], edges: [] })
  assert.equal(withBundleSubToolName(two, 'fresh'), null)
  assert.equal(withBundleSubToolName('{ not json', 'fresh'), null)
})
