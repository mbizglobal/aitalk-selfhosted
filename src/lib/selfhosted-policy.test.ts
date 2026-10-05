import { test } from 'node:test'
import assert from 'node:assert/strict'
import { poweredByRuleFor, applyPoweredByRule } from './selfhosted-policy'

function oldCanHide(planType: string, serviceVariant: string): boolean {
  return serviceVariant === 'managed' ? ['standard', 'pro'].includes(planType) : ['growth', 'pro'].includes(planType)
}

test('Cloud: same answer as before the change for every plan and service type', () => {
  for (const plan of ['free', 'starter', 'standard', 'growth', 'pro', 'weird', '']) {
    for (const variant of ['managed', 'self', '']) {
      const rule = poweredByRuleFor(false, plan, variant)
      assert.equal(rule, oldCanHide(plan || 'free', variant) ? 'hide' : 'show', `${plan}/${variant}`)
    }
  }
  assert.equal(poweredByRuleFor(false, null, null), 'show')
})

test('Self-hosted: user\'s choice regardless of plan and service type', () => {
  for (const plan of ['free', 'pro', null]) assert.equal(poweredByRuleFor(true, plan, 'managed'), 'choice')
})

test('applyPoweredByRule: hide gives none, show restores from none, choice stays as is', () => {
  assert.equal(applyPoweredByRule('hide', 'AITalk02_w.png'), 'none')
  assert.equal(applyPoweredByRule('show', 'none'), 'AITalk02_b.png')
  assert.equal(applyPoweredByRule('show', 'AITalk02_w.png'), 'AITalk02_w.png')
  assert.equal(applyPoweredByRule('choice', 'none'), 'none')
  assert.equal(applyPoweredByRule('choice', 'AITalk02_w.png'), 'AITalk02_w.png')
})
