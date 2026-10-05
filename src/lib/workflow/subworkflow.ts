
import { resolveNodeType } from './engine/resolve-node-type'
import { isUnsafeTemplateSegment } from './template-scope'
import type { WorkflowNode } from './types'

// ========================================
// ========================================

export type WorkflowKind = 'main' | 'sub'
export const MAIN_WORKFLOW_KIND: WorkflowKind = 'main'
export const SUB_WORKFLOW_KIND: WorkflowKind = 'sub'

export function normalizeWorkflowKind(value: unknown): WorkflowKind {
  return value === SUB_WORKFLOW_KIND ? SUB_WORKFLOW_KIND : MAIN_WORKFLOW_KIND
}

export const SUB_WORKFLOW_TRIGGER = 'subworkflow'
export const SUB_WORKFLOW_TOOL_TYPE = 'subworkflow'
export const SUB_WORKFLOW_TOOL_PREFIX = 'subwf_'
export const SUB_WORKFLOW_TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/
export const SUB_WORKFLOW_INPUT_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/
export const SUB_WORKFLOW_MAX_INPUTS = 10
export const SUB_WORKFLOW_MAX_DESCRIPTION_CHARS = 1000
export const SUB_WORKFLOW_MAX_ARG_STRING_CHARS = 2000
export const SUB_WORKFLOW_MAX_ARGS_BYTES = 8192
export const SUB_WORKFLOW_MAX_RESULT_CHARS = 4000
export const SUB_WORKFLOW_TIMEOUT_MS = 15_000
export const SUB_WORKFLOW_TIMEOUT_DEFAULT_S = 15
export const SUB_WORKFLOW_TIMEOUT_MIN_S = 5
export const SUB_WORKFLOW_TIMEOUT_MAX_S = 60

export const SUB_WORKFLOW_ALLOWED_NODE_KINDS: ReadonlySet<string> = new Set([
  'start', 'end',
  'dataSheets', 'httpRequest', 'store',
  'ifElse', 'condition', 'while', 'continue',
  'sms', 'sms_acs', 'sms_infobip', 'sendgrid', 'telegram', 'smtp', 'imap',
])

// ========================================
// ========================================

export type SubWorkflowInputType = 'string' | 'number' | 'boolean'
export const SUB_WORKFLOW_INPUT_TYPES: readonly SubWorkflowInputType[] = ['string', 'number', 'boolean']

export interface SubWorkflowInput {
  name: string
  type: SubWorkflowInputType
  description?: string
  required?: boolean
}

export type SubWorkflowTimeoutParse =
  | { ok: true; seconds: number | null }
  | { ok: false; error: string }

export function parseSubWorkflowTimeoutSeconds(raw: unknown): SubWorkflowTimeoutParse {
  if (raw === undefined || raw === null) return { ok: true, seconds: null }
  const invalid: SubWorkflowTimeoutParse = {
    ok: false,
    error: `timeoutSeconds must be a whole number of seconds between ${SUB_WORKFLOW_TIMEOUT_MIN_S} and ${SUB_WORKFLOW_TIMEOUT_MAX_S} (e.g. 20) — how long the calling AI waits for the result`,
  }
  let n: number
  if (typeof raw === 'number') {
    n = raw
  } else if (typeof raw === 'string') {
    const t = raw.trim()
    if (t === '') return { ok: true, seconds: null }
    if (!/^\d+$/.test(t)) return invalid
    n = Number(t)
  } else {
    return invalid
  }
  if (!Number.isInteger(n) || n < SUB_WORKFLOW_TIMEOUT_MIN_S || n > SUB_WORKFLOW_TIMEOUT_MAX_S) return invalid
  return { ok: true, seconds: n }
}

export function subWorkflowTimeoutSecondsOf(startNodeData: unknown): number {
  const raw = (startNodeData as Record<string, unknown> | null | undefined)?.timeoutSeconds
  const parsed = parseSubWorkflowTimeoutSeconds(raw)
  return parsed.ok ? (parsed.seconds ?? SUB_WORKFLOW_TIMEOUT_DEFAULT_S) : SUB_WORKFLOW_TIMEOUT_DEFAULT_S
}

export interface SubWorkflowDefinition {
  toolName: string
  toolDescription: string
  inputs: SubWorkflowInput[]
  timeoutMs: number
}

