
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  areRateLimitsEnabled,
  checkRateLimit,
  toRateLimitSettings,
  recordChatRequest,
  countRecentChatRequests,
  __resetChatRequestCounter,
  clampRateLimitCount,
  MAX_RATE_LIMIT_COUNT,
} from './rate-limit'

const settings = (over: Partial<Parameters<typeof checkRateLimit>[3]> = {}) => ({
  chatLimitCount: 0,
  chatLimitDurationMinutes: 1440,
  chatLimitMessage: 'limit',
  continuousAnswerLimit: 0,
  continuousAnswerLimitMessage: 'too fast',
  ...over,
})

const fakePrisma = (count: () => Promise<number>) =>
  ({ conversation: { count } }) as any

describe('checkRateLimit: does not swallow errors', () => {
  it('🔴 throws if the count query fails; does not pretend to pass', async () => {
    const prisma = fakePrisma(async () => {
      throw new Error('db down')
    })

    await assert.rejects(
      () => checkRateLimit(prisma, 'agent-1', 'client-1', settings({ chatLimitCount: 5 })),
      /db down/,
      '실패를 { allowed: true } 로 바꾸면 호출부가 장애 정책을 정할 수 없다',
    )
  })

  it('throws on query failure even when only the consecutive-reply limit is on', async () => {
    const prisma = fakePrisma(async () => {
      throw new Error('db down')
    })

    await assert.rejects(
      () => checkRateLimit(prisma, 'agent-1', 'client-1', settings({ continuousAnswerLimit: 3 })),
      /db down/,
    )
  })
})

describe('checkRateLimit: normal verdicts are unchanged', () => {
  it('passes without even querying when both limits are 0', async () => {
    let calls = 0
    const prisma = fakePrisma(async () => {
      calls++
      return 999
    })

    const r = await checkRateLimit(prisma, 'agent-1', 'client-1', settings())

    assert.equal(r.allowed, true)
    assert.equal(calls, 0, '제한이 꺼져 있으면 DB 를 치지 않아야 한다')
  })

  it('blocks and gives a reason when the limit is exceeded', async () => {
    const prisma = fakePrisma(async () => 5)

    const r = await checkRateLimit(prisma, 'agent-1', 'client-1', settings({ chatLimitCount: 3 }))

    assert.equal(r.allowed, false)
    assert.equal(r.reason, 'chat_limit')
    assert.ok(r.resetTime instanceof Date)
  })

  it('passes when within the limit', async () => {
    const prisma = fakePrisma(async () => 1)

    const r = await checkRateLimit(prisma, 'agent-1', 'client-1', settings({ chatLimitCount: 3 }))

    assert.equal(r.allowed, true)
  })
})

describe('toRateLimitSettings: built from an already fetched record', () => {
  it('carries the stored values as they are', () => {
    const s = toRateLimitSettings({
      chatLimitCount: 7,
      chatLimitDurationMinutes: 60,
      chatLimitMessage: 'slow down',
      continuousAnswerLimit: 2,
      continuousAnswerLimitMessage: 'wait',
    })

    assert.equal(s.chatLimitCount, 7)
    assert.equal(s.chatLimitDurationMinutes, 60)
    assert.equal(s.chatLimitMessage, 'slow down')
    assert.equal(s.continuousAnswerLimit, 2)
  })

  it('null and undefined are filled with defaults (no limit + 1-day window)', () => {
    const s = toRateLimitSettings({})

    assert.equal(s.chatLimitCount, 0)
    assert.equal(s.continuousAnswerLimit, 0)
    assert.equal(s.chatLimitDurationMinutes, 1440)
    assert.ok(s.chatLimitMessage.length > 0)
  })

  it('🔴 looking at the same record as areRateLimitsEnabled, the verdicts cannot disagree', () => {
    const agent = { chatLimitCount: 3, continuousAnswerLimit: 0 }

    assert.equal(areRateLimitsEnabled(agent), true)
    assert.equal(toRateLimitSettings(agent).chatLimitCount, 3, '같은 입력이면 같은 사실을 말해야 한다')
  })
})

