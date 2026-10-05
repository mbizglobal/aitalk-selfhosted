import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pstnLanguageSyncWrites, pstnLanguageSiblingCount } from './pstnLanguageSync'

const pstnStart = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  data: { nodeType: 'start', triggerType: 'pstn', ...data },
})
const aiNode = (id: string, model: string) => ({ id, data: { nodeType: 'ai', model } })
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target })

const sttEdges = (starts: string[], ai = 'ai-1') => starts.map((s) => edge(s, ai))

const writes = (nodes: unknown, editedId: string, patch: Record<string, unknown>, edges: unknown = []) =>
  pstnLanguageSyncWrites(nodes, edges, editedId, patch)

const ownerNodes = () => [
  pstnStart('start-1', { language: 'de-CH', voiceName: 'de-CH-LeniNeural', phoneNumber: '+41…' }),
  pstnStart('start-outbound-1', {
    language: 'ko-KR',
    voiceName: 'ko-KR-SunHi:DragonHDLatestNeural',
    callDirection: 'outbound',
  }),
  { id: 'ai-1', data: { nodeType: 'ai', model: 'gpt-4.1-mini' } },
]

test('changing the language propagates to other PSTN start nodes - the edited node is excluded', () => {
  const w = writes(ownerNodes(), 'start-1', { language: 'de-CH' })
  assert.equal(w.length, 1)
  assert.equal(w[0].nodeId, 'start-outbound-1')
  assert.equal(w[0].patch.language, 'de-CH')
})

test('the reverse direction works too - changing outbound makes inbound follow', () => {
  const w = writes(ownerNodes(), 'start-outbound-1', { language: 'fr-CH' })
  assert.deepEqual(w.map((x) => x.nodeId), ['start-1'])
  assert.equal(w[0].patch.language, 'fr-CH')
})

test('voice is not moved - even if carried in the patch, it is not written to other nodes', () => {
  const w = writes(ownerNodes(), 'start-1', {
    language: 'de-CH',
    voiceName: 'de-CH-JanNeural',
  })
  assert.equal(w.length, 1)
  assert.notEqual(w[0].patch.voiceName, 'de-CH-JanNeural')
})

test('but if the sibling voice is invalid for the new language, it is fixed to the default voice', () => {
  const w = writes(ownerNodes(), 'start-1', { language: 'de-CH' }, sttEdges(['start-1', 'start-outbound-1']))
  const v = w[0].patch.voiceName
  assert.equal(typeof v, 'string')
  assert.ok(String(v).startsWith('de-CH-'), `de-CH 음성이어야 하는데 ${String(v)}`)
})

test('siblings not attached to an AI node do not know the pipeline, so their voice is untouched', () => {
  const nodes = [
    pstnStart('a', { language: 'de-CH' }),
    pstnStart('b', { language: 'ko-KR', voiceName: 'realtime:coral' }),
  ]
  const w = writes(nodes, 'a', { language: 'de-CH' })
  assert.equal(w.length, 1)
  assert.equal(w[0].patch.language, 'de-CH')
  assert.equal('voiceName' in w[0].patch, false)
})

test('leaves the sibling voice alone if it already fits the language', () => {
  const nodes = [
    pstnStart('a', { language: 'de-CH', voiceName: 'de-CH-LeniNeural' }),
    pstnStart('b', { language: 'ko-KR', voiceName: 'de-CH-LeniNeural' }),
  ]
  const w = writes(nodes, 'a', { language: 'de-CH' })
  assert.equal('voiceName' in w[0].patch, false)
})

test('the Realtime voice of a Realtime node is language-independent - left as is', () => {
  const nodes = [
    pstnStart('a', { language: 'de-DE', voiceName: 'realtime:coral' }),
    pstnStart('b', { language: 'ko-KR', voiceName: 'realtime:alloy' }),
    aiNode('ai-1', 'gpt-realtime-1.5'),
  ]
  const w = writes(nodes, 'a', { language: 'de-DE' }, sttEdges(['a', 'b']))
  assert.equal('voiceName' in w[0].patch, false)
})

