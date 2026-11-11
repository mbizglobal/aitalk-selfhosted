
import { validateNodeAgainstSpec, resolveCatalogKey } from './node-catalog'
import { SAVE_AS_RESERVED_KEYS } from '@/lib/connection-scope'
import { NODE_CATALOG } from './node-catalog-data'
import { resolveNodeType } from './engine/resolve-node-type'
import { findEditionOffParts, editionOffMessage } from './edition-guard'
import { checkSafeExpressionSyntax } from './safe-expression'
import { isUnsafeTemplateSegment } from './template-scope'
import {
  SUB_WORKFLOW_TRIGGER,
  SUB_WORKFLOW_ALLOWED_NODE_KINDS,
  readSubWorkflowDefinitionFromStartData,
  type WorkflowKind,
} from './subworkflow'
import type { WorkflowNode } from './types'
import { MINI_APP_REGISTRY, MINI_APP_TYPES, isMiniAppAllowedOn, isMiniAppNode, miniAppChannelOf, type MiniAppType } from './mini-app-registry'
import { APP_TRIGGER, WORK_EVENT_TRIGGER, WORK_EVENT_KINDS } from './start-trigger'
import { isCalendarDate } from '@/lib/work/dates'
import { referenceLinesOf, sendLinesOf } from '@/lib/work/reference-lines'
import { APP_TEMPLATE_KINDS, isAppTemplateKind, isSharedAppTemplateKind, SHARED_APP_TEMPLATE_KINDS } from '@/lib/work/app-template-kinds'
import { appNodesOf, isAppCanvas, linkNodesOf, linkTargetOf, canvasEventEntries, DONE_HANDLE, doneRunGraph, eventKindOfHandle, eventRunGraph, EVENT_HANDLE_PREFIX, handoffCycle, handoffRoutesOf, HANDOFF_NODE } from '@/lib/work/app-canvas'

// ========================================
// ========================================

export type WorkflowValidationLevel = 'structural' | 'deployable'

export type WorkflowValidationIssueCode =
  // structural
  | 'JSON_PARSE_ERROR'
  | 'ROOT_SCHEMA_INVALID'
  | 'NODE_SHAPE_INVALID'
  | 'EDGE_SHAPE_INVALID'
  | 'DUPLICATE_NODE_ID'
  | 'EDGE_ENDPOINT_MISSING'
  | 'GRAPH_CYCLE'
  // deployable
  | 'START_NODE_MISSING'
  | 'END_NODE_MISSING'
  | 'ORPHAN_NODE'
  | 'UNREACHABLE_NODE'
  | 'DEAD_END_NODE'
  | 'UNKNOWN_NODE_TYPE'
  | 'NODE_SPEC_VIOLATION'
  | 'CONDITION_EXPRESSION_INVALID'
  | 'SUB_WORKFLOW_RULE'
  | 'APP_START_RULE'
  | 'WORK_EVENT_RULE'
  | 'WORK_APP_CANVAS_RULE'
  | 'LINK_TARGET_MISSING'
  | 'EDITION_NOT_INCLUDED'

export type WorkflowIssueSeverity = 'error' | 'warning'

export interface WorkflowValidationIssue {
  code: WorkflowValidationIssueCode
  message: string
  severity?: WorkflowIssueSeverity
  nodeId?: string
  edgeId?: string
  field?: string
}

export interface WorkflowJsonValidationResult {
  valid: boolean
  level: WorkflowValidationLevel
  issues: WorkflowValidationIssue[]
}

// ========================================
// ========================================

interface RawNode {
  id: string
  type?: string
  data?: Record<string, unknown>
}

interface RawEdge {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
}

function collectAttachmentIds(nodes: RawNode[], edges: RawEdge[]): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const ids = new Set<string>()
  for (const e of edges) {
    if (e.sourceHandle !== 'tools' && e.sourceHandle !== 'miniapps') continue
    const src = byId.get(e.source)
    if (!src || engineKind(src) !== 'ai') continue
    if (byId.get(e.target)?.type !== 'tool') continue
    ids.add(e.target)
  }
  for (const e of edges) {
    if (e.sourceHandle !== 'tools' && e.sourceHandle !== 'miniapps') ids.delete(e.target)
  }
  return ids
}

function isPureNote(node: RawNode, edges: RawEdge[]): boolean {
  if (node.type !== 'note' && node.data?.nodeType !== 'note') return false
  if (engineKind(node)) return false
  return !edges.some(e => e.source === node.id || e.target === node.id)
}

function engineKind(node: RawNode): string | null {
  return resolveNodeType(node as unknown as WorkflowNode)
}

function isFlowEdge(edge: RawEdge): boolean {
  return edge.sourceHandle !== 'tools' && edge.sourceHandle !== 'miniapps' && edge.sourceHandle !== 'ref' && edge.sourceHandle !== 'send'
}

function issue(
  code: WorkflowValidationIssueCode,
  message: string,
  loc?: { nodeId?: string; edgeId?: string; field?: string; severity?: WorkflowIssueSeverity },
): WorkflowValidationIssue {
  return { code, message, ...(loc ?? {}) }
}

const WARN = { severity: 'warning' as const }

const isBlocking = (i: WorkflowValidationIssue) => i.severity !== 'warning'

// ========================================
// ========================================

