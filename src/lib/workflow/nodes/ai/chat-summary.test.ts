import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_SUMMARY_MAX_TOKENS,
  CHAT_SUMMARY_TRIGGER_TOKENS,
  MESSAGE_OVERHEAD_TOKENS,
  capChatHistoryTokens,
  clampSummaryText,
  estimateChatHistoryTokens,
  foldChatHistory,
  splitHistoryForFold,
  type ChatHistoryMessage,
} from './chat-summary'
import { estimateTokens } from '@/lib/ai-assistant/token-counter'

function assertMaximalSuffix(original: string, kept: string, budget: number) {
  const start = original.length - kept.length
  if (start === 0) return
  const oneMore = original.slice(start - 1)
  if (estimateTokens(oneMore) > budget) return

  const cut = original.charCodeAt(start - 1)
  assert.ok(
    cut >= 0xdc00 && cut <= 0xdfff,
    `최장이 아니다 — 예산 ${budget} 에 한 글자 더 들어갈 수 있었다(off-by-one)`
  )
  if (start >= 2) {
    assert.ok(
      estimateTokens(original.slice(start - 2)) > budget,
      '페어를 복원해도 예산 안이라면 가드가 필요 이상으로 버린 것이다'
    )
  }
}

const msg = (role: 'user' | 'assistant', tokens: number): ChatHistoryMessage =>
  ({ role, content: 'x'.repeat(tokens * 4) })