test('if an STT+TTS node holds a realtime:* voice, it is fixed', () => {
  const nodes = [
    pstnStart('a', { language: 'de-CH', voiceName: 'de-CH-LeniNeural' }),
    pstnStart('b', { language: 'ko-KR', voiceName: 'realtime:alloy' }),
    aiNode('ai-1', 'gpt-4.1-mini'),
  ]
  const w = writes(nodes, 'a', { language: 'de-CH' }, sttEdges(['a', 'b']))
  assert.ok(String(w[0].patch.voiceName).startsWith('de-CH-'), String(w[0].patch.voiceName))
})

test('if a Realtime node holds an Azure voice, it is fixed to a Realtime voice', () => {
  const nodes = [
    pstnStart('a', { language: 'de-DE', voiceName: 'realtime:coral' }),
    pstnStart('b', { language: 'ko-KR', voiceName: 'ko-KR-SunHi' }),
    aiNode('ai-1', 'gpt-realtime-1.5'),
  ]
  const w = writes(nodes, 'a', { language: 'de-DE' }, sttEdges(['a', 'b']))
  assert.ok(String(w[0].patch.voiceName).startsWith('realtime:'), String(w[0].patch.voiceName))
})

const splitNodes = () => [
  pstnStart('in', { language: 'de-CH', voiceName: 'de-CH-LeniNeural' }),
  pstnStart('out', { language: 'ko-KR', voiceName: 'realtime:coral', callDirection: 'outbound' }),
  aiNode('ai-stt', 'gpt-4.1-mini'),
  aiNode('ai-rt', 'gpt-realtime-1.5'),
]
const splitEdges = [edge('in', 'ai-stt'), edge('out', 'ai-rt')]

test('Realtime siblings get only mode single - the list is passed along too', () => {
  const w = writes(
    splitNodes(),
    'in',
    { languageMode: 'menu', menuLanguages: [{ locale: 'de-CH' }, { locale: 'fr-CH' }] },
    splitEdges,
  )
  assert.equal(w.length, 1)
  assert.equal(w[0].nodeId, 'out')
  assert.equal(w[0].patch.languageMode, 'single')
  assert.deepEqual(w[0].patch.menuLanguages, [{ locale: 'de-CH' }, { locale: 'fr-CH' }])
})

test('keeping the list alongside means that reverting the pipeline revives the current shared list', () => {
  const shared = [{ locale: 'de-CH' }, { locale: 'fr-CH' }]
  const nodes = [
    pstnStart('in', { language: 'de-CH', languageMode: 'menu', menuLanguages: shared }),
    pstnStart('out', { language: 'de-DE', languageMode: 'single', menuLanguages: shared, callDirection: 'outbound' }),
    aiNode('ai-stt', 'gpt-4.1-mini'),
    aiNode('ai-rt', 'gpt-realtime-1.5'),
  ]
  const w = writes(nodes, 'out', { languageMode: 'menu', menuLanguages: shared }, [
    edge('in', 'ai-stt'),
    edge('out', 'ai-stt'),
  ])
  assert.deepEqual(w[0].patch.menuLanguages, shared)
  assert.equal(w[0].patch.languageMode, 'menu')
})

test('Realtime siblings get the branch representative, folded - otherwise it diverges when opened', () => {
  const w = writes(splitNodes(), 'in', { language: 'de-CH' }, splitEdges)
  assert.equal(w[0].patch.language, 'de-DE')
})

test('reverse direction - the branch representative chosen in Realtime goes unchanged to STT+TTS siblings', () => {
  const w = writes(splitNodes(), 'out', { language: 'fr-FR' }, splitEdges)
  assert.equal(w[0].nodeId, 'in')
  assert.equal(w[0].patch.language, 'fr-FR')
  assert.ok(String(w[0].patch.voiceName).startsWith('fr-FR-'), String(w[0].patch.voiceName))
})

