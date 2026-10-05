import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { MINI_APP_REGISTRY, isMiniAppAllowedOn, isMiniAppNode, miniAppsForChannel, miniAppsRunBy, runtimeForChannel } from './mini-app-registry'
import { validateWorkflowJson } from './validation'

test('exposure per channel: schedule only quiz, pstn only voice_quiz, nothing else', () => {
  assert.deepEqual(miniAppsForChannel('schedule'), ['quiz'])
  assert.deepEqual(miniAppsForChannel('pstn'), ['voice_quiz'])
  assert.deepEqual(miniAppsForChannel('chatWidget'), [])
  assert.deepEqual(miniAppsForChannel('telegram'), [])
})

test('allowed = channel allows AND that channel\'s executor enforces it (no runtime means one more allow-table)', () => {
  assert.equal(isMiniAppAllowedOn('quiz', 'schedule'), true)
  assert.equal(isMiniAppAllowedOn('quiz', 'pstn'), false)
  assert.equal(isMiniAppAllowedOn('voice_quiz', 'pstn'), true)
  assert.equal(isMiniAppAllowedOn('voice_quiz', 'schedule'), false)
  assert.equal(isMiniAppAllowedOn('flashcard', 'schedule'), false)
  assert.equal(isMiniAppAllowedOn(undefined, 'schedule'), false)
  assert.equal(runtimeForChannel('schedule'), 'engine')
  assert.equal(runtimeForChannel('pstn'), 'speech-session')
  assert.equal(runtimeForChannel('chatWidget'), null)
  for (const [t, spec] of Object.entries(MINI_APP_REGISTRY)) {
    for (const ch of spec.channels) assert.equal(runtimeForChannel(ch), spec.runtime, `${t}@${ch}`)
  }
})

test('list per executor: engine gets quiz, speech-session gets voice_quiz', () => {
  assert.deepEqual(miniAppsRunBy('engine'), ['quiz'])
  assert.deepEqual(miniAppsRunBy('speech-session'), ['voice_quiz'])
})

test('isMiniAppNode: saved shape + registered types only', () => {
  assert.equal(isMiniAppNode({ type: 'tool', data: { nodeType: 'miniapp', miniAppType: 'quiz' } }), true)
  assert.equal(isMiniAppNode({ type: 'tool', data: { nodeType: 'miniapp', miniAppType: 'voice_quiz' } }), true)
  assert.equal(isMiniAppNode({ type: 'tool', data: { nodeType: 'miniapp', miniAppType: 'flashcard' } }), false)
  assert.equal(isMiniAppNode({ type: 'custom', data: { nodeType: 'miniapp', miniAppType: 'quiz' } }), false)
  assert.equal(isMiniAppNode({ type: 'tool', data: { toolType: 'source' } }), false)
  assert.equal(isMiniAppNode(null), false)
})

test('no miniAppType literal comparisons remain in src/ (duplicated-judge drift gate)', () => {
  const root = join(process.cwd(), 'src')
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
      if (p.endsWith('mini-app-registry.ts')) continue
      const src = readFileSync(p, 'utf8')
      if (/miniAppType\s*===\s*'/.test(src) || /miniAppType\s*!==\s*'/.test(src)) hits.push(p.replace(root, 'src'))
    }
  }
  walk(root)
  assert.deepEqual(hits, [], `리터럴 비교가 남은 파일 — 레지스트리 조회(isMiniAppNodeOfType 등)로 바꿀 것`)
})

const node = (id: string, nodeType: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'custom', data: { nodeType, ...extra }, position: { x: 0, y: 0 } })
const tool = (id: string, data: Record<string, unknown>) => ({ id, type: 'tool', data, position: { x: 0, y: 0 } })
const edge = (s: string, t: string, handle?: string) => ({ id: `${s}-${t}${handle ? `-${handle}` : ''}`, source: s, target: t, ...(handle ? { sourceHandle: handle } : {}) })
const wf = (nodes: unknown[], edges: unknown[]) => JSON.stringify({ nodes, edges })

const pstnBase = (miniapp: Record<string, unknown>, extraTools: Array<{ id: string; data: Record<string, unknown> }> = []) => wf(
  [node('s', 'start', { triggerType: 'pstn' }), node('ai', 'ai'), node('e', 'end'), tool('m', { toolType: 'miniapp', nodeType: 'miniapp', ...miniapp }), ...extraTools.map(t => tool(t.id, t.data))],
  [edge('s', 'ai'), edge('ai', 'e'), edge('ai', 'm', 'miniapps'), ...extraTools.map(t => edge('ai', t.id, 'tools'))],
)

