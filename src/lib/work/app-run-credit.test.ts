import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeWorkAppRun, markWorkAppRunCreditShort, openWorkAppRun, workAppRunCreditShort } from './app-scope'

test('only marked turns - cleared on close - unknown turns stay quiet', () => {
  openWorkAppRun('r-short'); openWorkAppRun('r-ok')
  markWorkAppRunCreditShort('r-short')
  markWorkAppRunCreditShort('r-none')
  assert.equal(workAppRunCreditShort('r-short'), true)
  assert.equal(workAppRunCreditShort('r-ok'), false)
  closeWorkAppRun('r-short'); closeWorkAppRun('r-ok')
  assert.equal(workAppRunCreditShort('r-short'), false)
})

test('llm.ask from tools and modules - on low credit, marks this turn and keeps the error - other errors and success are not marked', async () => {
  const { askWithCreditMark } = await import('./app-ai')
  const ctxOf = (runId: string, ask: (p: string) => Promise<string>) => ({ scope: { runId }, askText: ask }) as unknown as Parameters<typeof askWithCreditMark>[0]
  openWorkAppRun('r-ask-short'); openWorkAppRun('r-ask-other'); openWorkAppRun('r-ask-ok')
  const short = askWithCreditMark(ctxOf('r-ask-short', async () => { throw Object.assign(new Error('Insufficient CPA balance'), { code: 'INSUFFICIENT_CPA' }) }))!
  await assert.rejects(short('x'), /Insufficient/)
  assert.equal(workAppRunCreditShort('r-ask-short'), true)
  const other = askWithCreditMark(ctxOf('r-ask-other', async () => { throw new Error('timeout') }))!
  await assert.rejects(other('x'))
  assert.equal(workAppRunCreditShort('r-ask-other'), false)
  assert.equal(await askWithCreditMark(ctxOf('r-ask-ok', async () => 'fine'))!('x'), 'fine')
  assert.equal(workAppRunCreditShort('r-ask-ok'), false)
  assert.equal(askWithCreditMark({ scope: { runId: 'r' } } as unknown as Parameters<typeof askWithCreditMark>[0]), undefined)
  for (const r of ['r-ask-short', 'r-ask-other', 'r-ask-ok']) closeWorkAppRun(r)
})