export function validateWorkflowJson(
  raw: string,
  level: WorkflowValidationLevel = 'structural',
  kind: WorkflowKind = 'main',
): WorkflowJsonValidationResult {
  const fail = (issues: WorkflowValidationIssue[]): WorkflowJsonValidationResult =>
    ({ valid: false, level, issues })

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return fail([issue('JSON_PARSE_ERROR', `workflowJson is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)])
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail([issue('ROOT_SCHEMA_INVALID', 'workflowJson must be an object of shape { nodes: [], edges: [] }')])
  }
  const root = parsed as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(root.nodes) || !Array.isArray(root.edges)) {
    return fail([issue('ROOT_SCHEMA_INVALID', 'workflowJson must contain "nodes" and "edges" arrays')])
  }

  const shapeIssues: WorkflowValidationIssue[] = []
  const nodes: RawNode[] = []
  root.nodes.forEach((n, i) => {
    if (typeof n !== 'object' || n === null || typeof (n as RawNode).id !== 'string' || !(n as RawNode).id) {
      shapeIssues.push(issue('NODE_SHAPE_INVALID', `nodes[${i}] must be an object with a non-empty string "id"`))
      return
    }
    const node = n as RawNode
    if (node.data !== undefined && (typeof node.data !== 'object' || node.data === null || Array.isArray(node.data))) {
      shapeIssues.push(issue('NODE_SHAPE_INVALID', `nodes[${i}] ("${node.id}") "data" must be an object`, { nodeId: node.id }))
      return
    }
    nodes.push(node)
  })
  const edges: RawEdge[] = []
  root.edges.forEach((e, i) => {
    const edge = e as RawEdge
    if (
      typeof e !== 'object' || e === null ||
      typeof edge.source !== 'string' || !edge.source ||
      typeof edge.target !== 'string' || !edge.target
    ) {
      shapeIssues.push(issue('EDGE_SHAPE_INVALID', `edges[${i}] must be an object with string "source" and "target"`))
      return
    }
    edges.push(edge)
  })
  if (shapeIssues.length > 0) return fail(shapeIssues)

  const issues: WorkflowValidationIssue[] = []

  for (const part of findEditionOffParts({ nodes })) {
    issues.push(issue('EDITION_NOT_INCLUDED', editionOffMessage([part]), { nodeId: part.nodeId }))
  }

  const seen = new Set<string>()
  for (const node of nodes) {
    if (seen.has(node.id)) {
      issues.push(issue('DUPLICATE_NODE_ID', `Duplicate node id "${node.id}"`, { nodeId: node.id }))
    }
    seen.add(node.id)
  }

  for (const edge of edges) {
    if (!seen.has(edge.source)) {
      issues.push(issue('EDGE_ENDPOINT_MISSING', `Edge source node "${edge.source}" does not exist`, { edgeId: edge.id, nodeId: edge.source }))
    }
    if (!seen.has(edge.target)) {
      issues.push(issue('EDGE_ENDPOINT_MISSING', `Edge target node "${edge.target}" does not exist`, { edgeId: edge.id, nodeId: edge.target }))
    }
  }

  if (issues.length === 0) {
    const cycleNodeId = findCycle(nodes, edges.filter(isFlowEdge))
    if (cycleNodeId !== null) {
      issues.push(issue('GRAPH_CYCLE', `Workflow contains a cycle through node "${cycleNodeId}"`, { nodeId: cycleNodeId }))
    }
  }

  //
  for (const node of nodes) {
    const kind = engineKind(node)
    const data = node.data as Record<string, unknown> | undefined
    const fields: Array<'saveAs' | 'forEachItemVar'> = []
    if (kind === 'ai' || kind === 'dataSheets') fields.push('saveAs')
    if (kind === 'while' && data?.loopMode === 'forEach') fields.push('forEachItemVar')

    for (const field of fields) {
      const raw = data?.[field]
      if (raw === undefined || raw === null || raw === '') continue
      if (typeof raw !== 'string') {
        issues.push(issue(
          'NODE_SPEC_VIOLATION',
          `Node "${label(node)}": ${field} must be a string (got ${Array.isArray(raw) ? 'array' : typeof raw}) — non-string names bypass the reserved-key check and are coerced on assignment`,
          { nodeId: node.id },
        ))
        continue
      }
      if (SAVE_AS_RESERVED_KEYS.has(raw.trim())) {
        issues.push(issue(
          'NODE_SPEC_VIOLATION',
          `Node "${label(node)}": ${field} "${raw.trim()}" is a reserved execution key (ownership / billing / managed credentials / prototype) — pick another variable name`,
          { nodeId: node.id },
        ))
      }
    }
  }

  if (kind === 'sub') {
    const startNodes = nodes.filter(n => engineKind(n) === 'start')
    const subStarts = startNodes.filter(n => n.data?.triggerType === SUB_WORKFLOW_TRIGGER)
    if (subStarts.length !== 1) {
      issues.push(issue('SUB_WORKFLOW_RULE', `A Sub-workflow needs exactly one Start node with triggerType "${SUB_WORKFLOW_TRIGGER}" (found ${subStarts.length}) — that Start node defines the tool (toolName/toolDescription/inputs) the calling AI sees`))
    }
    for (const n of startNodes) {
      if (n.data?.triggerType === SUB_WORKFLOW_TRIGGER) continue
      issues.push(issue('SUB_WORKFLOW_RULE', `Node "${label(n)}": a Sub-workflow's Start node must have triggerType "${SUB_WORKFLOW_TRIGGER}" — channel triggers (chat widget, schedule, telegram, pstn) do not apply, a Sub-workflow is invoked by an AI tool call`, { nodeId: n.id, field: 'triggerType' }))
    }
    if (subStarts.length === 1) {
      const def = readSubWorkflowDefinitionFromStartData(subStarts[0].data ?? {}, subStarts[0].id)
      if (!def.ok) {
        issues.push(issue('SUB_WORKFLOW_RULE', `Node "${label(subStarts[0])}": ${def.error}`, { nodeId: subStarts[0].id, ...(def.field ? { field: def.field } : {}) }))
      }
    }
    if (!nodes.some(n => engineKind(n) === 'end')) {
      issues.push(issue('SUB_WORKFLOW_RULE', 'A Sub-workflow needs at least one End node with a custom message — its text is what the calling AI receives; without an End node every run returns {"error":"sub_workflow_no_answer"}'))
    }
    const loopBodyIds = new Set(edges.filter(e => e.sourceHandle === 'loop').map(e => e.target))
    for (const node of nodes) {
      if (isPureNote(node, edges)) continue
      if (node.type === 'tool') {
        issues.push(issue('SUB_WORKFLOW_RULE', `Node "${label(node)}": tool attachments are not allowed inside a Sub-workflow — there is no AI node to attach them to (AI nodes are not allowed here), and a Sub-workflow cannot call another Sub-workflow`, { nodeId: node.id }))
        continue
      }
      const k = engineKind(node)
      if (!k) {
        issues.push(issue('UNKNOWN_NODE_TYPE', `Node "${label(node)}" is not a runnable node type — the engine cannot resolve it and would skip it silently`, { nodeId: node.id }))
        continue
      }
      if (!SUB_WORKFLOW_ALLOWED_NODE_KINDS.has(k)) {
        issues.push(issue('SUB_WORKFLOW_RULE', `Node "${label(node)}": node type "${k}" is not allowed inside a Sub-workflow (allowed: ${[...SUB_WORKFLOW_ALLOWED_NODE_KINDS].join(', ')}; AI nodes are not allowed in v1)`, { nodeId: node.id }))
        continue
      }
      if (k === 'end') {
        const msg = node.data?.message
        if (typeof msg !== 'string' || !msg.trim()) {
          issues.push(issue('SUB_WORKFLOW_RULE', `Node "${label(node)}": the End node of a Sub-workflow needs a custom message — that text is what the calling AI receives (without it the raw Data Sheets result table or error text would be returned and possibly spoken). Use {{context.…}} templates to compose it`, { nodeId: node.id, field: 'message' }))
        }
        continue
      }
      if (!loopBodyIds.has(node.id) && !edges.some(e => e.source === node.id && isFlowEdge(e))) {
        issues.push(issue('SUB_WORKFLOW_RULE', `Node "${label(node)}" has no outgoing connection — a Sub-workflow run that ends without reaching an End node returns {"error":"sub_workflow_no_answer"} to the calling AI`, { nodeId: node.id, ...WARN }))
      }
    }
  } else {
    for (const n of nodes) {
      if (engineKind(n) !== 'start' || n.data?.triggerType !== SUB_WORKFLOW_TRIGGER) continue
      issues.push(issue('SUB_WORKFLOW_RULE', `Node "${label(n)}": triggerType "${SUB_WORKFLOW_TRIGGER}" is only valid in a Sub-workflow (workflow kind "sub") — create the workflow as a Sub-workflow instead, or use a channel trigger here`, { nodeId: n.id, field: 'triggerType' }))
    }
    const startNodes = nodes.filter(n => engineKind(n) === 'start')
    if (startNodes.some(n => n.data?.triggerType === APP_TRIGGER) && startNodes.length !== 1) {
      issues.push(issue('APP_START_RULE', `A work app workflow (Start triggerType "${APP_TRIGGER}") must have exactly one Start node (found ${startNodes.length}) — another Start would let a different channel run it without the work app scope`))
    }
    for (const n of startNodes) {
      const tt = n.data?.triggerType
      if (typeof tt === 'string' && tt !== APP_TRIGGER && tt.trim().toLowerCase() === APP_TRIGGER) {
        issues.push(issue('APP_START_RULE', `Node "${label(n)}": triggerType "${tt}" — write exactly "${APP_TRIGGER}" for a work app`, { nodeId: n.id, field: 'triggerType' }))
      }
      if (tt !== APP_TRIGGER) continue
      const t = (n.data as Record<string, unknown>)?.appTemplate
      if (t !== undefined && t !== null && t !== '' && !isAppTemplateKind(t)) {
        issues.push(issue('APP_START_RULE', `Node "${label(n)}": appTemplate "${String(t)}" is not a known app template (known: ${APP_TEMPLATE_KINDS.join(', ')}; leave it empty to choose in the first chat)`, { nodeId: n.id, field: 'appTemplate' }))
      }
      const conns = (n.data as Record<string, unknown>)?.connections
      if (conns !== undefined && conns !== null) {
        const ok = typeof conns === 'object' && !Array.isArray(conns) && Object.values(conns as Record<string, unknown>).every((slots) =>
          !!slots && typeof slots === 'object' && !Array.isArray(slots) && Object.values(slots as Record<string, unknown>).every((id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 64))
        if (!ok) issues.push(issue('APP_START_RULE', `Node "${label(n)}": connections must be { <connection kind>: { <slot>: "<connection id>" } } with non-empty text ids`, { nodeId: n.id, field: 'connections' }))
      }
      const ai = (n.data as Record<string, unknown>)?.dbAiSql
      if (ai !== undefined && ai !== null && !(typeof ai === 'object' && !Array.isArray(ai) && Object.entries(ai as Record<string, unknown>).every(([k, v]) => k.length > 0 && k.length <= 64 && typeof v === 'boolean'))) {
        issues.push(issue('APP_START_RULE', `Node "${label(n)}": dbAiSql must be { <database slot>: true | false }`, { nodeId: n.id, field: 'dbAiSql' }))
      }
      if (!telegramChatsOk((n.data as Record<string, unknown>)?.telegramChats)) {
        issues.push(issue('APP_START_RULE', `Node "${label(n)}": telegramChats must be { <telegram slot>: "<chat id — a number like -1001234567890, or @channelname>" }`, { nodeId: n.id, field: 'telegramChats' }))
      }
      if (!calendarSlotsOk((n.data as Record<string, unknown>)?.calendarSlots)) {
        issues.push(issue('APP_START_RULE', `Node "${label(n)}": calendarSlots must be { <calendar slot>: { connectionId, accountId, calendarId, calendarName? } } — picked in the studio`, { nodeId: n.id, field: 'calendarSlots' }))
      }
      const rs = (n.data as Record<string, unknown>)?.ragSpaceId
      if (rs !== undefined && rs !== null && rs !== '' && !((typeof rs === 'number' && Number.isSafeInteger(rs) && rs > 0) || (typeof rs === 'string' && /^[1-9]\d{0,9}$/.test(rs)))) {
        issues.push(issue('APP_START_RULE', `Node "${label(n)}": ragSpaceId must be a positive whole number (leave it empty for the Default space)`, { nodeId: n.id, field: 'ragSpaceId' }))
      }
    }
  }

  {
    const startNodes = nodes.filter(n => engineKind(n) === 'start')
    const evStarts = startNodes.filter(n => n.data?.triggerType === WORK_EVENT_TRIGGER)
    if (evStarts.length && startNodes.length !== 1) {
      issues.push(issue('WORK_EVENT_RULE', `A workflow started by a work app event (Start triggerType "${WORK_EVENT_TRIGGER}") must have exactly one Start node (found ${startNodes.length})`))
    }
    if (evStarts.length && startNodes.some(n => n.data?.triggerType === APP_TRIGGER)) {
      issues.push(issue('WORK_EVENT_RULE', 'A work app workflow (Start / App) cannot also be started by a work app event'))
    }
    for (const n of evStarts) {
      const d = (n.data ?? {}) as Record<string, unknown>
      const src = d.workEventWorkflowId
      if (src !== undefined && src !== null && src !== '' && (typeof src !== 'string' || src.length > 25)) {
        issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": workEventWorkflowId must be the id of a work app workflow`, { nodeId: n.id, field: 'workEventWorkflowId' }))
      } else if (level !== 'structural' && (typeof src !== 'string' || !src)) {
        issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": choose the work app whose events start this workflow (workEventWorkflowId)`, { nodeId: n.id, field: 'workEventWorkflowId' }))
      }
      const ev = d.workEvents
      if (ev !== undefined && ev !== null && (!Array.isArray(ev) || !ev.every((x) => typeof x === 'string' && (WORK_EVENT_KINDS as readonly string[]).includes(x)))) {
        issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": workEvents must be a list of ${WORK_EVENT_KINDS.join(', ')}`, { nodeId: n.id, field: 'workEvents' }))
      } else if (level !== 'structural' && (!Array.isArray(ev) || ev.length === 0)) {
        issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": choose at least one event (${WORK_EVENT_KINDS.join(', ')})`, { nodeId: n.id, field: 'workEvents' }))
      }
    }
    if (evStarts.length) {
      for (const n of nodes) {
        if (engineKind(n) === 'wait') issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": a Wait node cannot be used in a workflow started by a work app event — no person replies to it`, { nodeId: n.id }))
      }
    }
    const isApp = startNodes.some(n => n.data?.triggerType === APP_TRIGGER) && !isAppCanvas({ nodes, edges })
    for (const p of referenceLinesOf({ nodes, edges }).problems) issues.push(issue('WORK_EVENT_RULE', `Reference line: ${p.message}`, { edgeId: p.edgeId }))
    for (const l of referenceLinesOf({ nodes, edges }).lines) {
      if (level !== 'structural' && (!Array.isArray(l.sheets) || l.sheets.length === 0 || !l.sheets.every((x) => typeof x === 'string' && x))) {
        issues.push(issue('WORK_EVENT_RULE', 'Reference line: choose at least one sheet the work app may read', { edgeId: l.edgeId }))
      }
    }
    const sendLines = sendLinesOf({ nodes, edges })
    for (const p of sendLines.problems) issues.push(issue('WORK_EVENT_RULE', `Send line: ${p.message}`, { edgeId: p.edgeId }))
    for (const l of sendLines.lines) {
      if (level !== 'structural' && !l.family) issues.push(issue('WORK_EVENT_RULE', 'Send line: choose the inbox of the receiving work app', { edgeId: l.edgeId }))
    }
    for (const n of nodes) {
      if (engineKind(n) !== 'workAppStep') continue
      if (isApp) issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": the work app node connects work apps — it cannot be placed inside a work app`, { nodeId: n.id }))
      const tw = (n.data as Record<string, unknown> | undefined)?.targetWorkflowId
      const tn = (n.data as Record<string, unknown> | undefined)?.targetNodeId
      if (level !== 'structural' && !(typeof tw === 'string' && tw) && !(typeof tn === 'string' && tn)) {
        issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": choose the work app to open (targetNodeId in a workflow with Work app nodes, otherwise targetWorkflowId)`, { nodeId: n.id, field: 'targetWorkflowId' }))
      }
      const pd = (n.data as Record<string, unknown> | undefined)?.periodDate
      if (pd !== undefined && pd !== null && pd !== '' && !(pd === 'event_end' || pd === 'event_start' || pd === 'today' || isCalendarDate(pd))) {
        issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": periodDate must be event_end, event_start, today or a calendar date YYYY-MM-DD`, { nodeId: n.id, field: 'periodDate' }))
      }
    }
    const inboxTools = (aiId: string) => edges.filter((e) => e.source === aiId && e.sourceHandle === 'tools')
      .map((e) => nodes.find((x) => x.id === e.target)).filter((t) => t?.type === 'tool' && t.data?.toolType === 'workInbox')
    for (const n of nodes) {
      if (engineKind(n) !== 'ai') continue
      const k = inboxTools(n.id).length
      if (k > 1) issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(n)}" (ai): only one Work inbox tool per AI node — ${k} are attached`, { nodeId: n.id }))
      if (k > 0 && isApp) issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": a Work inbox tool is for customer-facing workflows — it cannot be attached inside a work app`, { nodeId: n.id }))
      if (k > 0 && startNodes.some((s) => s.data?.triggerType === WORK_EVENT_TRIGGER || s.data?.triggerType === 'schedule')) {
        issues.push(issue('WORK_EVENT_RULE', `Node "${label(n)}": a Work inbox tool is for customer-facing workflows — it cannot be used in a workflow started by a work app event or a schedule`, { nodeId: n.id }))
      }
    }
  }

  const canvasApps = appNodesOf({ nodes, edges })
  const canvasLinks = linkNodesOf({ nodes, edges })
  const canvasIssues = (): WorkflowJsonValidationResult | null => {
    if (!canvasApps.length && !canvasLinks.length) return null
    const C = 'WORK_APP_CANVAS_RULE' as const
    if (kind === 'sub') issues.push(issue(C, 'Work app nodes cannot be placed in a Sub-workflow'))
    const starts = nodes.filter(n => engineKind(n) === 'start')
    if (starts.length !== 1 || starts[0].data?.triggerType !== APP_TRIGGER) {
      issues.push(issue(C, `A workflow with Work app nodes needs exactly one Start node with triggerType "${APP_TRIGGER}" (Start / App)`))
    }
    const appIds = new Set(canvasApps.map(n => n.id))
    const linkIds = new Set(canvasLinks.map(n => n.id))
    const startIds = new Set(starts.map(n => n.id))
    const linkedBy = new Map<string, string>()
    for (const n of canvasLinks) {
      const d = (n.data ?? {}) as Record<string, unknown>
      if (!isSharedAppTemplateKind(d.appTemplate)) {
        issues.push(issue(C, `Node "${label(n as RawNode)}": appTemplate "${String(d.appTemplate ?? '')}" — a link node points at a shared work app (${SHARED_APP_TEMPLATE_KINDS.join(', ') || 'none in this build'})`, { nodeId: n.id, field: 'appTemplate' }))
      }
      const t = d.linkedAppWorkflowId
      if (t !== undefined && t !== null && t !== '' && (typeof t !== 'string' || t.length > 25)) {
        issues.push(issue(C, `Node "${label(n as RawNode)}": linkedAppWorkflowId must be the id of a work app`, { nodeId: n.id, field: 'linkedAppWorkflowId' }))
        continue
      }
      const target = linkTargetOf(n)
      if (!target) {
        if (level !== 'structural') issues.push(issue('LINK_TARGET_MISSING', `Node "${label(n as RawNode)}": choose the work app this link points at`, { nodeId: n.id, field: 'linkedAppWorkflowId' }))
        continue
      }
      const first = linkedBy.get(target)
      if (first) issues.push(issue(C, `Node "${label(n as RawNode)}": this work app is already linked by node "${first}" — one link node per app`, { nodeId: n.id }))
      else linkedBy.set(target, label(n as RawNode))
    }
    if (canvasLinks.length && !canvasApps.length && level !== 'structural') {
      issues.push(issue(C, 'A link node joins a work app of this workflow by a reference line — add at least one Work app node'))
    }
    for (const n of canvasApps) {
      const d = (n.data ?? {}) as Record<string, unknown>
      if (n.id.length > 100) issues.push(issue(C, `Node "${label(n as RawNode)}": a Work app node id must be at most 100 characters`, { nodeId: n.id }))
      const t = d.appTemplate
      if (t !== undefined && t !== null && t !== '' && !isAppTemplateKind(t)) {
        issues.push(issue(C, `Node "${label(n as RawNode)}": appTemplate "${String(t)}" is not a known app template (known: ${APP_TEMPLATE_KINDS.join(', ')}; leave it empty to choose in the first chat)`, { nodeId: n.id, field: 'appTemplate' }))
      }
      const conns = d.connections
      if (conns !== undefined && conns !== null && !(typeof conns === 'object' && !Array.isArray(conns) && Object.values(conns as Record<string, unknown>).every((slots) =>
        !!slots && typeof slots === 'object' && !Array.isArray(slots) && Object.values(slots as Record<string, unknown>).every((id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 64)))) {
        issues.push(issue(C, `Node "${label(n as RawNode)}": connections must be { <connection kind>: { <slot>: "<connection id>" } } with non-empty text ids`, { nodeId: n.id, field: 'connections' }))
      }
      const aiSql = d.dbAiSql
      if (aiSql !== undefined && aiSql !== null && !(typeof aiSql === 'object' && !Array.isArray(aiSql) && Object.entries(aiSql as Record<string, unknown>).every(([k, v]) => k.length > 0 && k.length <= 64 && typeof v === 'boolean'))) {
        issues.push(issue(C, `Node "${label(n as RawNode)}": dbAiSql must be { <database slot>: true | false }`, { nodeId: n.id, field: 'dbAiSql' }))
      }
      if (!telegramChatsOk(d.telegramChats)) {
        issues.push(issue(C, `Node "${label(n as RawNode)}": telegramChats must be { <telegram slot>: "<chat id — a number like -1001234567890, or @channelname>" }`, { nodeId: n.id, field: 'telegramChats' }))
      }
      if (!calendarSlotsOk(d.calendarSlots)) {
        issues.push(issue(C, `Node "${label(n as RawNode)}": calendarSlots must be { <calendar slot>: { connectionId, accountId, calendarId, calendarName? } } — picked in the studio`, { nodeId: n.id, field: 'calendarSlots' }))
      }
      const rs = d.ragSpaceId
      if (rs !== undefined && rs !== null && rs !== '' && !((typeof rs === 'number' && Number.isSafeInteger(rs) && rs > 0) || (typeof rs === 'string' && /^[1-9]\d{0,9}$/.test(rs)))) {
        issues.push(issue(C, `Node "${label(n as RawNode)}": ragSpaceId must be a positive whole number (leave it empty for the Default space)`, { nodeId: n.id, field: 'ragSpaceId' }))
      }
      const ai = d.ai
      if (ai !== undefined && ai !== null) {
        const a = ai as Record<string, unknown>
        const ok = typeof ai === 'object' && !Array.isArray(ai)
          && (a.model === undefined || (typeof a.model === 'string' && a.model.length <= 100))
          && (a.systemMessage === undefined || (typeof a.systemMessage === 'string' && a.systemMessage.length <= 20000))
          && (a.maxTokens === undefined || (typeof a.maxTokens === 'number' && Number.isSafeInteger(a.maxTokens) && a.maxTokens > 0 && a.maxTokens <= 128000))
          && ['imageInput', 'pdfInput', 'includeChatHistory'].every((k) => a[k] === undefined || typeof a[k] === 'boolean')
        if (!ok) issues.push(issue(C, `Node "${label(n as RawNode)}": ai must be { model, systemMessage, maxTokens, imageInput, pdfInput, includeChatHistory }`, { nodeId: n.id, field: 'ai' }))
      }
    }
    for (const e of edges) {
      const fromApp = appIds.has(e.source)
      const toApp = appIds.has(e.target)
      const h = typeof e.sourceHandle === 'string' ? e.sourceHandle : ''
      if (linkIds.has(e.source) || linkIds.has(e.target)) {
        const other = linkIds.has(e.source) ? e.target : e.source
        if (h !== 'ref' || !appIds.has(other)) {
          issues.push(issue(C, 'A link node connects only by a reference line (ref) to a Work app node of this workflow', { edgeId: e.id, nodeId: linkIds.has(e.source) ? e.source : e.target }))
        }
        continue
      }
      if (fromApp && h !== 'send' && h !== 'ref' && h !== DONE_HANDLE && !eventKindOfHandle(h)) {
        issues.push(issue(C, `A Work app node connects only by its send / ref lines, its "${DONE_HANDLE}" output or an event output (${EVENT_HANDLE_PREFIX}sealed …) — "${h || 'default'}" is not one`, { edgeId: e.id, nodeId: e.source }))
      }
      if (toApp && fromApp && !(h === 'send' || h === 'ref' || h === DONE_HANDLE)) {
        issues.push(issue(C, 'Between two Work app nodes only a send / ref line or a "done" handoff line can connect', { edgeId: e.id, nodeId: e.target }))
      }
      if (toApp && !fromApp && !startIds.has(e.source) && (h === 'tools' || h === 'send' || h === 'ref' || eventKindOfHandle(h))) {
        issues.push(issue(C, 'Only the Start / App node, another Work app node or a flow after a "done" output can connect into a Work app node', { edgeId: e.id, nodeId: e.target }))
      }
      if (startIds.has(e.source) && starts[0]?.data?.triggerType === APP_TRIGGER && !toApp) {
        issues.push(issue(C, 'In a workflow with Work app nodes, the Start / App node connects only to Work app nodes — flows start from a Work app event output', { edgeId: e.id, nodeId: e.source }))
      }
    }
    for (const n of nodes) {
      if (engineKind(n) === 'wait') issues.push(issue(C, `Node "${label(n)}": a Wait node cannot be used in a workflow with Work app nodes — its flows run after an app event and no person replies`, { nodeId: n.id }))
    }
    for (const n of nodes) {
      if (engineKind(n) !== 'workAppStep') continue
      const tn = n.data?.targetNodeId
      if (tn !== undefined && tn !== null && tn !== '' && !(typeof tn === 'string' && appIds.has(tn))) {
        issues.push(issue(C, `Node "${label(n)}": targetNodeId must be a Work app node of this workflow`, { nodeId: n.id, field: 'targetNodeId' }))
      }
    }
    for (const n of nodes) {
      if (engineKind(n) === HANDOFF_NODE) issues.push(issue(C, `Node "${label(n)}": "${HANDOFF_NODE}" is made by the server — connect a "done" flow into a Work app node instead`, { nodeId: n.id }))
    }
    const graphs: Array<{ app: string; kind: string; json: string }> = []
    const covered = new Set<string>()
    const ho = handoffRoutesOf({ nodes, edges })
    for (const p of ho.problems) {
      issues.push(issue(C, `Work app "${label(canvasApps.find(n => n.id === p.appNodeId) as RawNode)}": ${p.message}`, { nodeId: p.appNodeId }))
    }
    const cyc = handoffCycle(ho.routes)
    if (cyc) issues.push(issue(C, `Work app "${label(canvasApps.find(n => n.id === cyc) as RawNode)}": the "done" handoffs go round in a loop — a correction goes back by a send line instead`, { nodeId: cyc }))
    for (const a of canvasApps) {
      if (!edges.some(e => e.source === a.id && e.sourceHandle === DONE_HANDLE)) continue
      const appLabel = label(a as RawNode)
      const g = doneRunGraph({ nodes, edges }, a.id, 'wf_canvas_check')
      if (!g) {
        if (!ho.problems.some(p => p.appNodeId === a.id)) issues.push(issue(C, `Work app "${appLabel}": its "done" flow cannot be taken apart`, { nodeId: a.id }))
        continue
      }
      for (const x of g.nodes) if (typeof x.id === 'string') covered.add(x.id)
      const vNodes = g.nodes
        .filter(x => !(typeof x.id === 'string' && x.id.startsWith('__work_event_start-end-')))
        .map(x => (x.data?.nodeType === HANDOFF_NODE ? { ...x, data: { label: x.data?.label ?? 'Work app', nodeType: 'end' } } : x))
      const vIds = new Set(vNodes.map(x => x.id))
      graphs.push({ app: appLabel, kind: DONE_HANDLE, json: JSON.stringify({ nodes: vNodes, edges: g.edges.filter(e => vIds.has(e.source as string) && vIds.has(e.target as string)) }) })
    }
    for (const en of canvasEventEntries({ nodes, edges })) {
      const g = eventRunGraph({ nodes, edges }, en.appNodeId, en.kind, 'wf_canvas_check')
      const appLabel = label(canvasApps.find(n => n.id === en.appNodeId) as RawNode)
      if (!g) {
        issues.push(issue(C, `Work app "${appLabel}": the flow after its "${en.kind}" event must not lead back to a Start or Work app node (or into a send / ref line)`, { nodeId: en.appNodeId }))
        continue
      }
      for (const x of g.nodes) if (typeof x.id === 'string') covered.add(x.id)
      graphs.push({ app: appLabel, kind: en.kind, json: JSON.stringify(g) })
    }
    if (level === 'structural' || issues.some(isBlocking)) return { valid: !issues.some(isBlocking), level, issues }
    for (const n of nodes) {
      if (appIds.has(n.id) || linkIds.has(n.id) || startIds.has(n.id) || covered.has(n.id) || isPureNote(n, edges)) continue
      issues.push(issue(C, `Node "${label(n)}" is not connected to any Work app event or "done" output — it never runs`, { nodeId: n.id }))
    }
    for (const g of graphs) {
      const sub = validateWorkflowJson(g.json, 'deployable', 'main')
      for (const i of sub.issues) issues.push({ ...i, message: `Work app "${g.app}" · ${g.kind} event: ${i.message}` })
    }
    return { valid: !issues.some(isBlocking), level, issues }
  }
  const canvasResult = canvasIssues()
  if (canvasResult) return canvasResult

  if (level === 'structural' || issues.some(isBlocking)) {
    return { valid: !issues.some(isBlocking), level, issues }
  }

  // ========================================
  // ========================================

  const attachmentIds = collectAttachmentIds(nodes, edges)
  const isAttachment = (n: RawNode) => attachmentIds.has(n.id) || isPureNote(n, edges)
  const logicNodes = nodes.filter(n => !isAttachment(n))
  const flowEdges = edges.filter(isFlowEdge)
  const kindById = new Map(nodes.map(n => [n.id, engineKind(n) ?? 'unknown']))

  const startNode = logicNodes.find(n => engineKind(n) === 'start')
  const hasEnd = logicNodes.some(n => engineKind(n) === 'end')
  if (!startNode) issues.push(issue('START_NODE_MISSING', 'Workflow must have a Start node to deploy'))
  if (!hasEnd) issues.push(issue('END_NODE_MISSING', 'Workflow must have an End node to deploy'))

  const isBranchKind = (k: string | undefined) => k === 'ifElse' || k === 'condition'

  const branchHandlesOf = (node: RawNode): string[] => {
    const conditions = Array.isArray(node.data?.conditions) ? node.data.conditions : []
    const handles: string[] = []
    for (const c of conditions as Array<{ id?: unknown; type?: unknown }>) {
      if (c?.type === 'else') { handles.push('else'); break }
      if (c && typeof c.id === 'string' && c.id) handles.push(c.id)
    }
    return handles
  }

  const mainFlowSuccessors = (node: RawNode): string[] => {
    const kind = kindById.get(node.id)
    if (!kind || kind === 'unknown') {
      const e = edges.find(x => x.source === node.id && !x.sourceHandle)
      return e ? [e.target] : []
    }
    if (kind === 'while') {
      const e = edges.find(x => x.source === node.id && x.sourceHandle === 'exit')
      return e ? [e.target] : []
    }
    if (isBranchKind(kind)) {
      const out: string[] = []
      for (const h of branchHandlesOf(node)) {
        const e = edges.find(x => x.source === node.id && x.sourceHandle === h)
        if (e) out.push(e.target)
      }
      return out
    }
    const e = edges.find(
      x => x.source === node.id &&
        (!x.sourceHandle || (x.sourceHandle !== 'tools' && x.sourceHandle !== 'loop' && x.sourceHandle !== 'miniapps' && x.sourceHandle !== 'ref' && x.sourceHandle !== 'send')),
    )
    return e ? [e.target] : []
  }


  const isBranchChainEdge = (e: RawEdge) => !e.sourceHandle || e.sourceHandle === 'default' || e.sourceHandle === 'output'

  const loopBodyOf = (whileId: string): Set<string> => {
    const body = new Set<string>()
    const queue: string[] = []
    for (const e of edges) {
      if (e.source !== whileId || e.sourceHandle !== 'loop') continue
      body.add(e.target) // (1)
      const branchNode = nodes.find(n => n.id === e.target)
      if (!branchNode || !isBranchKind(kindById.get(e.target))) continue
      if (branchNode.data?.includeBranchesInLoop === false) continue
      for (const h of branchHandlesOf(branchNode)) {
        const be = edges.find(x => x.source === e.target && x.sourceHandle === h)
        if (be) queue.push(be.target)
      }
    }
    //   `while (currentNode)` { if (!nodeType || nodeType === 'end') break; ...;
    while (queue.length > 0) {
      const id = queue.pop()!
      if (body.has(id)) continue
      body.add(id)
      const kind = kindById.get(id)
      if (!kind || kind === 'unknown' || kind === 'end') continue
      const nextEdge = edges.find(e => e.source === id && isBranchChainEdge(e))
      if (nextEdge && !body.has(nextEdge.target)) queue.push(nextEdge.target)
    }
    return body
  }

  const loopBody = new Set<string>()

  //
  const reachable = new Set<string>()
  const mainVisited = new Set<string>()
  if (startNode) {
    const queue = [startNode.id]
    while (queue.length > 0) {
      const id = queue.pop()!
      if (mainVisited.has(id)) continue
      mainVisited.add(id)
      reachable.add(id)
      const node = nodes.find(n => n.id === id)
      if (!node) continue
      if (kindById.get(id) === 'while') {
        for (const bid of loopBodyOf(id)) {
          loopBody.add(bid)
          reachable.add(bid)
        }
      }
      for (const t of mainFlowSuccessors(node)) if (!mainVisited.has(t)) queue.push(t)
    }
  }

  for (const e of edges) {
    if (e.sourceHandle !== 'loop' || kindById.get(e.source) !== 'while') continue
    const target = nodes.find(n => n.id === e.target)
    if (!target) continue
    if (target.data?.isLoopTool !== true) {
      issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(target)}" is connected to a while loop body but has no data.isLoopTool: true — the loop would silently skip it (loop body nodes also need data.loopOrder)`, { nodeId: target.id, ...WARN }))
    }
    if (kindById.get(target.id) === 'while') {
      issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(target)}" is a while node used as a loop body — nested loops are not supported (if execution reaches it, the workflow aborts with a runtime error). Restructure to a single loop`, { nodeId: target.id, ...WARN }))
    }
  }

  {
    const channel = miniAppChannelOf(nodes)
    let sawVoiceQuiz = false
    for (const e of edges) {
      if (e.sourceHandle !== 'miniapps') continue
      const target = nodes.find(n => n.id === e.target)
      if (!target) continue
      if (!isMiniAppNode(target)) {
        issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(target)}" is attached to the miniapps handle but is not a registered Mini App node (needs type "tool" with data.nodeType "miniapp" and data.miniAppType one of ${MINI_APP_TYPES.join('/')}) — the runtime would ignore it`, { nodeId: target.id, ...WARN }))
        continue
      }
      const appType = target.data?.miniAppType as MiniAppType
      if (!channel || !isMiniAppAllowedOn(appType, channel)) {
        const spec = MINI_APP_REGISTRY[appType]
        issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(target)}" (Mini App "${appType}") only runs on Start channel ${spec.channels.join('/')} (runtime: ${spec.runtime}) — this workflow's Start is "${channel ?? 'missing'}", so it would be ignored`, { nodeId: target.id, ...WARN }))
        continue
      }
      if (appType === 'voice_quiz') {
        const hasSource = edges.some((se) => {
          if (se.source !== e.source || se.sourceHandle !== 'tools') return false
          const sn = nodes.find((n) => n.id === se.target)
          return sn?.type === 'tool' && (sn.data?.toolType === 'source' || sn.data?.nodeType === 'source')
        })
        if (!hasSource) {
          issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(target)}" (Voice Quiz): the AI node needs a Source (knowledge base) tool attached — the server generates the questions from it, so without one the quiz silently does nothing on a call`, { nodeId: target.id, ...WARN }))
        }
        const hooks = (target.data?.hooks ?? {}) as { onRoundStart?: unknown; onRoundSettle?: unknown; onMemberChange?: unknown }
        const trimmed = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
        const onStart = trimmed(hooks.onRoundStart)
        const onSettle = trimmed(hooks.onRoundSettle)
        if (!onStart || !onSettle) {
          issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(target)}" (Voice Quiz): both hooks must point to a Sub-workflow attached to the same AI node's tools — hooks.onRoundStart (member check / round row) and hooks.onRoundSettle (reward payout). Without them a round has no payout, so deploy is refused`, { nodeId: target.id, field: 'hooks' }))
        }
        const aiId = e.source
        const attachedSubIds = new Set<string>()
        for (const te of edges) {
          if (te.source !== aiId || te.sourceHandle !== 'tools') continue
          const tn = nodes.find(n => n.id === te.target)
          const sid = tn?.type === 'tool' && tn.data?.toolType === 'subworkflow' && typeof tn.data?.subWorkflowId === 'string' ? tn.data.subWorkflowId.trim() : ''
          if (sid) attachedSubIds.add(sid)
        }
        for (const [name, sid] of [['onRoundStart', onStart], ['onRoundSettle', onSettle]] as const) {
          if (sid && !attachedSubIds.has(sid)) {
            issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(target)}" (Voice Quiz): hooks.${name} refers to Sub-workflow "${sid}" which is not attached to this AI node's tools handle — attach that Sub-workflow tool node to the same AI node`, { nodeId: target.id, field: 'hooks' }))
          }
        }
        sawVoiceQuiz = true

        const optionalWiring: Array<[string, string, string]> = []
        const onMember = trimmed(hooks.onMemberChange)
        if (onMember) optionalWiring.push(['hooks.onMemberChange', onMember, 'hooks'])
        const signupSub = trimmed(target.data?.signupSubWorkflowId)
        if (signupSub) optionalWiring.push(['signupSubWorkflowId', signupSub, 'signupSubWorkflowId'])
        for (const [name, sid, field] of optionalWiring) {
          if (!attachedSubIds.has(sid)) {
            issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(target)}" (Voice Quiz): ${name} refers to Sub-workflow "${sid}" which is not attached to this AI node's tools handle — the call cannot reach it, so that feature stays off`, { nodeId: target.id, field, ...WARN }))
          }
        }
      }
    }

    if (sawVoiceQuiz) {
      const pstnWebVoiceNode = nodes.find(
        (n) => n.data?.nodeType === 'start' && n.data?.triggerType === 'pstn' && (n.data as any)?.webVoice?.enabled === true,
      )
      if (pstnWebVoiceNode) {
        issues.push(issue('NODE_SPEC_VIOLATION', `Web Voice is on for this workflow, but Voice Quiz only runs on phone calls (PSTN) — browser callers get no quiz at all. If your greeting or AI instructions invite people to the quiz, web visitors will ask for something the AI cannot do. Turn Web Voice off for real service, or keep the quiz out of what the AI offers on the web.`, { nodeId: pstnWebVoiceNode.id, field: 'webVoice', ...WARN }))
      }
    }
  }

  for (const node of nodes) {
    const key = attachmentIds.has(node.id)
      ? 'tool'
      : isPureNote(node, edges)
        ? 'note'
        : resolveCatalogKey(engineKind(node) ?? 'unknown')
    const spec = NODE_CATALOG[key]
    if (!spec) {
      issues.push(issue('UNKNOWN_NODE_TYPE', `Node "${label(node)}" is not a runnable node type — the engine cannot resolve it and would skip it silently. Set data.nodeType to a supported type (see the node catalog)`, { nodeId: node.id }))
      continue
    }
    for (const specIssue of validateNodeAgainstSpec({ id: node.id, data: node.data }, spec)) {
      issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(node)}" (${key}): ${specIssue.message}`, {
        nodeId: node.id,
        ...(specIssue.field ? { field: specIssue.field } : {}),
        ...(specIssue.severity === 'warning' ? WARN : {}),
      }))
    }

    if (key === 'httpRequest' && ((node.data?.mode as string | undefined) ?? 'single') === 'multi') {
      const reqs = node.data?.requests
      if (Array.isArray(reqs)) {
        const seenAlias = new Set<string>()
        reqs.forEach((r, i) => {
          const req = r as { alias?: unknown; enabled?: unknown } | null
          if (!req || !req.enabled) return
          const alias = typeof req.alias === 'string' ? req.alias : ''
          if (!alias.trim()) {
            issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(node)}" (httpRequest): requests[${i}] has an empty "alias" — every enabled request needs an explicit one because results are keyed by it (context.httpResult.<alias>), so blank entries collide with each other`, { nodeId: node.id, field: 'requests' }))
            return
          }
          if (alias.includes('.') || alias.includes('}') || isUnsafeTemplateSegment(alias)) {
            issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(node)}" (httpRequest): request alias "${alias}" is not usable as a result key — it must not contain "." (the template path separator) or "}" (the template terminator), and must not be a prototype name (__proto__ / prototype / constructor), which the documented {{context.httpResult.<alias>}} path refuses to read`, { nodeId: node.id, field: 'requests' }))
            return
          }
          if (seenAlias.has(alias)) {
            issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(node)}" (httpRequest): duplicate request alias "${alias}" — the later request silently overwrites the earlier result in context.httpResult`, { nodeId: node.id, field: 'requests' }))
            return
          }
          seenAlias.add(alias)
        })
      }
    }

    if (key === 'httpRequest' && node.data?.mode !== 'multi' && node.data?.authType === 'hmac') {
      issues.push(issue('NODE_SPEC_VIOLATION', `Node "${label(node)}" (httpRequest): authType "hmac" works in multi mode only — in single mode the executor attaches neither the API key header nor the signature, so the request goes out unauthenticated and the target API rejects it with no hint why. Switch mode to "multi" (the Binance preset does) or pick another authType`, { nodeId: node.id, field: 'authType' }))
    }

    //
    const conditionKind = engineKind(node)
    if (conditionKind === 'ifElse' || conditionKind === 'condition') {
      const conds = node.data?.conditions
      if (Array.isArray(conds)) {
        for (let i = 0; i < conds.length; i++) {
          const cond = conds[i] as Record<string, unknown> | null
          if (!cond || typeof cond !== 'object') continue
          if (cond.type === 'else') break
          const mode = (cond.conditionMode as string | undefined) || 'simple'
          if (mode !== 'code' && mode !== 'advanced') continue
          const reason = checkSafeExpressionSyntax(cond.customExpression)
          if (reason) {
            issues.push(issue('CONDITION_EXPRESSION_INVALID', `Node "${label(node)}": conditions[${i}] is in Code mode but ${reason}. The engine evaluates an unparsable condition to false, so this branch never matches at runtime — the flow moves on to the next condition, then to Else, and ends unmatched if there is none`, { nodeId: node.id, field: 'conditions' }))
          }
        }
      }
    } else if (conditionKind === 'while' && node.data?.loopMode !== 'forEach') {
      const mode = (node.data?.conditionMode as string | undefined) || 'simple'
      if (mode === 'code' || mode === 'advanced') {
        const reason = checkSafeExpressionSyntax(node.data?.customExpression)
        if (reason) {
          issues.push(issue('CONDITION_EXPRESSION_INVALID', `Node "${label(node)}": the While condition is in Code mode but ${reason}. The engine evaluates an unparsable condition to false, so the loop exits immediately and its body never runs`, { nodeId: node.id, field: 'customExpression' }))
        }
      }
    }
  }

  for (const node of logicNodes) {
    const kind = engineKind(node)
    if (startNode && node.id === startNode.id) continue

    if (kind === 'start' && !reachable.has(node.id)) {
      issues.push(issue('UNREACHABLE_NODE', `Node "${label(node)}" is an extra Start node that never runs — only the first Start node is executed`, { nodeId: node.id, ...WARN }))
      continue
    }

    if (kind === 'workAppStep' && !flowEdges.some(e => e.target === node.id || e.source === node.id) && edges.some(e => (e.sourceHandle === 'ref' || e.sourceHandle === 'send') && (e.source === node.id || e.target === node.id))) continue

    if (!flowEdges.some(e => e.target === node.id)) {
      issues.push(issue('ORPHAN_NODE', `Node "${label(node)}" has no incoming connection`, { nodeId: node.id }))
    } else if (startNode && !reachable.has(node.id)) {
      issues.push(issue('UNREACHABLE_NODE', `Node "${label(node)}" is not reachable from the Start node`, { nodeId: node.id, ...WARN }))
    }

    //
    if (kind !== 'end' && mainVisited.has(node.id) && mainFlowSuccessors(node).length === 0) {
      issues.push(issue('DEAD_END_NODE', `Node "${label(node)}" has no outgoing connection the engine would follow`, { nodeId: node.id, ...WARN }))
    }
  }

  return { valid: !issues.some(isBlocking), level, issues }
}