describe('areRateLimitsEnabled: the reference value for the failure policy', () => {
  it('off when both are 0 (prod 16/16 is in this state)', () => {
    assert.equal(areRateLimitsEnabled({ chatLimitCount: 0, continuousAnswerLimit: 0 }), false)
  })

  it('on if either one is on', () => {
    assert.equal(areRateLimitsEnabled({ chatLimitCount: 5, continuousAnswerLimit: 0 }), true)
    assert.equal(areRateLimitsEnabled({ chatLimitCount: 0, continuousAnswerLimit: 3 }), true)
  })

  it('null and undefined fields are treated as 0', () => {
    assert.equal(areRateLimitsEnabled({ chatLimitCount: null, continuousAnswerLimit: null }), false)
    assert.equal(areRateLimitsEnabled({}), false)
    assert.equal(areRateLimitsEnabled({ chatLimitCount: null, continuousAnswerLimit: 2 }), true)
  })

  it('off if the agent does not exist at all (does not trigger fail-closed)', () => {
    assert.equal(areRateLimitsEnabled(null), false)
    assert.equal(areRateLimitsEnabled(undefined), false)
  })

  it('negative values are not treated as on (convention: 0 or below = unlimited)', () => {
    assert.equal(areRateLimitsEnabled({ chatLimitCount: -1, continuousAnswerLimit: -5 }), false)
  })
})


// ============================================================================
// ============================================================================
//
//
//

const NEVER_SAVED = fakePrisma(async () => 0)

describe('request counter: direct /api/chat calls are also counted', () => {
  it('🔴 rejects when the request count exceeds the limit even if 0 are stored', async () => {
    __resetChatRequestCounter()
    const s = settings({ chatLimitCount: 2 })

    for (let i = 0; i < 2; i++) {
      const r = await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
      assert.equal(r.allowed, true, `${i + 1}번째는 통과해야 한다`)
    }

    const blocked = await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
    assert.equal(blocked.allowed, false, '저장 0건이라고 무제한이면 안 된다')
    assert.equal(blocked.reason, 'chat_limit')
  })

  it('🔴 parallel requests cannot exceed the limit and pass (verdict and recording are atomic)', async () => {
    __resetChatRequestCounter()
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    const prisma = fakePrisma(async () => { await gate; return 0 })

    const s = settings({ chatLimitCount: 1 })
    const inflight = [1, 2, 3, 4, 5].map(() => checkRateLimit(prisma, 'a1', 'c1', s))
    release()
    const results = await Promise.all(inflight)

    const allowed = results.filter(r => r.allowed).length
    assert.equal(allowed, 1, `한도 1인데 ${allowed}건이 통과했다 — 판정과 기록 사이에 await 이 있다`)
  })

  it('rejected requests are not counted (the block must be able to lift)', async () => {
    __resetChatRequestCounter()
    const s = settings({ chatLimitCount: 1 })

    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)

    assert.equal(countRecentChatRequests('a1', 'c1', 0), 1,
      '거부된 요청까지 세면 슬라이딩 창이 계속 채워져 차단이 영영 안 풀린다')
  })

  it('a cooperative widget does not reduce the limit (max, not sum)', async () => {
    __resetChatRequestCounter()
    const savedTwo = fakePrisma(async () => 2)
    await checkRateLimit(savedTwo, 'a1', 'c1', settings({ chatLimitCount: 3 }))

    const r = await checkRateLimit(savedTwo, 'a1', 'c1', settings({ chatLimitCount: 3 }))
    assert.equal(r.allowed, true, '같은 턴을 두 번 세면 정직한 사용자만 손해를 본다')
  })

  it('requests from different visitors are not counted against each other', async () => {
    __resetChatRequestCounter()
    const s = settings({ chatLimitCount: 2 })
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)

    const r = await checkRateLimit(NEVER_SAVED, 'a1', 'c2', s)
    assert.equal(r.allowed, true)
  })

  it('without a clientId, the whole agent is counted (same meaning as the DB-side condition)', async () => {
    __resetChatRequestCounter()
    const s = settings({ chatLimitCount: 2 })
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
    await checkRateLimit(NEVER_SAVED, 'a1', 'c2', s)

    const r = await checkRateLimit(NEVER_SAVED, 'a1', null, s)
    assert.equal(r.allowed, false, '방문자별로 흩어져 있어도 에이전트 단위 판정은 합쳐 봐야 한다')
  })

  it('does not mix with other agents', async () => {
    __resetChatRequestCounter()
    const s = settings({ chatLimitCount: 2 })
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)

    const r = await checkRateLimit(NEVER_SAVED, 'a2', 'c1', s)
    assert.equal(r.allowed, true)
  })

  it('requests outside the window are not counted (sliding window)', async () => {
    __resetChatRequestCounter()
    const now = Date.now()
    recordChatRequest('a1', 'c1', now - 2 * 60 * 60 * 1000)
    recordChatRequest('a1', 'c1', now - 2 * 60 * 60 * 1000)

    const r = await checkRateLimit(
      NEVER_SAVED, 'a1', 'c1',
      settings({ chatLimitCount: 2, chatLimitDurationMinutes: 60 })
    )
    assert.equal(r.allowed, true, '지난 창의 요청이 계속 막으면 차단이 영영 안 풀린다')
  })

  it('the consecutive-reply limit (5-minute window) also looks at the request count', async () => {
    __resetChatRequestCounter()
    const s = settings({ continuousAnswerLimit: 2 })
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
    await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)

    const r = await checkRateLimit(NEVER_SAVED, 'a1', 'c1', s)
    assert.equal(r.allowed, false)
    assert.equal(r.reason, 'continuous_limit')
  })

  it('records are kept even when the limit is off (valid immediately when turned on later)', async () => {
    __resetChatRequestCounter()
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(NEVER_SAVED, 'a1', 'c1', settings())
      assert.equal(r.allowed, true)
    }
    assert.equal(countRecentChatRequests('a1', 'c1', 0), 3,
      '켠 뒤에야 기록을 시작하면 창이 빈 채로 열려 한도만큼 공짜로 통과한다')
  })
})

