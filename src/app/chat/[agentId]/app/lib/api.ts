export interface WorkStop { code: string; params?: Record<string, string | number> }

export class WorkApiError extends Error {
  constructor(readonly code: string, readonly detail?: string, readonly stop?: WorkStop) {
    super(code)
  }
}

export type WorkApi = <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<T>

export function makeWorkApi(agentId: string, token: string | null, onUnauthorized: () => void): WorkApi {
  return makeJsonApi(`/api/work/${encodeURIComponent(agentId)}`, token, onUnauthorized)
}

export function makeAppApi(agentId: string, token: string | null, onUnauthorized: () => void): WorkApi {
  return makeJsonApi(`/api/chat/${encodeURIComponent(agentId)}/app`, token, onUnauthorized)
}

export function makeArchiveApi(projectId: string, onUnauthorized: () => void): WorkApi {
  const inner = makeJsonApi(`/api/work-projects/${encodeURIComponent(projectId)}`, null, onUnauthorized)
  return async <T,>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> => {
    if (method !== 'GET') throw new WorkApiError('READ_ONLY')
    const rest = path.replace(/^\/[^/?]*/, '')
    return inner<T>('GET', rest || '/open', body)
  }
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
export type AppTemplateFieldType = 'boolean' | 'text' | 'textarea' | 'money' | 'members'
export interface AppTemplateField { name: string; type: AppTemplateFieldType; required?: boolean; maxLength?: number; example?: string; showWhen?: { filled: string }; ownerOnly?: true }
export interface SetupMember { key: string; name: string | null; email: string | null }
export type AppTemplatePeriodRule = 'quarter' | 'month' | 'year' | 'custom'
export interface SheetImport { module: string; family: string; accountColumn: string; fileKind: string; accept: string }
import type { ImportGroupPlan, ImportReader, ImportPlan } from '@/lib/work/bank-import-contract'
export type { ImportGroupPlan, ImportReader, ImportPlan }
export interface AppTemplateScreen {
  kind: string
  hasCalc: boolean
  calcModuleId: string | null
  ui: { settings: AppTemplateField[]; peerSettings?: Array<{ kind: string; fields: string[] }>; files?: 'kept'; referenceTab?: false; modulesTab?: false; notesTab?: false; period: AppTemplatePeriodRule; calcInput: AppTemplateField[]; resultTable?: { path: string; labelPrefix: string }; resultSections?: string[]; taskChecks: Array<{ module: string; table: string }>; sheetImports: SheetImport[]; filing?: boolean; design?: { family: string; imageGroup?: string; fields: Array<{ name: string; kind: 'cards' | 'color' | 'choice' | 'toggle' | 'text' | 'file' | 'number'; default?: string; auto?: true; showWhen?: { field: string; is: string }; group?: string; min?: number; max?: number; unit?: string; needsFile?: string; sample?: string; warnEmpty?: true }> } }
}
export interface ProjectOverview extends ProjectListItem {
  settings: Record<string, unknown>
  modules: string[]
  appTemplate: AppTemplateScreen | null
  sheets: SheetSummary[]
  tasks: TaskSummary[]
  references: number
  revising: Array<{ sourceName: string; title: string; periodStart: string | null; periodEnd: string | null }>
  setupIssues: Array<{ code: string; params?: Record<string, string | number> }>
  taskRule: 'period' | 'none' | 'manual'
}
export interface ReferenceScreenSheet { id: string; name: string; family: string; template: string | null; schema: { columns: ColumnDef[] }; options: Record<string, string[]>; hidden: string[]; derived?: { columns: Array<DerivedColumn & { after?: string | null }>; cells: Record<string, Record<string, string | number | null>> } | null; dateColumn: string | null; rows: Array<{ id: string; data: Record<string, unknown>; confirmed: boolean | null }>; labels?: Record<string, string>; refRows?: Record<string, Array<{ id: string; label: string | null; mark?: 'unconfirmed' | 'unreadable' }>> }
export interface ReferenceScreenItem { referenceId: string; sourceProjectId: string; sourceName: string; includeUnconfirmed: boolean; revising: Array<{ taskId: string; title: string; periodStart: string | null; periodEnd: string | null }>; sheets: ReferenceScreenSheet[] }
export interface TaskReferenceStatus {
  hasReferences: boolean
  differs: boolean
  flagged: boolean
  tasks: Array<{ sourceName: string; title: string | null; was: { status: string; number: number | null }; now: { status: string; number: number | null } | null }>
  rowsChanged: number
  rowsGone: number
  rowsAdded?: number
  pairsChanged: number
  digest: string
}
export type ColumnType = 'string' | 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json' | 'money' | 'decimal'
export interface ColumnDef { name: string; type: ColumnType; required?: boolean; scale?: number; encrypted?: boolean }
export interface SheetRow { id: string; data: Record<string, unknown>; confirmed: boolean | null; confirmedByAi?: boolean; locked: boolean; virtual?: boolean }
export interface DerivedColumn { name: string; label: string; type: 'text' | 'money' | 'date' | 'status'; replaces?: string }
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
  moduleOnly: boolean
  pairDefs: Array<{ kind: string; toFamily: string }>
  exceptions: string[]
  summary: string[] | null
  fileColumn: string | null
  image: { column: string; help: string | null; mime: string[] | null; maxBytes: number | null } | null
  fileRules?: Record<string, { mime: string[]; maxBytes: number }>
  form: { groups: Array<{ name: string; columns: string[] }>; note: string | null } | null
  sheetActions: Array<{ module: string; label: string; icon?: string; input?: Record<string, string>; ask?: 'confirm'; setting?: string }>
  select?: { module: string; inputKey: string; label: string; input?: Record<string, string>; when: { cell: string; in: string[] }; summary?: { amount: string; currency: string; title?: string; details?: string[]; flags?: string[] }; preview?: { module: string; inputKey: string } } | null
  hideCommon?: Array<'confirm' | 'confirmAll' | 'edit' | 'delete' | 'add' | 'editConfirm' | 'rowFile'>
  sortBy?: { column: string; dir: 'asc' | 'desc' } | null
  askButtons?: Array<{ label: string; ask: string }>
  download?: boolean
  viewOnly?: string[]
  rowActions: Array<{ module: string; inputKey: string; label: string; icon?: 'copy' | 'receipt' | 'play' | 'check' | 'ban' | 'plus' | 'minus' | 'trash' | 'filter' | 'send'; input?: Record<string, string>; ask?: 'reason' | 'confirm'; when?: { cell: string; in: string[] }; result?: 'pdf'; withLang?: true; primary?: true; note?: string }>
  openFiles?: Array<{ column: string; label: string }>
  moreFiles?: string | null
  details?: { column: string; columns: string[]; money?: string[]; label: string; download?: boolean; sumOf?: string; sumTo?: string; newItem?: Record<string, unknown>; options?: Record<string, string[]>; booleans?: string[] } | null
  choices?: Record<string, Array<{ value: string; label?: string; hints?: string[] }>>
  choicesFollow?: Record<string, { from: string; fillEmpty?: true }>
  countryColumns?: string[]
  noFirst?: string[]
  confirmAs?: 'approve' | null
  dotFrom?: string | null
  dotWhyFrom?: string | null
  closeActions?: ReadonlyArray<{ column: string; kind: 'reason' | 'today'; label: string; when?: { cell: string; in: readonly string[] } }>
  hideWhen?: string | null
  lockEditWhen?: string | null
  lockEditOnly?: { items: string[]; label: string; exceptWhen?: { cell: string; in: string[] } | null } | null
  confirmWhen?: { cell: string; in: readonly string[] } | null
  textButtons?: boolean
  labels?: Readonly<Record<string, string>>
  colLabels?: Readonly<Record<string, string>>
  fxShown: Record<string, { rate: string; unit: number; source: 'estv-monthly' | 'estv-daily' | 'manual'; validFor: string }>
  fxShownColumns: { rate: string; unit: string } | null
  help: string | null
  screenRows: { virtual: Array<{ key: string; data: Record<string, unknown> } & ScreenRowResult>; notes: Record<string, ScreenRowResult> } | null
  derived: { columns: Array<DerivedColumn & { after?: string | null }>; cells: Record<string, Record<string, string | number | null>> } | null
  sums?: Array<{ key: string; label: string; groups: Array<{ group: string; currency: string | null; total: string; count: number; label?: string; gone?: true; mark?: 'unconfirmed' | 'unreadable' }>; cut: boolean }> | null
  refRows?: Record<string, Array<{ id: string; label: string | null; mark?: 'unconfirmed' | 'unreadable' }>>
  specDocs?: Array<{ key: string; label: string }>
  specAppSends?: Array<{ key: string; label: string; allowWhen?: { status?: string[]; confirmed?: true }; start?: string }>
  specHttpSends?: Array<{ key: string; label: string; allowWhen?: { status?: string[]; confirmed?: true }; start?: string; via?: 'calendar' | 'sms' }>
  calSentMarks?: Record<string, Record<string, { sendId: string; at: string }>>
  appSendMarks?: Record<string, Record<string, { status: 'sent' | 'pending'; number?: string; to?: string; at?: string; sendId: string }>>
  timeColumns?: string[]
  stageMoves?: { column: string; start: string; next: Record<string, string[]> } | null
  fileHelp?: string | null
  pairs: Array<{ id: string; fromRowId: string; toRowId: string; kind: string; confirmed: boolean; locked: boolean }>
  rows: SheetRow[]
  paging?: SheetPaging | null
}
export interface SheetPaging {
  year: number | 'all' | null
  years: number[]
  period: { start: string; end: string } | null
  sort: { col: string; dir: 'asc' | 'desc' }
  sortable: string[]
  showHidden: boolean
  next: string | null
  matched: number
  matchedMore: boolean
  hidden: number
  unconfirmed: number
  unconfirmedMore: boolean
  total: number
  filters?: Array<{ index: number; label: string; options: Array<{ value: string; label: string }>; value: string | null }>
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
export interface WorkAppListItem { workflowId: string; name: string; appTemplate: string | null; tasks: number; projectKind: string | null; updatedAt: string; groupId: string; groupName: string; groupType: 'canvas' | 'workflow'; projectCreatedAt: string | null }
export interface LinkedAppView { name: string; kind: string; workflowId: string; agentId: string; url: string; relation: Array<'reads' | 'readBy' | 'handsTo' | 'receivesFrom'>; readsSheets?: string[] }
export interface WorkAppOpen { workflowId: string; name: string; projectId: string; welcome: string; fixedAppTemplate: string | null; chatBlocked: boolean; chatBlockedReason: 'no_tool' | 'graph' | null; appTemplates: AppTemplateScreen[]; linkedApps?: LinkedAppView[] }
export type WorkAppProposal =
  | { type: 'apply_app_template'; kind: string; settings: Record<string, unknown> }
  | { type: 'bank_import'; module: string; fileId: string; fileName: string; reader: ImportReader; accounts: Record<string, string>; balances?: Record<string, { opening: string; closing: string }>; label?: string; rows: number; groups: number }
  | { type: 'send'; sendId: string }
  | { type: 'module_run'; module: string; input: Record<string, unknown>; labelKey?: string; detail: string; preview?: { module: string; input: Record<string, unknown> } }
  | { type: 'confirm_rows'; sheetId: string; rowIds: string[]; fingerprint: string; count: number; detail: string; labelKey?: string }
  | { type: 'ledger_link'; ledgerProjectId: string; count: number; replaces: number; rows?: Array<{ date: string; amount: string; currency: string; counterparty: string; target: string; chosen: boolean }>; detail: string; items?: unknown[]; expl?: string[]; fingerprint?: string }
  | { type: 'ledger_files'; ledgerProjectId: string; files: Array<{ fileId: string; name: string }>; ledgerUrl: string | null }
  | { type: 'attach_files'; labelKey: string; ask: string; detail: string; hintKey?: string }
  | { type: 'report_files'; files: Array<{ fileId: string; name: string; problem: string }>; part: number; parts: number }
  | { type: 'ledger_statement'; ledgerProjectId: string; fileId: string; fileName: string; account: { type?: 'card' | 'bank'; last4: string; currency: string; bank: string; label: string }; summary: { lines: number; from: string; until: string; opening: string; closing: string; rounding?: string }; statement?: unknown }
export interface ShownAttachment { name: string; mimeType: string; pages?: number }
export interface WorkMessageView { id: string; role: 'user' | 'assistant' | 'notice'; actor: string; text: string; files: Array<{ id: string; name: string; mimeType: string }>; shown: ShownAttachment[]; proposals: WorkAppProposal[]; sendId?: string | null; shared?: boolean; notice?: { key: string; params?: Record<string, string | number>; by?: string }; done?: Record<string, CardDone>; createdAt: string }
export type CardDone = Record<string, string | number | null>
export function saveCardDone(api: WorkApi, projectId: string, messageId: string | undefined, index: number | undefined, result: CardDone): void {
  if (!messageId || messageId.startsWith('local-') || index === undefined) return
  void api('POST', `/projects/${encodeURIComponent(projectId)}/card-done`, { messageId, index, result }).catch(() => undefined)
}
export type ChatRoom = 'private' | 'team'
export type ProjectFileStatus =
  | { status: 'attached'; sheetId: string; rowId: string; family: string | null; role: 'main' | 'more' }
  | { status: 'excluded'; reason: string; text?: string; of?: string; by: 'human' | 'ai' }
  | { status: 'pending'; question: string; by: 'human' | 'ai' }
  | { status: 'unreadable'; reason: string }
  | { status: 'new' }
export interface ProjectFileView { id: string; name: string; mimeType: string; kind: string; sizeBytes: number; uploadedAt: string; pages: number; locked: boolean; lockReason?: 'proof' | 'record'; status?: ProjectFileStatus; reported?: number }
export interface PairTargetRow { id: string; summary: Array<[string, unknown]>; locked: boolean; confirmed: boolean | null }

const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'text/csv': 'csv', 'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc', 'application/zip': 'zip',
}