test('splitHistoryForFold: latest tail stays as original, only the old prefix is fold target', () => {
  const history = Array.from({ length: 6 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', 1_000))
  const { toFold, keepTail } = splitHistoryForFold(history, 3_500)

  assert.equal(keepTail.length, 3, 'tail 은 예산 안에 들어가는 최대 개수')
  assert.equal(toFold.length, 3)
  assert.deepEqual(toFold, history.slice(0, 3), 'fold = prefix')
  assert.deepEqual(keepTail, history.slice(3), 'keep = suffix')
  assert.deepEqual([...toFold, ...keepTail], history)
})

test('splitHistoryForFold: nothing to fold at or below the trigger', () => {
  const history = [msg('user', 100), msg('assistant', 200)]
  const { toFold, keepTail } = splitHistoryForFold(history, CHAT_SUMMARY_TRIGGER_TOKENS)
  assert.equal(toFold.length, 0, '전부 tail 안에 들어가면 fold 대상 0 → 요약 호출 안 함')
  assert.equal(keepTail.length, 2)
})

test('splitHistoryForFold: when a single item exceeds the budget, tail is empty and that item is the fold target', () => {
  const history = [msg('user', 5_000), msg('assistant', 100)]
  const { toFold, keepTail } = splitHistoryForFold(history, 3_500)
  assert.deepEqual(keepTail, [history[1]], '들어가는 것만 tail')
  assert.deepEqual(toFold, [history[0]])
})

test('capChatHistoryTokens: from the newest side up to the budget only (tail cap for context injection)', () => {
  const history = Array.from({ length: 5 }, () => msg('user', 1_000))
  const capped = capChatHistoryTokens(history, 2_500)
  assert.equal(capped.length, 2, '2,000 까지만 (3,000 은 초과)')
  assert.deepEqual(capped, history.slice(3), '남기는 것은 최신 쪽')
})

test('capChatHistoryTokens: if the single newest item exceeds the budget, it is truncated and included anyway', () => {
  const capped = capChatHistoryTokens([msg('user', 5_000)], 3_500)
  assert.equal(capped.length, 1, '문맥이 통째로 사라지면 안 된다')
  assert.ok(estimateTokens(capped[0].content) <= 3_500, '예산은 지켜야 한다')
  assert.equal(capped[0].role, 'user')

  const multi = capChatHistoryTokens([msg('user', 100), msg('assistant', 9_000)], 3_500)
  assert.equal(multi.length, 1)
  assert.equal(multi[0].role, 'assistant')

  assert.deepEqual(capChatHistoryTokens([msg('user', 5_000)], 0), [])
})

test('capChatHistoryTokens: truncation keeps the end (keeping the start would lose the conclusion)', () => {
  //
  const head = 'START_OF_ANSWER'
  const tail = 'THE_CONCLUSION_IS_HERE'
  const content = head + 'x'.repeat(20_000) + tail
  const [capped] = capChatHistoryTokens([{ role: 'assistant', content }], 3_500)

  const budget = 3_500 - MESSAGE_OVERHEAD_TOKENS
  assert.ok(content.endsWith(capped.content), '결과는 원문의 **suffix** 여야 한다')
  assert.ok(capped.content.endsWith(tail), '끝(결론)이 살아남아야 한다')
  assert.ok(!capped.content.includes(head), '예산을 넘겼으므로 앞부분은 잘려야 한다')
  assert.ok(content.length > capped.content.length, '실제로 잘렸는지 — 절단이 안 일어나면 무의미')
  assert.ok(estimateTokens(capped.content) <= budget, '예산(구조 비용 차감분)은 지켜야 한다')
  assertMaximalSuffix(content, capped.content, budget)
})

test('capChatHistoryTokens: suffix truncation does not split a surrogate pair in half', () => {
  //
  for (const padding of ['', 'a', 'ab', 'abc']) {
    const content = '😀'.repeat(10_000) + padding
    const [capped] = capChatHistoryTokens([{ role: 'user', content }], 1_000)
    const first = capped.content.charCodeAt(0)
    assert.ok(
      !(first >= 0xdc00 && first <= 0xdfff),
      `padding=${JSON.stringify(padding)} — lone low surrogate 로 시작하면 안 된다`
    )
    const budget = 1_000 - MESSAGE_OVERHEAD_TOKENS
    assert.ok(content.endsWith(capped.content), 'suffix 성질은 유지')
    assert.ok(estimateTokens(capped.content) <= budget, '예산은 지켜야 한다')
    assertMaximalSuffix(content, capped.content, budget)
  }
})

test('estimateChatHistoryTokens: sum of content + per-item structure cost', () => {
  assert.equal(estimateChatHistoryTokens([msg('user', 100), msg('assistant', 250)]), 350 + 2 * 4)
  assert.equal(estimateChatHistoryTokens([]), 0)
})

test('with very many short messages the structure cost dominates; counting only the content sum breaks the cap', () => {
  const many: ChatHistoryMessage[] = Array.from({ length: 2_000 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x',
  }))
  const contentOnly = many.reduce((s, m) => s + estimateTokens(m.content), 0)
  assert.ok(contentOnly <= CHAT_SUMMARY_TRIGGER_TOKENS,
    `픽스처 전제 — content 합(${contentOnly})만으로는 트리거를 넘지 않는다`)

  const estimated = estimateChatHistoryTokens(many)
  assert.ok(estimated > CHAT_SUMMARY_TRIGGER_TOKENS,
    `구조 비용 포함 추정(${estimated})은 트리거를 넘어야 접히기 시작한다`)

  const capped = capChatHistoryTokens(many, CHAT_SUMMARY_TRIGGER_TOKENS)
  assert.ok(capped.length < many.length, '2,000건 전부 통과하면 상한이 무의미')
  assert.ok(estimateChatHistoryTokens(capped) <= CHAT_SUMMARY_TRIGGER_TOKENS)
  assert.deepEqual(capped, many.slice(many.length - capped.length))
})

test('fold splitting also reflects structure cost: the tail has fewer items than by content alone', () => {
  const many: ChatHistoryMessage[] = Array.from({ length: 1_000 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x',
  }))
  const { toFold, keepTail } = splitHistoryForFold(many, CHAT_SUMMARY_TRIGGER_TOKENS)
  assert.ok(toFold.length > 0, 'content 기준이면 0이 되는 지점 — 구조 비용이 반영돼야 한다')
  assert.ok(estimateChatHistoryTokens(keepTail) <= CHAT_SUMMARY_TRIGGER_TOKENS)
  assert.deepEqual([...toFold, ...keepTail], many, '분할은 무손실')
})

test('clampSummaryText: a summary over the cap is truncated (defends against client-resent values)', () => {
  const short = 'a'.repeat(100)
  assert.equal(clampSummaryText(short, 600), short, '상한 이하는 그대로')

  const huge = 'a'.repeat(10_000)
  const clamped = clampSummaryText(huge, 600)
  assert.ok(clamped.length < huge.length)
  assert.ok(estimateTokens(clamped) <= 600)
})

test('clampSummaryText: guarantees at or below budget regardless of character makeup', () => {
  const budget = 600
  const cases: Array<[string, string]> = [
    ['전부 한글', '가'.repeat(50_000)],
    ['전부 영문', 'a'.repeat(50_000)],
    ['혼합(교대)', '가a'.repeat(25_000)],
    ['혼합(반반 연속)', '가'.repeat(25_000) + 'a'.repeat(25_000)],
    ['한글 다수 + 영문 1자', '가'.repeat(49_999) + 'a'],
    ['영문 다수 + 한글 1자', 'a'.repeat(49_999) + '가'],
  ]
  for (const [label, text] of cases) {
    const tokens = estimateTokens(clampSummaryText(text, budget))
    assert.ok(tokens <= budget, `${label}: ${tokens} 토큰 — 예산(${budget}) 이하여야 한다`)
  }
})