test('if Realtime does not know the branch, the language is not passed at all (so nothing changes silently)', () => {
  const nodes = [
    pstnStart('in', { language: 'it-IT' }),
    pstnStart('out', { language: 'ko-KR', voiceName: 'realtime:coral', callDirection: 'outbound' }),
    aiNode('ai-stt', 'gpt-4.1-mini'),
    aiNode('ai-rt', 'gpt-realtime-1.5'),
  ]
  const w = writes(nodes, 'in', { language: 'it-IT', languageMode: 'single' }, splitEdges)
  assert.equal(w.length, 1)
  assert.equal('language' in w[0].patch, false)
  assert.equal(w[0].patch.languageMode, 'single')
  assert.equal('voiceName' in w[0].patch, false)
})

test('even if only the list is passed to a Realtime sibling, single is still written', () => {
  const w = writes(splitNodes(), 'in', { menuLanguages: [{ locale: 'de-CH' }] }, splitEdges)
  assert.equal(w.length, 1)
  assert.equal(w[0].patch.languageMode, 'single')
  assert.deepEqual(w[0].patch.menuLanguages, [{ locale: 'de-CH' }])
})

test('if the edited node is not a PSTN start, nothing is passed (web call node)', () => {
  const nodes = [
    { id: 'web-1', data: { nodeType: 'start', triggerType: 'chat_widget', language: 'ko-KR' } },
    pstnStart('start-1', { language: 'de-CH' }),
  ]
  assert.deepEqual(writes(nodes, 'web-1', { language: 'ko-KR' }), [])
})

test('web call nodes are also excluded on the receiving side', () => {
  const nodes = [
    pstnStart('start-1', { language: 'de-CH' }),
    { id: 'web-1', data: { nodeType: 'start', triggerType: 'chat_widget', language: 'ko-KR' } },
    pstnStart('start-2', { language: 'ko-KR' }),
  ]
  const w = writes(nodes, 'start-1', { language: 'de-CH' })
  assert.deepEqual(w.map((x) => x.nodeId), ['start-2'])
})

test('the Multi Languages list goes along too - arrays are separate per node', () => {
  const nodes = [pstnStart('a'), pstnStart('b'), pstnStart('c')]
  const entries = [{ locale: 'de-CH' }, { locale: 'fr-CH' }]
  const w = writes(nodes, 'a', { languageMode: 'menu', menuLanguages: entries })
  assert.equal(w.length, 2)
  for (const x of w) {
    assert.equal(x.patch.languageMode, 'menu')
    assert.deepEqual(x.patch.menuLanguages, entries)
    assert.notEqual(x.patch.menuLanguages, entries)
    assert.notEqual((x.patch.menuLanguages as unknown[])[0], entries[0])
  }
  assert.notEqual(w[0].patch.menuLanguages, w[1].patch.menuLanguages)
})

test('a patch with no language field has nothing to pass (only voice changed)', () => {
  assert.deepEqual(writes(ownerNodes(), 'start-1', { voiceName: 'de-CH-JanNeural' }), [])
})

test('with only one PSTN start node, an empty list', () => {
  const nodes = [pstnStart('only'), { id: 'ai-1', data: { nodeType: 'ai' } }]
  assert.deepEqual(writes(nodes, 'only', { language: 'de-CH' }), [])
})

test('edge cases - nodes is not an array, or the id does not exist', () => {
  assert.deepEqual(writes(null, 'a', { language: 'de-CH' }), [])
  assert.deepEqual(writes(undefined, 'a', { language: 'de-CH' }), [])
  assert.deepEqual(writes({}, 'a', { language: 'de-CH' }), [])
  assert.deepEqual(writes([pstnStart('a'), pstnStart('b')], 'nope', { language: 'de-CH' }), [])
})

test('empty language, whitespace and unknown values are not passed at all', () => {
  const nodes = [pstnStart('a'), pstnStart('b', { voiceName: 'ko-KR-SunHi' }), aiNode('ai-1', 'gpt-4.1-mini')]
  const e = sttEdges(['a', 'b'])
  assert.deepEqual(writes(nodes, 'a', { language: '' }, e), [])
  assert.deepEqual(writes(nodes, 'a', { language: '   ' }, e), [])
  assert.deepEqual(writes(nodes, 'a', { language: 'de-ch' }, e), [])
  assert.deepEqual(writes(nodes, 'a', { language: 'it-IT' }, e), [])
  const w = writes(nodes, 'a', { language: ' de-CH ' }, e)
  assert.equal(w[0].patch.language, 'de-CH')
})