export interface WorkFiles {
  list(projectId: string): Promise<ProjectFileView[]>
  upload(projectId: string, file: File | Blob, kind: string, opts?: { name?: string; parentFileId?: string }): Promise<{ id: string; created: boolean }>
  uploadBig(projectId: string, file: File, kind: string, onPiece?: (done: number, total: number) => void): Promise<{ id: string; created: boolean }>
  open(projectId: string, fileId: string): Promise<void>
  referenceUrl(projectId: string, fileId: string): Promise<{ url: string; type: string; name: string; ext: string }>
  imageUrl(projectId: string, fileId: string): Promise<string | null>
  designPreview(projectId: string, design: Record<string, string | boolean | number | null>, lang: string, docLang?: string, docCurrency?: string): Promise<string>
  remove(projectId: string, fileId: string): Promise<void>
  exportTable(projectId: string, format: 'xlsx' | 'csv' | 'pdf', table: { header: string[]; rows: string[][]; align: string[] }): Promise<Blob>
  decide(projectId: string, fileId: string, action: 'exclude' | 'reset' | 'detach', reason?: string, text?: string): Promise<void>
  report(projectId: string, input: { source: 'work_files' | 'work_chat'; fileIds: string[]; note: string; chatMessageId?: string; consentV: number; lang: string; attached: File[] }): Promise<{ number: number; mailed: boolean }>
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
    async decide(projectId, fileId, action, reason, text) {
      let res: Response
      try { res = await fetch(`${base}/${projectId}/files/${fileId}/decision`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(reason ? { reason } : {}), ...(text ? { text } : {}) }) }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
    },
    async report(projectId, input) {
      const form = new FormData()
      form.set('payload', JSON.stringify({ source: input.source, fileIds: input.fileIds, note: input.note, ...(input.chatMessageId ? { chatMessageId: input.chatMessageId } : {}), consent: true, consentV: input.consentV, lang: input.lang }))
      for (const f of input.attached) form.append('file', f, f.name)
      let res: Response
      try { res = await fetch(`${base}/${projectId}/reports`, { method: 'POST', headers: auth, body: form }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
      return (await res.json()) as { number: number; mailed: boolean }
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
    async uploadBig(projectId, file, kind, onPiece) {
      const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('')
      const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
      const json = async (url: string, method: string, body?: unknown, raw?: Blob): Promise<Response> => {
        try {
          return await fetch(url, { method, headers: raw ? auth : { ...auth, 'Content-Type': 'application/json' }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
        } catch { throw new WorkApiError('network') }
      }
      let res = await json(`${base}/${projectId}/files/uploads`, 'POST', { name: file.name, mimeType: file.type, sizeBytes: file.size, sha256, kind })
      if (!res.ok) return fail(res)
      const { uploadId, pieceBytes, pieces } = (await res.json()) as { uploadId: string; pieceBytes: number; pieces: number }
      for (let n = 0; n < pieces; n++) {
        for (let attempt = 0; ; attempt++) {
          try {
            res = await json(`${base}/${projectId}/files/uploads/${uploadId}?n=${n}`, 'PUT', undefined, file.slice(n * pieceBytes, Math.min(file.size, (n + 1) * pieceBytes)))
            if (res.ok || attempt >= 2 || res.status < 500) break
          } catch (e) {
            if (attempt >= 2) throw e
          }
          await new Promise((r) => setTimeout(r, 1500))
        }
        if (!res.ok) return fail(res)
        onPiece?.(n + 1, pieces)
      }
      for (let attempt = 0; ; attempt++) {
        res = await json(`${base}/${projectId}/files/uploads/${uploadId}`, 'POST')
        if (res.status !== 503 || attempt >= 20) break
        await new Promise((r) => setTimeout(r, 3000))
      }
      if (!res.ok) return fail(res)
      return (await res.json()) as { id: string; created: boolean }
    },
    async designPreview(projectId, design, lang, docLang, docCurrency) {
      let res: Response
      try { res = await fetch(`${base}/${projectId}/design-preview`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ design, lang, ...(docLang ? { docLang } : {}), ...(docCurrency ? { docCurrency } : {}) }), cache: 'no-store' }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
      return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/pdf' }))
    },
    async exportTable(projectId, format, table) {
      let res: Response
      try { res = await fetch(`${base}/${projectId}/table-export`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ format, table }), cache: 'no-store' }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
      return new Blob([await res.arrayBuffer()], { type: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0] })
    },
    async referenceUrl(projectId, fileId) {
      let res: Response
      try { res = await fetch(`${base}/${projectId}/reference-files/${encodeURIComponent(fileId)}`, { headers: auth, cache: 'no-store' }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
      const raw = (res.headers.get('content-type') ?? '').split(';')[0].trim()
      const type = INLINE_TYPES.has(raw) ? raw : 'application/octet-stream'
      const cd = res.headers.get('content-disposition') ?? ''
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1]
      let name = /filename="([^"]*)"/i.exec(cd)?.[1] ?? ''
      if (star) { try { name = decodeURIComponent(star) } catch { } }
      const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? MIME_EXT[raw] ?? '').toLowerCase()
      return { url: URL.createObjectURL(new Blob([await res.arrayBuffer()], { type })), type, name, ext }
    },
    async imageUrl(projectId, fileId) {
      let res: Response
      try { res = await fetch(`${base}/${projectId}/files/${fileId}`, { headers: auth, cache: 'no-store' }) } catch { throw new WorkApiError('network') }
      if (!res.ok) return fail(res)
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
      if (type !== 'image/png' && type !== 'image/jpeg') return null
      return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }))
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