const stubOpenAI = (summaryText = 'folded summary') => {
  const calls: any[] = []
  const openai = {
    responses: {
      create: async (config: any) => {
        calls.push(config)
        return { output_text: summaryText }
      },
    },
  } as any
  return { openai, calls }
}

test('foldChatHistory: foldedCount matches the number of messages actually sent as API input', async () => {
  const history = Array.from({ length: 6 }, () => msg('user', 1_000))
  const { openai, calls } = stubOpenAI()

  const { toFold } = splitHistoryForFold(history)
  assert.ok(toFold.length > 0, '픽스처 전제 — fold 대상이 있어야 한다')

  const result = await foldChatHistory(openai, null, history)

  assert.ok(result, 'fold 대상이 있으면 결과가 나와야 한다')
  assert.equal(result!.foldedCount, toFold.length)
  const inputText: string = calls[0].input
  assert.equal(
    (inputText.match(/^USER: /gm) || []).length,
    toFold.length,
    'API 입력 메시지 수 = foldedCount'
  )
})

test('foldChatHistory: also parses the output array response of a reasoning model', async () => {
  const calls: any[] = []
  const openai = {
    responses: {
      create: async (config: any) => {
        calls.push(config)
        return {
          output: [
            { type: 'reasoning', summary: [] },
            { type: 'message', content: [
              { type: 'output_text', text: 'Part one. ' },
              { type: 'text', text: 'Part two.' },
            ] },
          ],
        }
      },
    },
  } as any

  const history = Array.from({ length: 6 }, () => msg('user', 1_000))
  const result = await foldChatHistory(openai, null, history)

  assert.ok(result, 'output 배열만 와도 요약을 만들어야 한다')
  assert.equal(result!.summary, 'Part one. Part two.', '조각을 순서대로 이어붙여야 한다')
  assert.equal(calls.length, 1)
})

test('foldChatHistory: a response with no text at all gives null (no empty summary is created)', async () => {
  const openai = {
    responses: {
      create: async () => ({ output: [{ type: 'reasoning', summary: [] }] }),
    },
  } as any
  const result = await foldChatHistory(openai, null, Array.from({ length: 6 }, () => msg('user', 1_000)))
  assert.equal(result, null, '빈 요약으로 covered 를 전진시키면 문맥이 사라진다')
})

test('foldChatHistory: does not call when there is nothing to fold (saves uncharged cost)', async () => {
  const { openai, calls } = stubOpenAI()
  const result = await foldChatHistory(openai, null, [msg('user', 100), msg('assistant', 200)])
  assert.equal(result, null)
  assert.equal(calls.length, 0, '트리거 이하면 LLM 을 부르지 않아야 한다')
})

test('foldChatHistory: a single large message is split into chunks and fully reflected (no loss)', async () => {
  const marker = (i: number) => `SEG${i}`
  const content = Array.from({ length: 6 }, (_, i) => marker(i) + 'x'.repeat(4 * 4_000)).join('')
  const { openai, calls } = stubOpenAI()

  const result = await foldChatHistory(openai, null, [{ role: 'user', content }, msg('assistant', 100)])

  assert.ok(result)
  assert.equal(result!.foldedCount, 1, '메시지 1건을 접은 것')
  assert.ok(calls.length > 1, `청크 순차 호출이어야 한다 (실제 ${calls.length}회)`)

  for (const [i, c] of calls.entries()) {
    const tokens = estimateTokens(c.input)
    assert.ok(tokens < 9_500, `호출 ${i + 1}: 입력 ${tokens} 토큰 — 예산(8K + wrapper) 안이어야 한다`)
  }
  const allInputs = calls.map(c => c.input).join('\n')
  for (let i = 0; i < 6; i++) {
    assert.ok(allInputs.includes(marker(i)), `구간 ${marker(i)} 이 요약 입력에서 빠졌다 = 유실`)
  }
})

