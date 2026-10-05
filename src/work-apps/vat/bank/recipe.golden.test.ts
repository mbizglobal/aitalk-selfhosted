
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'fs'
import path from 'path'
import { parseDelimited } from './parse-csv'
import { parseRecipe, readWithRecipe } from './recipe'
import { formatCents, parseCents } from '../estv'

const dir = process.env.VAT_GOLDEN_DIR

describe('\'reading recipe golden - Q2 Wise and Revolut originals vs owner standard CSV\'', () => {
  if (!dir || !existsSync(path.join(dir, 'bank_readers.json'))) {
    it('\'no VAT_GOLDEN_DIR -> skipped\'', () => {
      console.log('ℹ️  VAT_GOLDEN_DIR 가 없어 읽기 설명서 골든 테스트를 건너뛴다 (실제 자료는 리포 밖)')
    })
    return
  }
  const q2 = path.join(dir, 'vat2026_q2')
  const readers = JSON.parse(readFileSync(path.join(dir, 'bank_readers.json'), 'utf8')) as Record<string, unknown>

  const standard = (files: string[], account: (raw: string) => string) => {
    const sum = new Map<string, bigint>()
    let n = 0
    for (const f of files) {
      const [head, ...rows] = parseDelimited(readFileSync(path.join(q2, 'bank', f), 'utf8'), ',').filter((r) => r.some((c) => c.trim()))
      const ix = (c: string) => head.indexOf(c)
      for (const r of rows) {
        const k = [account(r[ix('account')]), r[ix('date')], r[ix('currency')], r[ix('direction')].toLowerCase()].join('|')
        sum.set(k, (sum.get(k) ?? BigInt(0)) + parseCents(r[ix('amount')]))
        n++
      }
    }
    return { sum, n }
  }
  const asText = (m: Map<string, bigint>) => [...m].map(([k, v]) => `${k}=${formatCents(v)}`).sort()

  it('\'Wise - total from reading 6 account originals with the recipe = owner standard, balance chain connected, line count difference only the 2 split by hand\'', () => {
    const recipe = parseRecipe(readers.wise)
    const sum = new Map<string, bigint>()
    let n = 0
    const companies = readdirSync(path.join(q2, 'bank_wise'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    for (const c of companies) {
      for (const f of readdirSync(path.join(q2, 'bank_wise', c)).filter((x) => x.endsWith('.csv'))) {
        const account = f.split('_')[1]
        const r = readWithRecipe(readFileSync(path.join(q2, 'bank_wise', c, f)), recipe)
        assert.deepEqual(r.issues, [], `${f} 파일 문제`)
        for (const g of r.groups) {
          assert.deepEqual(g.st.issues, [], `${f} ${g.id} 문제(잔액 사슬 등)`)
          for (const row of g.st.rows) {
            const k = [account, row.date, row.currency, row.direction].join('|')
            sum.set(k, (sum.get(k) ?? BigInt(0)) + parseCents(row.amount))
            n++
          }
        }
      }
    }
    const std = standard(['wise_chf.csv', 'wise_eur.csv', 'wise_usd.csv'], (a) => a)
    assert.deepEqual(asText(sum), asText(std.sum))
    assert.equal(std.n - n, 2)
  })

  it('\'Revolut - splitting one file by currency/account, Q2 total = owner standard, filtered lines, balance chain\'', () => {
    const recipe = parseRecipe(readers.revolut)
    const r = readWithRecipe(readFileSync(path.join(q2, 'bank', 'transaction_history_statement.csv')), recipe)
    assert.deepEqual(r.issues, [])
    const sum = new Map<string, bigint>()
    let n = 0
    for (const g of r.groups) {
      assert.deepEqual(g.st.issues, [], `${g.id} 문제(잔액 사슬 등)`)
      for (const row of g.st.rows.filter((x) => x.date >= '2026-04-01' && x.date <= '2026-06-30')) {
        const k = [`revolut_${row.currency.toLowerCase()}`, row.date, row.currency, row.direction].join('|')
        sum.set(k, (sum.get(k) ?? BigInt(0)) + parseCents(row.amount))
        n++
      }
    }
    const std = standard(['revolut_chf.csv', 'revolut_eur.csv'], (a) => a)
    assert.deepEqual(asText(sum), asText(std.sum))
    assert.equal(n, std.n)
  })
})
