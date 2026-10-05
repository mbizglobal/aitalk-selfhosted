
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { formatCents, parseCents } from '../estv'
import { parseDelimited } from './parse-csv'
import { parseUbsCsv } from './ubs'
import { reconcileBalance } from './balance'
import { computeBankPlan } from '../modules/bank-import'
import { VAT_SHEET_TEMPLATES, VAT_FAMILY } from '../templates'
import { templateSchema } from '@/lib/work/sheet-templates'

const dir = process.env.VAT_GOLDEN_DIR

describe('UBS golden - original ↔ owner standard CSV', () => {
  if (!dir) {
    it('skipped when VAT_GOLDEN_DIR is not set', () => {
      console.log('ℹ️  VAT_GOLDEN_DIR 가 없어 UBS 골든 테스트를 건너뛴다 (실제 자료는 리포 밖)')
    })
    return
  }

  const cases = readdirSync(dir)
    .filter((q) => /^vat\d{4}_q[1-4]$/.test(q) && existsSync(join(dir, q, 'bank_ubs')))
    .flatMap((q) => readdirSync(join(dir, q, 'bank_ubs')).filter((f) => f.endsWith('.csv')).map((f) => ({ q, f })))

  it('at least one UBS original exists to compare against', () => assert.ok(cases.length > 0))

  for (const { q, f } of cases) {
    it(`${q}/${f}`, () => {
      const st = parseUbsCsv(readFileSync(join(dir, q, 'bank_ubs', f), 'utf8'))
      assert.deepEqual(st.problems, [], '읽기 문제')
      assert.equal(reconcileBalance(st.opening, st.closing, st.rows).status, 'ok', '시작+움직임=끝')

      const stdPath = join(dir, q, 'bank', `ubs_${(st.currency ?? '').toLowerCase()}.csv`)
      assert.ok(existsSync(stdPath), `표준 CSV 없음: ubs_${st.currency}`)
      const [head, ...body] = parseDelimited(readFileSync(stdPath, 'utf8'), ',').filter((r) => r.some((c) => c.trim()))
      const ix = (n: string) => head.indexOf(n)
      const std = body.map((r) => `${r[ix('date')]}|${parseCents(r[ix('amount')])}|${r[ix('direction')].toLowerCase()}`).sort()
      const tx = VAT_SHEET_TEMPLATES.find((t) => t.family === VAT_FAMILY.transactions)!
      const account = { id: 'a', sheetId: 's', data: { accountKey: 'golden', bank: 'ubs', currency: st.currency }, confirmed: null, createdAt: new Date(), updatedAt: new Date() }
      const { plan, rows } = computeBankPlan({ periods: [], transactions: [], accounts: [account] }, st, { accountKey: 'golden', file: { id: 'f', sha256: '0'.repeat(64) } }, templateSchema(tx))
      assert.deepEqual(plan.problems, [], '계획 문제')
      assert.deepEqual(plan.balance, { file: 'ok', ledger: 'ok' }, '잔액 대조 두 가지')
      assert.equal(rows.length, st.rows.length, '넣을 줄 = 읽은 줄')
      for (const r of rows) assert.equal(tx.checkRow!(r), null, '틀 행 규칙')
      const app = rows.map((r) => `${r.date}|${parseCents(String(r.amount))}|${r.direction}`).sort()

      const onlyApp = app.filter((x) => !std.includes(x))
      const onlyStd = std.filter((x) => !app.includes(x))
      if (onlyApp.length || onlyStd.length) console.log(`  앱에만: ${onlyApp.join(', ')}\n  표준에만: ${onlyStd.join(', ')}`)
      assert.equal(app.length, std.length, '줄 수')
      assert.deepEqual(app, std, '(날짜·금액·방향) 앱템플릿')

      const sum = (rows: string[], d: string) => formatCents(rows.filter((x) => x.endsWith(`|${d}`)).reduce((s, x) => s + BigInt(x.split('|')[1]), BigInt(0)))
      assert.equal(sum(app, 'in'), sum(std, 'in'), '들어온 합')
      assert.equal(sum(app, 'out'), sum(std, 'out'), '나간 합')
    })
  }
})
