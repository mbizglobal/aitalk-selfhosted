import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DataSheetsNodeExecutor } from './data-sheets'

interface Write {
  model: 'dataSheetRow' | 'dataSheet'
  id: string
  inTransaction: boolean
  rowData?: string
  sizeBytes?: number
}

function makePrisma(opts: {
  sizeBytes?: number
  rows: Array<Record<string, unknown>>
  lockedSizeBytes?: number
  realRowCount?: number
  columns?: Array<{ name: string; type: string; required: boolean }>
}) {
  const writes: Write[] = []
  const rawCalls: Array<{ sql: string; inTransaction: boolean }> = []
  const reads: Array<{ inTransaction: boolean }> = []
  const sizeBytes = opts.sizeBytes ?? 1000
  const lockedSizeBytes = opts.lockedSizeBytes ?? sizeBytes

  const sheet = {
    id: 'sheet-1',
    agentId: 'agent-1',
    sizeBytes: BigInt(sizeBytes),
    rowCount: opts.rows.length,
    schema: JSON.stringify({
      columns: opts.columns ?? [
        { name: 'phone', type: 'string', required: false },
        { name: 'tag', type: 'string', required: false },
        { name: 'points', type: 'number', required: false },
        { name: 'tries', type: 'number', required: false },
      ],
    }),
  }

  const makeClient = (inTransaction: boolean): any => ({
    dataSheet: {
      findFirst: async () => sheet,
      update: async (args: any) => {
        writes.push({ model: 'dataSheet', id: args.where.id, inTransaction, sizeBytes: Number(args.data.sizeBytes) })
        return sheet
      },
    },
    dataSheetRow: {
      findMany: async () => {
        reads.push({ inTransaction })
        return opts.rows.map((row, i) => ({
          id: `row-${i + 1}`,
          sheetId: 'sheet-1',
          rowData: JSON.stringify(row),
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }))
      },
      update: async (args: any) => {
        writes.push({ model: 'dataSheetRow', id: args.where.id, inTransaction, rowData: args.data.rowData })
        return { id: args.where.id }
      },
      deleteMany: async (args: any) => {
        const ids: string[] = args.where.id.in
        for (const id of ids) writes.push({ model: 'dataSheetRow', id, inTransaction })
        return { count: ids.length }
      },
      count: async () => opts.realRowCount ?? opts.rows.length,
      create: async (args: any) => {
        const id = `row-new`
        writes.push({ model: 'dataSheetRow', id, inTransaction, rowData: args.data.rowData })
        return { id, sheetId: 'sheet-1', rowData: args.data.rowData, createdAt: new Date(0), updatedAt: new Date(0) }
      },
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      rawCalls.push({ sql: Array.from(strings).join('?'), inTransaction })
      return [{ size_bytes: BigInt(lockedSizeBytes), row_count: opts.rows.length }]
    },
    $transaction: async (fn: any) => fn(txClient),
  })

  const txClient = makeClient(true)
  const client = makeClient(false)
  return { client, writes, rawCalls, reads }
}

const node = (filter: unknown, data: unknown) =>
  ({
    id: 'ds-1',
    type: 'dataSheets',
    data: { nodeType: 'dataSheets', sheetId: 'sheet-1', operation: 'increment', filter, data },
    position: { x: 0, y: 0 },
  }) as any

const ctx = () => ({ agentId: 'agent-1', userId: 'user-1', message: '' }) as any
const run = (prisma: any, n: any) => new DataSheetsNodeExecutor().execute(n, ctx(), prisma)
const rowsWritten = (writes: Write[]) => writes.filter(w => w.model === 'dataSheetRow')

test('adds to the existing number; writes the result row and the ledger inside a transaction', async () => {
  const { client, writes, rawCalls } = makePrisma({ rows: [{ phone: '+41791112233', points: 10 }] })
  const result = await run(client, node({ phone: '+41791112233' }, { points: 5 }))

  assert.equal(result.debug?.status, 'success')
  assert.equal(result.debug!.output.updatedCount, 1)
  assert.equal(JSON.parse(rowsWritten(writes)[0].rowData!).points, 15)
  assert.equal(result.debug!.output.rows[0].points, 15)
  assert.equal(rawCalls.length, 1)
  assert.equal(rawCalls[0].inTransaction, true)
  assert.match(rawCalls[0].sql, /FOR UPDATE/)
  assert.ok(writes.every(w => w.inTransaction), '트랜잭션 밖 쓰기가 있다')
})

