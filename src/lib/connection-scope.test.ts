import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agentScopedWhere, userScopedWhere, restoreExecutionOwner, ConnectionScopeError,
  MCP_CONNECTION_PROVIDERS, isSaveAsKeyAllowed, SAVE_AS_RESERVED_KEYS,
} from './connection-scope'
import { SendGridToolClient } from './workflow/tools/sendgrid-tool'
import { TelegramToolClient } from './workflow/tools/telegram-tool'
import { SmtpToolClient } from './workflow/tools/smtp-tool'
import { GoogleCalendarToolClient } from './workflow/tools/google-calendar-tool'
import { MicrosoftCalendarToolClient } from './workflow/tools/microsoft-calendar-tool'
import { TelegramMcpClient } from './mcp/telegram'
import { McpNodeExecutor } from './workflow/nodes/mcp'

// ========================================
// ========================================

interface Call {
  model: string
  where: Record<string, any>
  matched: boolean
}

function whereMatches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (value && typeof value === 'object' && Array.isArray((value as any).in)) {
      return (value as any).in.includes(row[key])
    }
    return row[key] === value
  })
}

function makePrisma(rows: {
  connections?: Record<string, any>[]
  accounts?: Record<string, any>[]
  workflows?: Record<string, any>[]
} = {}) {
  const calls: Call[] = []
  const find = (model: string, table: Record<string, any>[]) => async (args: any) => {
    const where = args?.where ?? {}
    const hit = table.find((row) => whereMatches(row, where)) ?? null
    calls.push({ model, where, matched: hit !== null })
    return hit
  }
  const findMany = (model: string, table: Record<string, any>[]) => async (args: any) => {
    const where = args?.where ?? {}
    const hits = table.filter((row) => whereMatches(row, where))
    calls.push({ model, where, matched: hits.length > 0 })
    return hits
  }
  const client = {
    workflowConnection: { findFirst: find('workflowConnection', rows.connections ?? []) },
    workflowCalendarAccount: { findFirst: find('workflowCalendarAccount', rows.accounts ?? []) },
    workflow: {
      findUnique: find('workflow', rows.workflows ?? []),
      findFirst: find('workflow', rows.workflows ?? []),
      findMany: findMany('workflow', rows.workflows ?? []),
    },
    callPhoneNumber: { findFirst: async () => null },
  } as any
  return { client, calls }
}

