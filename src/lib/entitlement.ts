import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export type EntitlementDenyReason = 'no_subscription' | 'pending_payment' | 'trial_expired' | 'pending_access' | 'service_inactive'

export interface EntitlementResult {
  allowed: boolean
  reason?: EntitlementDenyReason
  isTrial: boolean
  isConverted: boolean
}

export async function assertServiceEntitlement(_userId: string): Promise<EntitlementResult> {
  return { allowed: true, isTrial: false, isConverted: false }
}

export async function assertWorkflowActivationAllowed(_userId: string): Promise<{ code: string; message: string } | null> {
  return null
}

export function activationStatusFor(
  block: { code: string; message: string } | null,
): { status: 'draft' | 'production'; trafficWeight: number } {
  return block ? { status: 'draft', trafficWeight: 0 } : { status: 'production', trafficWeight: 100 }
}

export async function isCrawlAllowedForUser(_userId: string): Promise<boolean> {
  return SELF_HOSTED_POLICY.crawlAllowed
}

export async function isPaymentConvertedForUser(_userId: string, _status: string, _planType: string): Promise<boolean> {
  return unavailable('Payment conversion')
}
