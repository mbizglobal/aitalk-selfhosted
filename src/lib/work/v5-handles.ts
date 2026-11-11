import { readProjectReferences, type ReferenceReader } from './references'
import { fetchFxMonthlyRates, type FetchFxMonthlyResult } from './fx-bazg'
import { estvMonthlyFx, projectMembersTx, type WorkMember, type WorkRequester, type WorkSheetDeps } from './sheet-gate'
import { buildConfirmCard } from './confirm-card'
import { recordWorkAppProposal } from './app-scope'
import { WorkError } from './errors'
import { fingerprint } from './fingerprint'
import { ledgerLinkSetup, proposeLedgerLink, type LedgerLinkSkip } from './ledger-link'
import type { WorkFileDeps } from './files'

export interface WorkAppV5Handles {
  references(opts?: { fresh?: boolean }): Promise<ReferenceReader>
  fingerprint(label: string, value: unknown): Promise<string>
}

export interface WorkAppV7Handles {
  members(): Promise<readonly WorkMember[]>
  ownerName(): Promise<string>
  fxMonthly(currency: string, date: string): Promise<{ rate: string; unit: number } | null>
  referencedCells(family: string): Promise<ReadonlyMap<string, Readonly<Record<string, string | number | null>>>>
}

export interface WorkAppV8Handles {
  fetchFxMonthly(q: { months: readonly string[]; currencies: readonly string[] }): Promise<FetchFxMonthlyResult>
}

export function v8Handles(core: number | null, deps: WorkSheetDeps): Partial<WorkAppV8Handles> {
  if (core === null || core < 8) return {}
  return { fetchFxMonthly: (q) => fetchFxMonthlyRates(deps.db, q) }
}

export function v5Handles(core: number | null, s: { deps: WorkSheetDeps; userId: string; projectId: string; readAsWorkflow?: string }): Partial<WorkAppV5Handles & WorkAppV7Handles> {
  if (core === null || core < 5) return {}
  let once: Promise<ReferenceReader> | null = null
  return {
    ...(core >= 7 ? {
      members: () => projectMembersTx(s.deps.db, s.userId, s.projectId),
      ownerName: async () => { const u = await s.deps.db.user.findUnique({ where: { id: s.userId }, select: { name: true, email: true } }); return u?.name || u?.email || '' },
      fxMonthly: (currency: string, date: string) => estvMonthlyFx(s.deps.db, currency, date),
      referencedCells: async (family: string) => (await import('./reference-views')).referencedCells(s.deps, { userId: s.userId, projectId: s.projectId, ...(s.readAsWorkflow !== undefined ? { workflowId: s.readAsWorkflow } : {}) }, family),
    } : {}),
    references: (opts) => {
      const read = () => readProjectReferences(s.deps, { userId: s.userId, projectId: s.projectId, ...(s.readAsWorkflow !== undefined ? { workflowId: s.readAsWorkflow } : {}) })
      return opts?.fresh ? (once = read()) : (once ??= read())
    },
    fingerprint: async (label, value) => fingerprint(await s.deps.dataKey(s.deps.db, s.userId), label, value),
  }
}

export interface WorkAppV5ToolHandles extends WorkAppV5Handles {
  proposeConfirm(p: { sheetId: string; rowIds: readonly string[]; detail: string; labelKey?: string }): Promise<{ proposed: true; count: number }>
  proposeLedgerLink(p: { items: unknown; own?: unknown; detail: string }): Promise<{ proposed: boolean; count: number; skipped: LedgerLinkSkip[]; setup?: string[] }>
  ledgerLinkSetup(): Promise<string[] | null>
  proposeLedgerStatement(p: { fileId: string; statement: unknown; account: unknown }): Promise<{ proposed: boolean; adds?: 'ok' | 'rounding' | 'off'; diff?: string; lines?: number; setup?: string[] }>
  proposeAppSend(p: { family: string; rows: unknown }): Promise<{ proposed: true; sendId: string; rows: number } | { proposed: false; setup: string }>
  appLinkSetup(p: { inbox: string; reads: readonly string[]; back: readonly string[] }): Promise<string[] | null>
}

export function v5ToolHandles(core: number | null, s: { deps: WorkSheetDeps; userId: string; projectId: string; workflowId: string; runId: string; requestedBy?: WorkRequester }): Partial<WorkAppV5ToolHandles> {
  if (core === null || core < 5) return {}
  return {
    ...v5Handles(core, { deps: s.deps, userId: s.userId, projectId: s.projectId, readAsWorkflow: s.workflowId }),
    async proposeConfirm(p) {
      const card = await buildConfirmCard(s.deps, { userId: s.userId, projectId: s.projectId, workflowId: s.workflowId, sheetId: p.sheetId, rowIds: p.rowIds, detail: p.detail, ...(p.labelKey ? { labelKey: p.labelKey } : {}) })
      if (!recordWorkAppProposal(s.runId, card)) throw new WorkError('INVALID', 'no open conversation turn to show the card in')
      return { proposed: true as const, count: card.count }
    },
    ledgerLinkSetup: () => ledgerLinkSetup(s.deps, { userId: s.userId, projectId: s.projectId }),
    appLinkSetup: async (p) => (await import('./app-send')).appLinkSetup(s.deps, { userId: s.userId, projectId: s.projectId }, p),
    async proposeLedgerStatement(p) {
      const { proposeLedgerStatement } = await import('./ledger-files')
      return proposeLedgerStatement(s.deps as WorkFileDeps, { userId: s.userId, projectId: s.projectId, runId: s.runId, fileId: p.fileId, statement: p.statement, account: p.account })
    },
    async proposeAppSend(p) {
      const { appSendRouteName, createAppSendCard, findSendRoutes } = await import('./app-send')
      const routes = (await findSendRoutes(s.deps.db, s.userId, s.workflowId)).filter((r) => r.family === p.family)
      if (routes.length !== 1) return { proposed: false as const, setup: routes.length ? 'several send lines to that inbox — keep one' : `no send line from this work app to an app inbox ${p.family} — the owner draws it on the canvas` }
      const r = await createAppSendCard({ deps: s.deps, userId: s.userId, projectId: s.projectId, workflowId: s.workflowId, caller: { type: 'ai', workflowId: s.workflowId, ...(s.requestedBy ? { requestedBy: s.requestedBy } : {}) }, taskId: null }, appSendRouteName(routes[0]), p.rows)
      if (!recordWorkAppProposal(s.runId, { type: 'send', sendId: r.sendId })) throw new WorkError('INVALID', 'no open conversation turn to show the card in')
      return { proposed: true as const, sendId: r.sendId, rows: r.rows }
    },
    async proposeLedgerLink(p) {
      const reader = await readProjectReferences(s.deps, { userId: s.userId, projectId: s.projectId, workflowId: s.workflowId })
      return proposeLedgerLink(s.deps, { userId: s.userId, projectId: s.projectId, runId: s.runId, items: p.items, ...(p.own !== undefined ? { own: p.own } : {}), detail: p.detail, reader })
    },
  }
}
