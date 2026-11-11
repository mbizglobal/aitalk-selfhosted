
import { WorkError } from './errors'
import type { WorkFileDeps } from './files'
import { readProjectFile } from './files'
import type { SheetActor } from './sheet-gate'
import { readProjectSettings } from './projects'
import { appTemplateOf } from './app-templates'
import { appStartSettings } from './app-chat'
import { workAppRegistry } from './registry'
import type { WorkAppPackage } from './package'
import type { AppTemplate } from './app-templates'
import { createSend, executeSend, isAutoOff, normalizeRecipients, queryFingerprint, type SendKind, type SendPayload, type Senders, type SendLookups, type SendQuery } from './sends'
import { recordWorkAppProposal } from './app-scope'
import { CompanyDbError, dbParamValues, readCompanyDb, resolveDbConnection, type CompanyDbDeps } from './company-db'
import { writeWorkEvent } from './projects'
import { reportSendResult } from './send-report'
import { refOpen } from './send-refs'
import { isSendQuery, type ConnectionKind, type KnowledgeHit, type SendRequest, type SendResult, type WorkAppUses, type WorkAppV3Handles } from './uses'

export type AskTextFn = (prompt: string, opts?: { json?: boolean; maxTokens?: number }) => Promise<string>

export interface V3Scope {
  deps: WorkFileDeps
  userId: string
  projectId: string
  caller: SheetActor
  taskId?: string | null
  askText?: AskTextFn
  senders?: Senders
  registry?: V3Registry
  companyDb?: CompanyDbDeps
  runId?: string
}

export interface V3Registry { packages: readonly WorkAppPackage[]; appTemplates: readonly AppTemplate[] }
const reg = (r?: V3Registry): V3Registry => r ?? workAppRegistry()

const CONN_TO_SEND: Record<ConnectionKind, SendKind> = { email: 'email', telegram: 'telegram', http: 'http', sms: 'sms', database: 'db_write', calendar: 'calendar' }
const MAX_TOPK = 20
const MAX_QUERY_CHARS = 2_000

export function usesOfKind(kind: string, r?: V3Registry): { uses: WorkAppUses; dbQueries: WorkAppPackage['dbQueries'] } | null {
  if (kind === 'free') return null
  const p = reg(r).packages.find((x) => x.appTemplates.some((a) => a.kind === kind))
  if (!p || p.core < 3) return null
  return { uses: p.meta.uses?.[kind] ?? {}, dbQueries: p.dbQueries }
}

export interface LookupOn { docs: boolean; webPages: boolean; webSearch: boolean }
const LOOKUP_OFF: LookupOn = { docs: false, webPages: false, webSearch: false }
const ASSEMBLED = 'assembled'

export function lookupDeclared(kind: string, r?: V3Registry): LookupOn {
  const d = usesOfKind(kind, r)
  if (!d || kind === ASSEMBLED) return LOOKUP_OFF
  return { docs: !!d.uses.knowledge, webPages: !!d.uses.webSearch, webSearch: !!d.uses.webSearch }
}

export function lookupFromSpec(lookup: { docs?: boolean; webPages?: boolean; webSearch?: boolean } | undefined, r?: V3Registry): LookupOn {
  const d = usesOfKind(ASSEMBLED, r)
  if (!d || !lookup) return LOOKUP_OFF
  return { docs: !!d.uses.knowledge && lookup.docs === true, webPages: !!d.uses.webSearch && lookup.webPages === true, webSearch: !!d.uses.webSearch && lookup.webSearch === true }
}

export async function lookupOf(db: WorkFileDeps['db'], key: Buffer, q: { userId: string; projectId: string; kind: string; registry?: V3Registry }): Promise<LookupOn> {
  if (q.kind !== ASSEMBLED) return lookupDeclared(q.kind, q.registry)
  const { readSpec } = await import('./assembled')
  const spec = await readSpec(db as never, key, { userId: q.userId, projectId: q.projectId })
  return lookupFromSpec(spec?.spec.lookup, q.registry)
}