function workflowJsonWithTools(tools: Array<{ toolType: string; connectionId: string; extra?: any }>) {
  const nodes: any[] = [{ id: 'ai-1', type: 'ai', data: { nodeType: 'ai' } }]
  const edges: any[] = []
  tools.forEach((t, i) => {
    const id = `tool-${t.toolType}-${i}`
    nodes.push({ id, type: 'tool', data: { toolType: t.toolType, connectionId: t.connectionId, ...(t.extra ?? {}) } })
    edges.push({ source: 'ai-1', sourceHandle: 'tools', target: id })
  })
  return JSON.stringify({ nodes, edges })
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

const OWN = { agentId: 'agent-own', userId: 'user-own' }

// ========================================
// ========================================

test(`agentScopedWhere: throws without agentId (blocked before the query)`, () => {
  assert.throws(() => agentScopedWhere({}, 'X'), ConnectionScopeError)
  assert.throws(() => agentScopedWhere({ agentId: '' }, 'X'), ConnectionScopeError)
  assert.throws(() => agentScopedWhere({ agentId: '   ' }, 'X'), ConnectionScopeError)
  assert.throws(() => agentScopedWhere({ agentId: null, userId: 'u1' }, 'X'), ConnectionScopeError)
})

test('agentScopedWhere: also applies userId when present', () => {
  assert.deepEqual(agentScopedWhere({ agentId: 'a1' }, 'X'), { agentId: 'a1' })
  assert.deepEqual(agentScopedWhere({ agentId: 'a1', userId: 'u1' }, 'X'), { agentId: 'a1', userId: 'u1' })
  assert.deepEqual(agentScopedWhere({ agentId: 'a1', userId: '' }, 'X'), { agentId: 'a1' })
  assert.equal('userId' in agentScopedWhere({ agentId: 'a1', userId: '' }, 'X'), false)
})

test('userScopedWhere: userId required, agentId optional', () => {
  assert.throws(() => userScopedWhere({}, 'X'), ConnectionScopeError)
  assert.throws(() => userScopedWhere({ agentId: 'a1' }, 'X'), ConnectionScopeError)
  assert.deepEqual(userScopedWhere({ userId: 'u1' }, 'X'), { userId: 'u1' })
  assert.deepEqual(userScopedWhere({ userId: 'u1', agentId: 'a1' }, 'X'), { userId: 'u1', agentId: 'a1' })
  assert.equal('agentId' in userScopedWhere({ userId: 'u1', agentId: '' }, 'X'), false)
})

// ========================================
//
// ========================================

test('restoreExecutionOwner: an uncontaminated context passes through unchanged (same reference)', () => {
  const ctx = { agentId: 'a1', userId: 'u1', message: 'x' }
  assert.equal(restoreExecutionOwner({ agentId: 'a1', userId: 'u1' }, ctx), ctx)
})

test('restoreExecutionOwner: restores agentId and userId overwritten by saveAs to the canonical values', () => {
  const original = console.error
  console.error = () => {}
  try {
    const poisoned = { agentId: 'agent-victim', userId: 'user-victim', message: 'x', aiResponse: 'y' }
    const fixed = restoreExecutionOwner({ agentId: 'agent-own', userId: 'user-own' }, poisoned)
    assert.equal(fixed.agentId, 'agent-own')
    assert.equal(fixed.userId, 'user-own')
    assert.equal(fixed.aiResponse, 'y', '소유자 외 필드는 보존되어야 한다')
  } finally {
    console.error = original
  }
})

test('restoreExecutionOwner: a contaminated context cannot produce another agent\'s scope', () => {
  const original = console.error
  console.error = () => {}
  try {
    const poisoned = { agentId: 'agent-victim', userId: 'user-victim' }
    const restored = restoreExecutionOwner({ agentId: OWN.agentId, userId: OWN.userId }, poisoned)
    assert.deepEqual(agentScopedWhere(restored, 'X'), { agentId: OWN.agentId, userId: OWN.userId })
  } finally {
    console.error = original
  }
})

test('dynamic variable names: reserved security and billing keys are not storable', () => {
  const original = console.error
  console.error = () => {}
  try {
    assert.equal(isSaveAsKeyAllowed('agentId'), false)
    assert.equal(isSaveAsKeyAllowed('userId'), false)
    assert.equal(isSaveAsKeyAllowed('skipAiCallCpa'), false)
    assert.equal(isSaveAsKeyAllowed('isTestMode'), false)
    assert.equal(isSaveAsKeyAllowed('isManaged'), false)
    assert.equal(isSaveAsKeyAllowed('managedRegion'), false)
    assert.equal(isSaveAsKeyAllowed('isScheduledTrigger'), false)
    assert.equal(isSaveAsKeyAllowed('scheduleRunKey'), false)
    assert.equal(isSaveAsKeyAllowed('workflowId'), false)
    assert.equal(isSaveAsKeyAllowed('__proto__'), false)
    assert.equal(isSaveAsKeyAllowed('prototype'), false)
    assert.equal(isSaveAsKeyAllowed('constructor'), false)
    assert.equal(isSaveAsKeyAllowed('category'), true)
    assert.equal(isSaveAsKeyAllowed('currentEmail'), true)
  } finally {
    console.error = original
  }
})

test('__proto__ pollution is not caught by restoreExecutionOwner, so it must be blocked at the write point', () => {
  const ctx: any = { agentId: OWN.agentId, userId: OWN.userId }
  const polluted: any = { ...ctx }
  polluted['__proto__'] = { skipAiCallCpa: true }
  assert.equal(polluted.skipAiCallCpa, true, '프로토타입 경유로 값이 읽힌다')
  assert.equal(
    restoreExecutionOwner({ agentId: OWN.agentId, userId: OWN.userId }, polluted),
    polluted,
    'agentId/userId 가 멀쩡하므로 복원기는 손대지 않는다 = 탐지 불가'
  )
  assert.equal(isSaveAsKeyAllowed('__proto__'), false, '따라서 쓰기 자체를 막아야 한다')
})

// ========================================
// ========================================

const APPS_TOOLS: Array<{
  label: string
  provider: string
  run: (prisma: any, connectionId: string, overrides: any, userId?: string) => Promise<void>
}> = [
  {
    label: 'SendGrid',
    provider: 'sendgrid',
    run: (p, id, o, u) => new SendGridToolClient().initialize(p, id, o, u),
  },
  {
    label: 'Telegram',
    provider: 'telegram',
    run: (p, id, o, u) => new TelegramToolClient().initialize(p, id, o, u),
  },
  {
    label: 'SMTP',
    provider: 'smtp',
    run: (p, id, o, u) => new SmtpToolClient().initialize(p, id, o, u),
  },
]

for (const tool of APPS_TOOLS) {
  test(`${tool.label} tool: where has agentId, userId, provider and status all applied`, async () => {
    const prisma = makePrisma()
    await assert.rejects(() => tool.run(prisma.client, 'conn-1', { ...OWN }, OWN.userId))
    assert.equal(prisma.calls.length, 1)
    assert.deepEqual(prisma.calls[0].where, {
      id: 'conn-1',
      agentId: OWN.agentId,
      userId: OWN.userId,
      provider: tool.provider,
      status: 'active',
    })
  })

  test(`${tool.label} tool: does no DB query at all without agentId`, async () => {
    const prisma = makePrisma()
    await assert.rejects(
      () => tool.run(prisma.client, 'conn-1', {}, OWN.userId),
      /Missing agentId/
    )
    assert.equal(prisma.calls.length, 0, 'agentId 없이 findFirst 가 나갔다 — 필터 소실 위험')
  })

  test(`${tool.label} tool: another agent's connection is not picked up`, async () => {
    const victim = {
      id: 'conn-victim',
      userId: 'user-victim',
      agentId: 'agent-victim',
      provider: tool.provider,
      status: 'active',
      encryptedToken: 'ENCRYPTED',
      serviceConfig: '{}',
      authType: 'api_key',
    }
    const owner = makePrisma({ connections: [victim] })
    await tool
      .run(owner.client, 'conn-victim', { agentId: 'agent-victim', userId: 'user-victim' }, 'user-victim')
      .catch(() => { })
    assert.equal(owner.calls[0].matched, true, '대조군이 안 잡히면 이 테스트는 무의미하다')

    const attacker = makePrisma({ connections: [victim] })
    await assert.rejects(() =>
      tool.run(attacker.client, 'conn-victim', { ...OWN }, OWN.userId)
    )
    assert.equal(attacker.calls[0].matched, false)
  })
}

// ========================================
// ========================================

const CALENDARS: Array<{
  label: string
  provider: string
  run: (prisma: any, connectionId: string, overrides: any) => Promise<void>
}> = [
  {
    label: 'Google Calendar',
    provider: 'google_workspace',
    run: (p, id, o) => new GoogleCalendarToolClient().initialize(p, id, o),
  },
  {
    label: 'Microsoft Calendar',
    provider: 'microsoft_workspace',
    run: (p, id, o) => new MicrosoftCalendarToolClient().initialize(p, id, o),
  },
]

for (const cal of CALENDARS) {
  const ownConnection = {
    id: 'conn-own',
    userId: OWN.userId,
    agentId: OWN.agentId,
    provider: cal.provider,
    status: 'active',
    serviceConfig: null,
  }

  test(`${cal.label}: does no DB query at all without agentId`, async () => {
    const prisma = makePrisma({ connections: [ownConnection] })
    await assert.rejects(() => cal.run(prisma.client, 'conn-own', {}), /Missing agentId/)
    assert.equal(prisma.calls.length, 0)
  })

  test(`${cal.label}: the scope is applied to the connection where`, async () => {
    const prisma = makePrisma()
    await assert.rejects(() => cal.run(prisma.client, 'conn-own', { ...OWN }))
    assert.deepEqual(prisma.calls[0].where, {
      id: 'conn-own',
      agentId: OWN.agentId,
      userId: OWN.userId,
      status: 'active',
      provider: cal.provider,
    })
  })

  test(`${cal.label}: rejects the combination of own connection + someone else's accountId`, async () => {
    const prisma = makePrisma({
      connections: [ownConnection],
      accounts: [
        {
          id: 'acct-victim',
          connectionId: 'conn-victim',
          userId: 'user-victim',
          agentId: 'agent-victim',
          status: 'active',
        },
      ],
    })
    await assert.rejects(
      () => cal.run(prisma.client, 'conn-own', { ...OWN, accountId: 'acct-victim' }),
      /account not found/i
    )
    const accountCall = prisma.calls.find((c) => c.model === 'workflowCalendarAccount')
    assert.ok(accountCall, 'account 조회가 아예 없었다')
    assert.equal(accountCall!.where.connectionId, 'conn-own')
    assert.equal(accountCall!.where.agentId, OWN.agentId)
    assert.equal(accountCall!.matched, false)
  })

  test(`${cal.label}: does not fall back to the first account if the explicit accountId does not match`, async () => {
    const prisma = makePrisma({
      connections: [ownConnection],
      accounts: [
        { id: 'acct-own', connectionId: 'conn-own', userId: OWN.userId, agentId: OWN.agentId, status: 'active' },
      ],
    })
    await assert.rejects(
      () => cal.run(prisma.client, 'conn-own', { ...OWN, accountId: 'acct-does-not-exist' }),
      /account not found/i
    )
  })
}

// ========================================
// ========================================

test('Telegram MCP client: does no DB query without agentId', async () => {
  const prisma = makePrisma()
  await assert.rejects(
    () => new TelegramMcpClient('conn-1').initialize(prisma.client, {}),
    /Missing agentId/
  )
  assert.equal(prisma.calls.length, 0)
})

test('Telegram MCP client: where has scope + provider applied', async () => {
  const prisma = makePrisma()
  await assert.rejects(() => new TelegramMcpClient('conn-1').initialize(prisma.client, { ...OWN }))
  assert.deepEqual(prisma.calls[0].where, {
    id: 'conn-1',
    agentId: OWN.agentId,
    userId: OWN.userId,
    provider: 'telegram_mcp',
    status: 'active',
  })
})

test('MCP node: with a context lacking agentId, yields an error result without a query', async () => {
  const prisma = makePrisma()
  const node = { id: 'n1', type: 'mcp', data: { mcpConnectionId: 'conn-1', mcpToolName: 't' } } as any
  const context = { agentId: '', userId: OWN.userId } as any
  const result = await new McpNodeExecutor().execute(node, context, prisma.client)
  assert.equal(result.debug?.status, 'error')
  assert.match(String(result.debug?.error), /Missing agentId/)
  assert.equal(prisma.calls.length, 0)
})

test('MCP node: even if the query throws, the error status write is scoped (no corrupting someone else\'s row with an unverified id)', async () => {
  const writes: Array<Record<string, any>> = []
  const prisma: any = {
    workflowConnection: {
      findFirst: async () => { throw new Error('DB down') },
      updateMany: async (a: any) => { writes.push(a.where); return { count: 0 } },
      update: async (a: any) => { writes.push({ ...a.where, __update: true }); return {} },
    },
  }
  const node = { id: 'n1', type: 'mcp', data: { mcpConnectionId: 'conn-victim', mcpToolName: 't' } } as any
  const result: any = await quiet(() => new McpNodeExecutor().execute(node, { ...OWN } as any, prisma))

  assert.equal(result.debug?.status, 'error')
  assert.equal(writes.length, 1, '상태 쓰기가 안 나갔거나 두 번 나갔다')
  assert.equal(writes[0].__update, undefined, 'unique update 로 나갔다 — 소유권 조건을 못 건다')
  assert.equal(writes[0].id, 'conn-victim')
  assert.equal(writes[0].agentId, OWN.agentId, '미검증 id 로 남의 커넥션을 error 로 만들 수 있다')
})

test('MCP node: the scope is applied to where', async () => {
  const prisma = makePrisma()
  const node = { id: 'n1', type: 'mcp', data: { mcpConnectionId: 'conn-1', mcpToolName: 't' } } as any
  const result = await new McpNodeExecutor().execute(node, { ...OWN } as any, prisma.client)
  assert.equal(result.debug?.status, 'error')
  assert.deepEqual(prisma.calls[0].where, {
    id: 'conn-1',
    agentId: OWN.agentId,
    userId: OWN.userId,
    provider: { in: [...MCP_CONNECTION_PROVIDERS] },
    status: 'active',
  })
})

// ========================================
//
//
// ========================================

test('loadAgentAppsTools: the connectionId of a stored tool node is queried together with the agentId scope', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const prisma = makePrisma({
    workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
      { toolType: 'sendgrid', connectionId: 'conn-sg' },
      { toolType: 'telegram', connectionId: 'conn-tg' },
      { toolType: 'smtp', connectionId: 'conn-smtp' },
      { toolType: 'google_calendar', connectionId: 'conn-gcal' },
    ]) }],
  })

  await quiet(() => loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget'))

  const connCalls = prisma.calls.filter((c) => c.model === 'workflowConnection')
  assert.equal(connCalls.length, 4, '4개 tool 이 전부 조회되지 않았다')
  for (const call of connCalls) {
    assert.equal(call.where.agentId, OWN.agentId, `agentId 배선 누락: ${JSON.stringify(call.where)}`)
    assert.equal(call.where.userId, OWN.userId, `userId 배선 누락: ${JSON.stringify(call.where)}`)
    assert.equal(call.where.status, 'active')
  }
})

