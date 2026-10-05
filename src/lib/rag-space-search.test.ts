import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSearchSpace, RAG_SPACE_UNRESOLVED_ERROR } from './rag-space'

//
//

type SpaceRow = { id: number; isDefault: boolean }

const dbStub = (rows: SpaceRow[], opts: { onCreate?: () => SpaceRow } = {}) => {
  const calls: string[] = []
  return {
    calls,
    db: {
      ragSpace: {
        findFirst: async ({ where }: any) => {
          if (where.isDefault) {
            calls.push('findDefault')
            return rows.find(r => r.isDefault) ?? null
          }
          calls.push(`findById:${where.id}`)
          return rows.find(r => r.id === where.id) ?? null
        },
        create: async () => {
          calls.push('create')
          if (!opts.onCreate) throw new Error('unique conflict')
          return opts.onCreate()
        },
      },
    } as any,
  }
}

test('searches the specified space if it is valid (legacy null documents are excluded)', async () => {
  const { db, calls } = dbStub([{ id: 1, isDefault: true }, { id: 6, isDefault: false }])

  const out = await resolveSearchSpace(db, 'agent-1', 6)

  assert.deepEqual(out, { ragSpace: '6', ragSpaceIncludeNull: false })
  assert.deepEqual(calls, ['findById:6'], 'Default 를 다시 조회할 이유가 없다')
})

test('no space selected: Default + legacy null documents included (backward compatible with existing workflows)', async () => {
  const { db } = dbStub([{ id: 1, isDefault: true }])

  const out = await resolveSearchSpace(db, 'agent-1', undefined)

  assert.deepEqual(out, { ragSpace: '1', ragSpaceIncludeNull: true })
})

test('specified space is invalid/deleted: falls back to Default instead of throwing (during a call there is no place to return a 400)', async () => {
  const { db, calls } = dbStub([{ id: 1, isDefault: true }])

  const out = await resolveSearchSpace(db, 'agent-1', 999)

  assert.deepEqual(out, { ragSpace: '1', ragSpaceIncludeNull: true })
  assert.deepEqual(calls, ['findById:999', 'findDefault'], '무효 확인 후 Default 로 떨어진다')
})

test('creates the Default space if it does not exist yet', async () => {
  const { db, calls } = dbStub([], { onCreate: () => ({ id: 42, isDefault: true }) })

  const out = await resolveSearchSpace(db, 'agent-new', null)

  assert.deepEqual(out, { ragSpace: '42', ragSpaceIncludeNull: true })
  assert.ok(calls.includes('create'))
})

test('throws if the space cannot be determined after all; does not fall back to an unfiltered search (fail-closed)', async () => {
  const { db } = dbStub([])

  await assert.rejects(
    () => resolveSearchSpace(db, 'agent-broken', 3),
    (e: any) => e.code === RAG_SPACE_UNRESOLVED_ERROR,
    '격리 실패는 명시적 실패여야 한다 (호출자가 RAG 를 끈다)'
  )
})
