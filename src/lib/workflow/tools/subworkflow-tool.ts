
import type { PrismaClient } from '@prisma/client'
import type { AIToolClient, ToolDefinition, ToolCallContext } from './types'
import { VOICE_QUIZ_HOOK_PHASES } from '@/lib/call/voice-quiz/types'
import type { WorkflowContext, WorkflowExecutionResult, WorkflowJson } from '../types'
import { describeCaughtError, safeLogId } from '@/lib/log-mask'
import {
  SUB_WORKFLOW_KIND,
  SUB_WORKFLOW_RESULT,
  SUB_WORKFLOW_TIMEOUT_MS,
  buildSubWorkflowToolDefinition,
  clampSubWorkflowResult,
  readSubWorkflowDefinition,
  subWorkflowToolFunctionName,
  validateSubWorkflowArgs,
  type SubWorkflowDefinition,
} from '../subworkflow'

export type SubWorkflowChannel = 'pstn' | 'web_voice' | 'chat_widget' | 'test'

const MAX_CALLER_NUMBER_CHARS = 32

export class SubWorkflowToolError extends Error {
  constructor(readonly code: 'SUB_WORKFLOW_SCOPE_MISSING' | 'SUB_WORKFLOW_REF_MISSING' | 'SUB_WORKFLOW_NOT_FOUND' | 'SUB_WORKFLOW_ARCHIVED' | 'SUB_WORKFLOW_JSON_INVALID' | 'SUB_WORKFLOW_DEFINITION_INVALID', message: string) {
    super(message)
    this.name = 'SubWorkflowToolError'
  }
}

function pstnCallerNumber(callContext?: ToolCallContext): string {
  const raw = typeof callContext?.callerNumber === 'string' ? callContext.callerNumber.trim() : ''
  if (!raw) return ''

  const ch = callContext?.callChannel
  const label = ch === 'pstn' || ch === 'web_voice' || ch === 'chat_widget' ? ch : 'unknown'

  if (ch !== 'pstn') {
    console.warn(`[SubWorkflow] caller number dropped: channel=${label} (only pstn is trusted)`)
    return ''
  }
  if (raw.length > MAX_CALLER_NUMBER_CHARS) {
    console.warn(`[SubWorkflow] caller number dropped: length=${raw.length} > ${MAX_CALLER_NUMBER_CHARS}`)
    return ''
  }
  return raw
}

function voiceQuizContext(v: NonNullable<ToolCallContext['voiceQuiz']>): NonNullable<WorkflowContext['voiceQuiz']> {
  const int = (n: unknown) => (Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0)
  const any = v as Record<string, unknown>
  const str = (k: string, max: number) => (typeof any[k] === 'string' ? (any[k] as string).slice(0, max) : undefined)
  return {
    roundId: String(any.roundId ?? '').slice(0, 64),
    phase: (VOICE_QUIZ_HOOK_PHASES as readonly string[]).includes(String(any.phase)) ? String(any.phase) : 'start',
    questionCount: int(any.questionCount),
    asked: int(any.asked),
    correct: int(any.correct),
    topic: String(any.topic ?? '').slice(0, 100),
    ...(str('actionKey', 64) !== undefined ? { actionKey: str('actionKey', 64) } : {}),
    ...(str('anonKey', 64) !== undefined ? { anonKey: str('anonKey', 64) } : {}),
    ...(str('consentText', 600) !== undefined ? { consentText: str('consentText', 600) } : {}),
    ...(str('consentAt', 40) !== undefined ? { consentAt: str('consentAt', 40) } : {}),
    ...(any.consentAfterMs !== undefined ? { consentAfterMs: int(any.consentAfterMs) } : {}),
    ...(str('callReg', 32) !== undefined ? { callReg: str('callReg', 32) } : {}),
    ...(str('callGroup', 64) !== undefined ? { callGroup: str('callGroup', 64) } : {}),
  }
}

export type SubWorkflowRunner = (
  workflowJson: WorkflowJson,
  context: WorkflowContext,
  options: { channel?: SubWorkflowChannel },
) => Promise<WorkflowExecutionResult>

const defaultRunner: SubWorkflowRunner = async (workflowJson, context, options) => {
  const { WorkflowEngine } = await import('../engine')
  return new WorkflowEngine().execute(workflowJson, context, { channel: options.channel })
}

export interface SubWorkflowToolOverrides {
  agentId?: string
  channel?: SubWorkflowChannel
  isTestMode?: boolean
  callerWorkflowId?: string
}

export class SubWorkflowToolClient implements AIToolClient {
  private prisma: PrismaClient | null = null
  private agentId = ''
  private userId = ''
  private subWorkflowId = ''
  private subWorkflowName = ''
  private channel: SubWorkflowChannel | undefined
  private isTestMode = false
  private callerWorkflowId: string | undefined
  private definition: SubWorkflowDefinition | null = null
  private workflowJson: WorkflowJson | null = null

  constructor(
    private readonly runner: SubWorkflowRunner = defaultRunner,
    private readonly timeoutMsOverride?: number,
  ) {}

  private get timeoutMs(): number {
    const o = this.timeoutMsOverride
    if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o
    return this.definition?.timeoutMs ?? SUB_WORKFLOW_TIMEOUT_MS
  }

