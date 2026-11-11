
import { Prisma, type PrismaClient } from '@prisma/client'
import { APP_WORKFLOW_KIND, appNodesOf, linkNodesOf, linkTargetOf } from './app-canvas'
import { COMPANY_BOOK_KINDS, isCompanyBookKind, isSharedAppTemplateKind } from './app-template-kinds'

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

export interface SharedAppChoice {
  appWorkflowId: string
  projectId: string
  appName: string
  canvasWorkflowId: string
  canvasName: string
  agentId: string
  agentName: string
  alone: boolean
}

export interface UnpickableSharedApp {
  why: 'draft' | 'deleted_canvas' | 'removed_node'
  canvasWorkflowId: string | null
  canvasName: string | null
  appName: string
}

export interface SharedAppLookup {
  pickable: SharedAppChoice[]
  auto: SharedAppChoice[]
  exists: boolean
  unpickable: UnpickableSharedApp[]
  legacy: number
  byBook?: BookGroups
}

export interface BookGroups {
  same: SharedAppChoice[]
  none: SharedAppChoice[]
  mixed: SharedAppChoice[]
  other: SharedAppChoice[]
}

export async function booksOf(db: Db, userId: string, projectIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(projectIds.map((id) => [id, []]))
  if (!projectIds.length || !COMPANY_BOOK_KINDS.length) return out
  const ids = [...new Set(projectIds)]
  const own = await db.workProject.findMany({ where: { userId, id: { in: ids } }, select: { id: true, kind: true } })
  for (const p of own) if (isCompanyBookKind(p.kind)) out.set(p.id, [p.id])
  const refs = await db.projectReference.findMany({ where: { userId, fromProjectId: { in: ids }, to: { kind: { in: [...COMPANY_BOOK_KINDS] }, status: 'active' } }, select: { fromProjectId: true, toProjectId: true } })
  const isBook = new Set(own.filter((p) => isCompanyBookKind(p.kind)).map((p) => p.id))
  for (const r of refs) {
    if (isBook.has(r.fromProjectId)) continue
    const cur = out.get(r.fromProjectId) ?? []
    if (!cur.includes(r.toProjectId)) out.set(r.fromProjectId, [...cur, r.toProjectId].sort())
  }
  return out
}

export async function resolveBook(db: Db, userId: string, bookAppWorkflowId: string): Promise<{ appWorkflowId: string; projectId: string } | null> {
  const w = await db.workflow.findFirst({ where: { workflowId: bookAppWorkflowId, kind: APP_WORKFLOW_KIND, status: 'production', agent: { userId } }, select: { workflowId: true } })
  if (!w) return null
  const p = await db.workProject.findFirst({ where: { userId, workflowId: w.workflowId, status: 'active', kind: { in: [...COMPANY_BOOK_KINDS] } }, select: { id: true } })
  return p ? { appWorkflowId: w.workflowId, projectId: p.id } : null
}

export function bookRelation(books: readonly string[], book: string): keyof BookGroups {
  if (!books.length) return 'none'
  if (!books.includes(book)) return 'other'
  return books.length === 1 ? 'same' : 'mixed'
}

export type BookLinkDecision =
  | { link: SharedAppChoice }
  | { note: 'LINK_CHOOSE' | 'LINK_DRAFT_ONLY' | 'LINK_ATTACH' | 'LINK_DETACHED_ONLY'; detail?: string }
  | { create: true }

export function decideBookLink(lk: Pick<SharedAppLookup, 'unpickable' | 'legacy'>, g: BookGroups): BookLinkDecision {
  if (g.same.length === 1) return { link: g.same[0] }
  if (g.same.length > 1) return { note: 'LINK_CHOOSE' }
  if (lk.unpickable.some((u) => u.why === 'draft')) return { note: 'LINK_DRAFT_ONLY' }
  if (g.none.length) return { note: 'LINK_ATTACH' }
  if (g.mixed.length) return { note: 'LINK_CHOOSE' }
  const det = lk.unpickable.find((u) => u.why === 'deleted_canvas' || u.why === 'removed_node')
  if (det) return { note: 'LINK_DETACHED_ONLY', detail: det.why }
  if (lk.legacy > 0) return { note: 'LINK_CHOOSE' }
  return { create: true }
}

