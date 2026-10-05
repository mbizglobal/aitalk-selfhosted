
export interface WorkScope {
  projectId: string
  taskId: string | null
  runId: string
}

export type WorkAppProposal =
  | { type: 'apply_app_template'; kind: string; settings: Record<string, unknown> }
  | {
    type: 'bank_import'
    module: string
    fileId: string
    fileName: string
    reader: 'ubs' | { recipe: unknown } | { recipeKey: string }
    accounts: Record<string, string>
    balances?: Record<string, { opening: string; closing: string }>
    label?: string
    rows: number
    groups: number
  }

const runs = new Map<string, { list: WorkAppProposal[]; timer: ReturnType<typeof setTimeout> }>()

const RUN_TTL_MS = 15 * 60_000

export function openWorkAppRun(runId: string): void {
  const timer = setTimeout(() => runs.delete(runId), RUN_TTL_MS)
  timer.unref?.()
  runs.set(runId, { list: [], timer })
}

export function recordWorkAppProposal(runId: string, p: WorkAppProposal): boolean {
  const list = runs.get(runId)?.list
  if (!list) return false
  const i = list.findIndex((x) => x.type === p.type && (x.type !== 'bank_import' || p.type !== 'bank_import' || x.fileId === p.fileId))
  if (i >= 0) list.splice(i, 1)
  list.push(p)
  return true
}

export function closeWorkAppRun(runId: string): WorkAppProposal[] {
  const run = runs.get(runId)
  if (!run) return []
  clearTimeout(run.timer)
  runs.delete(runId)
  return run.list
}
