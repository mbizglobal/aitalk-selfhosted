
import { Prisma } from '@prisma/client'
import { decryptJson } from './sealed'
import { actorBase, actorRequester, sheetMeta, type WorkSheetDeps } from './sheet-gate'

export const ACTIVITY_PAGE = 50
const READ_ONLY_ACTIONS = ['file_read', 'web_search', 'web_page_read', 'db_read', 'db_sql_read']

export interface ActivityPerson { key: string; name: string | null; you: boolean }
export type ActivityWho =
  | { kind: 'person'; person: ActivityPerson }
  | { kind: 'ai' }
  | { kind: 'module'; module: string }
  | { kind: 'flow' | 'channel' | 'app' | 'handoff'; name: string | null }
  | { kind: 'import'; module: string }
  | { kind: 'other'; label: string }

export interface ActivityItem {
  id: string
  at: string
  action: string
  who: ActivityWho
  requestedBy: ActivityPerson | null
  sheet: { id: string; name: string | null; family: string | null } | null
  task: { id: string; title: string | null } | null
  file: { id: string; name: string | null } | null
  why: string | null
  changes: { before: unknown; after: unknown } | null
}

const tail = (label: string, prefix: string) => (label.startsWith(prefix) ? label.slice(prefix.length) : null)

export async function readProjectActivity(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string; viewer: string | null; before?: string | null },
): Promise<{ items: ActivityItem[]; more: boolean }> {
  const where: Prisma.WorkEventWhereInput = { userId: q.userId, projectId: q.projectId, action: { notIn: READ_ONLY_ACTIONS } }
  if (q.before) {
    const b = await deps.db.workEvent.findFirst({ where: { id: q.before, userId: q.userId, projectId: q.projectId }, select: { id: true, createdAt: true } })
    if (!b) return { items: [], more: false }
    where.OR = [{ createdAt: { lt: b.createdAt } }, { createdAt: b.createdAt, id: { lt: b.id } }]
  }
  const rows = await deps.db.workEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: ACTIVITY_PAGE + 1 })
  const more = rows.length > ACTIVITY_PAGE
  const page = rows.slice(0, ACTIVITY_PAGE)
  if (page.length === 0) return { items: [], more: false }
  const key = await deps.dataKey(deps.db, q.userId)

  const project = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { agentId: true } })

  const requesters = page.map((e) => actorRequester(e.actor))
  const people = new Set([...page.map((e) => actorBase(e.actor)), ...requesters].filter((x): x is string => !!x && (x === 'human' || x.startsWith('member:'))))
  const memberIds = [...people].map((x) => Number(tail(x, 'member:'))).filter((n) => Number.isInteger(n))
  const names = new Map<string, string | null>()
  if (memberIds.length && project?.agentId) {
    for (const m of await deps.db.agentMember.findMany({ where: { id: { in: memberIds }, agentAgentId: project.agentId }, select: { id: true, displayName: true, email: true } })) names.set(`member:${m.id}`, m.displayName || m.email)
  }
  if (people.has('human')) {
    const o = await deps.db.user.findUnique({ where: { id: q.userId }, select: { name: true, email: true } })
    names.set('human', o?.name || o?.email || null)
  }
  const person = (k: string): ActivityPerson => ({ key: k, name: names.get(k) ?? null, you: k === q.viewer })

  const flowIds = new Set<string>()
  for (const e of page) for (const p of ['flow:', 'channel:', 'app:', 'handoff:']) { const id = tail(actorBase(e.actor), p); if (id) flowIds.add(id) }
  const flowNames = new Map((flowIds.size ? await deps.db.workflow.findMany({ where: { workflowId: { in: [...flowIds] }, agent: { userId: q.userId } }, select: { workflowId: true, name: true } }) : []).map((w) => [w.workflowId, w.name]))

  const sheetIds = [...new Set(page.map((e) => e.sheetId).filter((x): x is string => !!x))]
  const sheets = new Map<string, { name: string; family: string | null; reason: string | null }>()
  if (sheetIds.length) {
    for (const s of await deps.db.dataSheet.findMany({ where: { id: { in: sheetIds }, userId: q.userId }, select: { id: true, name: true, schema: true, template: true, templateFamily: true } })) {
      let reason: string | null = null
      try { reason = sheetMeta(s, deps.templates).template?.confirm?.ai?.reasonColumn ?? null } catch { }
      sheets.set(s.id, { name: s.name, family: s.templateFamily, reason })
    }
  }

  const taskIds = [...new Set(page.map((e) => e.taskId).filter((x): x is string => !!x))]
  const titles = new Map<string, string>()
  if (taskIds.length) {
    for (const t of await deps.db.workTask.findMany({ where: { id: { in: taskIds }, userId: q.userId }, select: { id: true, title: true } })) titles.set(t.id, t.title)
    const gone = taskIds.filter((id) => !titles.has(id))
    if (gone.length) {
      for (const e of await deps.db.workEvent.findMany({ where: { userId: q.userId, taskId: { in: gone }, action: { in: ['task_create', 'task_delete'] } }, select: { taskId: true, payload: true } })) {
        if (!e.taskId || !e.payload || titles.has(e.taskId)) continue
        try { const d = decryptJson<{ title?: unknown }>(e.payload, key); if (typeof d.title === 'string') titles.set(e.taskId, d.title) } catch { }
      }
    }
  }

  const fileIds = [...new Set(page.map((e) => e.fileId).filter((x): x is string => !!x))]
  const fileNames = new Map<string, string>()
  if (fileIds.length) {
    for (const f of await deps.db.workFile.findMany({ where: { id: { in: fileIds }, userId: q.userId }, select: { id: true, payload: true } })) {
      try { fileNames.set(f.id, decryptJson<{ originalName: string }>(f.payload, key).originalName) } catch { }
    }
  }

  const items = page.map((e): ActivityItem => {
    const base = actorBase(e.actor)
    const req = actorRequester(e.actor)
    const who: ActivityWho = base === 'human' || base.startsWith('member:') ? { kind: 'person', person: person(base) }
      : base.startsWith('ai:') ? { kind: 'ai' }
        : base.startsWith('module:') ? { kind: 'module', module: base.slice('module:'.length).replace(/@\d+$/, '') }
          : base.startsWith('import:') ? { kind: 'import', module: base.slice('import:'.length) }
            : (['flow', 'channel', 'app', 'handoff'] as const).map((k) => [k, tail(base, `${k}:`)] as const).filter(([, id]) => id).map(([kind, id]): ActivityWho => ({ kind, name: flowNames.get(id!) ?? null }))[0]
              ?? { kind: 'other', label: base.startsWith('webhook:') ? 'Webhook' : base.slice(0, 40) }
    const sheet = e.sheetId ? sheets.get(e.sheetId) : undefined
    let changes: ActivityItem['changes'] = null
    let why: string | null = null
    if (e.payload && (e.sheetId || e.action === 'settings_change')) {
      try {
        const d = decryptJson<{ before?: unknown; after?: unknown; changes?: unknown }>(e.payload, key)
        if (e.sheetId) {
          changes = { before: d.before ?? null, after: d.after ?? null }
          const data = (d.after as { data?: Record<string, unknown> } | null)?.data
          const r = sheet?.reason ? data?.[sheet.reason] : undefined
          if (typeof r === 'string' && r.trim()) why = r.trim().slice(0, 500)
        } else changes = { before: null, after: d.changes ?? null }
      } catch { }
    }
    return {
      id: e.id,
      at: e.createdAt.toISOString(),
      action: e.action,
      who,
      requestedBy: req ? person(req) : null,
      sheet: e.sheetId ? { id: e.sheetId, name: sheet?.name ?? null, family: sheet?.family ?? null } : null,
      task: e.taskId ? { id: e.taskId, title: titles.get(e.taskId) ?? null } : null,
      file: e.fileId ? { id: e.fileId, name: fileNames.get(e.fileId) ?? null } : null,
      why,
      changes,
    }
  })
  return { items, more }
}
