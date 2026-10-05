import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLocalTemplates } from '@/lib/local-templates'
import {
  parseBundleSpec,
  checkWiringBeforeSubstitution,
  checkWiringAfterSubstitution,
  substituteBundleTokens,
  findForbiddenLiterals,
  findTokenCandidates,
  MAIN_GRAPH_KEY,
  type BundleGraphs,
  type ResolvedBundleIds,
} from './bundle'
import { validateWorkflowJson } from './validation'

type Tpl = Record<string, unknown>

const templates = getLocalTemplates() as unknown as Tpl[]

test('at least one template file is read (if the path changes, this test would silently pass empty)', () => {
  assert.ok(templates.length > 0, '로컬 템플릿을 하나도 못 읽었다')
})

test('🔴 templates that are not bundles have no tokens; otherwise the old path stores them as is', () => {
  for (const t of templates) {
    if (t.bundleVersion !== undefined) continue
    const hits = findTokenCandidates(t)
    assert.deepEqual(hits, [], `${String(t.templateId)} 에 기호처럼 생긴 것이 있다: ${JSON.stringify(hits)}`)
  }
})

for (const t of templates.filter((x) => x.bundleVersion !== undefined)) {
  const id = String(t.templateId)

  test(`🔴 bundle template "${id}": spec, wiring, literals, deployable`, () => {
    const parsed = parseBundleSpec(t)
    assert.ok(parsed && parsed.ok, `규격 위반: ${parsed && !parsed.ok ? JSON.stringify(parsed.problems) : '묶음으로 안 읽힘'}`)
    if (!parsed?.ok) return
    const spec = parsed.value

    const graphs: BundleGraphs = { [MAIN_GRAPH_KEY]: JSON.parse(String(t.workflowJson)) }
    for (const sub of spec.subWorkflows) graphs[sub.key] = JSON.parse(sub.workflowJson)

    assert.deepEqual(
      checkWiringBeforeSubstitution(graphs, spec).map((p) => p.message), [],
      '배선이 «치환 전» 검사를 통과해야 한다',
    )
    assert.deepEqual(
      findForbiddenLiterals(graphs, spec).map((p) => p.message), [],
      '본문에 도구 함수명·시트 이름을 «직접» 쓰면 안 된다 — 두 번째 복제에서 이름이 바뀐다',
    )

    for (const [key, g] of Object.entries(graphs)) {
      const r = validateWorkflowJson(JSON.stringify(g), 'structural', key === MAIN_GRAPH_KEY ? 'main' : 'sub')
      assert.deepEqual(r.issues.map((i) => i.message), [], `${key} 구조`)
    }

    const ids: ResolvedBundleIds = { subIds: {}, subToolNames: {}, sheetIds: {}, sheetNames: {} }
    spec.subWorkflows.forEach((sw, i) => {
      ids.subIds[sw.key] = `wf_fake${String(i).padStart(16, '0')}`
      ids.subToolNames[sw.key] = `subwf_fake_${sw.key}`
    })
    spec.dataSheets.forEach((sh, i) => {
      ids.sheetIds[sh.key] = `cmfake${String(i).padStart(19, '0')}`
      ids.sheetNames[sh.key] = sh.name
    })
    const substituted = substituteBundleTokens(graphs, spec, ids)
    assert.deepEqual(
      checkWiringAfterSubstitution(substituted, spec, ids).map((p) => p.message), [],
      '치환 뒤 모든 배선이 «이번에 만든 id» 를 가리켜야 한다',
    )
    const dep = validateWorkflowJson(JSON.stringify(substituted[MAIN_GRAPH_KEY]), 'deployable', 'main')
    assert.deepEqual(
      dep.issues.filter((i) => (i as { severity?: string }).severity !== 'warning').map((i) => i.message), [],
      '복제 직후 «배포 가능» 해야 한다',
    )
  })

  test(`🔴 bundle template "${id}": no account-specific values are included`, () => {
    const whole = JSON.stringify(t)
    const leaks: Array<[string, RegExp]> = [
      ['connectionId 칸', /"connectionId"\s*:/],
      ['ragSpaceId 칸', /"ragSpaceId"\s*:/],
      ['진짜 워크플로 id', /"wf_[a-z0-9]{10,}"/],
      ['진짜 시트 id', /"cm[a-z0-9]{15,}"/],
      ['전화번호', /\+[0-9]{8,}/],
    ]
    for (const [what, re] of leaks) {
      const m = whole.match(re)
      assert.equal(m, null, `${what} 이 남았다: ${m?.[0]}`)
    }
  })
}
