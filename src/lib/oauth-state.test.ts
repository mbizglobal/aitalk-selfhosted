import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-oauth-state'

import { signOauthState, verifyOauthState, resolveOauthRequester } from './oauth-state'
import { linkOauthAccountOwnedBy } from './oauth-account-link'

// ========================================
// ========================================

test('round trip: the signed payload comes back unchanged', () => {
  const state = signOauthState({ agentId: 'agent_abc', userId: 'user_1' })
  const out = verifyOauthState<{ agentId: string; userId: string }>(state)
  assert.equal(out?.agentId, 'agent_abc')
  assert.equal(out?.userId, 'user_1')
  assert.equal(typeof out?.exp, 'number')
})

test('body tampering: swapping agentId is rejected', () => {
  const state = signOauthState({ agentId: 'agent_mine', userId: 'user_1' })
  const sig = state.slice(state.lastIndexOf('.') + 1)
  const forgedBody = Buffer.from(
    JSON.stringify({ agentId: 'agent_victim', userId: 'user_1', exp: Date.now() + 60_000 })
  ).toString('base64url')

  assert.equal(verifyOauthState(`${forgedBody}.${sig}`), null)
})

test('signature tampering: changing a single character of the signature is rejected', () => {
  const state = signOauthState({ agentId: 'agent_abc', userId: 'user_1' })
  const dot = state.lastIndexOf('.')
  const body = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)

  assert.equal(verifyOauthState(`${body}.${flipped}`), null)
})

test('signature of wrong length: returns null without throwing', () => {
  const state = signOauthState({ agentId: 'agent_abc', userId: 'user_1' })
  const body = state.slice(0, state.lastIndexOf('.'))

  assert.equal(verifyOauthState(`${body}.AAAA`), null)
})

test('no separator or empty part: rejected', () => {
  assert.equal(verifyOauthState('nodot'), null)
  assert.equal(verifyOauthState('.onlysig'), null)
  assert.equal(verifyOauthState('onlybody.'), null)
  assert.equal(verifyOauthState(''), null)
})

test('plain base64 state: the old format does not pass', () => {
  const legacy = Buffer.from(JSON.stringify({ agentId: 'agent_abc', userId: 'user_1' })).toString('base64')
  assert.equal(verifyOauthState(legacy), null)
})

test('expiry: rejected after the TTL (10 minutes)', () => {
  mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 })
  try {
    const state = signOauthState({ agentId: 'agent_abc', userId: 'user_1' })
    assert.notEqual(verifyOauthState(state), null, '발급 직후에는 유효해야 한다')

    mock.timers.tick(10 * 60_000 + 1)
    assert.equal(verifyOauthState(state), null, 'TTL 초과분은 거부되어야 한다')
  } finally {
    mock.timers.reset()
  }
})

// ========================================
// ========================================

const OWNER = 'user_owner'
const OTHER = 'user_other'

test('verdict: normal round trip passes when the issuer completes with their own session', () => {
  const state = signOauthState({ agentId: 'agent_a', userId: OWNER })
  const r = resolveOauthRequester(state, OWNER)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.agentId, 'agent_a')
  assert.equal(r.ok && r.userId, OWNER)
})

test('🔴 verdict: extra fields come back unchanged as signedPayload', () => {
  const state = signOauthState({
    agentId: 'agent_a',
    userId: OWNER,
    type: 'imap',
    purpose: 'microsoft-email',
  })
  const r = resolveOauthRequester(state, OWNER)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.signedPayload.purpose, 'microsoft-email')
  assert.equal(r.ok && r.signedPayload.type, 'imap')
  assert.equal(r.ok && r.signedPayload.agentId, 'agent_a')
  assert.equal(r.ok && r.signedPayload.userId, OWNER)
})

test('🔴 verdict: signedPayload only means signed; shape validation covers agentId and userId only', () => {
  const state = signOauthState({
    agentId: 'agent_a',
    userId: OWNER,
    type: { evil: true },
    purpose: 12345,
  })
  const r = resolveOauthRequester(state, OWNER)
  assert.equal(r.ok, true, 'agentId·userId 가 멀쩡하면 부가 필드 모양은 판정에 영향이 없다')
  assert.deepEqual(r.ok && r.signedPayload.type, { evil: true })
  assert.equal(r.ok && r.signedPayload.purpose, 12345)
})