test('loadAgentAppsTools: the multi-calendar (>=2) dispatcher path also carries the scope', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const ownConn = {
    id: 'conn-gcal',
    userId: OWN.userId,
    agentId: OWN.agentId,
    provider: 'google_workspace',
    status: 'active',
    serviceConfig: null,
  }
  const prisma = makePrisma({
    connections: [ownConn],
    accounts: [
      { id: 'acct-own', connectionId: 'conn-gcal', userId: OWN.userId, agentId: OWN.agentId, status: 'active', ownerEmail: 'a@b.c' },
    ],
    workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
      { toolType: 'google_calendar', connectionId: 'conn-gcal', extra: { accountId: 'acct-own', label: 'A' } },
      { toolType: 'google_calendar', connectionId: 'conn-gcal', extra: { accountId: 'acct-own', label: 'B' } },
    ]) }],
  })

  await quiet(() => loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget'))

  const acctCalls = prisma.calls.filter((c) => c.model === 'workflowCalendarAccount')
  assert.ok(acctCalls.length > 0, 'dispatcher 가 account 조회를 아예 안 했다')
  for (const call of acctCalls) {
    assert.equal(call.where.agentId, OWN.agentId, `dispatcher account 조회에 agentId 누락: ${JSON.stringify(call.where)}`)
  }
})

