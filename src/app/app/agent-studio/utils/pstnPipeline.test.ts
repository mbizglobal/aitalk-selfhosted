import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derivePstnPipeline, isMenuLanguageMode, pstnPipelinePatch, mixMenuProblem, isLastTalkSlot, shouldLockTalkSlot } from './pstnPipeline'

const RT = 'gpt-realtime-1.5'
const CHAT = 'gpt-4.1-mini'
const base = { realtimeModel: RT, chatDefaultModel: CHAT }

test('[X-1] a Realtime AI is always realtime - whatever languageMode is', () => {
  for (const mode of ['single', 'menu', 'auto', undefined, null, 'mix']) {
    assert.equal(derivePstnPipeline(true, mode), 'realtime', String(mode))
  }
})

test('[X-1] non-Realtime + menu = mix, anything else = talk', () => {
  assert.equal(derivePstnPipeline(false, 'menu'), 'mix')
  assert.equal(derivePstnPipeline(false, 'auto'), 'mix', '옛 auto 도 메뉴로 읽는다')
  assert.equal(derivePstnPipeline(false, 'single'), 'talk')
  assert.equal(derivePstnPipeline(false, undefined), 'talk', '저장값이 없으면 talk')
  assert.equal(derivePstnPipeline(false, 'mix'), 'talk', "🔴 'mix' 라는 저장값은 «만들지 않았다»")
})

test('[X-1] the two prod saved records read as Mix - without fixing the saved data', () => {
  assert.equal(derivePstnPipeline(false, 'menu'), 'mix')
  assert.equal(isMenuLanguageMode('menu'), true)
})

test('[X-1] switching to Realtime removes the menu - RealtimeBridge has no menu implementation', () => {
  const { aiPatch, nodePatch } = pstnPipelinePatch('realtime', { ...base, currentAiModel: CHAT })
  assert.equal(aiPatch.model, RT)
  assert.equal(aiPatch.previousChatModel, CHAT, '돌아올 모델을 챙겨 둔다')
  assert.equal(nodePatch.languageMode, 'single')
})

test('[X-1] if the stashed model is retired (5.6, 5.1), revive it as generation 6 - the voice value saved is the Azure deployment name', () => {
  assert.equal(pstnPipelinePatch('talk', { ...base, currentAiModel: RT, previousChatModel: 'gpt-5.1' }).aiPatch.model, 'gpt-6-sol')
  assert.equal(pstnPipelinePatch('mix', { ...base, currentAiModel: RT, previousChatModel: 'gpt-5.6-luna' }).aiPatch.model, 'gpt-6-luna')
})

test('[X-1] leaving Realtime for Talk revives the stashed model', () => {
  const { aiPatch, nodePatch } = pstnPipelinePatch('talk', { ...base, currentAiModel: RT, previousChatModel: 'gpt-6-sol' })
  assert.equal(aiPatch.model, 'gpt-6-sol')
  assert.equal(nodePatch.languageMode, 'single')
})

test('[X-1] if the stashed model is Realtime, it is not revived - prevents infinite round trips', () => {
  const { aiPatch } = pstnPipelinePatch('talk', { ...base, currentAiModel: RT, previousChatModel: 'gpt-realtime-2.1' })
  assert.equal(aiPatch.model, CHAT)
})

test('[X-1] Mix also starts as Talk - because reading the menu prompt is done by Talk', () => {
  const { aiPatch, nodePatch } = pstnPipelinePatch('mix', { ...base, currentAiModel: RT, seedMenuLanguages: [{ locale: 'de-CH' }] })
  assert.ok(!/^gpt-realtime/i.test(String(aiPatch.model)), 'AI 노드는 비Realtime 이어야 한다')
  assert.equal(nodePatch.languageMode, 'menu')
})

test('[X-1] when going to Mix, an existing list is not overwritten by the seed', () => {
  const existing = [{ locale: 'de-CH' }, { locale: 'de-DE' }]
  const { nodePatch } = pstnPipelinePatch('mix', {
    ...base,
    menuLanguages: existing,
    seedMenuLanguages: [{ locale: 'en-US' }],
  })
  assert.deepEqual(nodePatch.menuLanguages, existing)
})