export function decideSoloLink(lk: Pick<SharedAppLookup, 'pickable' | 'auto' | 'unpickable' | 'legacy' | 'exists'>): { link: SharedAppChoice } | { note: 'LINK_CHOOSE' | 'LINK_DRAFT_ONLY' | 'LINK_DETACHED_ONLY'; detail?: string } | { create: true } {
  if (lk.auto.length === 1 && lk.pickable.length === 1 && lk.unpickable.length === 0 && lk.legacy === 0) return { link: lk.auto[0] }
  if (lk.pickable.length) return { note: 'LINK_CHOOSE' }
  if (lk.unpickable.some((u) => u.why === 'draft')) return { note: 'LINK_DRAFT_ONLY' }
  const det = lk.unpickable.find((u) => u.why === 'deleted_canvas' || u.why === 'removed_node')
  if (det) return { note: 'LINK_DETACHED_ONLY', detail: det.why }
  if (lk.exists) return { note: 'LINK_CHOOSE' }
  return { create: true }
}

const hasAppNodeOf = (workflowJson: string, kind: string) => appNodesOf(workflowJson).some((n) => n.data?.appTemplate === kind)

export async function sharedAppLookup(db: Db, userId: string, appTemplate: string, opts: { excludeWorkflowId?: string; sameBookAs?: string } = {}): Promise<SharedAppLookup> {
  const empty: SharedAppLookup = { pickable: [], auto: [], exists: false, unpickable: [], legacy: 0 }
  if (!isSharedAppTemplateKind(appTemplate)) return empty
  const exclude = opts.excludeWorkflowId ?? null

  const projects = await db.workProject.findMany({ where: { userId, kind: appTemplate, status: 'active' }, select: { id: true, workflowId: true } })
  const projectIds = projects.map((p) => p.id)
  const hidden = projectIds.length
    ? await db.workflow.findMany({
        where: { kind: APP_WORKFLOW_KIND, agent: { userId }, OR: [{ workflowId: { in: projects.map((p) => p.workflowId).filter((x): x is string => !!x) } }, { appProjectId: { in: projectIds } }] },
        select: { workflowId: true, name: true, status: true, parentWorkflowId: true, appProjectId: true, agentId: true, agent: { select: { title: true } }, parent: { select: { workflowId: true, name: true, status: true, kind: true, workflowJson: true } } },
      })
    : []

  const pickable: SharedAppChoice[] = []
  const unpickable: UnpickableSharedApp[] = []
  const seenProject = new Set<string>()
  let legacy = 0
  for (const p of projects) {
    const linked = p.workflowId ? hidden.find((h) => h.workflowId === p.workflowId) : undefined
    if (linked) {
      seenProject.add(p.id)
      if (linked.parentWorkflowId === exclude) continue
      const parent = linked.parent
      if (linked.status === 'production' && parent?.status === 'production' && parent.kind === 'main') {
        pickable.push({
          appWorkflowId: linked.workflowId, projectId: p.id, appName: linked.name, canvasWorkflowId: parent.workflowId, canvasName: parent.name,
          agentId: linked.agentId, agentName: linked.agent.title ?? '', alone: appNodesOf(parent.workflowJson).length === 1,
        })
      } else {
        unpickable.push({ why: 'draft', canvasWorkflowId: parent?.workflowId ?? null, canvasName: parent?.name ?? null, appName: linked.name })
      }
      continue
    }
    if (p.workflowId) { legacy++; continue }
    seenProject.add(p.id)
    const was = hidden.find((h) => h.appProjectId === p.id)
    if (was?.parentWorkflowId === exclude && exclude) continue
    if (was?.parent) unpickable.push({ why: 'removed_node', canvasWorkflowId: was.parent.workflowId, canvasName: was.parent.name, appName: was.name })
    else unpickable.push({ why: 'deleted_canvas', canvasWorkflowId: null, canvasName: null, appName: was?.name ?? appTemplate })
  }

  const canvases = await db.workflow.findMany({
    where: { kind: 'main', agent: { userId }, ...(exclude ? { workflowId: { not: exclude } } : {}), workflowJson: { contains: '"workApp"' } },
    select: { workflowId: true, name: true, status: true, workflowJson: true, appChildren: { where: { kind: APP_WORKFLOW_KIND }, select: { parentNodeId: true, appProjectId: true, workflowId: true } } },
  })
  for (const c of canvases) {
    for (const n of appNodesOf(c.workflowJson)) {
      if (n.data?.appTemplate !== appTemplate) continue
      const child = c.appChildren.find((h) => h.parentNodeId === n.id)
      if (child && (seenProject.has(child.appProjectId ?? '') || projects.some((p) => p.workflowId === child.workflowId))) continue
      if (!unpickable.some((u) => u.why === 'draft' && u.canvasWorkflowId === c.workflowId)) unpickable.push({ why: 'draft', canvasWorkflowId: c.workflowId, canvasName: c.name, appName: typeof n.data?.label === 'string' ? n.data.label : appTemplate })
    }
  }
  const ownedByExcluded = (p: { id: string; workflowId: string | null }) => !!exclude && hidden.some((h) => (h.workflowId === p.workflowId || h.appProjectId === p.id) && h.parentWorkflowId === exclude)
  const exists = projects.some((p) => !ownedByExcluded(p)) || canvases.some((c) => hasAppNodeOf(c.workflowJson, appTemplate))
  const out: SharedAppLookup = { pickable, auto: pickable.filter((x) => x.alone), exists, unpickable, legacy }
  if (opts.sameBookAs) {
    const books = await booksOf(db, userId, pickable.map((p) => p.projectId))
    const g: BookGroups = { same: [], none: [], mixed: [], other: [] }
    for (const p of pickable) g[bookRelation(books.get(p.projectId) ?? [], opts.sameBookAs)].push(p)
    out.byBook = g
  }
  return out
}