test('clampSummaryText: fills the budget as much as possible (does not use only half for English)', () => {
  const budget = 600

  for (const [label, text] of [
    ['영문', 'a'.repeat(600 * 4 * 3)],
    ['한글', '가'.repeat(600 * 2 * 3)],
    ['혼합', '가a'.repeat(600 * 2)],
  ] as Array<[string, string]>) {
    const tokens = estimateTokens(clampSummaryText(text, budget))
    assert.ok(tokens <= budget, `${label}: 예산 초과 (${tokens})`)
    assert.ok(tokens >= budget - 2, `${label}: 예산을 못 채웠다 (${tokens}/${budget}) — 이분 탐색이 아니다`)
  }
})

test('clampSummaryText: 601-token English shrinks only to near 600 (prevents quality collapse)', () => {
  const text = 'a'.repeat(601 * 4)
  const tokens = estimateTokens(clampSummaryText(text, 600))
  assert.equal(tokens, 600, `601 → ${tokens} (급격히 잘리면 안 된다)`)
})

test('foldChatHistory: English in the 32K-64K range is folded normally, not as a tombstone', async () => {
  const { openai, calls } = stubOpenAI()
  const content = 'c'.repeat(4 * 40_000)
  const result = await foldChatHistory(openai, null, [
    { role: 'user', content },
    msg('assistant', 100),
  ])

  assert.ok(result, '64K 이내는 접혀야 한다')
  assert.doesNotMatch(result!.summary, /too large to summarize/i, 'tombstone 이 되면 안 된다')
  assert.ok(calls.length >= 1 && calls.length <= 8, `청크 ${calls.length}회 (상한 8 이내)`)
})

test('clampSummaryText: boundary inputs (empty string, 1 char, budget 0)', () => {
  assert.equal(clampSummaryText('', 600), '')
  assert.equal(clampSummaryText('a', 600), 'a')
  assert.equal(clampSummaryText('a'.repeat(10_000), 0), '', '예산 0 이면 빈 문자열')
  assert.ok(estimateTokens(clampSummaryText('a'.repeat(100), 1)) <= 1)
})

test('clampSummaryText: does not cut an emoji (surrogate pair) in half', () => {
  const emoji = '😀'
  const cases = [emoji.repeat(2_000), 'a' + emoji.repeat(2_000), 'ab' + emoji.repeat(2_000), 'abc' + emoji.repeat(2_000)]
  for (const text of cases) {
    for (const budget of [1, 2, 3, 7, 100, 599]) {
      const out = clampSummaryText(text, budget)
      assert.ok(estimateTokens(out) <= budget, `budget ${budget}: 예산 초과`)
      const lastCode = out.charCodeAt(out.length - 1)
      const danglingHigh = out.length > 0 && lastCode >= 0xd800 && lastCode <= 0xdbff
      assert.equal(
        danglingHigh, false,
        `prefix=${JSON.stringify(text.slice(0, 3))} budget=${budget}: 서로게이트 페어가 반쪽으로 잘렸다`
      )
    }
  }
})

test('clampSummaryText: termination and performance (the loop converges on 50K-char input)', () => {
  const cases = [
    '가'.repeat(50_000),
    'a'.repeat(50_000),
    '가a'.repeat(25_000),
    '가'.repeat(49_999) + 'a',
    'a'.repeat(49_999) + '가',
    '가'.repeat(15_999) + 'a',
  ]
  const started = Date.now()
  for (const text of cases) {
    for (const budget of [600, 8_000]) {
      assert.ok(estimateTokens(clampSummaryText(text, budget)) <= budget)
    }
  }
  assert.ok(Date.now() - started < 2_000, '50K 입력 12회가 2초 안에 끝나야 한다')
})

test('foldChatHistory: a message over the chunk cap is folded as a tombstone without the LLM', async () => {
  const { openai, calls } = stubOpenAI()
  const monstrous = 'a'.repeat(4 * 400_000)

  const result = await foldChatHistory(openai, null, [
    { role: 'user', content: monstrous },
    msg('assistant', 100),
  ])

  assert.equal(calls.length, 0, '🔴 LLM 을 한 번도 부르지 않아야 한다 (반복 비용 0)')
  assert.ok(result, 'barrier 를 남기지 않도록 접어야 한다')
  assert.equal(result!.foldedCount, 1, '그 메시지 1건만 covered')
  assert.match(result!.summary, /too large to summarize/i, '요약 불가 사실이 표식으로 남아야 한다')
  assert.ok(estimateTokens(result!.summary) <= CHAT_SUMMARY_MAX_TOKENS)
})