export type SubWorkflowDefinitionResult =
  | { ok: true; def: SubWorkflowDefinition; startNodeId: string }
  | { ok: false; error: string; field?: string; startNodeId?: string }

interface RawNodeLike { id?: unknown; type?: unknown; data?: unknown }

function nodesOf(workflowJson: unknown): RawNodeLike[] {
  let root: unknown = workflowJson
  if (typeof root === 'string') {
    try { root = JSON.parse(root) } catch { return [] }
  }
  const nodes = (root as { nodes?: unknown } | null)?.nodes
  return Array.isArray(nodes) ? (nodes as RawNodeLike[]) : []
}

function isSubStartNode(n: RawNodeLike): boolean {
  const data = n?.data as Record<string, unknown> | undefined
  return resolveNodeType(n as unknown as WorkflowNode) === 'start' && data?.triggerType === SUB_WORKFLOW_TRIGGER
}

export function findSubWorkflowStartNodes(workflowJson: unknown): Array<{ id: string; data: Record<string, unknown> }> {
  const out: Array<{ id: string; data: Record<string, unknown> }> = []
  for (const n of nodesOf(workflowJson)) {
    if (!isSubStartNode(n)) continue
    out.push({ id: typeof n.id === 'string' ? n.id : '', data: (n.data as Record<string, unknown>) ?? {} })
  }
  return out
}

export function readSubWorkflowDefinition(workflowJson: unknown): SubWorkflowDefinitionResult {
  const starts = findSubWorkflowStartNodes(workflowJson)
  if (starts.length === 0) return { ok: false, error: `Sub-workflow needs exactly one Start node with triggerType "${SUB_WORKFLOW_TRIGGER}"` }
  if (starts.length > 1) return { ok: false, error: 'Sub-workflow must have exactly one Start node', startNodeId: starts[1].id }
  const { id: startNodeId, data } = starts[0]
  return readSubWorkflowDefinitionFromStartData(data, startNodeId)
}

export function readSubWorkflowDefinitionFromStartData(
  data: Record<string, unknown>,
  startNodeId = '',
): SubWorkflowDefinitionResult {
  const bad = (error: string, field?: string): SubWorkflowDefinitionResult => ({ ok: false, error, field, startNodeId })

  const toolName = typeof data.toolName === 'string' ? data.toolName.trim() : ''
  if (!toolName) return bad('Sub-workflow Start node needs a toolName (the AI calls the sub-workflow by this name)', 'toolName')
  if (!SUB_WORKFLOW_TOOL_NAME_RE.test(toolName)) {
    return bad(`toolName "${toolName}" is invalid — use 2-40 chars of lowercase letters, digits and underscore, starting with a letter (e.g. add_points)`, 'toolName')
  }

  if (data.toolDescription !== undefined && data.toolDescription !== null && typeof data.toolDescription !== 'string') {
    return bad('toolDescription must be a string', 'toolDescription')
  }
  const rawDesc = typeof data.toolDescription === 'string' ? data.toolDescription.trim() : ''
  if (rawDesc.length > SUB_WORKFLOW_MAX_DESCRIPTION_CHARS) {
    return bad(`toolDescription is too long (max ${SUB_WORKFLOW_MAX_DESCRIPTION_CHARS} characters)`, 'toolDescription')
  }
  const toolDescription = rawDesc || `Run the "${toolName}" sub-workflow.`

  const timeout = parseSubWorkflowTimeoutSeconds(data.timeoutSeconds)
  if (!timeout.ok) return bad(timeout.error, 'timeoutSeconds')
  const timeoutMs = (timeout.seconds ?? SUB_WORKFLOW_TIMEOUT_DEFAULT_S) * 1000

  const rawInputs = data.inputs
  const inputs: SubWorkflowInput[] = []
  if (rawInputs !== undefined && rawInputs !== null) {
    if (!Array.isArray(rawInputs)) return bad('inputs must be an array', 'inputs')
    if (rawInputs.length > SUB_WORKFLOW_MAX_INPUTS) return bad(`inputs: at most ${SUB_WORKFLOW_MAX_INPUTS} inputs`, 'inputs')
    const seen = new Set<string>()
    for (let i = 0; i < rawInputs.length; i++) {
      const raw = rawInputs[i] as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad(`inputs[${i}] must be an object`, 'inputs')
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      if (!SUB_WORKFLOW_INPUT_NAME_RE.test(name)) {
        return bad(`inputs[${i}].name "${name}" is invalid — lowercase letters, digits and underscore, starting with a letter (max 40)`, 'inputs')
      }
      if (isUnsafeTemplateSegment(name)) {
        return bad(`inputs[${i}].name "${name}" is reserved — pick another name`, 'inputs')
      }
      if (seen.has(name)) return bad(`inputs: duplicate input name "${name}"`, 'inputs')
      seen.add(name)
      const type = raw.type
      if (!SUB_WORKFLOW_INPUT_TYPES.includes(type as SubWorkflowInputType)) {
        return bad(`inputs[${i}].type must be one of ${SUB_WORKFLOW_INPUT_TYPES.join('/')}`, 'inputs')
      }
      if (raw.description !== undefined && raw.description !== null && typeof raw.description !== 'string') {
        return bad(`inputs[${i}].description must be a string`, 'inputs')
      }
      if (raw.required !== undefined && raw.required !== null && typeof raw.required !== 'boolean') {
        return bad(`inputs[${i}].required must be true or false`, 'inputs')
      }
      const description = typeof raw.description === 'string' ? raw.description.trim() : ''
      if (description.length > SUB_WORKFLOW_MAX_DESCRIPTION_CHARS) return bad(`inputs[${i}].description is too long`, 'inputs')
      inputs.push({
        name,
        type: type as SubWorkflowInputType,
        ...(description ? { description } : {}),
        ...(raw.required === true ? { required: true } : {}),
      })
    }
  }

  return { ok: true, def: { toolName, toolDescription, inputs, timeoutMs }, startNodeId }
}

