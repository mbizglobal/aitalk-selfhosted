const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export type AccountLifecycleState = 'active' | 'trial_expired' | 'paid_grace' | 'suspended_retain' | 'suspended_purged'
export interface AccountLifecycle {
  state: AccountLifecycleState
  dataDeletionDate: string | null
  previousPlan: string | null
}
export interface LifecycleSubInput {
  planType: string | null
  status: string | null
  trialEndsAt: Date | null
  graceStartedAt: Date | null
  softFreeConvertedAt: Date | null
}
export function deriveAccountLifecycle(_sub: LifecycleSubInput, _opts: { isConverted: boolean; now?: number }): AccountLifecycle {
  return unavailable('Subscription lifecycle')
}
