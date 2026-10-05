
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { decideThread, deriveConversationRole, shouldSaveConversation, shouldPersistCollected } from './server-save'

const CLIENT_A = 'client-aaaa'
const CLIENT_B = 'client-bbbb'
const CONV = 'conv-1234'
const AGENT_A = 'agt-aaaa'
const AGENT_B = 'agt-bbbb'

describe('decideThread: cases where appending is fine', () => {
  it('the first turn (no row saved under that number) uses the requested number as is', () => {
    assert.deepEqual(
      decideThread({
        requestedConversationId: CONV,
        requestClientId: CLIENT_A,
        requestAgentId: AGENT_A,
        threadExists: false,
      }),
      { action: 'reuse' }
    )
  })

  it('the same visitor continuing with the same agent uses it as is', () => {
    assert.deepEqual(
      decideThread({
        requestedConversationId: CONV,
        requestClientId: CLIENT_A,
        requestAgentId: AGENT_A,
        threadExists: true,
        existingThreadClientId: CLIENT_A,
        existingThreadAgentId: AGENT_A,
      }),
      { action: 'reuse' }
    )
  })
})

describe('RED decideThread: the same number used for a different agent', () => {
  it('a different agent gets redirected to a new number', () => {
    const d = decideThread({
      requestedConversationId: CONV,
      requestClientId: CLIENT_A,
      requestAgentId: AGENT_B,
      threadExists: true,
      existingThreadClientId: CLIENT_A,
      existingThreadAgentId: AGENT_A,
    })
    assert.equal(d.action, 'new', '두 에이전트 대화가 한 스레드로 섞이면 안 된다')
    assert.equal((d as any).reason, 'other_agent')
  })

  it('a legacy row without agent info is not appended to either', () => {
    const d = decideThread({
      requestedConversationId: CONV,
      requestClientId: CLIENT_A,
      requestAgentId: AGENT_A,
      threadExists: true,
      existingThreadClientId: CLIENT_A,
      existingThreadAgentId: null,
    })
    assert.equal(d.action, 'new')
    assert.equal((d as any).reason, 'other_agent')
  })
})

describe('RED decideThread: trying to append to someone else\'s thread (the point of this file)', () => {
  it('another visitor\'s thread is redirected to a new number: not a rejection', () => {
    const d = decideThread({
      requestedConversationId: CONV,
      requestClientId: CLIENT_B,
      requestAgentId: AGENT_A,
      threadExists: true,
      existingThreadClientId: CLIENT_A,
      existingThreadAgentId: AGENT_A,
    })
    assert.equal(d.action, 'new', '남의 스레드에 이어 붙이면 안 된다')
    assert.equal((d as any).reason, 'foreign_thread')
  })

  it('a thread whose owner is unknown (legacy) is not appended to either: fail-closed', () => {
    const d = decideThread({
      requestedConversationId: CONV,
      requestClientId: CLIENT_A,
      requestAgentId: AGENT_A,
      threadExists: true,
      existingThreadClientId: null,
      existingThreadAgentId: AGENT_A,
    })
    assert.equal(d.action, 'new')
    assert.equal((d as any).reason, 'unowned_thread')
  })

  it('RED in no case does the conclusion "do not save" come out: no conversation loss', () => {
    const inputs = [
      { requestedConversationId: null, requestClientId: CLIENT_A, requestAgentId: AGENT_A, threadExists: false },
      { requestedConversationId: CONV, requestClientId: null, requestAgentId: AGENT_A, threadExists: false },
      { requestedConversationId: CONV, requestClientId: CLIENT_B, requestAgentId: AGENT_A, threadExists: true, existingThreadClientId: CLIENT_A, existingThreadAgentId: AGENT_A },
      { requestedConversationId: CONV, requestClientId: CLIENT_A, requestAgentId: AGENT_A, threadExists: true, existingThreadClientId: null, existingThreadAgentId: AGENT_A },
      { requestedConversationId: CONV, requestClientId: CLIENT_A, requestAgentId: AGENT_B, threadExists: true, existingThreadClientId: CLIENT_A, existingThreadAgentId: AGENT_A },
      { requestedConversationId: '', requestClientId: '', requestAgentId: AGENT_A, threadExists: true, existingThreadClientId: CLIENT_A, existingThreadAgentId: AGENT_A },
    ]
    for (const i of inputs) {
      const d = decideThread(i)
      assert.ok(
        d.action === 'reuse' || d.action === 'new',
        `«저장 안 함» 이라는 결론이 생기면 정상 대화가 유실된다: ${JSON.stringify(i)}`
      )
    }
  })
})

