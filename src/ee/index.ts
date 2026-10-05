import { getLicenseState, type EeFeature } from '@/lib/license'

export type { EeFeature }

export function enabledEeFeatures(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): EeFeature[] {
  const s = getLicenseState(env, now)
  return s.status === 'active' || s.status === 'grace' ? [...s.features] : []
}

export { approvalApplies, assertMayUnlockSeal, eligibleApprovers, parseApprovalSettings, type ApprovalSettings } from './approval/rules'
export { requestApproval, approveTask, rejectApproval, cancelApproval, readApprovalState, setApprovalSettings, readTaskApproval, listApprovalCandidates } from './approval/actions'