test('loadAgentAppsTools: the widget chat path (no workflowId) also scopes the workflow query by agentId', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const prisma = makePrisma({
    workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
      { toolType: 'sendgrid', connectionId: 'conn-sg' },
    ]) }],
  })

  await quiet(() => loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, undefined, 'chat_widget'))

  const wfCall = prisma.calls.find((c) => c.model === 'workflow')
  assert.ok(wfCall, 'workflow 조회가 없었다')
  assert.equal(wfCall!.where.agentId, OWN.agentId)
  assert.equal(wfCall!.where.status, 'production')
  assert.equal(wfCall!.matched, true, '정상 워크플로가 안 잡혔다 — 테스트가 무의미해진다')
})

test('loadAgentAppsTools: does not load if the specified workflow is a work app (Start / App)', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const json = JSON.parse(workflowJsonWithTools([{ toolType: 'sendgrid', connectionId: 'conn-sg' }]))
  json.nodes.unshift({ id: 'start', type: 'custom', data: { nodeType: 'start', triggerType: 'app' } })
  const prisma = makePrisma({
    workflows: [{ workflowId: 'wf-app', agentId: OWN.agentId, status: 'production', workflowJson: JSON.stringify(json) }],
    connections: [{ id: 'conn-sg', agentId: OWN.agentId, userId: OWN.userId }],
  })
  const out = await quiet(() => loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-app', 'chat_widget'))
  assert.equal(prisma.calls.some((c) => c.model === 'workflowConnection'), false, '업무 앱의 도구 연결을 읽었다')
  assert.equal((out as { tools?: unknown[] })?.tools?.length ?? 0, 0)
})

test('loadAgentAppsTools: the path with a specified workflowId is also scoped by agentId (someone else\'s workflowId is rejected)', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const prisma = makePrisma({
    workflows: [{ workflowId: 'wf-victim', agentId: 'agent-victim', status: 'production', workflowJson: workflowJsonWithTools([
      { toolType: 'sendgrid', connectionId: 'conn-sg' },
    ]) }],
  })

  const result = await quiet(() =>
    loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-victim', 'chat_widget')
  )
  const wfCall = prisma.calls.find((c) => c.model === 'workflow')
  assert.equal(wfCall!.where.agentId, OWN.agentId)
  assert.equal(wfCall!.matched, false, '남의 workflow JSON 이 tool 로드 입력이 됐다')
  assert.equal(result.clients.size, 0)
})

test('MultiCalendarDispatcher: the rest survive even if one calendar fails', async () => {
  const { MultiCalendarDispatcher } = await import('./workflow/tools/multi-calendar-dispatcher')
  const goodConn = {
    id: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId,
    provider: 'google_workspace', status: 'active', serviceConfig: null,
  }
  const prisma = makePrisma({
    connections: [goodConn],
    accounts: [
      { id: 'acct-ok', connectionId: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId, status: 'active', ownerEmail: 'ok@x.io' },
    ],
  })

  const dispatcher = new MultiCalendarDispatcher()
  await quiet(() =>
    dispatcher.initializeMulti(prisma.client, OWN, [
      { nodeId: 'n-bad', toolType: 'google_calendar', connectionId: 'conn-ok', label: 'Bad', nodeData: { accountId: 'acct-expired' } },
      { nodeId: 'n-ok', toolType: 'google_calendar', connectionId: 'conn-ok', label: 'Good', nodeData: { accountId: 'acct-ok' } },
    ], '')
  )

  const roster = dispatcher.rosterEntries()
  assert.equal(roster.length, 1, '살아있는 캘린더만 roster 에 남아야 한다')
  assert.equal(roster[0].displayName, 'Good')
})

