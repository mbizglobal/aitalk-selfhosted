import type { SubscriptionPlan } from '@prisma/client'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export function getManagedPlanAgentLimit(_planType: SubscriptionPlan): number { return unavailable('Plan limits') }
export function getManagedStoragePerAgent(_planType: SubscriptionPlan): number { return unavailable('Plan limits') }
export function getManagedDocPagesPerMonth(_planType: SubscriptionPlan): number { return unavailable('Plan limits') }
export function getManagedActiveWorkflowLimit(_planType: SubscriptionPlan): number { return unavailable('Plan limits') }
export function getPlanTeamMemberLimit(_planType: SubscriptionPlan): number { return unavailable('Plan limits') }
export function hasManagedPlanTier(_planType: SubscriptionPlan): boolean { return unavailable('Plan limits') }
export function getManagedPlanTeamMemberLimit(_planType: SubscriptionPlan): number { return unavailable('Plan limits') }
