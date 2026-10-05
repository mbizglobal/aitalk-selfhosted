
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { compactToolOutput, insertPreviousToolTrace, readToolTraceEntries, makeToolTraceEntry, TOOL_TRACE_MAX_ENTRIES, TOOL_TRACE_TOTAL_MAX_CHARS } from './tool-trace'
import { createToolExecutor } from './tool-loop'

const availability = () => JSON.stringify({
  success: true,
  timezone: 'Europe/Zurich',
  workingHours: { start: '11:30', end: '23:00' },
  capacityMode: 'tables',
  tableInventory: [{ name: '4-seat table', capacity: 4, count: 8 }, { name: '3-seat table', capacity: 3, count: 5 }, { name: '2-seat table', capacity: 2, count: 6 }],
  requestedTime: { requested: '2026-09-24T20:00:00+02:00', available: true, alternatives: [] },
  requestedTimeNote: 'Answer the requested time first: if available, say that exact time is free; if not, say so and offer "alternatives" (they are in openSlots).',
  openSlots: Array.from({ length: 48 }, (_, i) => ({
    start: `2026-09-24T${String(11 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00+02:00`,
    availableTables: [{ name: '4-seat table', capacity: 4, available: 8 }, { name: '3-seat table', capacity: 3, available: 5 }],
    tablesAvailable: 13,
  })),
})

describe('compactToolOutput: shape carried to the next turn', () => {
  it('availability lookup result: long lists are folded, while whether that time works is kept', () => {
    const raw = availability()
    const out = compactToolOutput(raw)
    assert.ok(raw.length > 7000, '전제: 원문이 실측처럼 커야 한다')
    assert.ok(out.length <= 920, `너무 길다: ${out.length}`)
    const parsed = JSON.parse(out)
    assert.deepEqual(parsed.requestedTime, { requested: '2026-09-24T20:00:00+02:00', available: true, alternatives: [] })
    assert.equal(parsed.openSlots, '[48 items omitted]')
    assert.equal(parsed.success, true)
  })

  it('eventId and success in a booking result stay as they are', () => {
    const out = JSON.parse(compactToolOutput('{"success":true,"eventId":"AQMkADAw","start":"2026-09-24T20:00:00+02:00"}'))
    assert.equal(out.eventId, 'AQMkADAw')
    assert.equal(out.success, true)
  })

  it('if not JSON, only the character count is cut; an empty value does not throw either', () => {
    assert.equal(compactToolOutput('Error: boom'), 'Error: boom')
    assert.match(compactToolOutput('x'.repeat(5000)), /…\[truncated\]$/)
    assert.equal(compactToolOutput(''), '')
    assert.equal(compactToolOutput(undefined as any), '')
  })
})

describe('insertPreviousToolTrace: only right before the last AI reply', () => {
  const trace = {
    assistantMessage: '확정할까요?',
    entries: [makeToolTraceEntry('check_calendar_availability', '{"requested_start_iso":"2026-09-24T20:00"}', availability(), 'ai-1')!],
  }
  const history = () => [
    { type: 'message', role: 'user', content: '예약합니다' },
    { type: 'message', role: 'assistant', content: '몇 분이세요?' },
    { type: 'message', role: 'user', content: '3명, 내일 8시' },
    { type: 'message', role: 'assistant', content: '확정할까요?' },
  ]

  it('if it matches the saved reply, inserts a function_call / function_call_output pair before it', () => {
    const h: any[] = history()
    assert.equal(insertPreviousToolTrace(h, trace, 'ai-1'), 1)
    assert.deepEqual(h.map(m => m.type === 'message' ? m.role : m.type),
      ['user', 'assistant', 'user', 'function_call', 'function_call_output', 'assistant'])
    assert.equal(h[3].call_id, h[4].call_id)
    assert.equal(h[3].name, 'check_calendar_availability')
    assert.match(h[4].output, /"available":true/)
  })

  it('if the last AI reply differs from the saved reply, nothing is inserted; a record from another thread is not made to look like its own action', () => {
    const h: any[] = history()
    h[3].content = '다른 답'
    assert.equal(insertPreviousToolTrace(h, trace, 'ai-1'), 0)
    assert.equal(h.length, 4)
  })

  it('nothing is inserted if the history does not end with an AI reply or is empty', () => {
    const h: any[] = history().slice(0, 3)
    assert.equal(insertPreviousToolTrace(h, trace, 'ai-1'), 0)
    assert.equal(insertPreviousToolTrace([], trace, 'ai-1'), 0)
    assert.equal(insertPreviousToolTrace(history(), undefined, 'ai-1'), 0)
    assert.equal(insertPreviousToolTrace(history(), { assistantMessage: '확정할까요?', entries: [] }, 'ai-1'), 0)
  })

  it('calls made by another AI node are not inserted, and also not when the node id is missing', () => {
    assert.equal(insertPreviousToolTrace(history(), trace, 'ai-2'), 0)
    assert.equal(insertPreviousToolTrace(history(), trace, undefined), 0)
    const untagged = { assistantMessage: '확정할까요?', entries: [makeToolTraceEntry('x', '{}', 'ok')!] }
    assert.equal(insertPreviousToolTrace(history(), untagged, 'ai-1'), 0)
  })

  it('when over the total cap, oldest are dropped first and the latest call stays', () => {
    const big = (n: number) => makeToolTraceEntry(`t${n}`, '{}', JSON.stringify({ note: 'x'.repeat(230), n, a: 'y'.repeat(230), b: 'z'.repeat(230) }), 'ai-1')!
    const many = { assistantMessage: '확정할까요?', entries: [1, 2, 3, 4, 5, 6].map(big) }
    const h: any[] = history()
    const n = insertPreviousToolTrace(h, many, 'ai-1')
    assert.ok(n > 0 && n < 6, `상한이 안 걸렸다: ${n}`)
    const calls = h.filter(m => m.type === 'function_call')
    assert.equal(calls[calls.length - 1].name, 't6', '가장 최근 호출이 빠졌다')
    const total = h.filter(m => m.type === 'function_call_output').reduce((s, m) => s + m.output.length, 0)
    assert.ok(total <= TOOL_TRACE_TOTAL_MAX_CHARS)
  })
})