export interface LinkProblem {
  nodeId: string
  code: 'LINK_TARGET_MISSING' | 'LINK_TARGET_INVALID'
  reason: string
}

export async function linkTargetProblems(tx: Tx, userId: string, workflowJson: unknown, workflowId: string): Promise<LinkProblem[]> {
  const links = linkNodesOf(workflowJson)
  if (!links.length) return []
  const out: LinkProblem[] = []
  const targets = [...new Set(links.map(linkTargetOf).filter((x): x is string => !!x))].sort()
  if (targets.length) await tx.$queryRaw`SELECT "workflowId" FROM workflows WHERE "workflowId" = ANY(${targets}::text[]) ORDER BY "workflowId" FOR SHARE`
  const rows = targets.length
    ? await tx.workflow.findMany({ where: { workflowId: { in: targets } }, select: { workflowId: true, kind: true, status: true, parentWorkflowId: true, agent: { select: { userId: true } } } })
    : []
  const projects = targets.length ? await tx.workProject.findMany({ where: { userId, workflowId: { in: targets } }, select: { workflowId: true, kind: true, status: true } }) : []
  for (const n of links) {
    const kind = n.data?.appTemplate
    const t = linkTargetOf(n)
    if (!t) { out.push({ nodeId: n.id, code: 'LINK_TARGET_MISSING', reason: 'choose the work app this link points at' }); continue }
    const w = rows.find((r) => r.workflowId === t)
    if (!w || w.kind !== APP_WORKFLOW_KIND || w.agent.userId !== userId) { out.push({ nodeId: n.id, code: 'LINK_TARGET_MISSING', reason: 'the linked work app no longer exists — restore it from the trash or choose another' }); continue }
    if (w.parentWorkflowId === workflowId) { out.push({ nodeId: n.id, code: 'LINK_TARGET_INVALID', reason: 'a link node points at a work app of another workflow — this app is on this canvas' }); continue }
    if (w.status !== 'production') { out.push({ nodeId: n.id, code: 'LINK_TARGET_MISSING', reason: 'the linked work app is not deployed — deploy its workflow or choose another' }); continue }
    const p = projects.find((x) => x.workflowId === t)
    if (!p || p.status !== 'active') { out.push({ nodeId: n.id, code: 'LINK_TARGET_MISSING', reason: 'the linked work app has no data yet — open it once first' }); continue }
    if (!isSharedAppTemplateKind(kind) || p.kind !== kind) out.push({ nodeId: n.id, code: 'LINK_TARGET_INVALID', reason: `the linked work app is not a ${String(kind)} app` })
  }
  return out
}

