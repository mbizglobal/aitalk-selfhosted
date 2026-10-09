
import type { OpenAI } from 'openai'
import type { McpClient } from '../mcp'
import type { TelegramMcpClient } from '@/lib/mcp/telegram'
import type { AIToolClient } from '../../tools'
import type { AiCallReservation } from '../../ai-call-cpa'
import { detectStreamFailure } from './utils'
import { reconcileFunctionCallId, type StreamedFunctionCall } from './function-call-ids'
import { describeCaughtError, safeLogDigest, safeLogFields, safeLogToken } from '@/lib/log-mask'
import { makeToolTraceEntry, type ToolTraceEntry } from './tool-trace'
import { isGptReasoningFamily } from '@/lib/managed/model-lineup'

export const MAX_TOOL_ROUNDS = 5
export const TOOL_TURN_DEADLINE_MS = 60_000
export const WORK_APP_TOOL_LIMITS = { maxRounds: 20, deadlineMs: 240_000, rateLimitWaitsMs: [20_000, 40_000] } as const

type StreamFailure = NonNullable<ReturnType<typeof detectStreamFailure>>
type ToolOutput = { call_id: string; output: string }
type Usage = { input_tokens: number; output_tokens: number }

export interface ToolCallRecord {
  kind: 'mcp' | 'apps' | 'unknown'
  name: string
  args: any
  status: 'success' | 'error'
  durationMs: number
  resultText?: string
  error?: string
  duplicate?: boolean
}

export interface ToolExecutor {
  run(calls: StreamedFunctionCall[], pastDeadline?: () => boolean): Promise<{ outputs: ToolOutput[]; skippedForDeadline: number }>
}

const NOT_EXECUTED_DEADLINE =
  'Error: NOT executed — this turn ran out of time. Tell the user it could not be completed right now; do not claim it succeeded.'

function stableStringify(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function createToolExecutor(opts: {
  mcpClient?: McpClient | TelegramMcpClient | null
  mcpToolsMap?: Map<string, any>
  appsToolClients?: Map<string, AIToolClient>
  onToolCall?: (rec: ToolCallRecord) => void
  traceSink?: ToolTraceEntry[]
  traceNodeId?: string
}): ToolExecutor {
  const { mcpClient, mcpToolsMap, appsToolClients } = opts
  const doneCalls = new Map<string, string>()
  const recordTrace = (name: string, args: string, output: string) => {
    const entry = opts.traceSink ? makeToolTraceEntry(name, args, output, opts.traceNodeId) : null
    if (entry) opts.traceSink!.push(entry)
  }
  const onToolCall = (rec: ToolCallRecord) => {
    try { opts.onToolCall?.(rec) } catch (e) { console.warn('[AI Node] Tool debug callback failed:', describeCaughtError(e)) }
  }

  return {
    async run(calls, pastDeadline) {
      const outputs: ToolOutput[] = []
      let skippedForDeadline = 0
      for (const fc of calls) {
        const startedAt = Date.now()
        const isMcp = !!(mcpClient && mcpToolsMap?.has(fc.name))
        const isApps = !isMcp && !!appsToolClients?.has(fc.name)
        const kind: ToolCallRecord['kind'] = isMcp ? 'mcp' : isApps ? 'apps' : 'unknown'
        let args: any = {}
        let argsParsed = true
        try { args = JSON.parse(fc.arguments || '{}') } catch { argsParsed = false }

        if (kind === 'unknown') {
          console.warn(`[AI Node] Unknown tool #${safeLogDigest(fc.name)} — returning an error result`)
          const output = `Error: unknown tool "${fc.name}"`
          outputs.push({ call_id: fc.id, output })
          onToolCall({ kind, name: fc.name, args, status: 'error', durationMs: 0, error: output })
          continue
        }

        const key = `${fc.name}\u0000${argsParsed ? stableStringify(args) : fc.arguments}`
        const previous = doneCalls.get(key)
        if (previous !== undefined) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[ChatTools] ${kind === 'mcp' ? `#${safeLogDigest(fc.name)}` : safeLogToken(fc.name)} — same call again this turn, not executed`)
          }
          outputs.push({ call_id: fc.id, output: previous })
          onToolCall({ kind, name: fc.name, args, status: 'success', durationMs: 0, resultText: previous, duplicate: true })
          continue
        }

        if (pastDeadline?.()) {
          skippedForDeadline++
          outputs.push({ call_id: fc.id, output: NOT_EXECUTED_DEADLINE })
          continue
        }

        try {
          if (!argsParsed) throw new Error('Invalid JSON in tool arguments')
          let resultText: string
          if (isMcp) {
            const result = await mcpClient!.callTool(fc.name, args)
            resultText = result.content?.map((c: any) => c.text || JSON.stringify(c)).join('\n') || JSON.stringify(result)
          } else {
            resultText = String((await appsToolClients!.get(fc.name)!.callTool(fc.name, args)) ?? '')
            if (process.env.NODE_ENV !== 'production') {
              console.log(`[ChatTools] ${safeLogToken(fc.name)}(fields=[${safeLogFields(args)}]) → ${String(resultText ?? '').length} chars`)
            }
          }
          doneCalls.set(key, resultText)
          recordTrace(fc.name, fc.arguments, resultText)
          outputs.push({ call_id: fc.id, output: resultText })
          onToolCall({ kind, name: fc.name, args, status: 'success', durationMs: Date.now() - startedAt, resultText })
        } catch (err: any) {
          if (isMcp) {
            console.error(`[AI Node] MCP tool #${safeLogDigest(fc.name)} failed:`, describeCaughtError(err))
          } else {
            console.error(`[AI Node] Apps tool ${safeLogToken(fc.name)} failed:`, describeCaughtError(err))
          }
          const output = `Error: ${err?.message}`
          recordTrace(fc.name, fc.arguments, output)
          outputs.push({ call_id: fc.id, output })
          onToolCall({ kind, name: fc.name, args, status: 'error', durationMs: Date.now() - startedAt, error: err?.message })
        }
      }
      if (skippedForDeadline > 0) console.warn(`[AI Node] Tool loop: deadline reached — ${skippedForDeadline} tool call(s) not executed`)
      return { outputs, skippedForDeadline }
    },
  }
}