test('starts from 0 when the field is missing, null or an empty string (counter semantics)', async () => {
  for (const row of [{ phone: 'p' }, { phone: 'p', points: null }, { phone: 'p', points: '' }]) {
    const { client, writes } = makePrisma({ rows: [row] })
    const result = await run(client, node({ phone: 'p' }, { points: 7 }))
    assert.equal(result.debug?.status, 'success', JSON.stringify(row))
    assert.equal(JSON.parse(rowsWritten(writes)[0].rowData!).points, 7, JSON.stringify(row))
  }
})

test('negative increment = deduction', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 10 }] })
  await run(client, node({ phone: 'p' }, { points: -4 }))
  assert.equal(JSON.parse(rowsWritten(writes)[0].rowData!).points, 6)
})

test('accepts numeric strings produced by template substitution ("5", " 5 ", "2.5")', async () => {
  for (const [amount, expected] of [['5', 15], [' 5 ', 15], ['2.5', 12.5]] as const) {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 10 }] })
    const result = await run(client, node({ phone: 'p' }, { points: amount }))
    assert.equal(result.debug?.status, 'success', String(amount))
    assert.equal(JSON.parse(rowsWritten(writes)[0].rowData!).points, expected, String(amount))
  }
})

test('applies several fields at once to all matching rows', async () => {
  const { client, writes } = makePrisma({ rows: [{ tag: 'x', points: 1, tries: 0 }, { tag: 'x', points: 5, tries: 2 }, { tag: 'y', points: 9 }] })
  const result = await run(client, node({ tag: 'x' }, { points: 2, tries: 1 }))
  assert.equal(result.debug!.output.updatedCount, 2)
  const written = rowsWritten(writes).map(w => JSON.parse(w.rowData!))
  assert.deepEqual(written.map(r => [r.points, r.tries]), [[3, 1], [7, 3]])
})

test('0 rows when no row matches; no write and no ledger update', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'other', points: 1 }] })
  const result = await run(client, node({ phone: 'p' }, { points: 5 }))
  assert.equal(result.debug?.status, 'success')
  assert.equal(result.debug!.output.updatedCount, 0)
  assert.deepEqual(writes, [])
})

test('🔒 rejects an empty filter; an empty filter matches every row', async () => {
  for (const bad of [{}, undefined, null, [], 'x']) {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
    const result = await run(client, node(bad, { points: 5 }))
    assert.equal(result.debug?.status, 'error', JSON.stringify(bad))
    assert.match(result.debug!.error!, /filter is required/)
    assert.deepEqual(writes, [], `거부인데 쓰기가 일어났다: ${JSON.stringify(bad)}`)
  }
})

test('rejects empty data', async () => {
  for (const bad of [{}, undefined, null, []]) {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
    const result = await run(client, node({ phone: 'p' }, bad))
    assert.equal(result.debug?.status, 'error', JSON.stringify(bad))
    assert.match(result.debug!.error!, /data is required/)
    assert.deepEqual(writes, [])
  }
})

test('🔒 rejects dangerous number notations; using Number() as is would put them into the balance', async () => {
  for (const bad of ['0x10', '0b11', 'Infinity', '-Infinity', '1,000', 'abc', '', '   ', true, null, {}, []]) {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
    const result = await run(client, node({ phone: 'p' }, { points: bad }))
    assert.equal(result.debug?.status, 'error', JSON.stringify(bad))
    assert.deepEqual(writes, [], `거부인데 쓰기가 일어났다: ${JSON.stringify(bad)}`)
  }
})

test('🔒 rejects when the stored value is not a number; silently treating it as 0 would overwrite someone else\'s data', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 'ten' }] })
  const result = await run(client, node({ phone: 'p' }, { points: 5 }))
  assert.equal(result.debug?.status, 'error')
  assert.match(result.debug!.error!, /not a number/)
  assert.deepEqual(rowsWritten(writes), [], '거부인데 행이 써졌다')
})

