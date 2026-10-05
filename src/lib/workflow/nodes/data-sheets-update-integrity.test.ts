import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DataSheetsNodeExecutor } from './data-sheets'

const MAX_SHEET_SIZE_BYTES = 50 * 1024 * 1024

interface Write {
  model: 'dataSheetRow' | 'dataSheet'
  id: string
  inTransaction: boolean
  rowData?: string
  sizeBytes?: number
}

function makePrisma(opts: {
  sizeBytes: number
  rows: Array<Record<string, unknown>>
  failOnRowId?: string
}) {
  const writes: Write[] = []
  const rawCalls: Array<{ sql: string; inTransaction: boolean }> = []

  const sheet = {
    id: 'sheet-1',
    agentId: 'agent-1',
    sizeBytes: BigInt(opts.sizeBytes),
    rowCount: opts.rows.length,
    schema: JSON.stringify({ columns: [{ name: 'memo', type: 'text', required: false }] }),
  }

  const makeClient = (inTransaction: boolean): any => ({
    dataSheet: {
      findFirst: async () => sheet,
      update: async (args: any) => {
        writes.push({
          model: 'dataSheet',
          id: args.where.id,
          inTransaction,
          sizeBytes: Number(args.data.sizeBytes),
        })
        return sheet
      },
    },
    dataSheetRow: {
      findMany: async () =>
        opts.rows.map((row, i) => ({
          id: `row-${i + 1}`,
          sheetId: 'sheet-1',
          rowData: JSON.stringify(row),
          createdAt: new Date(0),
          updatedAt: new Date(0),
        })),
      update: async (args: any) => {
        if (args.where.id === opts.failOnRowId) throw new Error('DB write failed')
        writes.push({
          model: 'dataSheetRow',
          id: args.where.id,
          inTransaction,
          rowData: args.data.rowData,
        })
        return { id: args.where.id }
      },
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      rawCalls.push({ sql: Array.from(strings).join('?'), inTransaction })
      return [{ size_bytes: BigInt(opts.sizeBytes), row_count: opts.rows.length }]
    },
    $transaction: async (fn: any) => fn(txClient),
  })

  const txClient = makeClient(true)
  const client = makeClient(false)

  return { client, writes, rawCalls }
}

const sheetNode = (
  operation: 'update' | 'upsert',
  filter: Record<string, unknown>,
  data: Record<string, unknown>,
) =>
  ({
    id: 'ds-1',
    type: 'custom',
    data: { nodeType: 'dataSheets', sheetId: 'sheet-1', operation, filter, data },
    position: { x: 0, y: 0 },
  }) as any

const ctx = () => ({ agentId: 'agent-1', userId: 'user-1', message: '' }) as any

const run = (prisma: any, node: any) => new DataSheetsNodeExecutor().execute(node, ctx(), prisma)

const SMALL_ROW = { memo: 'a' }
const BIG_MEMO = { memo: 'x'.repeat(200) }

test('UPDATE: writes no row at all when over the cap (the check comes before the write)', async () => {
  const { client, writes } = makePrisma({
    sizeBytes: MAX_SHEET_SIZE_BYTES - 100,
    rows: [SMALL_ROW],
  })

  const result = await run(client, sheetNode('update', { memo: 'a' }, BIG_MEMO))

  assert.equal(result.debug?.status, 'error', '상한 초과인데 성공으로 끝났다')
  assert.match(result.debug!.error!, /Storage limit exceeded/)

  assert.deepEqual(writes, [], `상한 초과인데 쓰기가 일어났다: ${JSON.stringify(writes)}`)
})

test('UPDATE: a normal update writes rows and ledger in the same transaction with exact values', async () => {
  const { client, writes } = makePrisma({ sizeBytes: 1000, rows: [SMALL_ROW] })

  const result = await run(client, sheetNode('update', { memo: 'a' }, BIG_MEMO))

  assert.equal(result.debug?.status, 'success')
  assert.equal(result.debug!.output.updatedCount, 1)

  assert.deepEqual(
    writes.map((w) => w.model),
    ['dataSheetRow', 'dataSheet'],
    '행 갱신과 장부 갱신이 둘 다 일어나야 한다',
  )
  assert.ok(
    writes.every((w) => w.inTransaction),
    `트랜잭션 밖에서 쓴 것이 있다 — 중간 실패 시 부분 갱신이 남는다: ${JSON.stringify(writes)}`,
  )

  assert.equal(writes[0].rowData, JSON.stringify(BIG_MEMO), '행에 병합 결과가 안 써졌다')
  assert.equal(writes[1].sizeBytes, 1000 + 199, '장부가 증분(+199)을 반영하지 않았다')
})

test('UPDATE: the ledger matches the total even when increases and decreases are mixed across rows', async () => {
  const { client, writes } = makePrisma({
    sizeBytes: 1000,
    rows: [
      { kind: 'a', memo: 'a' },
      { kind: 'a', memo: 'y'.repeat(50) },
    ],
  })

  const result = await run(client, sheetNode('update', { kind: 'a' }, { memo: 'z'.repeat(10) }))

  assert.equal(result.debug?.status, 'success')
  assert.equal(result.debug!.output.updatedCount, 2)

  const expectedRow = JSON.stringify({ kind: 'a', memo: 'z'.repeat(10) })
  const rowWrites = writes.filter((w) => w.model === 'dataSheetRow')
  assert.equal(rowWrites.length, 2)
  assert.ok(
    rowWrites.every((w) => w.rowData === expectedRow),
    `병합 결과가 안 써진 행이 있다: ${JSON.stringify(rowWrites)}`,
  )

  const sheetWrite = writes.find((w) => w.model === 'dataSheet')
  assert.equal(sheetWrite?.sizeBytes, 1000 - 31, '감소분이 장부에 반영되지 않았다')
})

test('UPDATE: if a row update fails midway, the ledger (sizeBytes) is not updated', async () => {
  const { client, writes } = makePrisma({
    sizeBytes: 1000,
    rows: [
      { kind: 'a', memo: 'a' },
      { kind: 'a', memo: 'b' },
    ],
    failOnRowId: 'row-2',
  })

  const result = await run(client, sheetNode('update', { kind: 'a' }, BIG_MEMO))

  assert.equal(result.debug?.status, 'error', '쓰기가 실패했는데 성공으로 보고됐다')

  assert.equal(
    writes.filter((w) => w.model === 'dataSheet').length,
    0,
    `행 갱신이 실패했는데 장부를 갱신했다: ${JSON.stringify(writes)}`,
  )

  const rowWrites = writes.filter((w) => w.model === 'dataSheetRow')
  assert.ok(
    rowWrites.length > 0 && rowWrites.every((w) => w.inTransaction),
    `실패 전 쓰기가 트랜잭션 밖이다 — 실제 DB 라면 부분 갱신으로 남는다: ${JSON.stringify(writes)}`,
  )
})

test('UPDATE: upsert gets the same protection when it meets an existing row (via executeUpdate)', async () => {
  const { client, writes } = makePrisma({
    sizeBytes: MAX_SHEET_SIZE_BYTES - 100,
    rows: [SMALL_ROW],
  })

  const result = await run(client, sheetNode('upsert', { memo: 'a' }, BIG_MEMO))

  assert.equal(result.debug?.status, 'error', 'upsert 가 상한을 우회했다')
  assert.match(result.debug!.error!, /Storage limit exceeded/)
  assert.deepEqual(writes, [], `upsert 경유 쓰기가 상한을 우회했다: ${JSON.stringify(writes)}`)
})