test('foldChatHistory: a tombstone does not erase the existing summary', async () => {
  const { openai } = stubOpenAI()
  const prev = 'Visitor asked about pricing and booked a demo for Friday.'
  const result = await foldChatHistory(openai, prev, [
    { role: 'user', content: 'a'.repeat(4 * 400_000) },
    msg('assistant', 100),
  ])
  assert.ok(result!.summary.includes('booked a demo'), '이전 요약이 유지돼야 한다')
  assert.match(result!.summary, /too large to summarize/i)
})

test('foldChatHistory: the tombstone marker stays even when the previous summary fills the cap', async () => {
  const { openai } = stubOpenAI()
  const fullSummary = 'S'.repeat(CHAT_SUMMARY_MAX_TOKENS * 4)
  const result = await foldChatHistory(openai, fullSummary, [
    { role: 'user', content: 'a'.repeat(4 * 400_000) },
    msg('assistant', 100),
  ])
  assert.ok(result)
  assert.match(result!.summary, /too large to summarize/i, '🔴 표식이 잘려 사라지면 안 된다')
  assert.ok(
    estimateTokens(result!.summary) <= CHAT_SUMMARY_MAX_TOKENS,
    '표식을 보존하면서도 주입 상한은 지켜야 한다'
  )
})

test('foldChatHistory: after a tombstone, later messages fold normally (barrier cleared)', async () => {
  const huge: ChatHistoryMessage = { role: 'user', content: 'a'.repeat(4 * 400_000) }
  const rest = Array.from({ length: 10 }, () => msg('assistant', 600))

  const first = await foldChatHistory(stubOpenAI().openai, null, [huge, ...rest])
  assert.equal(first!.foldedCount, 1)

  const { openai, calls } = stubOpenAI()
  const second = await foldChatHistory(openai, first!.summary, rest)
  assert.ok(second, 'barrier 가 사라져 접혀야 한다')
  assert.ok(second!.foldedCount >= 1)
  assert.ok(calls.length >= 1, '이번에는 실제 요약 호출이 일어난다')
})

test('foldChatHistory: within the chunk cap (large but bounded) folds normally', async () => {
  const { openai, calls } = stubOpenAI()
  const large = 'b'.repeat(4 * 20_000)
  const result = await foldChatHistory(openai, null, [
    { role: 'user', content: large },
    msg('assistant', 100),
  ])
  assert.ok(result, '상한 이내는 접혀야 한다')
  assert.equal(result!.foldedCount, 1)
  assert.ok(calls.length >= 1 && calls.length <= 8, `청크 수가 상한 이내 (실제 ${calls.length})`)
})

test('foldChatHistory: a chunk boundary does not split an emoji in half', async () => {
  const { openai, calls } = stubOpenAI()
  const content = 'a' + '😀'.repeat(30_000)
  const result = await foldChatHistory(openai, null, [
    { role: 'user', content },
    msg('assistant', 100),
  ])

  assert.ok(result)
  assert.ok(calls.length > 1, `청크가 여러 개여야 경계를 검사할 수 있다 (실제 ${calls.length})`)
  for (const [i, c] of calls.entries()) {
    const input: string = c.input
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(input)
    assert.equal(lone, false, `호출 ${i + 1}: 깨진 서로게이트가 요약 입력에 있다`)
  }
})

test('foldChatHistory: if a sequential chunk fold fails midway, nothing is folded (prevents partial-apply loss)', async () => {
  let n = 0
  const openai = {
    responses: {
      create: async () => {
        n++
        if (n === 2) throw new Error('429')
        return { output_text: 'partial' }
      },
    },
  } as any
  const content = 'x'.repeat(4 * 20_000)
  const result = await foldChatHistory(openai, null, [{ role: 'user', content }, msg('assistant', 100)])
  assert.equal(result, null, '일부만 반영한 채 covered 처리하면 나머지가 유실된다')
})

test('foldChatHistory: a huge previousSummary is also clamped', async () => {
  const bloatedSummary = 'S'.repeat(200_000)
  const history = Array.from({ length: 6 }, () => msg('user', 1_000))
  const { openai, calls } = stubOpenAI()

  await foldChatHistory(openai, bloatedSummary, history)

  const inputTokens = estimateTokens(calls[0].input)
  assert.ok(
    inputTokens < 12_000,
    `previousSummary clamp 후 입력이 유계여야 한다 (실제 ${inputTokens})`
  )
})