test('🔴 verdict: phishing direction; completing someone else\'s signed state with my session is rejected', () => {
  const attackerState = signOauthState({ agentId: 'agent_attacker', userId: OTHER })
  const r = resolveOauthRequester(attackerState, OWNER)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'session_mismatch')
})

test('verdict: no session is rejected (a browser that is not logged in completing the callback)', () => {
  const state = signOauthState({ agentId: 'agent_a', userId: OWNER })
  for (const s of [null, undefined, '']) {
    const r = resolveOauthRequester(state, s)
    assert.equal(!r.ok && r.reason, 'session_mismatch', `sessionUserId=${String(s)}`)
  }
})

test('verdict: missing, forged or expired state is invalid_state', () => {
  assert.equal(resolveOauthRequester(null, OWNER).ok, false)
  assert.equal(resolveOauthRequester('', OWNER).ok, false)
  const legacy = Buffer.from(JSON.stringify({ agentId: 'a', userId: OWNER })).toString('base64')
  const r = resolveOauthRequester(legacy, OWNER)
  assert.equal(!r.ok && r.reason, 'invalid_state')
})

test('🔴 verdict: valid signature but wrong payload shape is invalid_state', () => {
  for (const bad of [
    {},
    { agentId: 'a' },
    { userId: OWNER },
    { agentId: '', userId: OWNER },
    { agentId: 'a', userId: '' },
    { agentId: 123, userId: OWNER },
    { agentId: 'a', userId: { toString: 'x' } },
  ]) {
    const r = resolveOauthRequester(signOauthState(bad as any), OWNER)
    assert.equal(!r.ok && r.reason, 'invalid_state', JSON.stringify(bad))
  }
})

// ========================================
// ========================================

function accountMock(rows: Array<Record<string, any>>) {
  const calls: string[] = []
  const api = {
    calls,
    rows,
    async update({ where, data }: any) {
      calls.push('update')
      const k = where.provider_providerAccountId
      const row = rows.find(
        (r) =>
          r.provider === k.provider &&
          r.providerAccountId === k.providerAccountId &&
          (where.userId === undefined || r.userId === where.userId)
      )
      if (!row) {
        const e: any = new Error('An operation failed because it depends on one or more records that were required but not found.')
        e.code = 'P2025'
        throw e
      }
      Object.assign(row, data)
      return { id: row.id }
    },
    async create({ data }: any) {
      calls.push('create')
      const dup = rows.find(
        (r) => r.provider === data.provider && r.providerAccountId === data.providerAccountId
      )
      if (dup) {
        const e: any = new Error('Unique constraint failed on the fields: (`provider`,`providerAccountId`)')
        e.code = 'P2002'
        throw e
      }
      const row = { id: `acc_${rows.length + 1}`, ...data }
      rows.push(row)
      return { id: row.id }
    },
    async findUnique({ where }: any) {
      calls.push('findUnique')
      const k = where.provider_providerAccountId
      const row = rows.find(
        (r) => r.provider === k.provider && r.providerAccountId === k.providerAccountId
      )
      return row ? { userId: row.userId } : null
    },
  }
  return api
}

test('binding: creates the row if absent and returns accountId', async () => {
  const m = accountMock([])
  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { access_token: 'T' },
  })
  assert.equal(r.ok, true)
  assert.equal(m.rows.length, 1)
  assert.equal(m.rows[0].userId, OWNER)
})

test('binding: updates if the row is mine (does not attempt create)', async () => {
  const m = accountMock([{ id: 'acc_1', provider: 'google', providerAccountId: 'sub_1', userId: OWNER }])
  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { access_token: 'NEW' },
  })
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.accountId, 'acc_1')
  assert.equal((m.rows[0] as any).access_token, 'NEW')
  assert.equal(m.calls.includes('create'), false)
})