export async function companyBookProblems(tx: Tx, userId: string, workflowJson: unknown, workflowId: string): Promise<LinkProblem[]> {
  const apps = appNodesOf(workflowJson)
  const links = linkNodesOf(workflowJson)
  const bookNodes = [...apps, ...links].filter((n) => isCompanyBookKind(n.data?.appTemplate))
  if (bookNodes.length !== 1) return []
  const hidden = await tx.workflow.findMany({ where: { parentWorkflowId: workflowId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true, parentNodeId: true } })
  const appIdOf = (n: { id: string; data?: { nodeType?: unknown } | null }) => (n.data?.nodeType === 'workAppLink' ? linkTargetOf(n as Parameters<typeof linkTargetOf>[0]) : hidden.find((h) => h.parentNodeId === n.id)?.workflowId ?? null)
  const nodes = [...apps, ...links].map((n) => ({ n, app: appIdOf(n) })).filter((x): x is { n: typeof x.n; app: string } => !!x.app)
  const projects = await tx.workProject.findMany({ where: { userId, status: 'active', workflowId: { in: nodes.map((x) => x.app) } }, select: { id: true, workflowId: true } })
  const projectOf = (app: string) => projects.find((p) => p.workflowId === app)?.id ?? null
  const book = nodes.find((x) => x.n.id === bookNodes[0].id)
  const L = book ? projectOf(book.app) : null
  if (!L) return [{ nodeId: bookNodes[0].id, code: 'LINK_TARGET_INVALID', reason: 'the bank ledger of this workflow has no data yet — deploy or restore it first' }]
  const others = nodes.filter((x) => x.n.id !== bookNodes[0].id).map((x) => ({ ...x, project: projectOf(x.app) })).filter((x): x is typeof x & { project: string } => !!x.project)
  const books = await booksOf(tx, userId, others.map((x) => x.project))
  const out: LinkProblem[] = []
  for (const x of others) {
    const b = books.get(x.project) ?? []
    if (b.length && !(b.length === 1 && b[0] === L)) out.push({ nodeId: x.n.id, code: 'LINK_TARGET_INVALID', reason: 'this work app reads the bank ledger of another company — link the app that reads the ledger of this workflow' })
  }
  return out
}

export async function linkingCanvases(db: Db, userId: string, appWorkflowIds: readonly string[], exceptWorkflowId: string | null): Promise<Array<{ workflowId: string; name: string; appWorkflowId: string }>> {
  if (!appWorkflowIds.length) return []
  const ids = new Set(appWorkflowIds)
  const rows = await db.workflow.findMany({
    where: { kind: 'main', status: 'production', agent: { userId }, workflowJson: { contains: '"workAppLink"' }, ...(exceptWorkflowId ? { workflowId: { not: exceptWorkflowId } } : {}) },
    select: { workflowId: true, name: true, workflowJson: true },
  })
  const out: Array<{ workflowId: string; name: string; appWorkflowId: string }> = []
  for (const r of rows) for (const n of linkNodesOf(r.workflowJson)) {
    const t = linkTargetOf(n)
    if (t && ids.has(t)) out.push({ workflowId: r.workflowId, name: r.name, appWorkflowId: t })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export class SharedAppInUseError extends Error {
  readonly code = 'SHARED_APP_IN_USE'
  constructor(readonly canvases: ReadonlyArray<{ workflowId: string; name: string }>) {
    super(`this work app is linked by ${canvases.map((c) => `"${c.name}"`).join(', ')} — change or remove the link there first`)
    this.name = 'SharedAppInUseError'
  }
}

export async function assertSharedAppsNotInUseLocked(tx: Tx, userId: string, appWorkflowIds: readonly string[], exceptWorkflowId: string): Promise<void> {
  const users = await linkingCanvases(tx, userId, appWorkflowIds, exceptWorkflowId)
  if (users.length) throw new SharedAppInUseError([...new Map(users.map((u) => [u.workflowId, { workflowId: u.workflowId, name: u.name }])).values()])
}
