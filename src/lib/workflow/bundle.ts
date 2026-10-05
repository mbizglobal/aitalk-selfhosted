
import { SUB_WORKFLOW_TOOL_NAME_RE, findSubWorkflowStartNodes } from './subworkflow'

export const BUNDLE_VERSION = 1

export const MAIN_GRAPH_KEY = '@main'

export type BundleRefKind = 'sub' | 'sheet' | 'sheetName' | 'subtool'

export const STRUCTURAL_FIELD_REF = {
  subWorkflowId: 'sub',
  signupSubWorkflowId: 'sub',
  'hooks.onRoundStart': 'sub',
  'hooks.onRoundSettle': 'sub',
  'hooks.onMemberChange': 'sub',
  sheetId: 'sheet',
  sheetName: 'sheetName',
} as const satisfies Record<string, Exclude<BundleRefKind, 'subtool'>>

export const STRUCTURAL_FIELDS = Object.keys(STRUCTURAL_FIELD_REF) as ReadonlyArray<keyof typeof STRUCTURAL_FIELD_REF>

export const BODY_FIELDS = ['systemMessage', 'toolDescription'] as const

const KEY_RE = /^[a-z0-9_]+$/

const TOKEN_CANDIDATE_RE = /@([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([^\s"',}\]]*)/g

function looksLikeOurToken(namespace: string): boolean {
  const n = namespace.toLowerCase().replace(/[_-]/g, '')
  return n.startsWith('sub') || n.startsWith('sheet')
}

const WHOLE_TOKEN_RE = /^@(sub|sheet|sheetName|subtool):([a-z0-9_]+)$/

const BODY_INLINE_RE = /@(subtool|sheetName):([a-z0-9_]+)/g

export interface BundleSheetSpec {
  key: string
  name: string
  description?: string
  columns: Array<{ name: string; type: string; required?: boolean; description?: string }>
}

export interface BundleSubSpec {
  key: string
  name: string
  description?: string
  workflowJson: string
}

export interface BundleWiring {
  graph: string
  node: string
  field: string
  ref: Exclude<BundleRefKind, 'subtool'>
  key: string
}

export interface BundleSpec {
  bundleVersion: number
  group?: { name: string }
  dataSheets: BundleSheetSpec[]
  subWorkflows: BundleSubSpec[]
  wiring: BundleWiring[]
}

export interface BundleProblem {
  code: string
  message: string
}

type Result<T> = { ok: true; value: T } | { ok: false; problems: BundleProblem[] }

const problem = (code: string, message: string): BundleProblem => ({ code, message })

const slotKey = (graph: string, node: string, field: string): string => JSON.stringify([graph, node, field])

// ========================================
// ========================================

export function parseBundleSpec(raw: unknown): Result<BundleSpec> | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (t.bundleVersion === undefined || t.bundleVersion === null) return null

  const problems: BundleProblem[] = []

  if (t.bundleVersion !== BUNDLE_VERSION) {
    return {
      ok: false,
      problems: [problem('BUNDLE_VERSION_UNSUPPORTED', `bundleVersion ${String(t.bundleVersion)} is not supported (expected ${BUNDLE_VERSION}).`)],
    }
  }
  if (t.dataSheetSchema !== undefined) {
    problems.push(problem('BUNDLE_LEGACY_SHEET_MIXED', 'A bundle template cannot also carry dataSheetSchema — declare the sheet in dataSheets instead.'))
  }

  const dataSheets = readSheets(t.dataSheets, problems)
  const subWorkflows = readSubs(t.subWorkflows, problems)

  if (dataSheets.length === 0 && subWorkflows.length === 0) {
    problems.push(problem('BUNDLE_EMPTY', 'A bundle must declare at least one sub-workflow or one data sheet.'))
  }

  const group = readGroup(t.group, problems)
  const wiring = readWiring(t.wiring, problems)

  const sheetKeys = new Set(dataSheets.map((s) => s.key))
  const subKeys = new Set(subWorkflows.map((s) => s.key))
  const graphKeys = new Set<string>([MAIN_GRAPH_KEY, ...subKeys])
  const usedSheet = new Set<string>()
  const usedSub = new Set<string>()

  for (const w of wiring) {
    if (!graphKeys.has(w.graph)) {
      problems.push(problem('BUNDLE_WIRING_GRAPH_UNKNOWN', `wiring references graph "${w.graph}" which is not "${MAIN_GRAPH_KEY}" or a declared sub-workflow key.`))
    }
    if (w.ref === 'sub') {
      if (!subKeys.has(w.key)) problems.push(problem('BUNDLE_WIRING_KEY_UNKNOWN', `wiring references sub "${w.key}" which is not declared.`))
      usedSub.add(w.key)
    } else {
      if (!sheetKeys.has(w.key)) problems.push(problem('BUNDLE_WIRING_KEY_UNKNOWN', `wiring references sheet "${w.key}" which is not declared.`))
      usedSheet.add(w.key)
    }
  }
  for (const k of sheetKeys) {
    if (!usedSheet.has(k)) problems.push(problem('BUNDLE_KEY_UNUSED', `data sheet "${k}" is declared but nothing wires to it.`))
  }
  for (const k of subKeys) {
    if (!usedSub.has(k)) problems.push(problem('BUNDLE_KEY_UNUSED', `sub-workflow "${k}" is declared but nothing wires to it.`))
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { bundleVersion: BUNDLE_VERSION, group, dataSheets, subWorkflows, wiring } }
}

function readKeyed(v: unknown, what: string, problems: BundleProblem[]): Record<string, unknown>[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) {
    problems.push(problem('BUNDLE_SHAPE_INVALID', `${what} must be an array.`))
    return []
  }
  const out: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (!item || typeof item !== 'object') {
      problems.push(problem('BUNDLE_SHAPE_INVALID', `${what} contains a non-object entry.`))
      continue
    }
    const o = item as Record<string, unknown>
    const key = typeof o.key === 'string' ? o.key : ''
    if (!KEY_RE.test(key)) {
      problems.push(problem('BUNDLE_KEY_INVALID', `${what} has an invalid key ${JSON.stringify(o.key)} — use lower-case letters, digits and underscore.`))
      continue
    }
    if (seen.has(key)) {
      problems.push(problem('BUNDLE_KEY_DUPLICATE', `${what} declares key "${key}" more than once.`))
      continue
    }
    seen.add(key)
    if (typeof o.name !== 'string' || !o.name.trim()) {
      problems.push(problem('BUNDLE_SHAPE_INVALID', `${what} "${key}" needs a non-empty name.`))
      continue
    }
    out.push(o)
  }
  return out
}

const SHEET_COLUMN_TYPES = ['string', 'number', 'boolean', 'date'] as const

function readSheets(v: unknown, problems: BundleProblem[]): BundleSheetSpec[] {
  return readKeyed(v, 'dataSheets', problems).flatMap((o) => {
    const where = `dataSheets "${String(o.key)}"`
    const cols = o.columns
    if (!Array.isArray(cols) || cols.length === 0) {
      problems.push(problem('BUNDLE_SHAPE_INVALID', `${where} needs at least one column.`))
      return []
    }
    const out: BundleSheetSpec['columns'] = []
    const seen = new Set<string>()
    let bad = false
    for (const c of cols) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        problems.push(problem('BUNDLE_SHAPE_INVALID', `${where} has a column that is not an object.`))
        bad = true
        continue
      }
      const col = c as Record<string, unknown>
      const name = typeof col.name === 'string' ? col.name.trim() : ''
      if (!name) {
        problems.push(problem('BUNDLE_SHAPE_INVALID', `${where} has a column without a name.`))
        bad = true
        continue
      }
      if (seen.has(name)) {
        problems.push(problem('BUNDLE_SHAPE_INVALID', `${where} declares the column "${name}" more than once.`))
        bad = true
        continue
      }
      seen.add(name)
      if (typeof col.type !== 'string' || !(SHEET_COLUMN_TYPES as readonly string[]).includes(col.type)) {
        problems.push(problem('BUNDLE_SHAPE_INVALID', `${where} column "${name}" needs a type of ${SHEET_COLUMN_TYPES.join('/')}.`))
        bad = true
        continue
      }
      if (col.required !== undefined && typeof col.required !== 'boolean') {
        problems.push(problem('BUNDLE_SHAPE_INVALID', `${where} column "${name}": required must be true or false.`))
        bad = true
        continue
      }
      if (col.description !== undefined && typeof col.description !== 'string') {
        problems.push(problem('BUNDLE_SHAPE_INVALID', `${where} column "${name}": description must be a string.`))
        bad = true
        continue
      }
      out.push({
        name,
        type: col.type,
        ...(col.required === undefined ? {} : { required: col.required }),
        ...(col.description === undefined ? {} : { description: col.description }),
      })
    }
    if (bad) return []
    return [{
      key: o.key as string,
      name: o.name as string,
      description: typeof o.description === 'string' ? o.description : undefined,
      columns: out,
    }]
  })
}