describe('clampRateLimitCount: does not store values the counter cannot represent', () => {
  it('🔴 clamped when over the upper bound (above it the limit becomes unreachable)', () => {
    assert.equal(clampRateLimitCount(MAX_RATE_LIMIT_COUNT + 1), MAX_RATE_LIMIT_COUNT)
    assert.equal(clampRateLimitCount(1e9), MAX_RATE_LIMIT_COUNT)
  })

  it('anything that is not a valid number becomes 0 = unlimited (does not pretend to be on)', () => {
    assert.equal(clampRateLimitCount('abc'), 0)
    assert.equal(clampRateLimitCount(undefined), 0)
    assert.equal(clampRateLimitCount(null), 0)
    assert.equal(clampRateLimitCount(Infinity), 0)
  })

  it('negative becomes 0, normal values stay, decimals are rounded down', () => {
    assert.equal(clampRateLimitCount(-5), 0)
    assert.equal(clampRateLimitCount(0), 0)
    assert.equal(clampRateLimitCount(10), 10)
    assert.equal(clampRateLimitCount('25'), 25)
    assert.equal(clampRateLimitCount(3.9), 3)
  })

  it('the upper bound itself is actually reachable (boundary)', async () => {
    __resetChatRequestCounter()
    const s = settings({ chatLimitCount: 2 })
    await checkRateLimit(NEVER_SAVED, 'edge', 'c1', s)
    await checkRateLimit(NEVER_SAVED, 'edge', 'c1', s)
    const r = await checkRateLimit(NEVER_SAVED, 'edge', 'c1', s)
    assert.equal(r.allowed, false, 'clamp 된 값이 카운터로 도달 가능해야 의미가 있다')
  })
})