test('🔴 binding: ownership and identifier fields cannot be overwritten on the update path either', async () => {
  const m = accountMock([
    { id: 'acc_1', provider: 'google', providerAccountId: 'sub_1', userId: OWNER, type: 'oauth' },
  ])
  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google',
    providerAccountId: 'sub_1',
    userId: OWNER,
    tokens: {
      access_token: 'T',
      userId: OTHER, provider: 'evil', providerAccountId: 'sub_evil', type: 'hijack', id: 'acc_x',
    } as any,
  })
  assert.equal(r.ok, true)
  const row = m.rows[0] as any
  assert.equal(row.access_token, 'T', '허용 필드는 갱신되어야 한다')
  assert.equal(row.userId, OWNER)
  assert.equal(row.provider, 'google')
  assert.equal(row.providerAccountId, 'sub_1')
  assert.equal(row.type, 'oauth')
  assert.equal(row.id, 'acc_1')
})

test('🔴 binding: ownership and identifier fields cannot be overwritten on the create path either', async () => {
  const m = accountMock([])
  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google',
    providerAccountId: 'sub_1',
    userId: OWNER,
    tokens: { access_token: 'T', userId: OTHER, provider: 'evil', type: 'hijack' } as any,
  })
  assert.equal(r.ok, true)
  const row = m.rows[0] as any
  assert.equal(row.userId, OWNER)
  assert.equal(row.provider, 'google')
  assert.equal(row.type, 'oauth')
})

test('🔴 binding: concurrent requests from the same user are not rejected as a conflict', async () => {
  const m = accountMock([])
  const origCreate = m.create.bind(m)
  let raced = false
  ;(m as any).create = async (args: any) => {
    if (!raced) {
      raced = true
      m.rows.push({ id: 'acc_first', provider: 'google', providerAccountId: 'sub_1', userId: OWNER } as any)
    }
    return origCreate(args)
  }

  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { access_token: 'T' },
  })
  assert.equal(r.ok, true, '정상 사용자를 충돌로 막으면 안 된다')
  assert.equal(r.ok && r.accountId, 'acc_first')
  assert.equal((m.rows[0] as any).access_token, 'T', '이긴 행이 내 토큰으로 갱신되어야 한다')
})

test('🔴 binding: another owner\'s row is neither updated nor taken over', async () => {
  const before = { id: 'acc_1', provider: 'google', providerAccountId: 'sub_1', userId: OTHER, access_token: 'OLD' }
  const m = accountMock([before as any])
  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { access_token: 'STOLEN' },
  })
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'owned_by_other')
  assert.equal((m.rows[0] as any).userId, OTHER)
  assert.equal((m.rows[0] as any).access_token, 'OLD')
  assert.equal(m.rows.length, 1)
})

test('🔴 binding: TOCTOU; even if someone else creates it first after the lookup, the unique constraint blocks it', async () => {
  const m = accountMock([])
  const origCreate = m.create.bind(m)
  let raced = false
  ;(m as any).create = async (args: any) => {
    if (!raced) {
      raced = true
      m.rows.push({ id: 'acc_race', provider: 'google', providerAccountId: 'sub_1', userId: OTHER } as any)
    }
    return origCreate(args)
  }

  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { access_token: 'T' },
  })
  assert.equal(r.ok, false, '경쟁에서 진 요청은 결속하면 안 된다')
  assert.equal(m.rows.length, 1)
  assert.equal((m.rows[0] as any).userId, OTHER)
})

test('🔴 binding: delete race; does not misjudge as "already another account" and recreates', async () => {
  const m = accountMock([])
  const origCreate = m.create.bind(m)
  let phase = 0
  ;(m as any).create = async (args: any) => {
    phase++
    if (phase === 1) {
      m.rows.push({ id: 'acc_ghost', provider: 'google', providerAccountId: 'sub_1', userId: OTHER } as any)
      try {
        return await origCreate(args)
      } finally {
        m.rows.length = 0
      }
    }
    return origCreate(args)
  }

  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { access_token: 'T' },
  })
  assert.equal(r.ok, true, '소유자가 사라졌으면 내 것으로 만들 수 있어야 한다')
  assert.equal((m.rows[0] as any).userId, OWNER)
})