function readSubs(v: unknown, problems: BundleProblem[]): BundleSubSpec[] {
  return readKeyed(v, 'subWorkflows', problems).flatMap((o) => {
    if (typeof o.workflowJson !== 'string' || !o.workflowJson.trim()) {
      problems.push(problem('BUNDLE_SHAPE_INVALID', `subWorkflows "${String(o.key)}" needs workflowJson.`))
      return []
    }
    return [{
      key: o.key as string,
      name: o.name as string,
      description: typeof o.description === 'string' ? o.description : undefined,
      workflowJson: o.workflowJson,
    }]
  })
}

function readGroup(v: unknown, problems: BundleProblem[]): { name: string } | undefined {
  if (v === undefined || v === null) return undefined
  const name = (v as { name?: unknown })?.name
  if (typeof name !== 'string' || !name.trim()) {
    problems.push(problem('BUNDLE_SHAPE_INVALID', 'group.name must be a non-empty string.'))
    return undefined
  }
  return { name: name.trim() }
}

function readWiring(v: unknown, problems: BundleProblem[]): BundleWiring[] {
  if (!Array.isArray(v)) {
    problems.push(problem('BUNDLE_SHAPE_INVALID', 'wiring must be an array.'))
    return []
  }
  const out: BundleWiring[] = []
  const seen = new Set<string>()
  for (const item of v) {
    const o = (item ?? {}) as Record<string, unknown>
    const graph = typeof o.graph === 'string' ? o.graph : ''
    const node = typeof o.node === 'string' ? o.node : ''
    const field = typeof o.field === 'string' ? o.field : ''
    const ref = o.ref
    const key = typeof o.key === 'string' ? o.key : ''
    if (!graph || !node || !field || !KEY_RE.test(key) || (ref !== 'sub' && ref !== 'sheet' && ref !== 'sheetName')) {
      problems.push(problem('BUNDLE_SHAPE_INVALID', `wiring entry is malformed: ${JSON.stringify(item)}`))
      continue
    }
    const allowedRef = (STRUCTURAL_FIELD_REF as Record<string, string>)[field]
    if (!allowedRef) {
      problems.push(problem('BUNDLE_WIRING_FIELD_UNKNOWN', `wiring field "${field}" is not a structural field (${STRUCTURAL_FIELDS.join(', ')}).`))
      continue
    }
    if (allowedRef !== ref) {
      problems.push(problem('BUNDLE_WIRING_REF_MISMATCH', `wiring field "${field}" must use ref "${allowedRef}", not "${String(ref)}".`))
      continue
    }
    const slot = slotKey(graph, node, field)
    if (seen.has(slot)) {
      problems.push(problem('BUNDLE_WIRING_DUPLICATE', `wiring declares ${graph}/${node}/${field} more than once.`))
      continue
    }
    seen.add(slot)
    out.push({ graph, node, field, ref, key })
  }
  return out
}