test('loadAgentAppsTools: capacity and bookingQuestions of a failed calendar do not remain in the prompt', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const conn = {
    id: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId,
    provider: 'google_workspace', status: 'active', serviceConfig: null,
  }
  const prisma = makePrisma({
    connections: [conn],
    accounts: [
      { id: 'acct-ok', connectionId: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId, status: 'active', ownerEmail: 'ok@x.io' },
    ],
    workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: JSON.stringify({
      nodes: [
        { id: 'ai-1', type: 'ai', data: { nodeType: 'ai' } },
        { id: 'cal-dead', type: 'tool', data: {
          toolType: 'google_calendar', connectionId: 'conn-ok', accountId: 'acct-dead',
          capacityMode: 'simple', simpleCapacity: 4, bookingQuestions: '죽은 캘린더 질문',
        } },
        { id: 'cal-live', type: 'tool', data: {
          toolType: 'google_calendar', connectionId: 'conn-ok', accountId: 'acct-ok',
          capacityMode: 'single',
        } },
      ],
      edges: [
        { source: 'ai-1', sourceHandle: 'tools', target: 'cal-dead' },
        { source: 'ai-1', sourceHandle: 'tools', target: 'cal-live' },
      ],
    }) }],
  })

  const result = await quiet(() =>
    loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget')
  )

  assert.equal(result.multiCalendar?.roster.length, 1, '생존 캘린더만 roster 에 남아야 한다')
  assert.equal(result.hasCapacityCalendar, false, '실패한 캘린더의 capacityMode 가 프롬프트에 남았다')
  assert.equal(result.bookingQuestions, undefined, '실패한 캘린더의 bookingQuestions 가 적용됐다')
})

test('ForEach: a normal itemVar runs as is and does not touch the execution owner (control group)', async () => {
  const { WhileLoopExecutor } = await import('./workflow/nodes/while')
  const nodes: any[] = [
    { id: 'fe', type: 'while', data: { loopMode: 'forEach', forEachSource: 'items', forEachItemVar: 'currentUserRef', maxIterations: 5 } },
    { id: 'inner', type: 'sendgrid', data: { isLoopTool: true, loopOrder: 1 } },
  ]
  const edges: any[] = [{ source: 'fe', sourceHandle: 'loop', target: 'inner' }]

  const seen: Array<{ agentId: string; userId: string; item: any }> = []
  const executeNode = async (_n: any, _t: any, ctx: any) => {
    seen.push({ agentId: ctx.agentId, userId: ctx.userId, item: ctx.currentUserRef })
    return { context: ctx, debug: { status: 'success', input: {}, output: {} } }
  }
  const executor = new WhileLoopExecutor({} as any, nodes, edges, executeNode as any, (n: any) => n?.type ?? null)

  const result: any = await quiet(() => executor.executeLoop(nodes[0], {
    ...OWN, message: '', items: ['a', 'b'],
  } as any))

  assert.equal(result.fatalError, undefined, '정상 itemVar 인데 중단됐다')
  assert.equal(seen.length, 2, '항목 수만큼 루프 바디가 돌아야 한다')
  assert.deepEqual(seen.map((x) => x.item), ['a', 'b'])
  for (const x of seen) {
    assert.equal(x.agentId, OWN.agentId, 'ForEach 가 실행 소유자를 건드렸다')
    assert.equal(x.userId, OWN.userId)
  }
})

test('ForEach: a reserved-key itemVar is not skipped quietly but aborts with a fatal nodeError', async () => {
  const { WhileLoopExecutor } = await import('./workflow/nodes/while')
  const nodes: any[] = [
    { id: 'fe', type: 'while', data: { loopMode: 'forEach', forEachSource: 'items', forEachItemVar: 'userId', maxIterations: 3 } },
    { id: 'inner', type: 'sendgrid', data: { isLoopTool: true, loopOrder: 1 } },
  ]
  const edges: any[] = [{ source: 'fe', sourceHandle: 'loop', target: 'inner' }]
  let innerRan = 0
  const executeNode = async (_n: any, _t: any, ctx: any) => {
    innerRan++
    return { context: ctx, debug: { status: 'success', input: {}, output: {} } }
  }
  const executor = new WhileLoopExecutor({} as any, nodes, edges, executeNode as any, (n: any) => n?.type ?? null)

  const result: any = await quiet(() => executor.executeLoop(nodes[0], {
    ...OWN, message: '', items: ['u-victim-1', 'u-victim-2'],
  } as any))

  assert.ok(result.fatalError, '예약키인데 fatalError 없이 진행했다')
  assert.match(String(result.fatalError.error), /reserved execution key/)
  assert.equal(result.context.nodeError?.nodeId, 'fe')
  assert.equal(innerRan, 0, '중단 전에 루프 바디가 실행됐다')
  assert.equal(result.context.userId, OWN.userId, '소유자 userId 가 항목 값으로 덮였다')
})

test('ForEach: a reserved-key setting aborts even if the source is an empty array', async () => {
  const { WhileLoopExecutor } = await import('./workflow/nodes/while')
  const nodes: any[] = [
    { id: 'fe', type: 'while', data: { loopMode: 'forEach', forEachSource: 'items', forEachItemVar: 'agentId' } },
  ]
  const executor = new WhileLoopExecutor({} as any, nodes, [], (async () => ({ context: {} })) as any, (n: any) => n?.type ?? null)

  for (const items of [[], undefined]) {
    const result: any = await quiet(() => executor.executeLoop(nodes[0], { ...OWN, message: '', items } as any))
    assert.ok(result.fatalError, `items=${JSON.stringify(items)} 에서 조용히 통과했다`)
    assert.match(String(result.fatalError.error), /reserved execution key/)
  }
})

