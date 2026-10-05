import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

//

const engine = readFileSync(new URL('./engine.ts', import.meta.url), 'utf8')
const whileTs = readFileSync(new URL('./nodes/while.ts', import.meta.url), 'utf8')
const exec = readFileSync(new URL('./nodes/ai/openai-execute.ts', import.meta.url), 'utf8')

for (const [name, src] of [['engine.ts', engine], ['nodes/while.ts', whileTs]] as const) {
  test(`${name}: subworkflow tool branch + subWorkflowIds copy + depth guard`, () => {
    assert.match(src, /toolType === 'subworkflow'/, `${name} 에 subworkflow 분기가 없다`)
    assert.match(src, /subWorkflowIds/, `${name} 이 subWorkflowIds 를 AI 노드로 넘기지 않는다`)
    assert.match(src, /subWorkflowDepth \?\? 0\) >= 1/, `${name} 에 깊이 가드가 없다`)
    assert.match(src, /subworkflow: false/, `${name} selectedTools 에 subworkflow 플래그가 없다`)
  })
}

test('openai-execute.ts: loads SubWorkflowToolClient via selectedTools.subworkflow + subWorkflowIds, with depth and name-collision guards', () => {
  assert.match(exec, /selectedTools\?\.subworkflow && Array\.isArray\(node\.data\.subWorkflowIds\)/)
  assert.match(exec, /new SubWorkflowToolClient\(\)/)
  assert.match(exec, /subWorkflowDepth \?\? 0\) >= 1/)
  assert.match(exec, /name collision/)
})
