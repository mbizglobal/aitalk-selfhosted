
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AzureAISearchClient, azureDocKeyAgentPrefix } from './azure-ai-search'
import { AGENT_ID_ALPHABET, generateAgentId } from '@/lib/agent'

const isValidAzureDocKey = (key: string) =>
  /^[A-Za-z0-9_\-=]+$/.test(key) && !key.startsWith('_') && key.length <= 1024

const BROKEN = '_OU9y0A3n4Wm8fsqZ86a'
const NORMAL = 'aI06NkgwGbjpIjez3Hh8'
const MID_US = 'CRG1_LftfJL4vyzurc6S'

function makeClient() {
  const client = new AzureAISearchClient({
    searchApiKey: 'test-key',
    searchEndpoint: 'https://test.search.windows.net',
    openaiApiKey: 'test-key',
    openaiEndpoint: 'https://test.cognitiveservices.azure.com',
    openaiApiVersion: '2024-12-01-preview',
    regionId: 'switzerlandnorth',
  })
  const c = client as unknown as Record<string, unknown>
  const sentKeys: string[] = []
  c.searchRequest = async (_path: string, _method: string, body?: { value?: Array<{ id: string }> }) => {
    for (const d of body?.value ?? []) sentKeys.push(String(d.id))
    return { value: (body?.value ?? []).map(d => ({ key: d.id, status: true })) }
  }
  c.getEmbeddings = async (texts: string[]) => texts.map(() => new Array(1536).fill(0))
  c.ensureIndex = async () => {}
  c.ensureRagSpaceField = async () => {}
  return { client, sentKeys }
}

test('(1) document keys for an agentId starting with `_` pass the Azure rules; the real upload path', async () => {
  const { client, sentKeys } = makeClient()
  await client.uploadFile('idx', Buffer.from('업무 안내 문서입니다.'), 'Business Information.txt', 'text/plain', {
    userId: 'u1',
    agentId: BROKEN,
    storageId: '138',
  })

  assert.ok(sentKeys.length > 0, '문서가 하나도 전송되지 않았다 — 스텁이 경로를 막았다')
  for (const key of sentKeys) {
    assert.equal(key.startsWith('_'), false, `키가 여전히 _ 로 시작한다: ${key}`)
    assert.ok(isValidAzureDocKey(key), `Azure 문서 키 규칙 위반: ${key}`)
  }
})

test('(2) the prefix of a normal agentId is unchanged; compatible with existing indexed documents', () => {
  assert.equal(azureDocKeyAgentPrefix(NORMAL), 'aI06NkgwGbjpIje')
  assert.equal(azureDocKeyAgentPrefix(MID_US), 'CRG1_LftfJL4vyz')
})

const LEGACY_DELETE_KEYS: Array<{ agentId: string; expected: [string, string] }> = [
  {
    agentId: NORMAL,
    expected: [
      'aI06NkgwGbjpIje_Business_Information_txt_ms126f0s809d40c5_0',
      'aI06NkgwGbjpIje_Business_Information_txt_ms126f0s809d40c5_1',
    ],
  },
  {
    agentId: MID_US,
    expected: [
      'CRG1_LftfJL4vyz_Business_Information_txt_ms126f0s809d40c5_0',
      'CRG1_LftfJL4vyz_Business_Information_txt_ms126f0s809d40c5_1',
    ],
  },
]

for (const { agentId, expected } of LEGACY_DELETE_KEYS) {
  test(`(2-b) the delete key of a normal agent stays in the old format: agent=${agentId.slice(0, 8)}…`, async () => {
    const { client, sentKeys } = makeClient()
    await client.deleteChunksByKey(agentId, 'Business_Information_txt_ms126f0s809d40c5', 2)
    assert.deepEqual(sentKeys, expected, '기존 인덱싱 문서를 못 찾는 키가 나갔다')
  })
}

for (const agentId of [BROKEN, NORMAL]) {
  test(`(3) creation and deletion produce the same key: agent=${agentId.slice(0, 8)}…`, async () => {
    const up = makeClient()
    const uploaded = await up.client.uploadFile(
      'idx',
      Buffer.from('업무 안내 문서입니다.'),
      'Business Information.txt',
      'text/plain',
      { userId: 'u1', agentId, storageId: '138' },
    )
    assert.ok(uploaded.chunkCount > 0, '청크가 0이면 이 계약을 검사할 수 없다')

    const del = makeClient()
    await del.client.deleteChunksByKey(agentId, uploaded.fileId, uploaded.chunkCount)

    assert.deepEqual(
      del.sentKeys,
      up.sentKeys,
      '생성/삭제 키가 어긋난다 — 삭제가 없는 키를 지우고 조용히 성공한다',
    )
  })
}

test('the replacement character `-` does not collide with the prefix of agents made by generateAgentId', () => {
  assert.equal(azureDocKeyAgentPrefix(BROKEN), '-OU9y0A3n4Wm8fs', '치환 규칙이 바뀌었다')
  assert.equal(
    AGENT_ID_ALPHABET.includes('-'),
    false,
    '생성 알파벳에 `-` 가 들어왔다 — 치환 결과가 다른 agent 의 prefix 와 겹칠 수 있다',
  )
})

test('regression guard: the generation alphabet has no `_` (deterministic check)', () => {
  assert.equal(AGENT_ID_ALPHABET.includes('_'), false, '생성 알파벳에 `_` 가 되돌아왔다')
  assert.match(AGENT_ID_ALPHABET, /^[A-Za-z0-9]+$/, '생성 알파벳에 Azure 키에 못 쓰는 문자가 있다')

  for (let n = 0; n < 200; n++) {
    const id = generateAgentId()
    assert.equal(id.length, 20)
    assert.ok(isValidAzureDocKey(id), `Azure 키에 못 쓰는 agentId 가 나왔다: ${id}`)
    for (const ch of id) {
      assert.ok(AGENT_ID_ALPHABET.includes(ch), `알파벳 밖 문자가 나왔다: ${ch}`)
    }
  }
})

test('does not produce rule-violating keys even for empty strings and short ids', () => {
  assert.equal(azureDocKeyAgentPrefix('_'), '-')
  assert.equal(azureDocKeyAgentPrefix('_a'), '-a')
  assert.equal(azureDocKeyAgentPrefix('a'), 'a')
})