export async function v3Handles(s: V3Scope): Promise<WorkAppV3Handles | null> {
  const p = await s.deps.db.workProject.findFirst({
    where: { id: s.projectId, userId: s.userId },
    select: { kind: true, workflowId: true, capabilityOff: true, workflow: { select: { agentId: true, workflowJson: true } } },
  })
  if (!p) throw new WorkError('NOT_FOUND')
  const decl = usesOfKind(p.kind, s.registry)
  if (!decl) return null
  const { uses } = decl
  const kind = p.kind
  const agentId = p.workflow?.agentId ?? null
  const start = p.workflow ? appStartSettings(p.workflow.workflowJson) : null

  const h: WorkAppV3Handles = {
    settings: () => settingsOf(s, kind),
    llm: {
      async ask(prompt, opts) {
        if (!s.askText) throw new WorkError('UNAVAILABLE', 'no AI call here — ask from an AI tool')
        if (typeof prompt !== 'string' || !prompt.trim()) throw new WorkError('INVALID', 'prompt is empty')
        return s.askText(prompt, opts)
      },
    },
  }

  if (uses.knowledge) {
    h.knowledge = {
      async search(q, opts) {
        if (typeof q !== 'string' || !q.trim()) throw new WorkError('INVALID', 'query is empty')
        const topK = opts?.topK === undefined ? 5 : opts.topK
        if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOPK) throw new WorkError('INVALID', `topK must be 1–${MAX_TOPK}`)
        if (!agentId) throw new WorkError('UNAVAILABLE', 'this work app has no workflow')
        if (kind === ASSEMBLED && !(await lookupOf(s.deps.db, await s.deps.dataKey(s.deps.db, s.userId), { userId: s.userId, projectId: s.projectId, kind, registry: s.registry })).docs) {
          throw new WorkError('FORBIDDEN', 'document search is not turned on in this app (lookup.docs)')
        }
        return searchDocs(s, agentId, start?.ragSpaceId ?? null, q.slice(0, MAX_QUERY_CHARS), topK)
      },
    }
  }

  if ((uses.dbQueries ?? []).some((q) => q.mode === 'read')) {
    h.db = {
      query: (id, params) => readDb(s, { kind, workflowId: p.workflowId, uses, dbQueries: decl.dbQueries }, id, params),
    }
  }

  if ((uses.connections ?? []).length) {
    h.send = async (req) => {
      const r = await sendOne(s, { kind, workflowId: p.workflowId ?? '', uses, dbQueries: decl.dbQueries }, req)
      if (s.runId) recordWorkAppProposal(s.runId, { type: 'send', sendId: r.sendId })
      return r
    }
  }
  return h
}

async function readDb(
  s: V3Scope,
  c: { kind: string; workflowId: string | null; uses: WorkAppUses; dbQueries: WorkAppPackage['dbQueries'] },
  id: string,
  params: unknown,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const q = (c.uses.dbQueries ?? []).find((x) => x.id === id && x.mode === 'read')
  const impl = q ? c.dbQueries?.[q.id] : undefined
  if (!q || !impl) throw new WorkError('INVALID', `unknown read query ${String(id)}`)
  const values = dbParamValues(impl.params, params)
  const engine = (c.uses.connections ?? []).find((x) => x.id === q.via)?.engine
  if (!engine || !c.workflowId) throw new WorkError('UNAVAILABLE', 'NO_CONNECTION')
  const conn = await resolveDbConnection(s.deps.db, { userId: s.userId, workflowId: c.workflowId, slot: q.via, engine })
  if (!conn.ok) throw new WorkError('UNAVAILABLE', conn.code)
  let out: { rows: Record<string, unknown>[]; truncated: boolean }
  try {
    out = await readCompanyDb(conn.config, { sql: impl.sql, values, names: impl.params, maxRows: impl.maxRows }, s.companyDb)
  } catch (e) {
    if (!(e instanceof CompanyDbError)) throw e
    console.warn(`[work-db] read ${q.id}: ${e.code} ${e.detail.slice(0, 200)}`)
    throw new WorkError('UNAVAILABLE', e.code)
  }
  const key = await s.deps.dataKey(s.deps.db, s.userId)
  await writeWorkEvent(s.deps.db as never, key, { userId: s.userId, projectId: s.projectId, taskId: s.taskId ?? undefined, actor: s.caller, action: 'db_read', detail: { query: q.id, rows: out.rows.length, truncated: out.truncated } })
  return out
}