test('if even one row is rejected, the rest are not written either (no partial apply)', async () => {
  const { client, writes } = makePrisma({ rows: [{ tag: 'x', points: 1 }, { tag: 'x', points: 'broken' }] })
  const result = await run(client, node({ tag: 'x' }, { points: 5 }))
  assert.equal(result.debug?.status, 'error')
  assert.deepEqual(rowsWritten(writes), [])
})

test('🔒 update: rejects an empty filter (it used to overwrite the whole sheet)', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'a', points: 1 }, { phone: 'b', points: 2 }] })
  const n = node({}, { points: 99 })
  n.data.operation = 'update'
  const result = await run(client, n)
  assert.equal(result.debug?.status, 'error')
  assert.match(result.debug!.error!, /empty filter is refused/)
  assert.deepEqual(writes, [])
})

test('🔒 delete: rejects an empty filter (it used to empty the whole sheet)', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'a' }, { phone: 'b' }] })
  const n = node({}, undefined)
  n.data.operation = 'delete'
  const result = await run(client, n)
  assert.equal(result.debug?.status, 'error')
  assert.match(result.debug!.error!, /empty filter is refused/)
  assert.deepEqual(writes, [])
})

test('🔒 rejects when the sum becomes Infinity; JSON writes it as null so the next accrual would start from 0', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1e308 }] })
  const result = await run(client, node({ phone: 'p' }, { points: 1e308 }))
  assert.equal(result.debug?.status, 'error')
  assert.match(result.debug!.error!, /out of range/)
  assert.deepEqual(rowsWritten(writes), [])
  assert.equal(JSON.stringify({ points: 1e308 + 1e308 }), '{"points":null}')
})

test('🔒 rejects columns not in the sheet; a typo would create a ghost field invisible on screen', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
  const result = await run(client, node({ phone: 'p' }, { poinst: 5 }))
  assert.equal(result.debug?.status, 'error')
  assert.match(result.debug!.error!, /no such column/)
  assert.deepEqual(writes, [])
})

test('🔒 rejects non-number columns (does not overwrite string/date with a number)', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
  const result = await run(client, node({ phone: 'p' }, { phone: 5 }))
  assert.equal(result.debug?.status, 'error')
  assert.match(result.debug!.error!, /not a number column/)
  assert.deepEqual(writes, [])
})

test('legacy sheets without a schema pass leniently (new constraints do not break existing sheets)', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }], columns: [] })
  const result = await run(client, node({ phone: 'p' }, { whatever: 5 }))
  assert.equal(result.debug?.status, 'success')
  assert.equal(JSON.parse(rowsWritten(writes)[0].rowData!).whatever, 5)
})

test('🔒 the ledger is written based on the value read inside the lock (not the outer sheet.sizeBytes)', async () => {
  const { client, writes } = makePrisma({ sizeBytes: 1000, lockedSizeBytes: 4000, rows: [{ phone: 'p', points: 9 }] })
  const result = await run(client, node({ phone: 'p' }, { points: 1 }))
  assert.equal(result.debug?.status, 'success')

  const ledger = writes.find(w => w.model === 'dataSheet')!
  const before = Buffer.byteLength(JSON.stringify({ phone: 'p', points: 9 }), 'utf8')
  const after = Buffer.byteLength(JSON.stringify({ phone: 'p', points: 10 }), 'utf8')
  assert.equal(ledger.sizeBytes, 4000 + (after - before))
})

test('🔒 rejects reserved keys (id/createdAt/updatedAt) regardless of schema', async () => {
  for (const key of ['id', 'createdAt', 'updatedAt']) {
    for (const columns of [undefined, []]) {
      const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }], columns })
      const result = await run(client, node({ phone: 'p' }, { [key]: 1 }))
      assert.equal(result.debug?.status, 'error', `${key}/${JSON.stringify(columns)}`)
      assert.match(result.debug!.error!, /reserved row field/)
      assert.deepEqual(writes, [])
    }
  }
})

