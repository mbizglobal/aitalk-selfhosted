
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
import { APP_TRIGGER } from './start-trigger'
import { APP_TEMPLATE_KINDS, isAppTemplateKind } from '@/lib/work/app-template-kinds'

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
  return edge.sourceHandle !== 'tools' && edge.sourceHandle !== 'miniapps'
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
    }
  }

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
        (!x.sourceHandle || (x.sourceHandle !== 'tools' && x.sourceHandle !== 'loop' && x.sourceHandle !== 'miniapps')),
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