test('even for an unknown language, other language fields still pass through', () => {
  const nodes = [pstnStart('a'), pstnStart('b'), aiNode('ai-1', 'gpt-4.1-mini')]
  const w = writes(nodes, 'a', { language: 'it-IT', languageMode: 'single' }, sttEdges(['a', 'b']))
  assert.equal(w.length, 1)
  assert.equal('language' in w[0].patch, false)
  assert.equal(w[0].patch.languageMode, 'single')
})

test('for Realtime siblings, single is always written even when only the language changes', () => {
  const nodes = [
    pstnStart('in', { language: 'de-CH' }),
    pstnStart('out', { language: 'ko-KR', languageMode: 'menu', menuLanguages: [{ locale: 'ko-KR' }], callDirection: 'outbound' }),
    aiNode('ai-stt', 'gpt-4.1-mini'),
    aiNode('ai-rt', 'gpt-realtime-1.5'),
  ]
  const w = writes(nodes, 'in', { language: 'de-CH' }, splitEdges)
  assert.equal(w[0].patch.languageMode, 'single')
})

test('the old mode of a Realtime sibling is overwritten with single but the list is left alone', () => {
  const nodes = [
    pstnStart('in', { language: 'de-CH' }),
    pstnStart('out', {
      language: 'ko-KR',
      languageMode: 'auto',
      menuLanguages: [{ locale: 'ko-KR' }],
      autoDetectLanguages: [{ locale: 'ko-KR' }],
      callDirection: 'outbound',
    }),
    aiNode('ai-stt', 'gpt-4.1-mini'),
    aiNode('ai-rt', 'gpt-realtime-1.5'),
  ]
  const w = writes(nodes, 'in', { language: 'de-CH' }, splitEdges)
  assert.equal(w[0].patch.languageMode, 'single')
  assert.equal('menuLanguages' in w[0].patch, false)
  assert.equal('autoDetectLanguages' in w[0].patch, false)
})

test('no deleting writes are issued to either kind of sibling', () => {
  const w1 = writes(splitNodes(), 'in', { language: 'de-CH' }, splitEdges)
  assert.equal('menuLanguages' in w1[0].patch, false)
  assert.equal('autoDetectLanguages' in w1[0].patch, false)
  assert.equal(w1[0].patch.languageMode, 'single')
  const nodes = [
    pstnStart('a', { language: 'de-CH' }),
    pstnStart('b', { language: 'ko-KR', languageMode: 'menu', menuLanguages: [{ locale: 'ko-KR' }] }),
    aiNode('ai-1', 'gpt-4.1-mini'),
  ]
  const w2 = writes(nodes, 'a', { language: 'de-CH' }, sttEdges(['a', 'b']))
  assert.equal('menuLanguages' in w2[0].patch, false)
  assert.equal('languageMode' in w2[0].patch, false)
})

test('the old autoDetectLanguages also goes along (remaining workflows)', () => {
  const nodes = [pstnStart('a'), pstnStart('b')]
  const w = writes(nodes, 'a', { autoDetectLanguages: [{ locale: 'de-CH' }] })
  assert.deepEqual(w[0].patch.autoDetectLanguages, [{ locale: 'de-CH' }])
})

test('sibling count is separate from whether there is anything to pass - it is 1 even for it-IT + a Realtime sibling', () => {
  const nodes = [
    pstnStart('in', { language: 'it-IT' }),
    pstnStart('out', { language: 'ko-KR', callDirection: 'outbound' }),
    aiNode('ai-stt', 'gpt-4.1-mini'),
    aiNode('ai-rt', 'gpt-realtime-1.5'),
  ]
  assert.equal(pstnLanguageSiblingCount(nodes, 'in'), 1)
  const w = writes(nodes, 'in', { language: 'it-IT' }, splitEdges)
  assert.equal(w.length, 1)
  assert.equal('language' in w[0].patch, false)
  assert.equal(w[0].patch.languageMode, 'single')
})