test('validateWorkflowJson: reserved-key and non-string dynamic variable names are blocked at the structural stage', async () => {
  const { validateWorkflowJson } = await import('./workflow/validation')
  const wrap = (extraNode: any) => JSON.stringify({
    nodes: [
      { id: 's', type: 'start', data: { nodeType: 'start', triggerType: 'chat' } },
      extraNode,
      { id: 'e', type: 'end', data: { nodeType: 'end' } },
    ],
    edges: [{ id: 'e1', source: 's', target: extraNode.id }, { id: 'e2', source: extraNode.id, target: 'e' }],
  })
  const reserved = (r: any) => r.issues.filter((i: any) => /reserved execution key|must be a string/.test(i.message))

  for (const bad of ['agentId', 'skipAiCallCpa', 'isManaged', '__proto__']) {
    const r = validateWorkflowJson(wrap({ id: 'n', type: 'ai', data: { nodeType: 'ai', saveAs: bad } }), 'structural')
    assert.equal(r.valid, false, `saveAs="${bad}" 가 structural 을 통과했다`)
    assert.ok(reserved(r).length > 0, `saveAs="${bad}" 지적 없음: ${JSON.stringify(r.issues)}`)
  }

  for (const bad of [['skipAiCallCpa'], ['__proto__'], 123]) {
    const r = validateWorkflowJson(wrap({ id: 'n', type: 'ai', data: { nodeType: 'ai', saveAs: bad } }), 'structural')
    assert.equal(r.valid, false, `saveAs=${JSON.stringify(bad)} 가 통과했다`)
    assert.ok(r.issues.some((i: any) => /must be a string/.test(i.message)))
  }

  const feBad = validateWorkflowJson(
    wrap({ id: 'n', type: 'while', data: { nodeType: 'while', loopMode: 'forEach', forEachItemVar: 'userId' } }), 'structural')
  assert.equal(feBad.valid, false)
  assert.ok(reserved(feBad).length > 0)

  const strayForEach = validateWorkflowJson(
    wrap({ id: 'n', type: 'ai', data: { nodeType: 'ai', forEachItemVar: 'userId' } }), 'structural')
  assert.equal(reserved(strayForEach).length, 0, 'AI 노드의 잉여 forEachItemVar 를 오거부했다')
  const strayWhile = validateWorkflowJson(
    wrap({ id: 'n', type: 'while', data: { nodeType: 'while', loopMode: 'while', saveAs: 'agentId' } }), 'structural')
  assert.equal(reserved(strayWhile).length, 0, 'while 노드의 잉여 saveAs 를 오거부했다')

  const ok = validateWorkflowJson(
    wrap({ id: 'n', type: 'ai', data: { nodeType: 'ai', saveAs: 'category' } }), 'structural')
  assert.equal(reserved(ok).length, 0)
})

test('dynamic variable names: non-strings are also rejected by the runtime guard (Set.has bypass)', () => {
  const original = console.error
  console.error = () => {}
  try {
    assert.equal(isSaveAsKeyAllowed(['skipAiCallCpa'] as any), false)
    assert.equal(isSaveAsKeyAllowed(['__proto__'] as any), false)
    assert.equal(isSaveAsKeyAllowed(123 as any), false)
    assert.equal(isSaveAsKeyAllowed(null as any), false)
    assert.equal(isSaveAsKeyAllowed('currentEmail'), true)
  } finally {
    console.error = original
  }
})

for (const cal of [
  { toolType: 'google_calendar', provider: 'google_workspace' },
  { toolType: 'microsoft_calendar', provider: 'microsoft_workspace' },
]) {
  test(`loadAgentAppsTools: a single ${cal.toolType} also uses the accountId chosen by the node (no first-account fallback)`, async () => {
    const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
    const conn = {
      id: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId,
      provider: cal.provider, status: 'active', serviceConfig: null,
    }
    const prisma = makePrisma({
      connections: [conn],
      accounts: [
        { id: 'acct-first', connectionId: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId, status: 'active', ownerEmail: 'a@x.io' },
        { id: 'acct-chosen', connectionId: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId, status: 'active', ownerEmail: 'b@x.io' },
      ],
      workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
        { toolType: cal.toolType, connectionId: 'conn-ok', extra: { accountId: 'acct-chosen' } },
      ]) }],
    })

    await quiet(() => loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget'))

    const acctCall = prisma.calls.find((c) => c.model === 'workflowCalendarAccount')
    assert.ok(acctCall, 'account 조회가 없었다')
    assert.equal(acctCall!.where.id, 'acct-chosen', '노드가 고른 계정 대신 폴백을 탔다')
    assert.equal(acctCall!.where.connectionId, 'conn-ok')
    assert.equal(acctCall!.where.agentId, OWN.agentId)
  })

  test(`loadAgentAppsTools: keeps the existing fallback when ${cal.toolType} accountId is unspecified`, async () => {
    const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
    const prisma = makePrisma({
      connections: [{ id: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId, provider: cal.provider, status: 'active', serviceConfig: null }],
      accounts: [{ id: 'acct-first', connectionId: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId, status: 'active', ownerEmail: 'a@x.io' }],
      workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
        { toolType: cal.toolType, connectionId: 'conn-ok' },
      ]) }],
    })
    await quiet(() => loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget'))
    const acctCall = prisma.calls.find((c) => c.model === 'workflowCalendarAccount')
    assert.ok(acctCall, 'account 조회가 없었다')
    assert.equal(acctCall!.where.id, undefined, '미지정인데 id 조건이 붙었다 — 폴백이 깨졌다')
    assert.equal(acctCall!.where.connectionId, 'conn-ok')
  })
}

