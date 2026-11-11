import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergePageTexts } from './app-ai'

test('pages left by another conversation are kept - receiving later pages keeps earlier ones', () => {
  const a = mergePageTexts([], [], ['P1', 'P2', 'P3', 'P4', 'P5'], [], 0, 7, 7)
  const b = mergePageTexts(a.pageTexts!, a.pageCut ?? [], ['P6', 'P7'], [], 5, 7, 7)
  assert.deepEqual(b.pageTexts, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'])
  assert.equal(b.pagesRead, 7)
  assert.equal(b.truncated, false)
})

test('later pages first - earlier slots are empty - pagesRead 0 - joined when earlier pages arrive', () => {
  const a = mergePageTexts([], [], ['P6', 'P7'], [], 5, 7, 7)
  assert.equal(a.pagesRead, 0)
  assert.equal(a.text, '')
  const b = mergePageTexts(a.pageTexts!, [], ['P1', 'P2', 'P3', 'P4', 'P5'], [], 0, 7, 7)
  assert.equal(b.pagesRead, 7)
})

test('a failed page (null) does not erase kept text - empty text counts as a received page', () => {
  const a = mergePageTexts(['P1', 'P2', 'P3'], [], [null, '', 'Q3'], [], 0, 3, 3)
  assert.deepEqual(a.pageTexts, ['P1', '', 'Q3'])
  assert.equal(a.pagesRead, 3)
  const b = mergePageTexts([], [], ['P1', null, 'P3'], [], 0, 3, 3)
  assert.equal(b.pagesRead, 1)
  assert.deepEqual(b.pageTexts, ['P1', null, 'P3'])
})

test('cut page - truncated when inside the joined pages - cleared after re-reading', () => {
  const a = mergePageTexts([], [], ['P1', 'P2'], [2], 0, 2, 2)
  assert.equal(a.truncated, true)
  assert.deepEqual(a.pageCut, [2])
  const b = mergePageTexts(a.pageTexts!, a.pageCut!, [null, 'P2 full'], [], 0, 2, 2)
  assert.equal(b.truncated, false)
  assert.equal(b.pageCut, undefined)
})

test('failed pages go to pageFailed - removed after re-reading', () => {
  const a = mergePageTexts([], [], [null, 'P2'], [], 0, 2, 2)
  assert.deepEqual(a.pageFailed, [1])
  const b = mergePageTexts(a.pageTexts!, [], ['P1'], [], 0, 2, 2, a.pageFailed)
  assert.equal(b.pageFailed, undefined)
  assert.equal(b.pagesRead, 2)
})