async function searchDocs(s: V3Scope, agentId: string, ragSpaceId: number | null, q: string, topK: number): Promise<KnowledgeHit[]> {
  const db = s.deps.db
  if (ragSpaceId !== null) {
    const own = await db.ragSpace.findFirst({ where: { id: ragSpaceId, agentId }, select: { id: true } })
    if (!own) throw new WorkError('UNAVAILABLE', 'the document space of this work app no longer exists')
  }
  const { resolveSearchSpace } = await import('@/lib/rag-space')
  const { knowledgeTargetFor, tryGetKnowledgeStore } = await import('@/lib/knowledge')
  const { isSelfHosted } = await import('@/lib/edition')
  const user = await db.user.findUnique({ where: { id: s.userId }, select: isSelfHosted() ? { id: true } : { id: true, subscription: { select: { serviceVariant: true, managedRegion: true } } } })
  const target = knowledgeTargetFor((user as { subscription?: { serviceVariant: string | null; managedRegion: string | null } | null } | null)?.subscription ?? null)
  if (!target) throw new WorkError('UNAVAILABLE', 'document search is not available for this account')
  const store = await tryGetKnowledgeStore({ regionId: target.regionId, allowSelfHosted: true }, 'Work app')
  if (!store) throw new WorkError('UNAVAILABLE', 'document search is not configured')
  const space = await resolveSearchSpace(db, agentId, ragSpaceId, 'Work app')
  const hits = await store.search({ agentId, ragSpace: { id: space.ragSpace, includeNull: space.ragSpaceIncludeNull } }, q, topK)
  return hits.map((x) => ({ content: x.content, score: x.score, source: { storageId: x.source.storageId, title: x.source.title, chunkIndex: x.source.chunkIndex } }))
}

interface SendCtx {
  kind: string
  workflowId: string
  uses: WorkAppUses
  dbQueries: WorkAppPackage['dbQueries']
}