// ========================================
// ========================================

interface GraphNode { id?: unknown; data?: Record<string, unknown> | null }
interface Graph { nodes?: unknown; edges?: unknown }

function nodesOf(graph: Graph): GraphNode[] {
  return Array.isArray(graph.nodes) ? (graph.nodes as GraphNode[]) : []
}

function isPlainContainer(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function readPath(data: Record<string, unknown> | null | undefined, path: string): { present: boolean; value: unknown } {
  const miss = { present: false, value: undefined }
  if (!isPlainContainer(data)) return miss
  const parts = path.split('.')
  let cur: unknown = data
  for (let i = 0; i < parts.length; i++) {
    if (!isPlainContainer(cur)) return miss
    if (!Object.prototype.hasOwnProperty.call(cur, parts[i])) return miss
    cur = cur[parts[i]]
  }
  return { present: true, value: cur }
}

function writePath(data: Record<string, unknown>, path: string, value: string): boolean {
  const parts = path.split('.')
  let cur: unknown = data
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainContainer(cur) || !Object.prototype.hasOwnProperty.call(cur, parts[i])) return false
    cur = cur[parts[i]]
  }
  if (!isPlainContainer(cur) || !Object.prototype.hasOwnProperty.call(cur, parts[parts.length - 1])) return false
  cur[parts[parts.length - 1]] = value
  return true
}