test('binding: when the other owner is stable, judges immediately without wasting attempts', async () => {
  const m = accountMock([{ id: 'acc_1', provider: 'google', providerAccountId: 'sub_1', userId: OTHER } as any])
  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { access_token: 'T' },
  })
  assert.equal(!r.ok && r.reason, 'owned_by_other')
  assert.equal(m.calls.filter((c) => c === 'create').length, 1, 'create 를 반복 시도하면 안 된다')
})

test('🔴 binding: if the race does not settle, ends as transient rather than owned_by_other', async () => {
  const m = accountMock([])
  let creates = 0
  let updates = 0
  const origUpdate = m.update.bind(m)
  ;(m as any).update = async (args: any) => {
    updates++
    return origUpdate(args)
  }
  ;(m as any).create = async () => {
    creates++
    const e: any = new Error('Unique constraint failed')
    e.code = 'P2002'
    throw e
  }
  ;(m as any).findUnique = async () => null

  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { access_token: 'T' },
  })
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'transient_conflict', '소유자 문제로 단정하면 안 된다')
  assert.equal(creates, 3, 'create 는 정확히 MAX_ATTEMPTS 회')
  assert.equal(updates, 3, 'update 도 회차마다 한 번')
})

test('binding: exceptions other than P2002 are not swallowed', async () => {
  const m = accountMock([])
  ;(m as any).create = async () => {
    const e: any = new Error('connection lost')
    e.code = 'P1001'
    throw e
  }
  await assert.rejects(
    () => linkOauthAccountOwnedBy(m as any, {
      provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: {},
    }),
    /connection lost/
  )
})

test('🔴 binding: passing userId through tokens does not change the owner', async () => {
  const m = accountMock([{ id: 'acc_1', provider: 'google', providerAccountId: 'sub_1', userId: OTHER } as any])
  const r = await linkOauthAccountOwnedBy(m as any, {
    provider: 'google', providerAccountId: 'sub_1', userId: OWNER, tokens: { userId: OWNER } as any,
  })
  assert.equal(r.ok, false)
  assert.equal((m.rows[0] as any).userId, OTHER)
})

// ========================================
// ========================================

const ROUTES = [
  'src/app/api/storage/sharepoint/authorize/route.ts',
  'src/app/api/storage/sharepoint/callback/route.ts',
  'src/app/api/storage/google-drive/authorize/route.ts',
  'src/app/api/storage/google-drive/callback/route.ts',
  'src/app/api/auth/microsoft-email/connect/route.ts',
  'src/app/api/auth/callback/microsoft-email/route.ts',
]

const ISSUERS = new Set([
  'src/app/api/storage/sharepoint/authorize/route.ts',
  'src/app/api/storage/google-drive/authorize/route.ts',
  'src/app/api/auth/microsoft-email/connect/route.ts',
])

const CALLBACKS = [
  'src/app/api/storage/sharepoint/callback/route.ts',
  'src/app/api/storage/google-drive/callback/route.ts',
  'src/app/api/auth/callback/microsoft-email/route.ts',
]

const ACCOUNT_CALLBACKS = [
  'src/app/api/storage/sharepoint/callback/route.ts',
  'src/app/api/storage/google-drive/callback/route.ts',
]