export function buildFollowUpConfig(
  requestConfig: any,
  nodeData: { model: string; maxTokens?: number; temperature?: number },
  previousResponseId: string | null,
  toolOutputs: ToolOutput[],
  toolChoice: 'auto' | 'none',
): any {
  const { model, maxTokens, temperature } = nodeData
  const config: any = {
    model,
    temperature,
    max_output_tokens: requestConfig.max_output_tokens ?? maxTokens,
    instructions: requestConfig.instructions,
    previous_response_id: previousResponseId,
    input: toolOutputs.map(tr => ({ type: 'function_call_output', call_id: tr.call_id, output: tr.output })),
    stream: true,
  }
  if (requestConfig.tools) {
    config.tools = requestConfig.tools
    config.tool_choice = toolChoice
  }
  config.text = requestConfig.text
  config.reasoning = requestConfig.reasoning
  config.top_p = requestConfig.top_p
  if (isGptReasoningFamily(model)) {
    delete config.temperature
    delete config.top_p
  }
  return config
}

interface RoundResult {
  text: string
  sawOutput: boolean
  functionCalls: StreamedFunctionCall[]
  responseId: string | null
  usage: Usage | null
  completed: boolean
  incompleteReason: string | null
  failure: StreamFailure | null
}

const newRoundResult = (): RoundResult => ({
  text: '', sawOutput: false, functionCalls: [], responseId: null, usage: null,
  completed: false, incompleteReason: null, failure: null,
})

async function consumeRound(stream: AsyncIterable<any>, r: RoundResult, onTextDelta?: (delta: string) => void): Promise<void> {
  let sawDelta = false
  const callMap = new Map<string, StreamedFunctionCall>()

  for await (const chunk of stream) {
    const failure = detectStreamFailure(chunk)
    if (failure) { r.failure = failure; break }

    if (chunk.type === 'response.output_text.delta' && chunk.delta) {
      r.text += chunk.delta
      r.sawOutput = true
      sawDelta = true
      onTextDelta?.(chunk.delta)
    }
    if (chunk.type === 'response.function_call_arguments.delta' && chunk.delta) r.sawOutput = true
    if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call') {
      const item = chunk.item
      callMap.set(item.id || item.call_id, { id: item.id || item.call_id || `call_${Date.now()}`, name: item.name, arguments: '' })
    }
    if (chunk.type === 'response.function_call_arguments.done') {
      r.sawOutput = true
      const fc = callMap.get(chunk.item_id)
      if (fc) {
        fc.arguments = chunk.arguments || '{}'
        r.functionCalls.push(fc)
      } else {
        r.functionCalls.push({ id: chunk.item_id || chunk.call_id || `call_${Date.now()}`, name: chunk.name || 'unknown', arguments: chunk.arguments || '{}' })
      }
    }
    if (chunk.type === 'response.completed' || chunk.type === 'response.incomplete') {
      r.completed = true
      if (chunk.type === 'response.incomplete') r.incompleteReason = chunk.response?.incomplete_details?.reason || 'unknown'
      if (chunk.response?.id) r.responseId = chunk.response.id
      if (chunk.response?.usage) {
        r.usage = { input_tokens: chunk.response.usage.input_tokens || 0, output_tokens: chunk.response.usage.output_tokens || 0 }
      }
      for (const item of Array.isArray(chunk.response?.output) ? chunk.response.output : []) {
        reconcileFunctionCallId(r.functionCalls, item)
        if (!sawDelta && item.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if ((c.type === 'output_text' || c.type === 'text') && c.text) {
              r.text += c.text
              r.sawOutput = true
              onTextDelta?.(c.text)
            }
          }
        }
      }
    }
  }
}