test('foldChatHistory: the returned summary is clamped to the injection cap', async () => {
  const history = Array.from({ length: 6 }, () => msg('user', 1_000))
  const { openai } = stubOpenAI('Z'.repeat(100_000))
  const result = await foldChatHistory(openai, null, history)
  assert.ok(estimateTokens(result!.summary) <= CHAT_SUMMARY_MAX_TOKENS)
})

test('foldChatHistory: null on LLM failure (existing summary kept, billing and consistency unchanged)', async () => {
  const openai = { responses: { create: async () => { throw new Error('429') } } } as any
  const result = await foldChatHistory(openai, 'prev', Array.from({ length: 6 }, () => msg('user', 1_000)))
  assert.equal(result, null)
})

test('🔴 liveness: even when the total is large, fold must run so covered advances', async () => {
  const huge: ChatHistoryMessage = { role: 'user', content: 'z'.repeat(400_000) }
  const rest = Array.from({ length: 4 }, () => msg('assistant', 500))
  const { openai, calls } = stubOpenAI()

  const folded = await foldChatHistory(openai, null, [huge, ...rest])

  assert.ok(folded, 'fold 가 돌아야 한다 — 막으면 covered 가 영구 정지한다')
  assert.ok(folded!.foldedCount >= 1, `covered 가 전진해야 한다 (실제 ${folded!.foldedCount})`)
  const viaTombstone = /too large to summarize/i.test(folded!.summary)
  assert.ok(viaTombstone || calls.length >= 1, '청크 fold 또는 tombstone 중 하나로 처리돼야 한다')
})

test('🔴 index contract: if the server trims the history front, the fold result diverges from the client', async () => {
  const all: ChatHistoryMessage[] = Array.from({ length: 30 }, (_, i) =>
    ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `MSG${i}-${'x'.repeat(4 * 800)}` })
  )
  const SERVER_LIMIT = 10
  const serverView = all.slice(-SERVER_LIMIT)

  const { openai } = stubOpenAI()
  const folded = await foldChatHistory(openai, null, serverView)
  assert.ok(folded, '절단된 배열로도 fold 자체는 성공한다 — 그래서 위험하다')

  const serverFolded = serverView.slice(0, folded!.foldedCount)
  const clientRemoved = all.slice(0, folded!.foldedCount)

  assert.notDeepEqual(
    clientRemoved, serverFolded,
    '절단 상태에서 fold 하면 접은 것과 지우는 것이 달라진다 — 그래서 chatHistoryTruncated 턴은 fold 를 건너뛴다'
  )
})

test('round-trip consistency: server foldedCount and client slice(coveredCount) remove the same items', async () => {
  const all: ChatHistoryMessage[] = []
  let coveredCount = 0
  let summary: string | null = null

  for (let turn = 0; turn < 12; turn++) {
    all.push(msg('user', 400), msg('assistant', 400))

    const uncovered = all.slice(coveredCount)
    if (estimateChatHistoryTokens(uncovered) <= CHAT_SUMMARY_TRIGGER_TOKENS) continue

    const { openai } = stubOpenAI(`summary@turn${turn}`)
    const folded = await foldChatHistory(openai, summary, uncovered)
    if (!folded) continue

    const serverFolded = uncovered.slice(0, folded.foldedCount)
    coveredCount += folded.foldedCount
    summary = folded.summary

    const clientRemoved = all.slice(coveredCount - folded.foldedCount, coveredCount)
    assert.deepEqual(clientRemoved, serverFolded, `turn ${turn}: 제거 대상이 접은 대상과 같아야 한다`)

    assert.ok(
      estimateChatHistoryTokens(all.slice(coveredCount)) <= CHAT_SUMMARY_TRIGGER_TOKENS,
      `turn ${turn}: fold 후 미요약분이 트리거를 넘으면 컨텍스트 배수가 붙는다`
    )
  }

  assert.ok(coveredCount > 0, '12턴이면 최소 한 번은 fold 가 일어나야 한다')
  assert.ok(summary !== null)
})

test('protocol invariant: the unsummarized remainder after a fold is always at or below the trigger', () => {
  for (const total of [4_000, 8_000, 20_000]) {
    const history = Array.from({ length: total / 500 }, () => msg('user', 500))
    const { keepTail } = splitHistoryForFold(history, CHAT_SUMMARY_TRIGGER_TOKENS)
    assert.ok(
      estimateChatHistoryTokens(keepTail) <= CHAT_SUMMARY_TRIGGER_TOKENS,
      `total=${total}: tail(${estimateChatHistoryTokens(keepTail)}) 이 트리거를 넘으면 input ×1 보장이 깨진다`
    )
  }
})