for (const rel of ROUTES) {
  test(`route contract: ${rel}`, () => {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n')

    assert.equal(
      /Buffer\.from\(\s*state\s*,/.test(code),
      false,
      '서명 없는 state 디코딩이 돌아왔다'
    )
    assert.equal(
      /Buffer\.from\(\s*JSON\.stringify\(/.test(code),
      false,
      '서명 없는 state 발급이 돌아왔다'
    )

    const helper = ISSUERS.has(rel) ? 'signOauthState' : 'resolveOauthRequester'
    assert.ok(
      new RegExp(`${helper}\\s*(<[^>]*>)?\\s*\\(`).test(code),
      `${helper}() 호출이 없다`
    )

    assert.ok(
      /agent\.userId\s*!==/.test(code),
      'agent 소유권 대조가 없다'
    )
  })
}

test('route contract: the callback actually uses the verdict as a gate', () => {
  for (const rel of CALLBACKS) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
    assert.ok(src.includes('getServerSession'), `${rel}: 세션 확인이 없다`)
    assert.ok(
      /resolveOauthRequester\(\s*state\s*,\s*session\?\.user\?\.id\s*\)/.test(src),
      `${rel}: 세션을 판정에 넘기지 않는다`
    )
    assert.ok(/if\s*\(\s*!requester\.ok\s*\)/.test(src), `${rel}: 판정 실패를 게이트로 쓰지 않는다`)
    assert.ok(/const agentId = requester\.agentId/.test(src), `${rel}: agentId 출처가 판정 결과가 아니다`)
    assert.ok(
      /requester\.reason === 'session_mismatch'\s*\?\s*'session_mismatch'\s*:\s*'invalid_state'/.test(src),
      `${rel}: session_mismatch/invalid_state 매핑이 아니다`
    )
  }
})

test('🔴 route contract: the Account binding callback is written only through the atomic helper', () => {
  for (const rel of ACCOUNT_CALLBACKS) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
    assert.ok(src.includes('linkOauthAccountOwnedBy('), `${rel}: 원자적 결속 헬퍼를 안 쓴다`)
    assert.ok(/if\s*\(\s*!linked\.ok\s*\)/.test(src), `${rel}: 결속 실패를 게이트로 쓰지 않는다`)
    assert.equal(
      /prisma\.account\.(upsert|update|updateMany|create)\s*\(/.test(src),
      false,
      `${rel}: Account 직접 쓰기가 돌아왔다`
    )
    assert.ok(
      /linked\.reason === 'owned_by_other'\s*\?\s*'account_already_linked'\s*:\s*'link_retry'/.test(src),
      `${rel}: owned_by_other→account_already_linked / transient→link_retry 매핑이 아니다`
    )
  }
})

test('🔒 route contract: Microsoft Email has a flow identifier and owner normalization', () => {
  const connect = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/auth/microsoft-email/connect/route.ts'), 'utf-8'
  )
  const callback = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/auth/callback/microsoft-email/route.ts'), 'utf-8'
  )

  const connectAst = ts.createSourceFile('c.ts', connect, ts.ScriptTarget.Latest, true)
  const callbackAst = ts.createSourceFile('cb.ts', callback, ts.ScriptTarget.Latest, true)

  function argObjects(root: ts.SourceFile, matches: (calleeText: string) => boolean) {
    const out: ts.ObjectLiteralExpression[] = []
    const walk = (n: ts.Node) => {
      if (ts.isCallExpression(n) && matches(n.expression.getText())) {
        for (const a of n.arguments) if (ts.isObjectLiteralExpression(a)) out.push(a)
      }
      ts.forEachChild(n, walk)
    }
    walk(root)
    return out
  }

  function topLevelProp(obj: ts.ObjectLiteralExpression, name: string) {
    return obj.properties.find((p) => {
      if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) return false
      return p.name?.getText() === name
    })
  }

  const signArgs = argObjects(connectAst, (t) => t === 'signOauthState')
  assert.equal(signArgs.length, 1, 'connect: signOauthState 호출이 정확히 1개가 아니다')
  const purposeProp = topLevelProp(signArgs[0], 'purpose')
  assert.ok(purposeProp, 'connect: 서명 payload 에 흐름 식별자(purpose)가 없다')
  assert.ok(
    ts.isPropertyAssignment(purposeProp!) && purposeProp!.initializer.getText() === "'microsoft-email'",
    'connect: purpose 값이 microsoft-email 이 아니다'
  )

  const getBodyOfGet = (root: ts.SourceFile): ts.Node | undefined => {
    let body: ts.Node | undefined
    const walk = (n: ts.Node) => {
      if (
        ts.isFunctionDeclaration(n) &&
        n.name?.getText() === 'GET' &&
        n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) body = n.body
      if (
        ts.isVariableDeclaration(n) && n.name.getText() === 'GET' && n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) &&
        ts.isVariableStatement(n.parent?.parent) &&
        n.parent.parent.parent === root &&
        n.parent.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) body = n.initializer.body
      ts.forEachChild(n, walk)
    }
    walk(root)
    return body
  }
  const getBody = getBodyOfGet(callbackAst)
  assert.ok(getBody, 'callback: exported GET 함수를 찾지 못했다 — 검사 범위를 다시 볼 것')

  const walkOwnFlow = (root: ts.Node, visit: (n: ts.Node) => void) => {
    const step = (n: ts.Node) => {
      if (n !== root && ts.isFunctionLike(n)) return
      visit(n)
      ts.forEachChild(n, step)
    }
    step(root)
  }

  const isUnconditional = (node: ts.Node, root: ts.Node) => {
    for (let p = node.parent; p && p !== root; p = p.parent) {
      if (ts.isFunctionLike(p)) return false
      if (
        ts.isIfStatement(p) || ts.isCatchClause(p) ||
        ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) ||
        ts.isWhileStatement(p) || ts.isDoStatement(p) ||
        ts.isSwitchStatement(p) || ts.isConditionalExpression(p)
      ) return false
    }
    return true
  }

  let tokenExchangePos = Infinity
  walkOwnFlow(getBody!, (n) => {
    if (ts.isCallExpression(n) && n.expression.getText() === 'fetch') {
      const first = n.arguments[0]?.getText() ?? ''
      if (first.includes('oauth2/v2.0/token')) tokenExchangePos = Math.min(tokenExchangePos, n.pos)
    }
  })
  assert.notEqual(tokenExchangePos, Infinity, 'callback: 토큰 교환 호출을 찾지 못했다')

  let purposeGate = false
  walkOwnFlow(getBody!, (n) => {
    if (ts.isIfStatement(n)) {
      const cond = n.expression
      const isCompare =
        ts.isBinaryExpression(cond) &&
        cond.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
        cond.left.getText() === 'requester.signedPayload.purpose' &&
        cond.right.getText() === "'microsoft-email'"
      const bodyReturns = (() => {
        const b = n.thenStatement
        if (ts.isReturnStatement(b)) return true
        return ts.isBlock(b) && b.statements.some((s) => ts.isReturnStatement(s))
      })()
      if (isCompare && bodyReturns && n.pos < tokenExchangePos && isUnconditional(n, getBody!)) purposeGate = true
    }
  })
  assert.ok(
    purposeGate,
    'callback: 흐름 식별자 비교가 GET 본문 안에서 «토큰 교환보다 앞선 조기 반환 게이트»로 쓰이지 않는다'
  )

  assert.equal(
    /verifyOauthState\s*(<[^>]*>)?\s*\(/.test(callback),
    false,
    'callback: state 를 두 번 검증한다 — 만료 경계에서 정상 사용자가 차단된다'
  )

  const rejectsUnknownType = (root: ts.Node, sideEffect: (t: string) => boolean) => {
    let typeFromParser = false
    let rejectPos = Infinity
    let sideEffectPos = Infinity
    walkOwnFlow(root, (n) => {
      if (
        ts.isVariableDeclaration(n) && n.name.getText() === 'type' &&
        n.initializer?.getText().includes('parseMicrosoftEmailConnectType(')
      ) typeFromParser = true
      if (ts.isCallExpression(n) && sideEffect(n.expression.getText())) {
        sideEffectPos = Math.min(sideEffectPos, n.pos)
      }
      if (ts.isIfStatement(n) && n.expression.getText() === '!type') {
        const b = n.thenStatement
        const returns = ts.isReturnStatement(b) || (ts.isBlock(b) && b.statements.some(ts.isReturnStatement))
        if (returns && isUnconditional(n, root)) rejectPos = Math.min(rejectPos, n.pos)
      }
    })
    assert.notEqual(sideEffectPos, Infinity, '첫 부작용 호출을 찾지 못했다 — 검사 범위를 다시 볼 것')
    return typeFromParser && rejectPos < sideEffectPos
  }

  const connectGetBody = getBodyOfGet(connectAst)
  assert.ok(connectGetBody, 'connect: exported GET 함수를 찾지 못했다')
  assert.ok(
    rejectsUnknownType(connectGetBody!, (t) => t === 'signOauthState'),
    'connect: type 이 판정 함수에서 오지 않거나, 거부가 state 발급보다 앞서지 않는다'
  )
  assert.ok(
    rejectsUnknownType(getBody!, (t) => t === 'fetch'),
    'callback: type 이 판정 함수에서 오지 않거나, 거부가 토큰 교환보다 앞서지 않는다'
  )

  let userIdFromRequester = false
  walkOwnFlow(getBody!, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText() === 'userId' &&
      n.initializer?.getText() === 'requester.userId' &&
      isUnconditional(n, getBody!)
    ) userIdFromRequester = true
  })
  assert.ok(
    userIdFromRequester,
    'callback: `userId` 가 판정 결과(requester.userId)에서 오지 않는다 — 아래 정규화 검사가 무의미해진다'
  )

  const upsertArgs: ts.ObjectLiteralExpression[] = []
  walkOwnFlow(getBody!, (n) => {
    if (ts.isCallExpression(n) && n.expression.getText() === 'prisma.workflowConnection.upsert') {
      for (const a of n.arguments) if (ts.isObjectLiteralExpression(a)) upsertArgs.push(a)
    }
  })
  assert.equal(upsertArgs.length, 2, 'callback: workflowConnection.upsert 가 2개(IMAP·SMTP)가 아니다')
  for (const [i, arg] of upsertArgs.entries()) {
    const update = topLevelProp(arg, 'update')
    assert.ok(update && ts.isPropertyAssignment(update), `upsert ${i + 1}: update 인자가 없다`)
    const updateObj = (update as ts.PropertyAssignment).initializer
    assert.ok(ts.isObjectLiteralExpression(updateObj), `upsert ${i + 1}: update 가 객체 리터럴이 아니다`)
    const userIdProp = topLevelProp(updateObj as ts.ObjectLiteralExpression, 'userId')
    assert.ok(userIdProp, `upsert ${i + 1}: update 에 소유자 정규화(userId)가 없다`)
    const assignsVerifiedOwner =
      ts.isShorthandPropertyAssignment(userIdProp!) ||
      (ts.isPropertyAssignment(userIdProp!) && userIdProp!.initializer.getText() === 'userId')
    assert.ok(
      assignsVerifiedOwner,
      `upsert ${i + 1}: update.userId 가 검증된 소유자(userId)가 아니다 — 값을 확인할 것`
    )
  }
})