export function subWorkflowToolFunctionName(toolName: string): string {
  return `${SUB_WORKFLOW_TOOL_PREFIX}${toolName}`
}

export function buildSubWorkflowToolDefinition(def: SubWorkflowDefinition): {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: SubWorkflowInputType; description?: string }>
    required: string[]
    additionalProperties: false
  }
} {
  const properties: Record<string, { type: SubWorkflowInputType; description?: string }> = {}
  const required: string[] = []
  for (const input of def.inputs) {
    properties[input.name] = { type: input.type, ...(input.description ? { description: input.description } : {}) }
    if (input.required) required.push(input.name)
  }
  return {
    name: subWorkflowToolFunctionName(def.toolName),
    description: def.toolDescription,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  }
}

// ========================================
// ========================================

export function collectSubWorkflowRefs(workflowJson: unknown): string[] {
  const ids = new Set<string>()
  for (const n of nodesOf(workflowJson)) {
    if (n?.type !== 'tool') continue
    const data = n.data as Record<string, unknown> | undefined
    if (data?.toolType !== SUB_WORKFLOW_TOOL_TYPE) continue
    const id = typeof data.subWorkflowId === 'string' ? data.subWorkflowId.trim() : ''
    if (id) ids.add(id)
  }
  return [...ids]
}

// ========================================
// ========================================

export type SubWorkflowArgsResult =
  | { ok: true; value: Record<string, string | number | boolean> }
  | { ok: false; error: string }

const DECIMAL_NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

