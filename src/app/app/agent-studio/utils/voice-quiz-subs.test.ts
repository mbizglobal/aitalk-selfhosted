import { test } from 'node:test'
import assert from 'node:assert/strict'
import { voiceQuizSubOptions } from './voice-quiz-subs'

const AI = { id: 'ai-1', type: 'ai' as const }
const QUIZ = { id: 'quiz-1', type: 'tool', data: { toolType: 'miniapp', miniAppType: 'voice_quiz' } }
const sub = (id: string, wf: string, label?: string) => ({ id, type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: wf, label } })

const NODES = [AI, QUIZ, sub('t1', 'wf_a', 'Quiz Round Start'), sub('t2', 'wf_b', 'Quiz Reward Record'), sub('t3', 'wf_c')]
const EDGES = [
  { source: 'ai-1', target: 'quiz-1', sourceHandle: 'miniapps' },
  { source: 'ai-1', target: 't1', sourceHandle: 'tools' },
  { source: 'ai-1', target: 't2', sourceHandle: 'tools' },
  { source: 'ai-1', target: 't3', sourceHandle: 'tools' },
]

test('returns the tools subs of the attached AI node together with labels', () => {
  assert.deepEqual(voiceQuizSubOptions(NODES, EDGES, 'quiz-1'), [
    { id: 'wf_a', label: 'Quiz Round Start' },
    { id: 'wf_b', label: 'Quiz Reward Record' },
    { id: 'wf_c', label: 'wf_c' },
  ])
})

test('subs attached to other AI nodes are not mixed in - the server cannot call them', () => {
  const nodes = [...NODES, { id: 'ai-2', type: 'ai' }, sub('t9', 'wf_other', 'Other AI sub')]
  const edges = [...EDGES, { source: 'ai-2', target: 't9', sourceHandle: 'tools' }]
  assert.deepEqual(voiceQuizSubOptions(nodes, edges, 'quiz-1').map((o) => o.id), ['wf_a', 'wf_b', 'wf_c'])
})

test('nodes on a handle other than tools are not included', () => {
  const edges = EDGES.map((e) => (e.target === 't2' ? { ...e, sourceHandle: 'miniapps' } : e))
  assert.deepEqual(voiceQuizSubOptions(NODES, edges, 'quiz-1').map((o) => o.id), ['wf_a', 'wf_c'])
})

test('a subWorkflowId that is empty or not a string is not included - an empty value must not become an option', () => {
  const nodes = [
    ...NODES,
    { id: 't4', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: '' } },
    { id: 't5', type: 'tool', data: { toolType: 'subworkflow' } },
    { id: 't6', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: 123 } },
  ]
  const edges = [...EDGES, ...['t4', 't5', 't6'].map((target) => ({ source: 'ai-1', target, sourceHandle: 'tools' }))]
  assert.deepEqual(voiceQuizSubOptions(nodes, edges, 'quiz-1').map((o) => o.id), ['wf_a', 'wf_b', 'wf_c'])
})

test('a whitespace-only id counts as empty - it must not diverge from the hook save rule (trim || null)', () => {
  const nodes = [
    ...NODES,
    { id: 't7', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: '   ' } },
    { id: 't8', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: '\t\n' } },
  ]
  const edges = [...EDGES, ...['t7', 't8'].map((target) => ({ source: 'ai-1', target, sourceHandle: 'tools' }))]
  assert.deepEqual(voiceQuizSubOptions(nodes, edges, 'quiz-1').map((o) => o.id), ['wf_a', 'wf_b', 'wf_c'])
})

test('an id with surrounding whitespace is returned trimmed - if the saved value and the list differ by characters, the selection is invisible', () => {
  const nodes = [...NODES, { id: 't9', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: '  wf_d  ', label: 'Padded' } }]
  const edges = [...EDGES, { source: 'ai-1', target: 't9', sourceHandle: 'tools' }]
  const out = voiceQuizSubOptions(nodes, edges, 'quiz-1')
  assert.deepEqual(out[out.length - 1], { id: 'wf_d', label: 'Padded' })
})

test('an empty node id gives an empty list - it does not fall over into \'scrape everything\'', () => {
  assert.deepEqual(voiceQuizSubOptions(NODES, EDGES, ''), [])
})

test('no parent attached as miniapps gives an empty list', () => {
  const edges = EDGES.filter((e) => e.sourceHandle !== 'miniapps')
  assert.deepEqual(voiceQuizSubOptions(NODES, edges, 'quiz-1'), [])
})

test('no sub tools at all gives an empty list - no exception is thrown', () => {
  assert.deepEqual(voiceQuizSubOptions([AI, QUIZ], [EDGES[0]], 'quiz-1'), [])
})

test('if the same id results after trimming, only one row - two identical rows in the dropdown would also collide on key', () => {
  const nodes = [...NODES, { id: 't10', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: '  wf_a  ', label: 'Same target' } }]
  const edges = [...EDGES, { source: 'ai-1', target: 't10', sourceHandle: 'tools' }]
  const out = voiceQuizSubOptions(nodes, edges, 'quiz-1')
  assert.deepEqual(out.map((o) => o.id), ['wf_a', 'wf_b', 'wf_c'])
  assert.equal(out[0].label, 'Quiz Round Start')
})

test('a whitespace-only label falls back to the id - the button must not get a nameless option', () => {
  const nodes = [...NODES, { id: 't11', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: 'wf_e', label: '   ' } }]
  const edges = [...EDGES, { source: 'ai-1', target: 't11', sourceHandle: 'tools' }]
  const out = voiceQuizSubOptions(nodes, edges, 'quiz-1')
  assert.deepEqual(out[out.length - 1], { id: 'wf_e', label: 'wf_e' })
})
