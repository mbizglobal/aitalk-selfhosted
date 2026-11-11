import { WorkError } from './errors'
import { fingerprint } from './references'
import { findTemplate } from './sheet-templates'
import { readProjectSheet, type SheetRowView, type WorkSheetDeps } from './sheet-gate'
import type { WorkAppProposal } from './app-scope'

export const CONFIRM_CARD_MAX = 100

export function cardFingerprint(key: Buffer, rows: ReadonlyArray<Pick<SheetRowView, 'id' | 'sheetId' | 'data'>>): string {
  const list = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => ({ id: r.id, s: r.sheetId, d: r.data }))
  return fingerprint(key, 'confirm_rows', list)
}

export async function buildConfirmCard(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string; workflowId: string; sheetId: string; rowIds: readonly string[]; detail: string; labelKey?: string },
): Promise<Extract<WorkAppProposal, { type: 'confirm_rows' }>> {
  const ids = [...new Set(q.rowIds)]
  if (ids.length === 0 || ids.length > CONFIRM_CARD_MAX || ids.length !== q.rowIds.length) throw new WorkError('INVALID', `a confirm card holds 1 to ${CONFIRM_CARD_MAX} different rows`)
  const s = await deps.db.dataSheet.findFirst({ where: { id: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId }, select: { template: true } })
  if (!s) throw new WorkError('NOT_FOUND')
  const tpl = s.template ? findTemplate(deps.templates, s.template) : null
  if (!tpl?.confirm) throw new WorkError('INVALID', 'this sheet has no confirmation')
  const { rows } = await readProjectSheet(deps, { userId: q.userId, projectId: q.projectId, sheetId: q.sheetId, workflowId: q.workflowId })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const picked = ids.map((id) => byId.get(id))
  if (picked.some((r) => !r)) throw new WorkError('NOT_FOUND', 'a row of the card is not in this sheet')
  if (picked.some((r) => r!.confirmed !== false)) throw new WorkError('INVALID', 'a confirm card holds only unconfirmed rows')
  const key = await deps.dataKey(deps.db, q.userId)
  return {
    type: 'confirm_rows',
    sheetId: q.sheetId,
    rowIds: ids,
    fingerprint: cardFingerprint(key, picked as SheetRowView[]),
    count: ids.length,
    detail: q.detail.slice(0, 300),
    ...(q.labelKey ? { labelKey: q.labelKey } : {}),
  }
}