async function sendOne(s: V3Scope, c: SendCtx, req: SendRequest): Promise<SendResult> {
  if (!req || typeof req !== 'object') throw new WorkError('INVALID', 'send request')
  const capabilityOff = (await s.deps.db.workProject.findFirst({ where: { id: s.projectId, userId: s.userId }, select: { capabilityOff: true } }))?.capabilityOff ?? null
  const conns = c.uses.connections ?? []
  let sendKind: SendKind
  let slot: string
  let declared: string | null = null
  let auto = false
  let to: string[] | null = null
  let refuse: string | undefined
  let ref: string | null = null
  const payload: SendPayload = {}

  const query = (id: string) => (c.uses.dbQueries ?? []).find((q) => q.id === id && q.mode === 'write')
  const asQuery = (queryId: string, params: unknown) => {
    const q = query(queryId)
    if (!q) throw new WorkError('INVALID', `unknown write query ${queryId}`)
    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) throw new WorkError('INVALID', 'params must be an object')
    const impl = c.dbQueries?.[queryId]
    if (impl) dbParamValues(impl.params, params)
    const engine = conns.find((x) => x.id === q.via)?.engine
    payload.params = (params ?? {}) as Record<string, unknown>
    payload.query = { id: queryId, fingerprint: impl ? queryFingerprint({ ...impl, engine }) : '' }
    sendKind = 'db_write'
    slot = q.via
  }

  if ('send' in req) {
    const d = (c.uses.sends ?? []).find((x) => x.id === req.send)
    if (!d) throw new WorkError('INVALID', `unknown send ${String(req.send)}`)
    declared = d.id
    auto = !isSendQuery(d) && !!d.auto && !isAutoOff(capabilityOff, d.id)
    if (isSendQuery(d)) {
      asQuery(d.query, req.params)
    } else {
      const conn = conns.find((x) => x.id === d.via)!
      sendKind = CONN_TO_SEND[conn.kind]
      slot = d.via
      if ('setting' in d.to) {
        to = normalizeRecipients((await settingsOf(s, c.kind))[d.to.setting])
        payload.toSetting = d.to.setting
      } else to = normalizeRecipients(d.to.fixed)
      if (!to) refuse = 'RECIPIENT_EMPTY'
    }
  } else if ('query' in req) {
    asQuery(req.query, req.params)
    declared = req.query
  } else if ('via' in req) {
    const conn = conns.find((x) => x.id === req.via)
    if (!conn || conn.kind === 'database') throw new WorkError('INVALID', `unknown sending connection ${String(req.via)}`)
    sendKind = CONN_TO_SEND[conn.kind]
    slot = conn.id
    if ('toChatSlot' in req && req.toChatSlot === true) {
      if (sendKind !== 'telegram') throw new WorkError('INVALID', 'toChatSlot is for a Telegram connection')
      const { slotChatNow } = await import('./sends')
      const chat = c.workflowId ? await slotChatNow(s.deps.db, s.userId, c.workflowId, slot) : null
      to = chat ? [chat] : null
      payload.toChatSlot = slot
    } else to = normalizeRecipients(req.to)
    if (!to) refuse = 'RECIPIENT_EMPTY'
    if (req.ref !== undefined) {
      const ok = typeof req.ref === 'string' && !!(await s.deps.db.dataSheetRow.findFirst({ where: { id: req.ref, projectId: s.projectId, userId: s.userId, kind: 'project' }, select: { id: true } }))
      if (!ok) throw new WorkError('INVALID', 'ref must be a row of this work app')
      ref = req.ref as string
      if ('refKey' in req && req.refKey !== undefined) {
        if (typeof req.refKey !== 'string' || req.refKey.length > 120) throw new WorkError('INVALID', 'refKey')
        payload.refKey = req.refKey
      }
    }
  } else throw new WorkError('INVALID', 'send request needs send, via or query')

  if ('content' in req && req.content) {
    const ct = req.content as { subject?: unknown; text?: unknown; json?: unknown; attachFileIds?: unknown }
    const hasJson = ct.json !== undefined && ct.json !== null
    if (hasJson && (ct.text !== undefined || ct.subject !== undefined || ct.attachFileIds !== undefined)) throw new WorkError('INVALID', 'content is either text (with subject and attachments) or json, not both')
    if (hasJson) payload.json = ct.json
    else {
      if (typeof ct.text !== 'string') throw new WorkError('INVALID', 'content.text is required')
      payload.text = ct.text
      if (ct.subject !== undefined) payload.subject = String(ct.subject).slice(0, 300)
      if (ct.attachFileIds !== undefined) {
        if (!Array.isArray(ct.attachFileIds)) throw new WorkError('INVALID', 'attachFileIds must be a list')
        payload.attach = []
        for (const id of ct.attachFileIds) {
          const f = typeof id === 'string' ? await s.deps.db.workFile.findFirst({ where: { id, projectId: s.projectId, userId: s.userId }, select: { id: true, sha256: true } }) : null
          if (!f) { refuse ??= 'ATTACHMENT_MISSING'; continue }
          payload.attach.push({ id: f.id, sha256: f.sha256 })
        }
      }
    }
  }
  if (to) payload.to = to

  const row = await createSend(s.deps, {
    userId: s.userId, projectId: s.projectId, taskId: s.taskId ?? null, workflowId: c.workflowId,
    kind: sendKind!, slot: slot!, declared, auto, payload, requestedBy: s.caller, refuseCode: refuse, ref,
  })
  if (row.status === 'refused') {
    await reportSendResult(s.deps, { userId: s.userId, projectId: s.projectId, sendId: row.id, by: s.caller })
    return { sendId: row.id, status: 'refused', code: refuse }
  }
  const asCard = async (): Promise<SendResult> => {
    const connected = sendKind! === 'db_write' || !c.workflowId ? undefined
      : !!(await (await import('./work-senders')).resolveSlotConnection(s.deps.db, { userId: s.userId, workflowId: c.workflowId, kind: sendKind!, slot: slot! }))
    return { sendId: row.id, status: 'card', ...(connected === undefined ? {} : { connected }) }
  }
  if (!auto) return asCard()
  const r = await executeSend(s.deps, { userId: s.userId, projectId: s.projectId, sendId: row.id }, { by: s.caller, senders: s.senders ?? {}, lookups: sendLookups(s, c), mode: 'auto' })
  if (r.status === 'pending') return asCard()
  if (r.status !== 'lost') await reportSendResult(s.deps, { userId: s.userId, projectId: s.projectId, sendId: row.id, by: s.caller })
  const status = r.status === 'lost' || r.status === 'sending' || r.status === 'discarded' ? 'unknown' : r.status
  return { sendId: row.id, status: status as SendResult['status'], ...(r.code ? { code: r.code } : {}), ...(r.affectedRows !== undefined ? { affectedRows: r.affectedRows } : {}) }
}