test('🔒 rejects prototype-pollution style names; fails instead of silently vanishing', async () => {
  assert.deepEqual(Object.keys({ __proto__: 5 } as any), [], '리터럴은 키를 안 만든다(테스트 전제)')
  assert.deepEqual(Object.keys(JSON.parse('{"__proto__":5}')), ['__proto__'], 'JSON.parse 는 만든다')

  for (const raw of ['{"constructor":5}', '{"prototype":5}']) {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p' }], columns: [] })
    const result = await run(client, node({ phone: 'p' }, JSON.parse(raw)))
    assert.equal(result.debug?.status, 'error', raw)
    assert.match(result.debug!.error!, /reserved/)
    assert.deepEqual(writes, [], `거부인데 쓰기가 일어났다: ${raw}`)
  }

  {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p' }], columns: [] })
    const result = await run(client, node({ phone: 'p' }, JSON.parse('{"__proto__":5}')))
    assert.equal(result.debug?.status, 'error')
    assert.deepEqual(writes, [], '거부인데 쓰기가 일어났다')
  }
})

test('🔒 update/delete: also rejects string and array filters (Object.keys("x") is ["0"] and used to pass)', async () => {
  for (const op of ['update', 'delete'] as const) {
    for (const bad of ['x', ['a']]) {
      const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
      const n = node(bad, { points: 1 })
      n.data.operation = op
      const result = await run(client, n)
      assert.equal(result.debug?.status, 'error', `${op}/${JSON.stringify(bad)}`)
      assert.deepEqual(writes, [])
    }
  }
})

test('writes nothing when the capacity cap is exceeded', async () => {
  const { client, writes } = makePrisma({
    sizeBytes: 50 * 1024 * 1024 - 1,
    rows: [{ phone: 'p', points: 9 }],
  })
  const result = await run(client, node({ phone: 'p' }, { points: 1000000 }))
  assert.equal(result.debug?.status, 'error')
  assert.match(result.debug!.error!, /Storage limit exceeded/)
  assert.deepEqual(writes, [])
})

//
//

const opNode = (op: string, filter: unknown, data: unknown) => {
  const n = node(filter, data)
  n.data.operation = op
  return n
}

test('🔒 every write (insert, update, upsert, increment) requests the sheet lock and writes inside it', async () => {
  const cases: Array<[string, unknown, unknown]> = [
    ['insert', undefined, { phone: 'new', points: 0 }],
    ['update', { phone: 'p' }, { points: 3 }],
    ['upsert', { phone: 'p' }, { points: 3 }],
    ['increment', { phone: 'p' }, { points: 1 }],
  ]
  for (const [op, f, d] of cases) {
    const { client, writes, rawCalls } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
    const result = await run(client, opNode(op, f, d))
    assert.equal(result.debug?.status, 'success', op)
    assert.ok(rawCalls.length >= 1, `${op}: 잠금을 요청하지 않았다`)
    assert.ok(rawCalls.every(c => c.inTransaction), `${op}: 잠금이 트랜잭션 밖이다`)
    assert.match(rawCalls[0].sql, /FOR UPDATE/, op)
    assert.ok(writes.length > 0 && writes.every(w => w.inTransaction), `${op}: 트랜잭션 밖 쓰기가 있다`)
  }
})

test('🔒 lookups also happen inside the lock; a lookup outside the lock breaks CAS', async () => {
  for (const [op, f, d] of [
    ['update', { phone: 'p' }, { points: 3 }],
    ['upsert', { phone: 'p' }, { points: 3 }],
    ['increment', { phone: 'p' }, { points: 1 }],
  ] as Array<[string, unknown, unknown]>) {
    const { client, reads } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
    const result = await run(client, opNode(op, f, d))
    assert.equal(result.debug?.status, 'success', op)
    assert.ok(reads.length >= 1, `${op}: 행을 읽지 않았다`)
    assert.ok(reads.every(r => r.inTransaction), `${op}: 잠금 밖에서 행을 읽었다`)
  }
})