test('🔴 UI contract: both Microsoft Email panels have code-to-text pairs', () => {
  const PANEL_PAIRS: Array<[code: string, key: string]> = [
    ['invalid_state', 'oauth_error_invalid_state'],
    ['session_mismatch', 'oauth_error_session_mismatch'],
  ]
  const PANELS = [
    'src/app/app/agent-studio/components/right-panel/ImapPanel.tsx',
    'src/app/app/agent-studio/components/right-panel/SmtpPanel.tsx',
  ]

  for (const rel of PANELS) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
    for (const [code, key] of PANEL_PAIRS) {
      assert.ok(
        new RegExp(`oauthError === '${code}'\\s*\\?\\s*t\\.${key}`).test(src),
        `${rel}: '${code}' → t.${key} 짝이 아니다`
      )
    }
  }

  for (const lang of ['en', 'de', 'fr', 'ko']) {
    const src = fs.readFileSync(
      path.join(process.cwd(), `src/lib/translations/agent-studio/${lang}.ts`), 'utf-8'
    )
    for (const [, key] of PANEL_PAIRS) {
      assert.ok(src.includes(`${key}:`), `agent-studio/${lang}.ts: ${key} 번역이 없다`)
    }
  }

  const guided = new Set(PANEL_PAIRS.map(([c]) => c))
  const generic = new Set([
    'authorization_denied', 'invalid_callback',
    'token_exchange_failed', 'user_info_failed', 'callback_error',
    'agent_not_found',
  ])
  const cbSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/auth/callback/microsoft-email/route.ts'), 'utf-8'
  )
  const cbAst = ts.createSourceFile('cb2.ts', cbSrc, ts.ScriptTarget.Latest, true)
  const emitted: string[] = []
  let callCount = 0
  const collect = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === 'redirectToAgentStudio') {
      callCount++
      const first = n.arguments[0]
      if (first) {
        const leaves = (x: ts.Node): ts.Node[] => {
          if (ts.isParenthesizedExpression(x)) return leaves(x.expression)
          if (ts.isAsExpression(x) || ts.isTypeAssertionExpression(x) || ts.isSatisfiesExpression(x))
            return leaves(x.expression)
          if (ts.isConditionalExpression(x)) return [...leaves(x.whenTrue), ...leaves(x.whenFalse)]
          if (
            ts.isBinaryExpression(x) &&
            (x.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
             x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
          ) return [...leaves(x.left), ...leaves(x.right)]
          return [x]
        }
        for (const leaf of leaves(first)) {
          assert.ok(
            ts.isStringLiteral(leaf) || ts.isNoSubstitutionTemplateLiteral(leaf),
            `callback: redirectToAgentStudio 의 코드 분기 \`${leaf.getText()}\` 가 정적 문자열이 아니다 — 이 검사가 못 본다`
          )
          emitted.push((leaf as ts.StringLiteral | ts.NoSubstitutionTemplateLiteral).text)
        }
      }
    }
    ts.forEachChild(n, collect)
  }
  collect(cbAst)
  assert.ok(callCount >= 8, `callback: redirectToAgentStudio 호출 수집이 비정상이다 (${callCount})`)

  const aliasWalk = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === 'redirectToAgentStudio') {
      const p = n.parent
      const isCallee = ts.isCallExpression(p) && p.expression === n
      const isOwnDecl = ts.isFunctionDeclaration(p) && p.name === n
      assert.ok(
        isCallee || isOwnDecl,
        `callback: redirectToAgentStudio 를 호출이 아닌 자리에서 참조한다(별칭/전달) — 역방향 검사가 못 본다`
      )
    }
    ts.forEachChild(n, aliasWalk)
  }
  aliasWalk(cbAst)

  for (const code of emitted) {
    if (code === 'success') continue
    assert.ok(
      guided.has(code) || generic.has(code),
      `callback: 코드 '${code}' 를 내는데 패널 매핑에도 기존 목록에도 없다 — 문구와 번역을 같이 늘려야 한다`
    )
  }
})