export function sendLookups(s: Pick<V3Scope, 'deps' | 'userId' | 'projectId' | 'caller' | 'registry'>, c: { kind: string; dbQueries?: SendCtx['dbQueries']; uses?: WorkAppUses }): SendLookups {
  return {
    async settingRecipients(setting) {
      return (await settingsOf(s, c.kind))[setting]
    },
    refOpen: (ref, attachFileIds, refKey) => refOpen(s, c.kind, ref, attachFileIds, refKey ?? null),
    async file(id) {
      const f = await s.deps.db.workFile.findFirst({ where: { id, projectId: s.projectId, userId: s.userId }, select: { id: true } })
      if (!f) return null
      try {
        const r = await readProjectFile(s.deps, { userId: s.userId, fileId: id, actor: s.caller })
        return { id: r.file.id, sha256: r.file.sha256, buffer: r.buffer, originalName: r.originalName, mimeType: r.file.mimeType }
      } catch (e) {
        if (e instanceof WorkError && e.code === 'NOT_FOUND') return null
        if (e instanceof WorkError && e.code === 'INTEGRITY') return { id, sha256: 'integrity-mismatch', buffer: Buffer.alloc(0), originalName: '', mimeType: '' }
        throw e
      }
    },
    query(id): SendQuery | null {
      const impl = c.dbQueries?.[id]
      const decl = (c.uses?.dbQueries ?? []).find((x) => x.id === id)
      if (!impl || !decl) return null
      const engine = (c.uses?.connections ?? []).find((x) => x.id === decl.via)?.engine ?? ''
      return { sql: impl.sql, params: impl.params, engine, mode: decl.mode, via: decl.via }
    },
  }
}

async function settingsOf(s: Pick<V3Scope, 'deps' | 'userId' | 'projectId' | 'registry'>, kind: string): Promise<Record<string, unknown>> {
  const { name: _name, ...rest } = await readProjectSettings(s.deps, s.userId, s.projectId)
  return appTemplateOf(kind, reg(s.registry).appTemplates)?.parseSettings(rest) ?? {}
}