test('sibling count - 0 with one PSTN node, 2 with three, web calls are not counted', () => {
  assert.equal(pstnLanguageSiblingCount([pstnStart('only')], 'only'), 0)
  assert.equal(pstnLanguageSiblingCount([pstnStart('a'), pstnStart('b'), pstnStart('c')], 'a'), 2)
  const mixed = [
    pstnStart('a'),
    { id: 'web-1', data: { nodeType: 'start', triggerType: 'chat_widget' } },
    pstnStart('b'),
  ]
  assert.equal(pstnLanguageSiblingCount(mixed, 'a'), 1)
})

test('sibling count - 0 if the edited node is not a PSTN start or does not exist', () => {
  const nodes = [{ id: 'web-1', data: { nodeType: 'start', triggerType: 'chat_widget' } }, pstnStart('a')]
  assert.equal(pstnLanguageSiblingCount(nodes, 'web-1'), 0)
  assert.equal(pstnLanguageSiblingCount(nodes, 'nope'), 0)
  assert.equal(pstnLanguageSiblingCount(null, 'a'), 0)
})


test('even without knowing the pipeline, an Azure voice that does not fit the new language is fixed', () => {
  const nodes = [
    pstnStart('a', { language: 'de-CH' }),
    pstnStart('b', { language: 'ko-KR', voiceName: 'ko-KR-SunHi:DragonHDLatestNeural' }),
  ]
  const w = writes(nodes, 'a', { language: 'de-CH' })
  assert.ok(String(w[0].patch.voiceName).startsWith('de-CH-'), String(w[0].patch.voiceName))
})

test('the realtime:* voice of a sibling with unknown pipeline is still left alone', () => {
  const nodes = [pstnStart('a', { language: 'de-CH' }), pstnStart('b', { voiceName: 'realtime:coral' })]
  const w = writes(nodes, 'a', { language: 'de-CH' })
  assert.equal('voiceName' in w[0].patch, false)
})




test('lists that diverged before the rule existed are not realigned when only the language changes', () => {
  const nodes = [
    pstnStart('in', { language: 'de-CH', languageMode: 'menu', menuLanguages: [{ locale: 'de-CH' }, { locale: 'fr-CH' }] }),
    pstnStart('out', { language: 'ko-KR', menuLanguages: [{ locale: 'ko-KR' }], callDirection: 'outbound' }),
    aiNode('ai-stt', 'gpt-4.1-mini'),
    aiNode('ai-rt', 'gpt-realtime-1.5'),
  ]
  const w = writes(nodes, 'in', { language: 'de-CH' }, splitEdges)
  assert.equal(w.length, 1)
  assert.equal('menuLanguages' in w[0].patch, false)
  assert.equal(w[0].patch.languageMode, 'single')
})

test('even if the language is rejected, the Realtime sibling mode is fixed', () => {
  const nodes = [
    pstnStart('in', { language: 'it-IT' }),
    pstnStart('out', { language: 'ko-KR', languageMode: 'auto', autoDetectLanguages: [{ locale: 'ko-KR' }], callDirection: 'outbound' }),
    aiNode('ai-stt', 'gpt-4.1-mini'),
    aiNode('ai-rt', 'gpt-realtime-1.5'),
  ]
  const w = writes(nodes, 'in', { language: 'it-IT' }, splitEdges)
  assert.equal('language' in w[0].patch, false)
  assert.equal(w[0].patch.languageMode, 'single')
})

test('if an STT+TTS sibling is in menu mode, even a language-only change makes that node use the list', () => {
  const nodes = [
    pstnStart('a', { language: 'de-CH' }),
    pstnStart('b', { language: 'ko-KR', languageMode: 'menu', menuLanguages: [{ locale: 'ko-KR' }] }),
    aiNode('ai-1', 'gpt-4.1-mini'),
  ]
  const w = writes(nodes, 'a', { language: 'de-CH' }, sttEdges(['a', 'b']))
  assert.equal(w[0].patch.language, 'de-CH')
  assert.equal('languageMode' in w[0].patch, false)
  assert.equal('menuLanguages' in w[0].patch, false)
})
