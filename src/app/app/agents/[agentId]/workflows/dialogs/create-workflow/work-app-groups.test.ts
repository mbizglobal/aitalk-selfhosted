import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countryOptions, defaultCountry, groupWorkApps, type WorkAppGroupItem } from './work-app-groups'

const item = (templateId: string, countries: 'all' | string[] | undefined, sortOrder: number, includes: string[] = [], extra: Partial<WorkAppGroupItem> = {}): WorkAppGroupItem =>
  ({ templateId, name: templateId, description: '', keywords: [], sortOrder, countries, includes, ...extra })

const ITEMS = [
  item('blank', 'all', 102),
  item('receipts', 'all', 104),
  item('vat', ['CH'], 103),
  item('invoice', ['CH'], 106),
  item('suite', ['CH'], 105, ['a', 'b', 'c', 'd']),
]
const keys = (s: Array<{ key: string; items: WorkAppGroupItem[] }>) => s.map((x) => [x.key, x.items.map((t) => t.templateId)])

test('country selected - all-countries group first - inside a country group, bundles first, then sortOrder', () => {
  assert.deepEqual(keys(groupWorkApps(ITEMS, 'CH', '', 'en')), [
    ['all', ['blank', 'receipts']],
    ['CH', ['suite', 'vat', 'invoice']],
  ])
})

test('All countries - one group per country - a multi-country app appears once in its first country - groups sorted by country name (screen language)', () => {
  const xs = [...ITEMS, item('dach', ['DE', 'CH'], 200), item('de-only', ['DE'], 201)]
  assert.deepEqual(countryOptions(xs, 'en'), ['DE', 'CH'])
  assert.deepEqual(keys(groupWorkApps(xs, null, '', 'en')), [
    ['all', ['blank', 'receipts']],
    ['DE', ['dach', 'de-only']],
    ['CH', ['suite', 'vat', 'invoice']],
  ])
  assert.deepEqual(countryOptions(xs, 'ko'), ['CH', 'DE'])
})

test('empty groups are dropped - missing or empty country value means all countries', () => {
  assert.deepEqual(keys(groupWorkApps([item('vat', ['CH'], 1)], 'CH', '', 'en')), [['CH', ['vat']]])
  assert.deepEqual(keys(groupWorkApps([item('x', undefined, 1), item('y', [], 2)], null, '', 'en')), [['all', ['x', 'y']]])
  assert.deepEqual(groupWorkApps([], null, '', 'en'), [])
  assert.deepEqual(countryOptions([item('x', 'all', 1)], 'en'), [])
})

test('search - only within cards on screen - name, description, keywords - case and surrounding spaces ignored', () => {
  const xs = [item('blank', 'all', 1, [], { keywords: ['Receipts'] }), item('vat', ['CH'], 2, [], { description: 'Swiss VAT return' })]
  assert.deepEqual(keys(groupWorkApps(xs, 'CH', '  vat ', 'en')), [['CH', ['vat']]])
  assert.deepEqual(keys(groupWorkApps(xs, 'CH', 'RECEIPTS', 'en')), [['all', ['blank']]])
  assert.deepEqual(groupWorkApps(xs, 'CH', 'zzz', 'en'), [])
})

test('default country - trimmed, lowercase accepted (uppercased) - only countries offered in the picker - a written-out country name or none = null', () => {
  const opts = ['CH']
  assert.equal(defaultCountry('CH', opts), 'CH')
  assert.equal(defaultCountry(' ch ', opts), 'CH')
  assert.equal(defaultCountry('Switzerland', opts), null)
  assert.equal(defaultCountry('DE', opts), null)
  assert.equal(defaultCountry('CH', []), null, '스위스 앱이 다 감춰진 설치')
  assert.equal(defaultCountry(null, opts), null)
  assert.equal(defaultCountry(undefined, opts), null)
  assert.equal(defaultCountry(42, opts), null)
})
