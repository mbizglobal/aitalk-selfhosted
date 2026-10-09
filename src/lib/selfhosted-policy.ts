export const SELF_HOSTED_POLICY = {
  agentLimit: 10,
  maxProduction: Number.POSITIVE_INFINITY,
  teamMemberLimit: Number.POSITIVE_INFINITY,
  maxWorkflows: null,
  maxDataSheets: null,
  crawlAllowed: false,
} as const

export type PoweredByRule = 'hide' | 'show' | 'choice'

export function poweredByRuleFor(
  selfHosted: boolean,
  planType: string | null | undefined,
  serviceVariant: string | null | undefined,
): PoweredByRule {
  if (selfHosted) return 'choice'
  const plan = planType || 'free'
  const canHide = serviceVariant === 'managed' ? ['standard', 'pro'].includes(plan) : ['growth', 'pro'].includes(plan)
  return canHide ? 'hide' : 'show'
}

export function applyPoweredByRule(rule: PoweredByRule, current: string): string {
  if (rule === 'hide') return 'none'
  if (rule === 'show' && current === 'none') return 'AITalk02_b.png'
  return current
}