const UI_ERROR_PAIRS: Array<[code: string, translationKey: string]> = [
  ['account_already_linked', 'storage_account_already_linked'],
  ['link_retry', 'storage_link_retry'],
  ['session_mismatch', 'storage_session_mismatch'],
  ['invalid_state', 'storage_invalid_state'],
]

test('🔴 UI contract: code to translation key pairs match', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/app/storage/page.tsx'), 'utf-8')

  for (const [code, key] of UI_ERROR_PAIRS) {
    assert.ok(
      new RegExp(`case '${code}':\\s*\\n\\s*errorMessage = t\\('${key}'\\)`).test(page),
      `storage/page.tsx: '${code}' → t('${key}') 짝이 아니다`
    )
  }

  for (const lang of ['en', 'de', 'fr', 'ko']) {
    const src = fs.readFileSync(
      path.join(process.cwd(), `src/lib/translations/dashboard/${lang}.ts`), 'utf-8'
    )
    for (const [, key] of UI_ERROR_PAIRS) {
      assert.ok(src.includes(`${key}:`), `${lang}.ts: ${key} 번역이 없다`)
    }
  }
})

test('🔴 UI contract: every code the route emits is registered in the UI', () => {
  const known = new Set(UI_ERROR_PAIRS.map(([c]) => c))
  const preexisting = new Set([
    'authorization_denied', 'invalid_callback', 'user_not_found',
    'token_exchange_failed', 'user_info_failed', 'callback_error',
  ])

  for (const rel of ACCOUNT_CALLBACKS) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
    const codes = [...src.matchAll(/[?&]error=([a-z_]+)/g)].map((m) => m[1])
    for (const c of codes) {
      assert.ok(
        known.has(c) || preexisting.has(c),
        `${rel}: 코드 '${c}' 를 내는데 UI_ERROR_PAIRS 에 없다 — page.tsx 와 번역도 같이 늘려야 한다`
      )
    }
  }
})