export function readWholeToken(value: unknown): { kind: BundleRefKind; key: string } | null {
  if (typeof value !== 'string') return null
  const m = WHOLE_TOKEN_RE.exec(value)
  return m ? { kind: m[1] as BundleRefKind, key: m[2] } : null
}

// ========================================
// ========================================

export interface BundleGraphs {
  [graphKey: string]: Graph
}

export function checkWiringBeforeSubstitution(graphs: BundleGraphs, spec: BundleSpec): BundleProblem[] {
  const problems: BundleProblem[] = []
  const declared = new Set(spec.wiring.map((w) => slotKey(w.graph, w.node, w.field)))

  for (const [graphKey, graph] of Object.entries(graphs)) {
    const seenIds = new Set<string>()
    for (const node of nodesOf(graph)) {
      if (typeof node.id !== 'string') continue
      if (seenIds.has(node.id)) {
        problems.push(problem('BUNDLE_NODE_ID_DUPLICATE', `${graphKey}: node id "${node.id}" appears more than once.`))
      }
      seenIds.add(node.id)
    }
  }
  if (problems.length > 0) return problems

  for (const w of spec.wiring) {
    const graph = graphs[w.graph]
    if (!graph) {
      problems.push(problem('BUNDLE_WIRING_GRAPH_MISSING', `wiring references graph "${w.graph}" which was not supplied.`))
      continue
    }
    const node = nodesOf(graph).find((n) => n.id === w.node)
    if (!node) {
      problems.push(problem('BUNDLE_WIRING_NODE_MISSING', `${w.graph}: node "${w.node}" is not in the graph.`))
      continue
    }
    const { present, value } = readPath(node.data, w.field)
    if (!present) {
      problems.push(problem('BUNDLE_WIRING_FIELD_MISSING', `${w.graph}/${w.node}: field "${w.field}" is not present.`))
      continue
    }
    const token = readWholeToken(value)
    if (!token || token.kind !== w.ref || token.key !== w.key) {
      problems.push(problem('BUNDLE_WIRING_TOKEN_MISMATCH', `${w.graph}/${w.node}/${w.field} must hold exactly "@${w.ref}:${w.key}" but holds ${JSON.stringify(value)}.`))
    }
  }

  for (const [graphKey, graph] of Object.entries(graphs)) {
    for (const node of nodesOf(graph)) {
      if (typeof node.id !== 'string') continue
      for (const field of STRUCTURAL_FIELDS) {
        if (!readPath(node.data, field).present) continue
        if (!declared.has(slotKey(graphKey, node.id, field))) {
          problems.push(problem('BUNDLE_WIRING_UNDECLARED', `${graphKey}/${node.id}/${field} is a structural field but no wiring entry declares it.`))
        }
      }
    }
  }
  return problems
}