function label(node: RawNode): string {
  const l = node.data?.label
  return typeof l === 'string' && l ? `${l} (${node.id})` : node.id
}

function findCycle(nodes: RawNode[], flowEdges: RawEdge[], seeds?: RawNode[]): string | null {
  const outgoing = new Map<string, string[]>()
  for (const e of flowEdges) {
    const list = outgoing.get(e.source)
    if (list) list.push(e.target)
    else outgoing.set(e.source, [e.target])
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  for (const start of seeds ?? nodes) {
    if (visited.has(start.id)) continue
    const stack: Array<{ id: string; childIndex: number }> = [{ id: start.id, childIndex: 0 }]
    inStack.add(start.id)
    visited.add(start.id)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const children = outgoing.get(frame.id) ?? []
      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex]
        frame.childIndex++
        if (inStack.has(child)) return child
        if (!visited.has(child)) {
          visited.add(child)
          inStack.add(child)
          stack.push({ id: child, childIndex: 0 })
        }
      } else {
        inStack.delete(frame.id)
        stack.pop()
      }
    }
  }
  return null
}

export function findReachableCycle(raw: string, extraEntryNodeIds: Array<string | undefined> = []): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const root = parsed as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(root.nodes) || !Array.isArray(root.edges)) return null

  const nodes = root.nodes.filter(
    (n): n is RawNode => typeof n === 'object' && n !== null && typeof (n as RawNode).id === 'string',
  )
  const flowEdges = root.edges.filter(
    (e): e is RawEdge =>
      typeof e === 'object' && e !== null &&
      typeof (e as RawEdge).source === 'string' && typeof (e as RawEdge).target === 'string' &&
      isFlowEdge(e as RawEdge),
  )

  const seeds: RawNode[] = []
  const startNode = nodes.find(n => engineKind(n) === 'start')
  if (startNode) seeds.push(startNode)
  for (const id of extraEntryNodeIds) {
    if (!id) continue
    const node = nodes.find(n => n.id === id)
    if (node && !seeds.includes(node)) seeds.push(node)
  }
  if (seeds.length === 0) return null

  return findCycle(nodes, flowEdges, seeds)
}

function calendarSlotsOk(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v !== 'object' || Array.isArray(v)) return false
  const txt = (x: unknown, max: number) => typeof x === 'string' && x.trim().length > 0 && x.length <= max
  return Object.entries(v as Record<string, unknown>).every(([k, x]) => {
    if (!(k.length > 0 && k.length <= 64) || !x || typeof x !== 'object' || Array.isArray(x)) return false
    const o = x as Record<string, unknown>
    return Object.keys(o).every((f) => ['connectionId', 'accountId', 'calendarId', 'calendarName'].includes(f)) && txt(o.connectionId, 64) && txt(o.accountId, 64) && txt(o.calendarId, 300) && (o.calendarName === undefined || (typeof o.calendarName === 'string' && o.calendarName.length <= 120))
  })
}

function telegramChatsOk(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v !== 'object' || Array.isArray(v)) return false
  return Object.entries(v as Record<string, unknown>).every(([k, x]) => k.length > 0 && k.length <= 64 && typeof x === 'string' && (x.trim() === '' || /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/.test(x.trim())))
}
