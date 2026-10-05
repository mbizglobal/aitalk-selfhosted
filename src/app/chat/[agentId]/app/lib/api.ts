export interface WorkStop { code: string; params?: Record<string, string | number> }

export class WorkApiError extends Error {
  constructor(readonly code: string, readonly detail?: string, readonly stop?: WorkStop) {
    super(code)
  }
}

export type WorkApi = <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<T>

export function makeWorkApi(agentId: string, token: string | null, onUnauthorized: () => void): WorkApi {
  return makeJsonApi(`/api/work/${encodeURIComponent(agentId)}`, token, onUnauthorized)
}

export function makeAppApi(agentId: string, token: string | null, onUnauthorized: () => void): WorkApi {
  return makeJsonApi(`/api/chat/${encodeURIComponent(agentId)}/app`, token, onUnauthorized)
}

function makeJsonApi(base: string, token: string | null, onUnauthorized: () => void): WorkApi {
  return async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    let res: Response
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      })
    } catch {
      throw new WorkApiError('network')
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; stop?: WorkStop }
    if (res.status === 401) {
      onUnauthorized()
      throw new WorkApiError('UNAUTHORIZED')
    }
    if (!res.ok) throw new WorkApiError(json.error ?? 'INTERNAL', json.detail, json.stop)
    return json as T
  }
}

export type NoteKind = 'conclusion' | 'todo' | 'source'
export interface NoteView { id: string; taskId: string | null; kind: NoteKind; text: string; done: boolean | null; status: 'accepted' | 'proposed'; previous: { kind: NoteKind; text: string } | null; createdAt: string; updatedAt: string }
export interface NoteList { project: NoteView[]; task: NoteView[] | null; taskLocked: boolean }
export interface ProjectListItem { id: string; name: string; kind: string; status: string; agentId: string | null; readOnly: boolean }
export interface SheetSummary { id: string; name: string; template: string | null; family: string | null; scope: 'period' | 'effective' | 'global'; confirmable: boolean }
export interface ChecklistItem { id: string; state: 'ok' | 'todo' | 'warn'; params?: Record<string, string | number>; goto?: { family: string } | 'files' | 'notes' }
export interface TaskSummary { id: string; title: string; periodStart: string | null; periodEnd: string | null; status: string; submittedAt: string | null }
export type AppTemplateFieldType = 'boolean' | 'text' | 'textarea' | 'money'
export interface AppTemplateField { name: string; type: AppTemplateFieldType; required?: boolean; maxLength?: number }
export type AppTemplatePeriodRule = 'quarter' | 'month' | 'year' | 'custom'
export interface SheetImport { module: string; family: string; accountColumn: string; fileKind: string; accept: string }
import type { ImportGroupPlan, ImportReader, ImportPlan } from '@/lib/work/bank-import-contract'
export type { ImportGroupPlan, ImportReader, ImportPlan }
export interface AppTemplateScreen {
  kind: string
  hasCalc: boolean
  calcModuleId: string | null
  ui: { settings: AppTemplateField[]; period: AppTemplatePeriodRule; calcInput: AppTemplateField[]; resultTable?: { path: string; labelPrefix: string }; taskChecks: Array<{ module: string; table: string }>; sheetImports: SheetImport[] }
}
export interface ProjectOverview extends ProjectListItem {
  settings: Record<string, unknown>
  modules: string[]
  appTemplate: AppTemplateScreen | null
  sheets: SheetSummary[]
  tasks: TaskSummary[]
  references: number
  revising: Array<{ sourceName: string; title: string; periodStart: string | null; periodEnd: string | null }>
}
export interface ReferenceScreenSheet { id: string; name: string; family: string; template: string | null; schema: { columns: ColumnDef[] }; options: Record<string, string[]>; hidden: string[]; dateColumn: string | null; rows: Array<{ id: string; data: Record<string, unknown>; confirmed: boolean | null }> }
export interface ReferenceScreenItem { referenceId: string; sourceProjectId: string; sourceName: string; includeUnconfirmed: boolean; revising: Array<{ taskId: string; title: string; periodStart: string | null; periodEnd: string | null }>; sheets: ReferenceScreenSheet[] }
export interface TaskReferenceStatus {
  hasReferences: boolean
  differs: boolean
  flagged: boolean
  tasks: Array<{ sourceName: string; title: string | null; was: { status: string; number: number | null }; now: { status: string; number: number | null } | null }>
  rowsChanged: number
  rowsGone: number
  pairsChanged: number
  digest: string
}
export type ColumnType = 'string' | 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json' | 'money' | 'decimal'
export interface ColumnDef { name: string; type: ColumnType; required?: boolean; scale?: number; encrypted?: boolean }
export interface SheetRow { id: string; data: Record<string, unknown>; confirmed: boolean | null; confirmedByAi?: boolean; locked: boolean; virtual?: boolean }
export interface ScreenRowResult { status: string; diff?: string; source?: string }
export interface SheetScreen {
  id: string
  name: string
  schema: { columns: ColumnDef[]; unique?: string[] }
  dateColumn: string | null
  effectiveFromColumn: string | null
  confirmable: boolean
  options: Record<string, string[]>
  refOptions: Record<string, string[]>
  hidden: string[]
  manualRows: boolean
  pairDefs: Array<{ kind: string; toFamily: string }>
  exceptions: string[]
  summary: string[] | null
  fileColumn: string | null
  fxShown: Record<string, { rate: string; unit: number; source: 'estv-monthly' | 'estv-daily' | 'manual'; validFor: string }>
  fxShownColumns: { rate: string; unit: string } | null
  help: string | null
  screenRows: { virtual: Array<{ key: string; data: Record<string, unknown> } & ScreenRowResult>; notes: Record<string, ScreenRowResult> } | null
  pairs: Array<{ id: string; fromRowId: string; toRowId: string; kind: string; confirmed: boolean; locked: boolean }>
  rows: SheetRow[]
}
export interface SubmitWarning { rowId: string; sheetId: string; code: string; summary: Record<string, unknown> }
export interface TaskApproval {
  applies: boolean
  status: string
  request: { byOwner: boolean; byName: string | null; mine: boolean; at: string } | null
  seal: { preparedByOwner: boolean; preparedBy: string | null; approvedByOwner: boolean; approvedBy: string | null } | null
  can: { request: boolean; approve: boolean; reject: boolean; cancel: boolean; unlock: boolean }
}
export interface PreviewResult { output: unknown; twoWay: boolean; unconfirmedCount: number; aiConfirmed?: number; warnings?: SubmitWarning[]; warningsTotal?: number; warningsDigest?: string | null; unconfirmed: Array<{ type: 'row' | 'pair'; id: string }>; reads: { rows: number; pairs: number; fx: number } }
export interface SubmissionItem { id: string; number: number; submittedAt: string; proofs: Array<{ fileId: string; name: string }> }
export interface SubmissionView { number: number; submittedAt: string; result: { module?: string; input?: unknown; output?: unknown } | null; files: number; references: number }
export interface WorkAppListItem { workflowId: string; name: string; appTemplate: string | null; tasks: number; projectKind: string | null; updatedAt: string }
export interface WorkAppOpen { workflowId: string; name: string; projectId: string; welcome: string; fixedAppTemplate: string | null; chatBlocked: boolean; chatBlockedReason: 'no_tool' | 'graph' | null; appTemplates: AppTemplateScreen[] }
export type WorkAppProposal =
  | { type: 'apply_app_template'; kind: string; settings: Record<string, unknown> }
  | { type: 'bank_import'; module: string; fileId: string; fileName: string; reader: ImportReader; accounts: Record<string, string>; balances?: Record<string, { opening: string; closing: string }>; label?: string; rows: number; groups: number }