export type SendStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'refused' | 'discarded'
export interface SendView {
  id: string
  kind: 'email' | 'telegram' | 'http' | 'db_write' | 'db_sql' | 'sms' | 'call' | 'work_app' | 'calendar'
  slot: string
  declared: string | null
  status: SendStatus
  code: string | null
  auto: boolean
  to: string[]
  toSetting: string | null
  subject: string | null
  text: string | null
  attachments: Array<{ id: string; name: string | null }>
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
  reissueOf: string | null
  reissued: boolean
  params: Record<string, unknown> | null
  affectedRows: number | null
  aiSql?: { sql: string; reason: string; targetLabel: string; kind: string; oneStep: boolean; countSql?: string | null } | null
  appSend?: { toLabel: string; rows: Array<Record<string, unknown>>; url?: string } | null
  slotConnected?: boolean | null
  copyText?: string | null
  json?: unknown
  calendar?: { label: string; title: string; description: string; allDay: boolean; start: string; end: string; timeZone: string; link?: string; note?: 'previous_calendar' | 'previous_calendar_lost'; lost?: string; existing?: { start: string | null; title: string | null } } | null
  sms?: { to: string; written: string | null; assumed: boolean; country: string; parts: number; credits: number; refunded: boolean } | null
}
export interface CapabilitiesView {
  v3: boolean
  autoSends: Array<{ id: string; label: string; kind: SendView['kind']; via: string; to: { setting: string } | { fixed: string[] } | null; off: boolean }>
  webSearch: { declared: boolean; off: boolean }
  knowledge: boolean
  connections: Array<{ slot: string; kind: string; label: string; connected: boolean }>
  pkg: string | null
  pending: number
}