test('[X-1] when leaving to Talk the list is not erased - coming back to Mix uses it as is', () => {
  const { nodePatch } = pstnPipelinePatch('talk', { ...base, menuLanguages: [{ locale: 'de-CH' }] })
  assert.equal('menuLanguages' in nodePatch, false, '건드리지 않는다')
})

test('[X-1] if every slot is Realtime, Mix does not hold - the caller never gets a chance to press a key', () => {
  assert.equal(mixMenuProblem([{ engine: 'realtime' }]), 'no-talk-slot')
  assert.equal(mixMenuProblem([{ engine: 'realtime' }, { engine: 'realtime' }]), 'no-talk-slot')
})

test('[X-1] passes if at least one Talk slot exists - with no engine it is Talk', () => {
  assert.equal(mixMenuProblem([{ engine: 'realtime' }, {}]), null, 'engine 없음 = talk')
  assert.equal(mixMenuProblem([{ engine: 'talk' }, { engine: 'realtime' }]), null)
  assert.equal(mixMenuProblem([{}]), null, '옛 저장본(전 칸 engine 없음)은 언제나 통과')
})

test('[X-1] an empty list gives a separate reason - the screen must say something different', () => {
  assert.equal(mixMenuProblem([]), 'empty')
  assert.equal(mixMenuProblem(undefined), 'empty')
  assert.equal(mixMenuProblem(null), 'empty')
})

test('[X-1] changing the last Talk slot to Realtime leaves nowhere to switch to - a condition the screen must block', () => {
  const lastTalk = isLastTalkSlot

  const oneTalkOneRt = [{ engine: 'talk' }, { engine: 'realtime' }]
  assert.equal(lastTalk(oneTalkOneRt, 0), true, '남은 Talk 칸 하나 → 잠긴다')
  assert.equal(lastTalk(oneTalkOneRt, 1), false, 'Realtime 칸은 잠기지 않는다')

  const twoTalk = [{ engine: 'talk' }, {}, { engine: 'realtime' }]
  assert.equal(lastTalk(twoTalk, 0), false, 'Talk 이 둘이면 하나는 바꿔도 된다')
  assert.equal(lastTalk(twoTalk, 1), false, 'engine 없음도 Talk 으로 센다')

  assert.equal(mixMenuProblem(oneTalkOneRt), null)
  assert.equal(mixMenuProblem([{ engine: 'realtime' }, { engine: 'realtime' }]), 'no-talk-slot')
})

test('[X-1] a branch-switch patch contains only values that must not be spread to siblings - languageMode is the identity of the branch', () => {
  for (const target of ['realtime', 'talk', 'mix'] as const) {
    const { nodePatch } = pstnPipelinePatch(target, { ...base, seedMenuLanguages: [{ locale: 'de-CH' }] })
    assert.ok('languageMode' in nodePatch, `${target}: 갈래를 정하는 값이 들어 있다`)
  }
})

test('[X-1] if already Talk, going to Mix does not touch the model - this overwrote the model the owner chose', () => {
  for (const target of ['talk', 'mix'] as const) {
    const { aiPatch } = pstnPipelinePatch(target, { ...base, currentAiModel: 'gpt-6-sol' })
    assert.equal('model' in aiPatch, false, `${target}: 비Realtime 에서 오면 모델을 안 쓴다`)
  }
  const { aiPatch } = pstnPipelinePatch('mix', { ...base, currentAiModel: 'gpt-6-sol', previousChatModel: 'gpt-4.1' })
  assert.equal('model' in aiPatch, false)
})

test('[X-1] on leaving Realtime it revives - the model is used only then', () => {
  const { aiPatch } = pstnPipelinePatch('mix', { ...base, currentAiModel: RT, previousChatModel: 'gpt-6-sol' })
  assert.equal(aiPatch.model, 'gpt-6-sol')
  const noPrev = pstnPipelinePatch('talk', { ...base, currentAiModel: RT })
  assert.equal(noPrev.aiPatch.model, CHAT, '챙겨 둔 것이 없으면 기본값')
})