describe('makeToolTraceEntry: arguments only as intact JSON', () => {
  it('long string values are folded but the result is still JSON', () => {
    const e = makeToolTraceEntry('book_calendar_event', JSON.stringify({ notes: 'x'.repeat(1000), start_iso: '2026-09-24T20:00' }), '{}')!
    const args = JSON.parse(e.arguments)
    assert.equal(args.start_iso, '2026-09-24T20:00')
    assert.ok(args.notes.length < 300)
  })

  it('not recorded if it is not JSON, not an object, or still too long after folding', () => {
    assert.equal(makeToolTraceEntry('t', '{broken', 'x'), null)
    assert.equal(makeToolTraceEntry('t', '[1,2]', 'x'), null)
    assert.equal(makeToolTraceEntry('t', 'null', 'x'), null)
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'v'.repeat(20)]))
    assert.equal(makeToolTraceEntry('t', JSON.stringify(wide), 'x'), null)
    assert.deepEqual(JSON.parse(makeToolTraceEntry('t', '', 'x')!.arguments), {})
  })
})

describe('readToolTraceEntries: validation of the saved copy', () => {
  it('the cap is per AI node: even if a later node calls a lot, earlier node records remain', () => {
    const e = (n: number, nodeId: string) => ({ name: `t${n}`, arguments: '{}', output: 'ok', nodeId })
    const out = readToolTraceEntries([e(0, 'ai-1'), ...Array.from({ length: 10 }, (_, i) => e(i + 1, 'ai-2'))])
    assert.deepEqual(out.filter(x => x.nodeId === 'ai-1').map(x => x.name), ['t0'])
    assert.equal(out.filter(x => x.nodeId === 'ai-2').length, TOOL_TRACE_MAX_ENTRIES)
    assert.equal(out[0].name, 't0', '순서가 바뀌면 안 된다')
  })

  it('malformed entries are discarded, and only up to the cap starting from the last', () => {
    const good = (n: number) => ({ name: `t${n}`, arguments: '{}', output: 'ok' })
    const mixed = [null, 1, { name: '', arguments: '{}', output: 'x' }, { name: 'a', arguments: {}, output: 'x' }, ...Array.from({ length: 10 }, (_, i) => good(i))]
    const out = readToolTraceEntries(mixed)
    assert.equal(out.length, TOOL_TRACE_MAX_ENTRIES)
    assert.equal(out[out.length - 1].name, 't9')
    assert.deepEqual(readToolTraceEntries(undefined), [])
    assert.deepEqual(readToolTraceEntries({}), [])
  })
})

describe('executor collection: only calls actually executed', () => {
  it('success and failure are included; same-call memory, unknown tools and timeout skips are not', async () => {
    const sink: any[] = []
    const client = {
      callTool: async (name: string) => {
        if (name === 'fails') throw new Error('boom')
        return availability()
      },
    } as any
    const exec = createToolExecutor({
      appsToolClients: new Map([['check_calendar_availability', client], ['fails', client], ['later', client]]) as any,
      traceSink: sink,
      traceNodeId: 'ai-1',
    })
    await exec.run([
      { id: 'c1', name: 'check_calendar_availability', arguments: '{"a":1}' },
      { id: 'c2', name: 'check_calendar_availability', arguments: '{"a":1}' },
      { id: 'c3', name: 'no_such_tool', arguments: '{}' },
      { id: 'c4', name: 'fails', arguments: '{}' },
    ])
    await exec.run([{ id: 'c5', name: 'later', arguments: '{}' }], () => true)
    assert.deepEqual(sink.map(e => e.name), ['check_calendar_availability', 'fails'])
    assert.match(sink[0].output, /\[48 items omitted\]/, '줄인 모양이어야 한다')
    assert.equal(sink[1].output, 'Error: boom')
    assert.ok(sink.every(e => e.nodeId === 'ai-1'), '노드 id 가 달려야 한다')
  })
})