test('validation: warns when quiz is attached to PSTN (channel mismatch), also when voice_quiz is attached to schedule', () => {
  const r1 = validateWorkflowJson(pstnBase({ miniAppType: 'quiz' }), 'deployable')
  assert.ok(r1.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && /only runs on Start channel schedule/.test(i.message)), JSON.stringify(r1.issues))
  const r2 = validateWorkflowJson(wf(
    [node('s', 'start', { triggerType: 'schedule' }), node('ai', 'ai'), node('e', 'end'), tool('m', { toolType: 'miniapp', nodeType: 'miniapp', miniAppType: 'voice_quiz', hooks: { onRoundStart: 'a', onRoundSettle: 'b' } })],
    [edge('s', 'ai'), edge('ai', 'e'), edge('ai', 'm', 'miniapps')],
  ), 'deployable')
  assert.ok(r2.issues.some(i => /only runs on Start channel pstn/.test(i.message)), JSON.stringify(r2.issues))
})

test('🔴 notifies when web voice is on: the quiz never starts at all in that call (it does not block)', () => {
  const subs = [
    { id: 'sub-a', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' } },
    { id: 'sub-b', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_b' } },
  ]
  const hooks = { onRoundStart: 'wf_sub_a', onRoundSettle: 'wf_sub_b' }
  const quiz = { miniAppType: 'voice_quiz', hooks }

  const off = validateWorkflowJson(pstnBase(quiz, subs), 'deployable')
  assert.ok(!off.issues.some(i => /Web Voice is on/.test(i.message)), JSON.stringify(off.issues))

  const on = validateWorkflowJson(wf(
    [node('s', 'start', { triggerType: 'pstn', webVoice: { enabled: true } }), node('ai', 'ai'), node('e', 'end'),
     tool('m', { toolType: 'miniapp', nodeType: 'miniapp', ...quiz }), ...subs.map(t => tool(t.id, t.data))],
    [edge('s', 'ai'), edge('ai', 'e'), edge('ai', 'm', 'miniapps'), ...subs.map(t => edge('ai', t.id, 'tools'))],
  ), 'deployable')
  const hit = on.issues.find(i => /Web Voice is on/.test(i.message))
  assert.ok(hit, JSON.stringify(on.issues))
  assert.equal(hit!.severity, 'warning', '🔴 막으면 설정 중에 둘 다 켜 두는 흐름이 깨진다')
  assert.equal(hit!.field, 'webVoice', '화면이 칠할 칸이 어긋난다')
  assert.equal(on.valid, true, '🔴 경고인데 배포가 막혔다')

  const noQuiz = validateWorkflowJson(wf(
    [node('s', 'start', { triggerType: 'pstn', webVoice: { enabled: true } }), node('ai', 'ai'), node('e', 'end')],
    [edge('s', 'ai'), edge('ai', 'e')],
  ), 'deployable')
  assert.ok(!noQuiz.issues.some(i => /Web Voice is on/.test(i.message)), JSON.stringify(noQuiz.issues))

  const twoQuiz = validateWorkflowJson(wf(
    [node('s', 'start', { triggerType: 'pstn', webVoice: { enabled: true } }), node('ai', 'ai'), node('e', 'end'),
     tool('m', { toolType: 'miniapp', nodeType: 'miniapp', ...quiz }),
     tool('m2', { toolType: 'miniapp', nodeType: 'miniapp', ...quiz }), ...subs.map(t => tool(t.id, t.data))],
    [edge('s', 'ai'), edge('ai', 'e'), edge('ai', 'm', 'miniapps'), edge('ai', 'm2', 'miniapps'),
     ...subs.map(t => edge('ai', t.id, 'tools'))],
  ), 'deployable')
  assert.equal(twoQuiz.issues.filter(i => /Web Voice is on/.test(i.message)).length, 1, JSON.stringify(twoQuiz.issues))

  const chatWidgetOnly = validateWorkflowJson(wf(
    [node('s', 'start', { triggerType: 'pstn' }),
     node('s2', 'start', { triggerType: 'chat_widget', webVoice: { enabled: true } }),
     node('ai', 'ai'), node('e', 'end'),
     tool('m', { toolType: 'miniapp', nodeType: 'miniapp', ...quiz }), ...subs.map(t => tool(t.id, t.data))],
    [edge('s', 'ai'), edge('ai', 'e'), edge('ai', 'm', 'miniapps'), ...subs.map(t => edge('ai', t.id, 'tools'))],
  ), 'deployable')
  assert.ok(!chatWidgetOnly.issues.some(i => /Web Voice is on/.test(i.message)),
    '🔴 챗위젯 start 의 webVoice 를 PSTN 토글로 오인했다: ' + JSON.stringify(chatWidgetOnly.issues))
})

test('validation: PSTN voice_quiz blocks deploy when the 2 hooks are empty, passes when both exist and point to subs of the same AI', () => {
  const subs = [
    { id: 'sub-a', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' } },
    { id: 'sub-b', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_b' } },
  ]
  const missing = validateWorkflowJson(pstnBase({ miniAppType: 'voice_quiz', hooks: { onRoundStart: 'wf_sub_a', onRoundSettle: null } }, subs), 'deployable')
  assert.equal(missing.valid, false, JSON.stringify(missing.issues))
  assert.ok(missing.issues.some(i => i.field === 'hooks' && i.severity !== 'warning'))

  const good = validateWorkflowJson(pstnBase({ miniAppType: 'voice_quiz', hooks: { onRoundStart: 'wf_sub_a', onRoundSettle: 'wf_sub_b' } }, subs), 'deployable')
  assert.equal(good.valid, true, JSON.stringify(good.issues))
  assert.ok(!good.issues.some(i => i.field === 'hooks'))

  const stray = validateWorkflowJson(pstnBase({ miniAppType: 'voice_quiz', hooks: { onRoundStart: 'wf_sub_a', onRoundSettle: 'wf_sub_zzz' } }, subs), 'deployable')
  assert.equal(stray.valid, false)
  assert.ok(stray.issues.some(i => /not attached to this AI node/.test(i.message)), JSON.stringify(stray.issues))
})

test('validation: optional wiring (quit hook, signup sub) warns when disconnected but does not block deploy', () => {
  const subs = [
    { id: 'sub-a', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' } },
    { id: 'sub-b', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_b' } },
    { id: 'sub-c', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_c' } },
  ]
  const required = { onRoundStart: 'wf_sub_a', onRoundSettle: 'wf_sub_b' }

  const ok = validateWorkflowJson(pstnBase({ miniAppType: 'voice_quiz', hooks: { ...required, onMemberChange: 'wf_sub_c' }, signupSubWorkflowId: 'wf_sub_c' }, subs), 'deployable')
  assert.equal(ok.valid, true, JSON.stringify(ok.issues))
  assert.ok(!ok.issues.some(i => /onMemberChange|signupSubWorkflowId/.test(i.message)), JSON.stringify(ok.issues))

  const empty = validateWorkflowJson(pstnBase({ miniAppType: 'voice_quiz', hooks: required }, subs), 'deployable')
  assert.ok(!empty.issues.some(i => /onMemberChange|signupSubWorkflowId/.test(i.message)), JSON.stringify(empty.issues))

  const strayMember = validateWorkflowJson(pstnBase({ miniAppType: 'voice_quiz', hooks: { ...required, onMemberChange: 'wf_sub_zzz' } }, subs), 'deployable')
  assert.equal(strayMember.valid, true, '선택 배선은 배포를 막지 않는다')
  assert.ok(strayMember.issues.some(i => i.severity === 'warning' && i.field === 'hooks' && /hooks\.onMemberChange/.test(i.message)), JSON.stringify(strayMember.issues))

  const straySignup = validateWorkflowJson(pstnBase({ miniAppType: 'voice_quiz', hooks: required, signupSubWorkflowId: 'wf_sub_zzz' }, subs), 'deployable')
  assert.equal(straySignup.valid, true)
  assert.ok(straySignup.issues.some(i => i.severity === 'warning' && i.field === 'signupSubWorkflowId' && /signupSubWorkflowId/.test(i.message)), JSON.stringify(straySignup.issues))
})

test('validation: 🔴 optional wiring warning still fires when required hooks are empty (it used to be silent inside the else)', () => {
  const subs = [
    { id: 'sub-a', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' } },
    { id: 'sub-b', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_b' } },
  ]
  const r = validateWorkflowJson(pstnBase({
    miniAppType: 'voice_quiz',
    hooks: { onRoundStart: 'wf_sub_a', onRoundSettle: null, onMemberChange: 'wf_sub_zzz' },
    signupSubWorkflowId: 'wf_sub_yyy',
  }, subs), 'deployable')
  assert.equal(r.valid, false, '필수 훅이 비면 배포는 여전히 막힌다')
  assert.ok(r.issues.some(i => i.severity === 'warning' && /hooks\.onMemberChange/.test(i.message)), JSON.stringify(r.issues))
  assert.ok(r.issues.some(i => i.severity === 'warning' && /signupSubWorkflowId/.test(i.message)), JSON.stringify(r.issues))
})

test('validation: still blocks when a required hook has a value but is not attached (not downgraded to a warning)', () => {
  const subs = [{ id: 'sub-a', data: { toolType: 'subworkflow', subWorkflowId: 'wf_sub_a' } }]
  const r = validateWorkflowJson(pstnBase({ miniAppType: 'voice_quiz', hooks: { onRoundStart: 'wf_sub_a', onRoundSettle: 'wf_sub_zzz' } }, subs), 'deployable')
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.severity !== 'warning' && /hooks\.onRoundSettle/.test(i.message)), JSON.stringify(r.issues))
})