test('[X-1] the chosen value survives round trips while changing models', () => {
  let model = 'gpt-6-sol'
  let prev: string | undefined
  const step = (target: 'realtime' | 'talk' | 'mix') => {
    const { aiPatch } = pstnPipelinePatch(target, { ...base, currentAiModel: model, previousChatModel: prev })
    if (typeof aiPatch.model === 'string') model = aiPatch.model
    if (typeof aiPatch.previousChatModel === 'string') prev = aiPatch.previousChatModel
  }
  step('mix')
  assert.equal(model, 'gpt-6-sol', 'Mix 로 가도 안 바뀐다')
  step('realtime')
  assert.equal(prev, 'gpt-6-sol')
  step('talk')
  assert.equal(model, 'gpt-6-sol', '왕복해도 원래 모델이 돌아온다')
})

test('[X-1] if there is only one slot and it is Talk, it can neither be changed nor deleted - the way out is Pipeline', () => {
  assert.equal(isLastTalkSlot([{}], 0), true, 'engine 없음 = Talk')
  assert.equal(isLastTalkSlot([{ engine: 'talk' }], 0), true)
  assert.equal(isLastTalkSlot([{ engine: 'realtime' }], 0), false)
  assert.equal(mixMenuProblem([{ engine: 'realtime' }]), 'no-talk-slot', '그 상태는 경고 대상이다')
})

test('[X-1] an empty seed gives an empty list - the screen must always supply a seed', () => {
  const { nodePatch } = pstnPipelinePatch('mix', base)
  assert.deepEqual(nodePatch.menuLanguages, [], '유틸 단독으로는 빈 목록')
  const seeded = pstnPipelinePatch('mix', { ...base, seedMenuLanguages: [{ locale: 'de-CH' }] })
  assert.equal((seeded.nodePatch.menuLanguages as unknown[]).length, 1)
})

test('[X-1] the lock applies only to phone calls - nobody reads the slot engine for web calls', () => {
  const oneTalk = [{ engine: 'talk' }]
  assert.equal(shouldLockTalkSlot(true, oneTalk, 0), true, '전화: 마지막 Talk 칸이라 잠근다')
  assert.equal(shouldLockTalkSlot(false, oneTalk, 0), false, '웹 통화: 잠그지 않는다 — 지울 수 있어야 한다')
})

test('[X-1] Talk <-> Mix works without an AI node - because it does not use the model', () => {
  for (const target of ['talk', 'mix'] as const) {
    const { aiPatch, nodePatch } = pstnPipelinePatch(target, { ...base, seedMenuLanguages: [{ locale: 'de-CH' }] })
    assert.equal(Object.keys(aiPatch).length, 0, `${target}: AI 쓰기가 없다`)
    assert.ok('languageMode' in nodePatch, `${target}: 시작 노드만 바꾼다`)
  }
  const rt = pstnPipelinePatch('realtime', base)
  assert.ok(Object.keys(rt.aiPatch).length > 0, 'realtime 은 모델을 써야 하므로 AI 노드가 필요하다')
})

test('[X-1] model name case and empty value boundaries', () => {
  const upper = pstnPipelinePatch('talk', { ...base, currentAiModel: 'GPT-Realtime-1.5', previousChatModel: 'gpt-6-sol' })
  assert.equal(upper.aiPatch.model, 'gpt-6-sol')
  for (const currentAiModel of ['', undefined, null as any, 123 as any]) {
    const { aiPatch } = pstnPipelinePatch('mix', { ...base, currentAiModel, previousChatModel: 'gpt-6-sol' })
    assert.equal('model' in aiPatch, false, JSON.stringify(currentAiModel))
  }
})

test('[X-1] the value the screen passes when there is no AI node - undefined must be accepted as is', () => {
  const noAiNode: { data?: { model?: string; previousChatModel?: string } } | null = null
  for (const target of ['talk', 'mix', 'realtime'] as const) {
    const { aiPatch, nodePatch } = pstnPipelinePatch(target, {
      ...base,
      currentAiModel: noAiNode?.data?.model,
      previousChatModel: noAiNode?.data?.previousChatModel,
      seedMenuLanguages: [{ locale: 'de-CH', voiceName: 'de-CH-LeniNeural' }],
    })
    if (target === 'realtime') {
      assert.ok(Object.keys(aiPatch).length > 0, 'Realtime 은 AI 가 필요하다 → 화면이 경고하고 멈춘다')
    } else {
      assert.equal(Object.keys(aiPatch).length, 0, `${target}: AI 없이 갈 수 있다`)
      assert.ok('languageMode' in nodePatch)
    }
  }
})