  async initialize(
    prisma: PrismaClient,
    subWorkflowId: string,
    overrides?: SubWorkflowToolOverrides,
    userId?: string,
  ): Promise<void> {
    const agentId = typeof overrides?.agentId === 'string' ? overrides.agentId.trim() : ''
    if (!agentId) throw new SubWorkflowToolError('SUB_WORKFLOW_SCOPE_MISSING', 'Sub-workflow tool requires agentId scope')
    subWorkflowId = typeof subWorkflowId === 'string' ? subWorkflowId.trim() : ''
    if (!subWorkflowId) throw new SubWorkflowToolError('SUB_WORKFLOW_REF_MISSING', 'Sub-workflow tool has no subWorkflowId')

    const row = await prisma.workflow.findFirst({
      where: { workflowId: subWorkflowId, agentId, kind: SUB_WORKFLOW_KIND },
      select: { workflowId: true, name: true, status: true, workflowJson: true },
    })
    if (!row) throw new SubWorkflowToolError('SUB_WORKFLOW_NOT_FOUND', 'Sub-workflow not found in this agent (or the referenced workflow is not a Sub-workflow)')
    if (row.status === 'archived') throw new SubWorkflowToolError('SUB_WORKFLOW_ARCHIVED', 'Sub-workflow is archived')

    let parsed: WorkflowJson
    try {
      parsed = JSON.parse(row.workflowJson)
    } catch {
      throw new SubWorkflowToolError('SUB_WORKFLOW_JSON_INVALID', 'Sub-workflow JSON is unreadable')
    }
    const def = readSubWorkflowDefinition(parsed)
    if (!def.ok) throw new SubWorkflowToolError('SUB_WORKFLOW_DEFINITION_INVALID', `Sub-workflow Start node is invalid: ${def.error}`)

    this.prisma = prisma
    this.agentId = agentId
    this.userId = userId || ''
    this.subWorkflowId = row.workflowId
    this.subWorkflowName = row.name
    this.channel = overrides?.channel
    this.isTestMode = overrides?.isTestMode === true
    this.callerWorkflowId = typeof overrides?.callerWorkflowId === 'string' && overrides.callerWorkflowId ? overrides.callerWorkflowId : undefined
    this.definition = def.def
    this.workflowJson = parsed
  }

  get functionName(): string | null {
    return this.definition ? subWorkflowToolFunctionName(this.definition.toolName) : null
  }

  listTools(): ToolDefinition[] {
    if (!this.definition) return []
    return [buildSubWorkflowToolDefinition(this.definition)]
  }

  async callTool(name: string, args: Record<string, any>, callContext?: ToolCallContext): Promise<string> {
    if (!this.definition || !this.workflowJson || !this.prisma) return SUB_WORKFLOW_RESULT.unavailable
    if (name !== this.functionName) return SUB_WORKFLOW_RESULT.unknownTool

    const checked = validateSubWorkflowArgs(this.definition, args)
    if (!checked.ok) return SUB_WORKFLOW_RESULT.invalidArgs(checked.error)

    const context: WorkflowContext = {
      message: JSON.stringify(checked.value),
      input: checked.value,
      agentId: this.agentId,
      userId: this.userId,
      subWorkflowDepth: 1,
      isTestMode: this.isTestMode,
      workflowId: this.callerWorkflowId,
      callerNumber: pstnCallerNumber(callContext),
      ...(callContext?.voiceQuiz ? { voiceQuiz: voiceQuizContext(callContext.voiceQuiz) } : {}),
    }

    const started = Date.now()
    const tag = `[SubWorkflow] ${safeLogId(this.subWorkflowId)} (${this.functionName})`
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.timeoutMs)
    })
    try {
      const run = this.runner(this.workflowJson, context, { channel: this.channel })
      const outcome = await Promise.race([run, timeout])
      if (outcome === 'timeout') {
        console.warn(`${tag} timed out after ${this.timeoutMs}ms — the run may still complete`)
        run.then(
          (late) => console.warn(`${tag} late completion after ${Date.now() - started}ms: ${late.nodeError ? `failed at ${safeLogId(late.nodeError.nodeId)}` : (late.context?.finalAnswer ? 'answered' : 'no answer')}`),
          (err) => console.error(`${tag} late failure after ${Date.now() - started}ms: ${describeCaughtError(err)}`),
        )
        return SUB_WORKFLOW_RESULT.timeout
      }
      const result = outcome
      if (result.nodeError) {
        console.error(`${tag} failed at node ${safeLogId(result.nodeError.nodeId)} (${Date.now() - started}ms)`)
        return SUB_WORKFLOW_RESULT.failed
      }
      const answer = typeof result.context?.finalAnswer === 'string' ? result.context.finalAnswer.trim() : ''
      if (!answer) {
        console.warn(`${tag} ended without a final answer (${Date.now() - started}ms) — End node not reached or empty message`)
        return SUB_WORKFLOW_RESULT.noAnswer
      }
      return clampSubWorkflowResult(answer)
    } catch (error) {
      console.error(`${tag} threw: ${describeCaughtError(error)}`)
      return SUB_WORKFLOW_RESULT.failed
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