test('🔒 the insert ledger is also written based on the value read inside the lock', async () => {
  const { client, writes } = makePrisma({ sizeBytes: 1000, lockedSizeBytes: 4000, rows: [] })
  const result = await run(client, opNode('insert', undefined, { phone: 'new', points: 0 }))
  assert.equal(result.debug?.status, 'success')
  const ledger = writes.find(w => w.model === 'dataSheet')!
  const size = Buffer.byteLength(JSON.stringify({ phone: 'new', points: 0 }), 'utf8')
  assert.equal(ledger.sizeBytes, 4000 + size)
})

test('🔒 update is compare-and-set: if the condition does not match, 0 rows and nothing is written', async () => {
  const { client, writes } = makePrisma({ rows: [{ round: 'r1', status: 'closed' }] })
  const result = await run(client, opNode('update', { round: 'r1', status: 'open' }, { status: 'closed' }))
  assert.equal(result.debug?.status, 'success')
  assert.equal(result.debug!.output.updatedCount, 0, '이미 닫힌 라운드인데 갱신됐다')
  assert.deepEqual(writes, [], '0건인데 쓰기가 일어났다')
})

test('🔒 when the condition matches, update changes exactly that one row', async () => {
  const { client, writes } = makePrisma({ rows: [{ round: 'r1', status: 'open' }, { round: 'r2', status: 'open' }] })
  const result = await run(client, opNode('update', { round: 'r1', status: 'open' }, { status: 'closed' }))
  assert.equal(result.debug!.output.updatedCount, 1)
  const rowW = rowsWritten(writes)
  assert.equal(rowW.length, 1)
  assert.equal(JSON.parse(rowW[0].rowData!).status, 'closed')
})

test('🔒 upsert does lookup, branch and write inside one lock (the spot that caused duplicate members)', async () => {
  const miss = makePrisma({ rows: [{ phone: 'other' }] })
  const r1 = await run(miss.client, opNode('upsert', { phone: 'p' }, {}))
  assert.equal(r1.debug!.output.action, 'inserted')
  assert.equal(r1.debug!.output.operation, 'insert', 'operation 계약이 깨졌다')
  assert.equal(miss.rawCalls.length, 1, 'insert 경로에서 잠금이 두 번 잡혔다(위임 잔재)')
  assert.equal(JSON.parse(rowsWritten(miss.writes)[0].rowData!).phone, 'p', 'filter 키가 행에 안 들어갔다')

  const hit = makePrisma({ rows: [{ phone: 'p', points: 2 }] })
  const r2 = await run(hit.client, opNode('upsert', { phone: 'p' }, { points: 5 }))
  assert.equal(r2.debug!.output.action, 'updated')
  assert.equal(r2.debug!.output.operation, 'update', 'operation 계약이 깨졌다')
  assert.equal(hit.rawCalls.length, 1, 'update 경로에서 잠금이 두 번 잡혔다(위임 잔재)')
})

test('🔒 the auto No of insert uses the ledger inside the lock (so concurrent inserts do not get the same number)', async () => {
  const { client, writes } = makePrisma({
    rows: [{ No: 1, phone: 'a' }, { No: 2, phone: 'b' }],
    columns: [{ name: 'No', type: 'number', required: false }, { name: 'phone', type: 'string', required: false }],
  })
  await run(client, opNode('insert', undefined, { phone: 'c' }))
  assert.equal(JSON.parse(rowsWritten(writes)[0].rowData!).No, 3)
})

test('🔒 upsert: rejects a malformed filter (it must not silently create a new row)', async () => {
  for (const bad of ['x', ['a'], 42]) {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p', points: 1 }] })
    const result = await run(client, opNode('upsert', bad, { points: 1 }))
    assert.equal(result.debug?.status, 'error', JSON.stringify(bad))
    assert.match(result.debug!.error!, /must be an object/)
    assert.deepEqual(writes, [], `거부인데 쓰기가 일어났다: ${JSON.stringify(bad)}`)
  }
})

test('upsert: with no filter or an empty object, always adds per the existing contract', async () => {
  for (const f of [undefined, null, {}]) {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p' }] })
    const result = await run(client, opNode('upsert', f, { phone: 'new' }))
    assert.equal(result.debug?.status, 'success', JSON.stringify(f))
    assert.equal(result.debug!.output.action, 'inserted')
    assert.equal(rowsWritten(writes).length, 1)
  }
})