export function validateSubWorkflowArgs(def: SubWorkflowDefinition, args: unknown): SubWorkflowArgsResult {
  const src = (args && typeof args === 'object' && !Array.isArray(args)) ? (args as Record<string, unknown>) : {}
  const value: Record<string, string | number | boolean> = {}
  for (const input of def.inputs) {
    const raw = Object.prototype.hasOwnProperty.call(src, input.name) ? src[input.name] : undefined
    const missing = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')
    if (missing) {
      if (input.required) return { ok: false, error: `Missing required argument "${input.name}"` }
      continue
    }
    if (typeof raw === 'object') return { ok: false, error: `Argument "${input.name}" must be a ${input.type}, not an object/array` }
    switch (input.type) {
      case 'string': {
        const s = String(raw)
        if (s.length > SUB_WORKFLOW_MAX_ARG_STRING_CHARS) {
          return { ok: false, error: `Argument "${input.name}" is too long (max ${SUB_WORKFLOW_MAX_ARG_STRING_CHARS} characters)` }
        }
        value[input.name] = s
        break
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && DECIMAL_NUMBER_RE.test(raw.trim()) ? Number(raw.trim()) : NaN)
        if (!Number.isFinite(n)) return { ok: false, error: `Argument "${input.name}" must be a number` }
        value[input.name] = n
        break
      }
      case 'boolean': {
        if (typeof raw === 'boolean') value[input.name] = raw
        else if (raw === 'true' || raw === 'false') value[input.name] = raw === 'true'
        else return { ok: false, error: `Argument "${input.name}" must be true or false` }
        break
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > SUB_WORKFLOW_MAX_ARGS_BYTES) {
    return { ok: false, error: `Arguments are too large (max ${SUB_WORKFLOW_MAX_ARGS_BYTES} bytes in total)` }
  }
  return { ok: true, value }
}

export const SUB_WORKFLOW_RESULT = {
  failed: JSON.stringify({ error: 'sub_workflow_failed' }),
  noAnswer: JSON.stringify({ error: 'sub_workflow_no_answer' }),
  timeout: JSON.stringify({ error: 'sub_workflow_timeout', note: 'may still complete' }),
  unavailable: JSON.stringify({ error: 'sub_workflow_unavailable' }),
  unknownTool: JSON.stringify({ error: 'sub_workflow_unknown_tool' }),
  invalidArgs: (reason: string) => JSON.stringify({ error: 'sub_workflow_invalid_arguments', reason }),
} as const

export function clampSubWorkflowResult(text: string): string {
  const cps = Array.from(text)
  return cps.length > SUB_WORKFLOW_MAX_RESULT_CHARS ? `${cps.slice(0, SUB_WORKFLOW_MAX_RESULT_CHARS).join('')}…` : text
}

// ========================================
// ========================================

export function withClonedSubWorkflowToolName(workflowJson: string, isTaken: (name: string) => boolean = () => false): string {
  const starts = findSubWorkflowStartNodes(workflowJson)
  if (starts.length !== 1 || typeof starts[0].data.toolName !== 'string') return workflowJson
  let parsed: { nodes?: Array<{ id?: string; data?: Record<string, unknown> }> }
  try { parsed = JSON.parse(workflowJson) } catch { return workflowJson }
  const node = parsed.nodes?.find((n) => n.id === starts[0].id)
  if (!node?.data) return workflowJson
  const base = String(node.data.toolName).trim().replace(/_copy(\d*)$/, '')
  for (let i = 1; i <= 50; i++) {
    const suffix = i === 1 ? '_copy' : `_copy${i}`
    let candidate = `${base}${suffix}`
    if (candidate.length > 40) candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`
    if (!SUB_WORKFLOW_TOOL_NAME_RE.test(candidate)) return workflowJson
    if (isTaken(candidate)) continue
    node.data.toolName = candidate
    return JSON.stringify(parsed)
  }
  return workflowJson
}

// ========================================
// ========================================

export function suggestSubWorkflowToolName(name: string, isTaken: (name: string) => boolean = () => false): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/_+$/g, '')
  const base = SUB_WORKFLOW_TOOL_NAME_RE.test(slug) ? slug : `sub_workflow_${Math.random().toString(36).slice(2, 6)}`
  if (!isTaken(base)) return base
  for (let i = 2; i <= 50; i++) {
    const suffix = `_${i}`
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`
    if (SUB_WORKFLOW_TOOL_NAME_RE.test(candidate) && !isTaken(candidate)) return candidate
  }
  return `sub_workflow_${Math.random().toString(36).slice(2, 6)}`
}

export function buildSubWorkflowSkeleton(name: string, isTaken: (name: string) => boolean = () => false): string {
  return JSON.stringify({
    nodes: [
      {
        id: 'start-1',
        type: 'custom',
        position: { x: 250, y: 100 },
        data: {
          label: 'Start / Sub-workflow',
          color: 'bg-pink-500',
          nodeType: 'start',
          triggerType: SUB_WORKFLOW_TRIGGER,
          showLeftHandle: false,
          toolName: suggestSubWorkflowToolName(name, isTaken),
          toolDescription: '',
          inputs: [],
        },
      },
      {
        id: 'end-1',
        type: 'custom',
        position: { x: 250, y: 320 },
        data: {
          label: 'End',
          color: 'bg-green-500',
          nodeType: 'end',
          message: 'Done.',
        },
      },
    ],
    edges: [{ id: 'e-start-1-end-1', source: 'start-1', target: 'end-1' }],
  })
}