describe('decideThread: no identifier', () => {
  it('without conversationId the server creates a new one (old client)', () => {
    const d = decideThread({ requestedConversationId: null, requestClientId: CLIENT_A, requestAgentId: AGENT_A, threadExists: false })
    assert.deepEqual(d, { action: 'new', reason: 'no_conversation_id' })
  })

  it('without clientId ownership cannot be proven, so a new one is created', () => {
    const d = decideThread({ requestedConversationId: CONV, requestClientId: null, requestAgentId: AGENT_A, threadExists: true, existingThreadClientId: CLIENT_A, existingThreadAgentId: AGENT_A })
    assert.deepEqual(d, { action: 'new', reason: 'no_client_id' })
  })

  it('an empty string is treated the same as "none"', () => {
    assert.equal(decideThread({ requestedConversationId: '', requestClientId: CLIENT_A, requestAgentId: AGENT_A, threadExists: false }).action, 'new')
    assert.equal(decideThread({ requestedConversationId: CONV, requestClientId: '', requestAgentId: AGENT_A, threadExists: false }).action, 'new')
  })
})

describe('shouldSaveConversation: same as the previous client condition?', () => {
  it('saves a public widget', () => {
    assert.equal(shouldSaveConversation({ source: 'widget', agentAccessMode: 'public' }), true)
  })

  it('RED: does not save the widget of a team agent (the previous widget did not either)', () => {
    assert.equal(shouldSaveConversation({ source: 'widget', agentAccessMode: 'team' }), false)
  })

  it('does not save if accessMode is empty or odd: fail-closed', () => {
    for (const mode of [null, undefined, '', 'PUBLIC', 'unknown']) {
      assert.equal(
        shouldSaveConversation({ source: 'widget', agentAccessMode: mode as any }),
        false,
        `accessMode=${JSON.stringify(mode)} 는 저장하면 안 된다`
      )
    }
  })

  it('Playground saves regardless of accessMode (owner\'s own test)', () => {
    assert.equal(shouldSaveConversation({ source: 'playground', agentAccessMode: 'team' }), true)
    assert.equal(shouldSaveConversation({ source: 'playground', agentAccessMode: null }), true)
  })

  it('RED: does not save the Test panel and team chat', () => {
    assert.equal(shouldSaveConversation({ source: 'workflow-playground', agentAccessMode: 'public' }), false)
    assert.equal(shouldSaveConversation({ source: 'team', agentAccessMode: 'public' }), false)
  })

  it('RED: does not save an unknown source: it is an allowlist, so new channels are not added automatically', () => {
    for (const s of ['app', 'quiz', 'pstn', 'voice', 'external', 'iframe', '', 'WIDGET']) {
      assert.equal(
        shouldSaveConversation({ source: s, agentAccessMode: 'public' }),
        false,
        `source=${JSON.stringify(s)} 가 저장되면 «없던 행» 이 생긴다`
      )
    }
  })
})

describe('shouldPersistCollected: the previous client\'s "just before save" condition', () => {
  const ok = { responseId: 'resp_1', clientId: 'c1', content: '답변', sawError: false }

  it('saves a normal run', () => {
    assert.equal(shouldPersistCollected(ok), true)
  })

  it('RED: does not save without a completion response ID: both the previous widget and Playground assumed it', () => {
    for (const rid of [null, undefined, '']) {
      assert.equal(shouldPersistCollected({ ...ok, responseId: rid }), false,
        `responseId=${JSON.stringify(rid)} 로 저장하면 «없던 행» 이 생긴다`)
    }
  })

  it('RED: does not save without clientId: the previous widget condition', () => {
    for (const cid of [null, undefined, '']) {
      assert.equal(shouldPersistCollected({ ...ok, clientId: cid }), false)
    }
  })

  it('does not save a run that saw an error frame', () => {
    assert.equal(shouldPersistCollected({ ...ok, sawError: true }), false)
  })

  it('does not save an empty answer (same as the widget\'s `if (accumulatedContent)`)', () => {
    assert.equal(shouldPersistCollected({ ...ok, content: '' }), false)
  })
})

describe('deriveConversationRole: same as the rule the client used?', () => {
  it('with no previous response it is the first turn of a new context (m = History group boundary)', () => {
    assert.equal(deriveConversationRole(null), 'm')
    assert.equal(deriveConversationRole(undefined), 'm')
    assert.equal(deriveConversationRole(''), 'm')
  })

  it('with a previous response it is a continuing turn (s)', () => {
    assert.equal(deriveConversationRole('resp_abc'), 's')
  })

  it('matches the widget\'s `isNewContextTurn = !lastResponseId` for all inputs', () => {
    for (const prev of [null, undefined, '', 'resp_1', 'x']) {
      const widget = !prev ? 'm' : 's'
      assert.equal(deriveConversationRole(prev), widget, `prev=${JSON.stringify(prev)}`)
    }
  })
})