// ========================================
// ========================================

export interface ResolvedBundleIds {
  subIds: Record<string, string>
  subToolNames: Record<string, string>
  sheetIds: Record<string, string>
  sheetNames: Record<string, string>
}

export function substituteBundleTokens(graphs: BundleGraphs, spec: BundleSpec, ids: ResolvedBundleIds): BundleGraphs {
  const out: BundleGraphs = structuredClone(graphs)
  for (const w of spec.wiring) {
    const graph = out[w.graph]
    if (!graph) continue
    const node = nodesOf(graph).find((n) => n.id === w.node)
    if (!node?.data) continue
    const value =
      w.ref === 'sub' ? ids.subIds[w.key]
      : w.ref === 'sheet' ? ids.sheetIds[w.key]
      : ids.sheetNames[w.key]
    if (typeof value !== 'string') continue
    writePath(node.data, w.field, value)
  }

  for (const graph of Object.values(out)) {
    for (const node of nodesOf(graph)) {
      if (!node.data) continue
      for (const field of BODY_FIELDS) {
        const cur = node.data[field]
        if (typeof cur !== 'string') continue
        node.data[field] = cur.replace(BODY_INLINE_RE, (whole, kind: string, key: string) => {
          const v = kind === 'subtool' ? ids.subToolNames[key] : ids.sheetNames[key]
          return typeof v === 'string' ? v : whole
        })
      }
    }
  }
  return out
}

// ========================================
// ========================================

export function checkWiringAfterSubstitution(graphs: BundleGraphs, spec: BundleSpec, ids: ResolvedBundleIds): BundleProblem[] {
  const problems: BundleProblem[] = []
  const createdSubIds = new Set(Object.values(ids.subIds))
  const createdSheetIds = new Set(Object.values(ids.sheetIds))
  const createdSheetNames = new Set(Object.values(ids.sheetNames))

  for (const w of spec.wiring) {
    const node = nodesOf(graphs[w.graph] ?? {}).find((n) => n.id === w.node)
    const { value } = readPath(node?.data, w.field)
    const pool = w.ref === 'sub' ? createdSubIds : w.ref === 'sheet' ? createdSheetIds : createdSheetNames
    if (typeof value !== 'string' || !pool.has(value)) {
      problems.push(problem('BUNDLE_WIRING_UNRESOLVED', `${w.graph}/${w.node}/${w.field} does not hold an id created by this bundle (got ${JSON.stringify(value)}).`))
      continue
    }
    const expected = w.ref === 'sub' ? ids.subIds[w.key] : w.ref === 'sheet' ? ids.sheetIds[w.key] : ids.sheetNames[w.key]
    if (value !== expected) {
      problems.push(problem('BUNDLE_WIRING_WRONG_TARGET', `${w.graph}/${w.node}/${w.field} points at the wrong member of this bundle.`))
    }
  }

  for (const [graphKey, graph] of Object.entries(graphs)) {
    for (const hit of findTokenCandidates(graph)) {
      problems.push(problem('BUNDLE_TOKEN_LEFTOVER', `${graphKey}: unresolved placeholder ${JSON.stringify(hit)} remains after substitution.`))
    }
  }
  return problems
}

export function findTokenCandidates(value: unknown, hits: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const m of value.matchAll(TOKEN_CANDIDATE_RE)) {
      if (looksLikeOurToken(m[1])) hits.push(m[0])
    }
    return hits
  }
  if (Array.isArray(value)) {
    for (const v of value) findTokenCandidates(v, hits)
    return hits
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) findTokenCandidates(v, hits)
  }
  return hits
}

