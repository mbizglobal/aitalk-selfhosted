
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { saveExecutedConversation, loadPreviousToolTrace } from './server-save'

const KEY = Buffer.from('k')
const encrypt = (plain: string) => Buffer.from(`enc:${plain}`)
const decrypt = (buf: Buffer) => {
  const s = buf.toString()
  return s.startsWith('enc:') ? s.slice(4) : 'Decryption failed'
}

function fakePrisma(rows: any[] = []) {
  return {
    rows,
    conversation: {
      findFirst: async ({ where, orderBy }: any) => {
        const hit = rows.filter(r => r.conversation_id === where.conversation_id)
        if (hit.length === 0) return null
        return orderBy?.no === 'desc' ? hit[hit.length - 1] : hit[0]
      },
      create: async ({ data }: any) => { rows.push({ ...data, no: rows.length + 1 }) },
    },
  } as any
}

const TRACE = [{ name: 'check_calendar_availability', arguments: '{"requested_start_iso":"2026-09-24T20:00"}', output: '{"requestedTime":{"available":true}}' }]

async function saveTurn(prisma: any, over: Record<string, any> = {}) {
  return saveExecutedConversation(
    { prisma, ensureUserDataKey: async () => KEY, encrypt },
    {
      agentId: 'agent_1', ownerUserId: 'owner_1', conversationId: 'conv_1', clientId: 'client_A',
      userMessage: '3명, 내일 8시', assistantMessage: '확정할까요?', toolTrace: TRACE, ...over,
    },
  )
}

const load = (prisma: any, over: Record<string, any> = {}) => loadPreviousToolTrace(
  { prisma, ensureUserDataKey: async () => KEY, decrypt },
  { conversationId: 'conv_1', clientId: 'client_A', agentId: 'agent_1', ownerUserId: 'owner_1', ...over },
)

describe('save: put tools in the conversation row too', () => {
  it('if there is a tool record, it goes into the same ciphertext as tools; the messages shape is unchanged', async () => {
    const prisma = fakePrisma()
    await saveTurn(prisma)
    const data = JSON.parse(decrypt(Buffer.from(prisma.rows[0].content)))
    assert.deepEqual(data.messages, [{ role: 'user', content: '3명, 내일 8시' }, { role: 'assistant', content: '확정할까요?' }])
    assert.deepEqual(data.tools, TRACE)
  })

  it('if there is no tool record, the tools key does not exist at all: same as the previous stored copy', async () => {
    const prisma = fakePrisma()
    await saveTurn(prisma, { toolTrace: [] })
    await saveTurn(prisma, { toolTrace: undefined })
    for (const r of prisma.rows) assert.equal('tools' in JSON.parse(decrypt(Buffer.from(r.content))), false)
  })
})

describe('retrieval: ownership check', () => {
  it('the same guest and same agent get the previous turn\'s record and its AI answer', async () => {
    const prisma = fakePrisma()
    await saveTurn(prisma, { assistantMessage: '몇 분이세요?', toolTrace: [] })
    await saveTurn(prisma)
    assert.deepEqual(await load(prisma), { assistantMessage: '확정할까요?', entries: TRACE })
  })

  it('LOCK: another guest (clientId) asking with the same thread number gets nothing', async () => {
    const prisma = fakePrisma()
    await saveTurn(prisma)
    assert.equal(await load(prisma, { clientId: 'client_B' }), null)
  })

  it('LOCK: a different agent gets nothing', async () => {
    const prisma = fakePrisma()
    await saveTurn(prisma)
    assert.equal(await load(prisma, { agentId: 'agent_2' }), null)
  })

  it('LOCK: an ownerless legacy row (no client_id) gets nothing', async () => {
    const content = encrypt(JSON.stringify({ messages: [{ role: 'assistant', content: '확정할까요?' }], tools: TRACE }))
    const prisma = fakePrisma([{ conversation_id: 'conv_1', client_id: null, agentId: 'agent_1', content, no: 1 }])
    assert.equal(await load(prisma), null)
  })

  it('LOCK: ownership is decided by the first row, and the latest row is not used if it belongs to another owner', async () => {
    const mk = (client: string) => encrypt(JSON.stringify({ messages: [{ role: 'assistant', content: '확정할까요?' }], tools: TRACE }))
    const prisma = fakePrisma([
      { conversation_id: 'conv_1', client_id: 'client_A', agentId: 'agent_1', content: mk('A'), no: 1 },
      { conversation_id: 'conv_1', client_id: 'client_B', agentId: 'agent_1', content: mk('B'), no: 2 },
    ])
    assert.equal(await load(prisma, { clientId: 'client_B' }), null, '첫 행 주인이 아닌데 받았다')
    assert.equal(await load(prisma), null, '최신 행이 남의 것인데 받았다')
  })

  it('null if there is no number or clientId, the previous turn had no tools, or decryption fails', async () => {
    const prisma = fakePrisma()
    assert.equal(await load(prisma, { conversationId: null }), null)
    assert.equal(await load(prisma, { clientId: null }), null)
    assert.equal(await load(prisma), null)
    await saveTurn(prisma, { toolTrace: [] })
    assert.equal(await load(prisma), null, '바로 앞 턴에 도구가 없으면 더 앞 것을 끌어오지 않는다')
    const broken = fakePrisma([{ conversation_id: 'conv_1', client_id: 'client_A', agentId: 'agent_1', content: Buffer.from('garbage'), no: 1 }])
    assert.equal(await load(broken), null)
  })
})
