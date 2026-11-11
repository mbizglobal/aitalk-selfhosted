import { WorkError } from './errors'
import { scanFilesAllowed } from './scan-fence'

export interface WorkScope {
  projectId: string
  taskId: string | null
  runId: string
  view?: import('./app-chat').RoomView
  requestedBy?: import('./sheet-gate').WorkRequester
  scan?: { scanId: string; attemptId: string; allowed: string[]; linked: string[] }
}

export type WorkAppProposal =
  | { type: 'apply_app_template'; kind: string; settings: Record<string, unknown> }
  | {
    type: 'bank_import'
    module: string
    fileId: string
    fileName: string
    reader: 'auto' | 'ubs' | { recipe: unknown } | { recipeKey: string } | { statement: unknown }
    accounts: Record<string, string>
    balances?: Record<string, { opening: string; closing: string }>
    label?: string
    rows: number
    groups: number
  }
  | { type: 'send'; sendId: string }
  | {
    type: 'module_run'
    module: string
    input: Record<string, unknown>
    labelKey?: string
    detail: string
    preview?: { module: string; input: Record<string, unknown> }
  }
  | { type: 'confirm_rows'; sheetId: string; rowIds: string[]; fingerprint: string; count: number; detail: string; labelKey?: string }
  | { type: 'ledger_link'; ledgerProjectId: string; items: Array<{ accountKey: string; lineKey: string; kind: string; allocations: Array<{ rowId: string; amountLine: string; amountTarget?: string }>; chosen?: true }>; expl: string[]; own?: Array<{ rowId: string; patch: Record<string, string>; confirm: boolean }>; fingerprint: string; count: number; replaces: number; rows: Array<{ date: string; amount: string; currency: string; counterparty: string; target: string; chosen: boolean; fix?: string }>; detail: string }
  | { type: 'ledger_files'; ledgerProjectId: string; files: Array<{ fileId: string; name: string }>; ledgerUrl: string | null }
  | { type: 'attach_files'; labelKey: string; ask: string; detail: string; hintKey?: string }
  | { type: 'report_files'; files: Array<{ fileId: string; name: string; problem: string }>; part: number; parts: number }
  | { type: 'ledger_statement'; ledgerProjectId: string; fileId: string; fileName: string; statement: unknown; account: { type?: 'card' | 'bank'; last4: string; iban?: string; currency: string; bank: string; label: string }; summary: { lines: number; from: string; until: string; opening: string; closing: string; rounding?: string } }

const runs = new Map<string, { list: WorkAppProposal[]; timer: ReturnType<typeof setTimeout>; counts?: Map<string, number>; projectId?: string; person?: boolean; creditShort?: boolean }>()

const RUN_TTL_MS = 15 * 60_000

export function openWorkAppRun(runId: string, meta?: { projectId: string; person: boolean }): void {
  const timer = setTimeout(() => runs.delete(runId), RUN_TTL_MS)
  timer.unref?.()
  runs.set(runId, { list: [], timer, ...(meta ?? {}) })
}

export function hasOpenPersonRun(projectId: string): boolean {
  for (const r of runs.values()) if (r.person && r.projectId === projectId) return true
  return false
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}

function proposalFiles(p: WorkAppProposal): { write: string[]; refer: string[] } {
  switch (p.type) {
    case 'bank_import': case 'ledger_statement': return { write: [p.fileId], refer: [] }
    case 'ledger_files': return { write: p.files.map((f) => f.fileId), refer: [] }
    case 'report_files': return { write: [], refer: p.files.map((f) => f.fileId) }
    default: return { write: [], refer: [] }
  }
}

export function recordWorkAppProposal(runId: string, p: WorkAppProposal): boolean {
  const list = runs.get(runId)?.list
  if (!list) return false
  const pf = proposalFiles(p)
  if (!scanFilesAllowed(pf.write, pf.refer)) throw new WorkError('FORBIDDEN', 'a card for a file outside the phone scan being sorted — leave it')
  const i = list.findIndex((x) => x.type === p.type && (x.type !== 'bank_import' || p.type !== 'bank_import' || x.fileId === p.fileId) && (x.type !== 'send' || p.type !== 'send' || x.sendId === p.sendId)
    && (x.type !== 'module_run' || p.type !== 'module_run' || (x.module === p.module && stableJson(x.input) === stableJson(p.input)))
    && (x.type !== 'confirm_rows' || p.type !== 'confirm_rows' || x.sheetId === p.sheetId)
    && (x.type !== 'ledger_link' || p.type !== 'ledger_link' || x.fingerprint === p.fingerprint)
    && (x.type !== 'ledger_statement' || p.type !== 'ledger_statement' || x.fileId === p.fileId)
    && (x.type !== 'ledger_files' || p.type !== 'ledger_files' || x.files.map((f) => f.fileId).join(',') === p.files.map((f) => f.fileId).join(','))
    && (x.type !== 'attach_files' || p.type !== 'attach_files' || (x.labelKey === p.labelKey && x.ask === p.ask))
    && (x.type !== 'report_files' || p.type !== 'report_files' || x.part === p.part))
  if (i >= 0) list.splice(i, 1)
  list.push(p)
  return true
}

export function countWorkAppRun(runId: string, key: string): number {
  const run = runs.get(runId)
  if (!run) return Number.POSITIVE_INFINITY
  run.counts ??= new Map()
  const n = (run.counts.get(key) ?? 0) + 1
  run.counts.set(key, n)
  return n
}

export function markWorkAppRunCreditShort(runId: string): void {
  const run = runs.get(runId)
  if (run) run.creditShort = true
}

export function workAppRunCreditShort(runId: string): boolean {
  return runs.get(runId)?.creditShort === true
}

export function workAppRunProposals(runId: string): WorkAppProposal[] {
  return runs.get(runId)?.list ?? []
}

const turnQueues = new Map<string, Promise<void>>()

export function enterTurn(key: string, maxMs: number): { wait: Promise<void>; release: () => void } {
  const prev = turnQueues.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((r) => { release = r })
  const tail = prev.then(() => mine)
  turnQueues.set(key, tail)
  void tail.then(() => { if (turnQueues.get(key) === tail) turnQueues.delete(key) })
  let timer: ReturnType<typeof setTimeout> | undefined
  const wait = Promise.race([prev, new Promise<void>((r) => { timer = setTimeout(r, maxMs); timer.unref?.() })]).then(() => clearTimeout(timer))
  return { wait, release }
}

export function closeWorkAppRun(runId: string): WorkAppProposal[] {
  const run = runs.get(runId)
  if (!run) return []
  clearTimeout(run.timer)
  runs.delete(runId)
  return run.list
}