test('loadAgentAppsTools: a calendar turned off via enabledChannels is not a failure (normal setting)', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const prisma = makePrisma({
    connections: [{ id: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId, provider: 'google_workspace', status: 'active', serviceConfig: null }],
    accounts: [{ id: 'acct-ok', connectionId: 'conn-ok', userId: OWN.userId, agentId: OWN.agentId, status: 'active', ownerEmail: 'a@x.io' }],
    workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
      { toolType: 'google_calendar', connectionId: 'conn-ok', extra: { enabledChannels: { chatWidget: false } } },
    ]) }],
  })
  const result = await quiet(() =>
    loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget')
  )
  assert.equal(result.clients.size, 0, '채널이 꺼졌는데 tool 이 로드됐다')
  assert.deepEqual(result.failedTools, [], '정상 설정이 실패로 보고됐다')
})

test('Data Sheets: sheetId is scoped by agentId (blocks node data injection)', async () => {
  const { DataSheetsNodeExecutor } = await import('./workflow/nodes/data-sheets')
  const calls: Array<Record<string, any>> = []
  const prisma: any = {
    dataSheet: { findFirst: async (a: any) => { calls.push(a.where); return null } },
  }
  const node: any = { id: 'ds', type: 'dataSheets', data: { sheetId: 'sheet-victim', operation: 'read' } }

  const result: any = await quiet(() =>
    new DataSheetsNodeExecutor().execute(node, { ...OWN, message: '' } as any, prisma)
  )
  assert.equal(result.debug?.status, 'error')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { id: 'sheet-victim', kind: 'agent', agentId: OWN.agentId })
})

test('Data Sheets: does no DB query at all when agentId is empty', async () => {
  const { DataSheetsNodeExecutor } = await import('./workflow/nodes/data-sheets')
  let called = 0
  const prisma: any = { dataSheet: { findFirst: async () => { called++; return null } } }
  const node: any = { id: 'ds', type: 'dataSheets', data: { sheetId: 's1', operation: 'read' } }

  const result: any = await quiet(() =>
    new DataSheetsNodeExecutor().execute(node, { agentId: '', userId: OWN.userId, message: '' } as any, prisma)
  )
  assert.equal(result.debug?.status, 'error')
  assert.match(String(result.debug?.error), /Missing agentId/)
  assert.equal(called, 0, 'agentId 없이 조회가 나갔다')
})

test('While ForEach: the temp storage query is scoped by agentId', async () => {
  const { WhileLoopExecutor } = await import('./workflow/nodes/while')
  const seen: Array<Record<string, any>> = []
  const prisma: any = {
    workflowTempStorage: { findFirst: async (a: any) => { seen.push(a.where); return null } },
  }
  const nodes: any[] = [{ id: 'w', type: 'while', data: { loopMode: 'while', maxIterations: 1, condition: 'false' } }]
  const executor = new WhileLoopExecutor(prisma, nodes, [], (async () => ({ context: {} })) as any, (n: any) => n?.type ?? null)

  await quiet(() => executor.executeLoop(nodes[0], {
    ...OWN, message: '', conversationId: 'conv-victim',
  } as any))

  assert.equal(seen.length, 1, 'loadJsonDataFromTempStorage 경로를 안 탔다 — 테스트가 무의미해진다')
  assert.deepEqual(seen[0], {
    conversationId: 'conv-victim',
    agentId: OWN.agentId,
    status: { in: ['pending', 'waiting'] },
  })
})

test('While ForEach: does no temp storage query at all when conversationId is empty', async () => {
  const { WhileLoopExecutor } = await import('./workflow/nodes/while')
  let called = 0
  const prisma: any = { workflowTempStorage: { findFirst: async () => { called++; return null } } }
  const nodes: any[] = [{ id: 'w', type: 'while', data: { loopMode: 'while', maxIterations: 1, condition: 'false' } }]
  const executor = new WhileLoopExecutor(prisma, nodes, [], (async () => ({ context: {} })) as any, (n: any) => n?.type ?? null)

  await quiet(() => executor.executeLoop(nodes[0], { ...OWN, message: '' } as any))
  assert.equal(called, 0, 'conversationId 없이 조회가 나갔다 — 남의 행이 잡힌다')
})

test('loadAgentAppsTools: surfaces tools that failed to load as failedTools', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const prisma = makePrisma({
    connections: [],
    workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
      { toolType: 'sendgrid', connectionId: 'conn-x' },
      { toolType: 'telegram', connectionId: '' },
    ]) }],
  })

  const result = await quiet(() =>
    loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget')
  )
  assert.equal(result.clients.size, 0)
  assert.ok(result.failedTools.length >= 2, `failedTools 가 비었다: ${JSON.stringify(result.failedTools)}`)
  assert.ok(result.failedTools.some((f) => f.toolType === 'sendgrid'), '초기화 실패가 안 담겼다')
  assert.ok(result.failedTools.some((f) => f.toolType === 'telegram'), '사전 스킵이 안 담겼다')

  //    (docs/security/log_scope.md §7.1).
  //
  const PII = 'victim@example.com'
  const poisoned = makePrisma({
    connections: [],
    workflows: [{ workflowId: 'wf-2', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
      { toolType: 'sendgrid', connectionId: 'conn-x' },
    ]) }],
  })
  poisoned.client.workflowConnection.findFirst = async () => {
    const e: any = new Error(`Invalid \`prisma.workflowConnection.findFirst()\` invocation: where: { email: "${PII}" }`)
    e.name = 'PrismaClientValidationError'
    e.code = 'P2009'
    throw e
  }

  const poisonedResult = await quiet(() =>
    loadAgentAppsTools(poisoned.client, OWN.agentId, OWN.userId, 'wf-2', 'chat_widget')
  )
  const serialized = JSON.stringify(poisonedResult.failedTools)
  assert.ok(
    !serialized.includes(PII) && !serialized.includes('prisma.workflowConnection'),
    `failedTools.reason 에 예외 메시지 원문이 실렸다: ${serialized}`
  )
})