test('🔒 delete and batch-insert also pass through the same lock (if not moved, deadlock and ledger loss remain)', async () => {
  const del = makePrisma({ rows: [{ phone: 'p' }, { phone: 'q' }] })
  const r1 = await run(del.client, opNode('delete', { phone: 'p' }, undefined))
  assert.equal(r1.debug?.status, 'success')
  assert.equal(r1.debug!.output.deletedCount, 1)
  assert.ok(del.rawCalls.length >= 1 && del.rawCalls.every(c => c.inTransaction), 'delete 가 잠금 밖이다')
  assert.ok(del.reads.every(r => r.inTransaction), 'delete 가 잠금 밖에서 읽었다')

  const bi = makePrisma({ rows: [] })
  const n = opNode('batch-insert', undefined, undefined)
  n.data.batchData = [{ phone: 'a' }, { phone: 'b' }]
  const r2 = await run(bi.client, n)
  assert.equal(r2.debug?.status, 'success')
  assert.ok(bi.rawCalls.length >= 1 && bi.rawCalls.every(c => c.inTransaction), 'batch-insert 가 잠금 밖이다')
  assert.ok(bi.writes.every(w => w.inTransaction), 'batch-insert 에 잠금 밖 쓰기가 있다')
})

test('🔒 delete: rejects an empty or malformed filter', async () => {
  for (const bad of [{}, 'x', ['a']]) {
    const { client, writes } = makePrisma({ rows: [{ phone: 'p' }] })
    const result = await run(client, opNode('delete', bad, undefined))
    assert.equal(result.debug?.status, 'error', JSON.stringify(bad))
    assert.deepEqual(writes, [])
  }
})

test('🔒 insert recounts the actual rows and self-corrects ledger drift', async () => {
  const { client, writes } = makePrisma({
    rows: [{ phone: 'a' }, { phone: 'b' }],
    realRowCount: 5,
    columns: [{ name: 'No', type: 'number', required: false }, { name: 'phone', type: 'string', required: false }],
  })
  await run(client, opNode('insert', undefined, { phone: 'c' }))
  assert.equal(JSON.parse(rowsWritten(writes)[0].rowData!).No, 6, '장부값(2)으로 번호를 매겼다 — 자기교정 상실')
  assert.equal(writes.find(w => w.model === 'dataSheet')!.sizeBytes! >= 0, true)
})

test('🔒 batch-insert also numbers by the actual row count', async () => {
  const { client, writes } = makePrisma({
    rows: [{ phone: 'a' }], realRowCount: 10,
    columns: [{ name: 'No', type: 'number', required: false }, { name: 'phone', type: 'string', required: false }],
  })
  const n = opNode('batch-insert', undefined, undefined)
  n.data.batchData = [{ phone: 'x' }, { phone: 'y' }]
  await run(client, n)
  const nos = rowsWritten(writes).map(w => JSON.parse(w.rowData!).No)
  assert.deepEqual(nos, [11, 12])
})

test('🔒 increment also uses the shared matching body: {k: null} catches rows without the field', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'p' }] })
  const result = await run(client, opNode('increment', { phone: 'p', tag: null }, { points: 3 }))
  assert.equal(result.debug?.status, 'success')
  assert.equal(result.debug!.output.updatedCount, 1, 'increment 만 매칭 규칙이 다르다(복제본 잔존)')
  assert.equal(JSON.parse(rowsWritten(writes)[0].rowData!).points, 3)
})

test('🔒 upsert insert path: the filter wins over data (otherwise a new row is created every time)', async () => {
  const { client, writes } = makePrisma({ rows: [{ phone: 'other' }] })
  const result = await run(client, opNode('upsert', { phone: 'A' }, { phone: 'B', points: 1 }))
  assert.equal(result.debug?.status, 'success')
  const row = JSON.parse(rowsWritten(writes)[0].rowData!)
  assert.equal(row.phone, 'A', 'data 가 filter 를 덮어써 저장된 행이 자기 filter 에 안 걸린다')
  assert.equal(row.points, 1, 'filter 와 안 겹치는 data 키는 그대로 들어가야 한다')
})