export interface ToolLoopResult {
  finalText: string
  responseId: string | null
  usage: Usage | null
  incompleteReason: string | null
  failure: StreamFailure | null
  stoppedBy: 'done' | 'max_rounds' | 'deadline'
}

export async function runToolFollowUps(p: {
  openai: OpenAI
  requestConfig: any
  nodeData: { model: string; maxTokens?: number; temperature?: number }
  reserve: () => Promise<AiCallReservation>
  executor: ToolExecutor
  responseId: string | null
  functionCalls: StreamedFunctionCall[]
  onTextDelta?: (delta: string, roundStart: boolean) => void
  onRoundDone?: (info: { round: number; durationMs: number; usage: Usage | null; incompleteReason: string | null }) => void
  now?: () => number
  limits?: { maxRounds: number; deadlineMs: number; rateLimitWaitsMs?: readonly number[] }
  sleep?: (ms: number) => Promise<void>
}): Promise<ToolLoopResult> {
  const now = p.now ?? Date.now
  const maxRounds = p.limits?.maxRounds ?? MAX_TOOL_ROUNDS
  const deadlineMs = p.limits?.deadlineMs ?? TOOL_TURN_DEADLINE_MS
  const startedAt = now()
  const out: ToolLoopResult = {
    finalText: '', responseId: p.responseId, usage: null, incompleteReason: null, failure: null, stoppedBy: 'done',
  }
  let pending = p.functionCalls

  for (let round = 1; pending.length > 0; round++) {
    if (round > maxRounds) {
      console.warn(`[AI Node] Tool loop: model still called ${pending.length} tool(s) after the last round — not executed`)
      break
    }
    const pastDeadline = () => now() - startedAt > deadlineMs

    const reservation = await p.reserve()
    const r = newRoundResult()
    try {
      const { outputs: toolOutputs, skippedForDeadline } = await p.executor.run(pending, pastDeadline)
      const overDeadline = skippedForDeadline > 0 || pastDeadline()
      const lastRound = overDeadline || round === maxRounds

      const roundStartedAt = now()
      let first = true
      const waits = p.limits?.rateLimitWaitsMs ?? []
      for (let attempt = 0; ; attempt++) {
        let rateLimited = false
        try {
          const stream = await p.openai.responses.create(
            buildFollowUpConfig(p.requestConfig, p.nodeData, out.responseId, toolOutputs, lastRound ? 'none' : 'auto'),
          ) as unknown as AsyncIterable<any>
          await consumeRound(stream, r, delta => { p.onTextDelta?.(delta, first); first = false })
          rateLimited = r.failure?.code === 'rate_limit_exceeded' && !r.sawOutput
        } catch (e) {
          if (!waits.length || (e as { status?: number }).status !== 429 || r.sawOutput) throw e
          rateLimited = true
          r.failure = detectStreamFailure({ type: 'error', code: 'rate_limit_exceeded', message: '' })
        }
        if (!rateLimited || attempt >= waits.length || now() - startedAt + waits[attempt] > deadlineMs) break
        console.warn(`[AI Node] Tool loop: rate limited — retry ${attempt + 1}/${waits.length} after ${waits[attempt]}ms`)
        await (p.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms))))(waits[attempt])
        Object.assign(r, newRoundResult())
      }

      if (r.failure) {
        if (!r.completed && r.failure.usageInputTokens != null) reservation.settle(r.failure.usageInputTokens, r.failure.usageOutputTokens)
        out.failure = r.failure
        break
      }

      if (r.responseId) out.responseId = r.responseId
      if (r.usage) {
        out.usage = {
          input_tokens: (out.usage?.input_tokens || 0) + r.usage.input_tokens,
          output_tokens: (out.usage?.output_tokens || 0) + r.usage.output_tokens,
        }
      }
      out.incompleteReason = r.incompleteReason
      if (r.text.trim()) out.finalText = r.text
      p.onRoundDone?.({ round, durationMs: now() - roundStartedAt, usage: r.usage, incompleteReason: r.incompleteReason })

      pending = r.functionCalls
      if (lastRound) {
        out.stoppedBy = overDeadline ? 'deadline' : 'max_rounds'
        if (pending.length > 0) console.warn(`[AI Node] Tool loop: ${pending.length} tool call(s) after the last round — not executed`)
        break
      }
    } finally {
      try {
        if (r.completed) reservation.settle(r.usage?.input_tokens, r.usage?.output_tokens)
      } finally {
        reservation.finalize(r.sawOutput)
      }
    }
  }
  return out
}