export interface ShownAttachment { name: string; mimeType: string; pages?: number }
export interface WorkMessageView { id: string; role: 'user' | 'assistant'; actor: string; text: string; files: Array<{ id: string; name: string; mimeType: string }>; shown: ShownAttachment[]; proposals: WorkAppProposal[]; createdAt: string }
export interface ProjectFileView { id: string; name: string; mimeType: string; kind: string; sizeBytes: number; uploadedAt: string; pages: number; locked: boolean }
export interface PairTargetRow { id: string; summary: Array<[string, unknown]>; locked: boolean; confirmed: boolean | null }

const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export interface WorkFiles {
  list(projectId: string): Promise<ProjectFileView[]>
  upload(projectId: string, file: File | Blob, kind: string, opts?: { name?: string; parentFileId?: string }): Promise<{ id: string; created: boolean }>
  open(projectId: string, fileId: string): Promise<void>
  remove(projectId: string, fileId: string): Promise<void>
}

export function makeWorkFiles(agentId: string, token: string | null, onUnauthorized: () => void): WorkFiles {
  const base = `/api/work/${encodeURIComponent(agentId)}/projects`
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const fail = async (res: Response): Promise<never> => {
    if (res.status === 401) onUnauthorized()
    const j = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; stop?: WorkStop }
    throw new WorkApiError(j.error ?? 'INTERNAL', j.detail, j.stop)
  }
  return {
    async list(projectId) {
      let res: Response
      try { res = await fetch(`${base}/${projectId}/files`, { headers: auth, cache: 'no-store' }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
      return ((await res.json()) as { files: ProjectFileView[] }).files
    },
    async remove(projectId, fileId) {
      let res: Response
      try { res = await fetch(`${base}/${projectId}/files/${fileId}`, { method: 'DELETE', headers: auth }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
    },
    async upload(projectId, file, kind, opts) {
      const form = new FormData()
      if (opts?.name) form.set('file', file, opts.name)
      else form.set('file', file)
      form.set('kind', kind)
      if (opts?.parentFileId) form.set('parentFileId', opts.parentFileId)
      let res: Response
      try { res = await fetch(`${base}/${projectId}/files`, { method: 'POST', headers: auth, body: form }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
      return (await res.json()) as { id: string; created: boolean }
    },
    async open(projectId, fileId) {
      const w = window.open('', '_blank')
      let res: Response
      try { res = await fetch(`${base}/${projectId}/files/${fileId}`, { headers: auth, cache: 'no-store' }) } catch { w?.close(); throw new WorkApiError('network') }
      if (!res.ok) { w?.close(); return fail(res) }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
      const cd = res.headers.get('content-disposition') ?? ''
      const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1]
      let name = /filename="([^"]*)"/.exec(cd)?.[1] || 'file'
      if (utf8) { try { name = decodeURIComponent(utf8) } catch { } }
      const url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: INLINE_TYPES.has(type) ? type : 'application/octet-stream' }))
      if (INLINE_TYPES.has(type) && w) {
        w.location.href = url
      } else {
        w?.close()
        const a = document.createElement('a')
        a.href = url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000)
    },
  }
}