export interface ActivityPerson { key: string; name: string | null; you: boolean }
export interface ActivityItem {
  id: string
  at: string
  action: string
  who:
    | { kind: 'person'; person: ActivityPerson }
    | { kind: 'ai' }
    | { kind: 'module'; module: string }
    | { kind: 'flow' | 'channel' | 'app' | 'handoff'; name: string | null }
    | { kind: 'import'; module: string }
    | { kind: 'other'; label: string }
  requestedBy: ActivityPerson | null
  sheet: { id: string; name: string | null; family: string | null } | null
  task: { id: string; title: string | null } | null
  file: { id: string; name: string | null } | null
  why: string | null
  changes: { before: unknown; after: unknown } | null
}
export interface ActivityList { items: ActivityItem[]; more: boolean }

export interface AppPerson { id: number; name: string | null; email: string | null; jobTitle: string | null; status: 'active' | 'suspended'; sameAsOwner?: true; approverOf?: string[] }
export interface AppInvite { id: number; email: string; expiresAt: string | null }
export interface AppPeople {
  owner: { name: string | null; email: string | null }
  items: AppPerson[]
  invites: AppInvite[]
  counts: { in: number; out: number; team: number }
  more: boolean
}
export type AppInviteResult = { result: 'added' } | { result: 'invited' | 'extended'; emailSent: boolean }

export interface PeerSettings { name: string; kind: string; url: string; values: Record<string, unknown> }

export interface AttentionView {
  code: string
  params?: Record<string, string | number>
  ask?: string
  open?: { family: string }
  review?: {
    pdf: { module: string; input: Record<string, string> }
    actions: Array<{ label: string; module: string; input: Record<string, string>; ask?: 'confirm' | 'reason' | 'check'; tone?: 'primary' | 'danger' }>
    items?: { actions: Array<{ label: string; module: string; input: Record<string, string>; key: string; ask?: 'confirm' | 'reason'; tone?: 'primary' | 'danger'; next?: true }> }
  }
}
export interface ReviewItem { id: string; title: string; sub?: string; fields: Array<{ label: string; value: string }>; amount?: string; note?: string; noteTone?: 'muted' | 'amber' | 'red'; files: string[]; marks: Array<{ text: string; mine: boolean }> }