test('loadAgentAppsTools: loads only the tools of the AI node specified by the caller (workflow_ai_tools.md)', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const twoAiNodes = JSON.stringify({
    nodes: [
      { id: 'ai-first', type: 'ai', data: { nodeType: 'ai' } },
      { id: 'tool-sg', type: 'tool', data: { toolType: 'sendgrid', connectionId: 'conn-sg' } },
      { id: 'ai-second', type: 'ai', data: { nodeType: 'ai' } },
      { id: 'tool-tg', type: 'tool', data: { toolType: 'telegram', connectionId: 'conn-tg' } },
    ],
    edges: [
      { source: 'ai-first', sourceHandle: 'tools', target: 'tool-sg' },
      { source: 'ai-second', sourceHandle: 'tools', target: 'tool-tg' },
    ],
  })
  const wfRow = { workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: twoAiNodes }

  const noHint = makePrisma({ workflows: [wfRow] })
  await quiet(() => loadAgentAppsTools(noHint.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget'))
  assert.deepEqual(
    noHint.calls.filter((c) => c.model === 'workflowConnection').map((c) => c.where.id),
    ['conn-sg'],
  )

  const hinted = makePrisma({ workflows: [wfRow] })
  await quiet(() => loadAgentAppsTools(hinted.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget', 'ai-second'))
  assert.deepEqual(
    hinted.calls.filter((c) => c.model === 'workflowConnection').map((c) => c.where.id),
    ['conn-tg'],
    '지정한 AI 노드가 아니라 배열 첫 노드의 tool 을 읽었다',
  )

  const missing = makePrisma({ workflows: [wfRow] })
  const r = await quiet(() => loadAgentAppsTools(missing.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget', 'ai-gone'))
  assert.equal(r.clients.size, 0)
  assert.equal(missing.calls.filter((c) => c.model === 'workflowConnection').length, 0, '매칭 실패인데 다른 노드로 폴백했다')

  const none = makePrisma({ workflows: [wfRow] })
  const rNone = await quiet(() => loadAgentAppsTools(none.client, OWN.agentId, OWN.userId, 'wf-1', 'pstn', null))
  assert.equal(rNone.clients.size, 0)
  assert.equal(rNone.definitions.length, 0)
  assert.equal(none.calls.filter((c) => c.model === 'workflowConnection').length, 0, 'null 인데 배열 첫 AI 노드로 폴백했다')
})

test('loadAgentAppsTools: no capacity rule remains when all multi-calendars fail', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const prisma = makePrisma({
    connections: [],
    accounts: [],
    workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: JSON.stringify({
      nodes: [
        { id: 'ai-1', type: 'ai', data: { nodeType: 'ai' } },
        { id: 'c1', type: 'tool', data: { toolType: 'google_calendar', connectionId: 'conn-x', capacityMode: 'simple', simpleCapacity: 4 } },
        { id: 'c2', type: 'tool', data: { toolType: 'google_calendar', connectionId: 'conn-y', capacityMode: 'tables' } },
      ],
      edges: [
        { source: 'ai-1', sourceHandle: 'tools', target: 'c1' },
        { source: 'ai-1', sourceHandle: 'tools', target: 'c2' },
      ],
    }) }],
  })

  const result = await quiet(() =>
    loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget')
  )
  assert.equal(result.multiCalendar, undefined, 'dispatcher 가 노출되면 안 된다')
  assert.equal(result.hasCapacityCalendar, false, '캘린더가 하나도 없는데 capacity 룰이 남았다')
})

test('MultiCalendarDispatcher: throws if all fail (no exposing an empty roster)', async () => {
  const { MultiCalendarDispatcher } = await import('./workflow/tools/multi-calendar-dispatcher')
  const prisma = makePrisma({ connections: [], accounts: [] })
  const dispatcher = new MultiCalendarDispatcher()
  await assert.rejects(
    () => quiet(() =>
      dispatcher.initializeMulti(prisma.client, OWN, [
        { nodeId: 'n1', toolType: 'google_calendar', connectionId: 'conn-x', label: 'A', nodeData: {} },
        { nodeId: 'n2', toolType: 'google_calendar', connectionId: 'conn-y', label: 'B', nodeData: {} },
      ], '')
    ),
    /all 2 calendars failed/
  )
})

test('loadAgentAppsTools: tools are not loaded if the workflow has someone else\'s connectionId embedded', async () => {
  const { loadAgentAppsTools } = await import('./workflow/tools/load-agent-tools')
  const prisma = makePrisma({
    connections: [
      { id: 'conn-victim', userId: 'user-victim', agentId: 'agent-victim', provider: 'sendgrid', status: 'active', encryptedToken: 'E', serviceConfig: '{}' },
    ],
    workflows: [{ workflowId: 'wf-1', agentId: OWN.agentId, status: 'production', workflowJson: workflowJsonWithTools([
      { toolType: 'sendgrid', connectionId: 'conn-victim' },
    ]) }],
  })

  const result = await quiet(() =>
    loadAgentAppsTools(prisma.client, OWN.agentId, OWN.userId, 'wf-1', 'chat_widget')
  )
  assert.equal(result.clients.size, 0, '남의 커넥션으로 tool 이 로드됐다')
  assert.equal(result.definitions.length, 0)
  assert.equal(prisma.calls.find((c) => c.model === 'workflowConnection')?.matched, false)
})