export function checkResolvedIds(spec: BundleSpec, ids: ResolvedBundleIds): BundleProblem[] {
  const problems: BundleProblem[] = []
  const check = (what: string, keys: string[], map: Record<string, string>, unique: boolean) => {
    const seen = new Map<string, string>()
    for (const k of keys) {
      const v = map[k]
      if (typeof v !== 'string' || !v.trim()) {
        problems.push(problem('BUNDLE_RESOLVED_MISSING', `${what} has no value for "${k}".`))
        continue
      }
      if (unique && seen.has(v)) {
        problems.push(problem('BUNDLE_RESOLVED_DUPLICATE', `${what} gives "${k}" and "${seen.get(v)}" the same value ${JSON.stringify(v)}.`))
      }
      seen.set(v, k)
    }
    for (const k of Object.keys(map)) {
      if (!keys.includes(k)) problems.push(problem('BUNDLE_RESOLVED_EXTRA', `${what} has "${k}" which the bundle does not declare.`))
    }
  }
  const subKeys = spec.subWorkflows.map((s) => s.key)
  const sheetKeys = spec.dataSheets.map((s) => s.key)
  check('subIds', subKeys, ids.subIds, true)
  check('subToolNames', subKeys, ids.subToolNames, true)
  check('sheetIds', sheetKeys, ids.sheetIds, true)
  check('sheetNames', sheetKeys, ids.sheetNames, true)
  return problems
}

// ========================================
// ========================================

export function findForbiddenLiterals(graphs: BundleGraphs, spec: BundleSpec): BundleProblem[] {
  const problems: BundleProblem[] = []
  const sheetNames = spec.dataSheets.map((s) => s.name.trim()).filter(Boolean)
  for (const [graphKey, graph] of Object.entries(graphs)) {
    for (const node of nodesOf(graph)) {
      if (!node.data) continue
      for (const field of BODY_FIELDS) {
        const v = node.data[field]
        if (typeof v !== 'string') continue
        if (v.includes('subwf_')) {
          problems.push(problem('BUNDLE_LITERAL_TOOL_NAME', `${graphKey}/${String(node.id)}/${field} writes a tool function name directly — use "@subtool:<key>" so it follows the renamed copy.`))
        }
        const lower = v.toLowerCase()
        for (const name of sheetNames) {
          if (lower.includes(name.toLowerCase())) {
            problems.push(problem('BUNDLE_LITERAL_SHEET_NAME', `${graphKey}/${String(node.id)}/${field} writes the sheet name "${name}" directly — a second copy is renamed to "${name} (2)".`))
          }
        }
      }
    }
  }
  return problems
}

// ========================================
// ========================================
//

const MAX_NAME_TRIES = 200

export function nextFreeDisplayName(base: string, isTaken: (name: string) => boolean): string | null {
  const trimmed = base.trim()
  if (!isTaken(trimmed)) return trimmed
  for (let i = 2; i < MAX_NAME_TRIES; i++) {
    const candidate = `${trimmed} (${i})`
    if (!isTaken(candidate)) return candidate
  }
  return null
}

export function nextFreeToolName(base: string, isTaken: (name: string) => boolean): string | null {
  if (!base) return null
  if (!isTaken(base)) return base
  for (let i = 2; i < MAX_NAME_TRIES; i++) {
    const suffix = `_${i}`
    const head = base.slice(0, Math.max(1, 40 - suffix.length)).replace(/_+$/g, '')
    const candidate = `${head}${suffix}`
    if (!SUB_WORKFLOW_TOOL_NAME_RE.test(candidate)) continue
    if (!isTaken(candidate)) return candidate
  }
  return null
}

export function withBundleSubToolName(workflowJson: string, toolName: string): string | null {
  const starts = findSubWorkflowStartNodes(workflowJson)
  if (starts.length !== 1) return null
  let parsed: { nodes?: Array<{ id?: string; data?: Record<string, unknown> }> }
  try { parsed = JSON.parse(workflowJson) } catch { return null }
  const node = parsed.nodes?.find((n) => n.id === starts[0].id)
  if (!node?.data) return null
  node.data.toolName = toolName
  return JSON.stringify(parsed)
}
