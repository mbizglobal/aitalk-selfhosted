import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKS, buildSpecMail, specSendRefKey, validateSpec } from './assembled'
import { appStartSettings, isTelegramChatId } from './app-chat'
import { guardStudioOnlyFields } from '../mcp-server/studio-only'

const leave = (): Record<string, unknown> & { tables: Array<Record<string, unknown>>; sends: Array<Record<string, unknown>> } => ({
  spec: 1, name: 'Leave',
  tables: [{
    key: 'requests', name: 'Leave requests',
    columns: [{ key: 'who', label: 'Requester', kind: 'person' }, { key: 'manager', label: 'Manager', kind: 'person' }, { key: 'days', label: 'Days', kind: 'number' }, { key: 'until', label: 'Until', kind: 'date' }],
    status: { values: ['draft', 'submitted', 'approved', 'rejected'], start: 'draft', moves: [['draft', 'submitted'], { from: 'submitted', to: 'approved', by: 'column:manager' }, { from: 'submitted', to: 'rejected', by: 'column:manager' }], lockedIn: ['approved', 'rejected'] },
    moveAlerts: [{ key: 'up', label: 'Submitted', to: ['submitted'], notify: 'column:manager', send: 'ask', telegram: 'tg' }],
    alerts: [{ key: 'soon', label: 'Soon', date: 'until', daysBefore: 3, telegram: 'tg' }],
  }],
  sends: [
    { key: 'ask', label: 'Ask', table: 'requests', to: 'column:manager', subject: 'Leave {days}', body: 'Please decide.' },
    { key: 'tg', label: 'Team chat', table: 'requests', via: 'telegram', to: 'team', body: 'Leave {days} days · {status}' },
  ],
})
const codes = (raw: unknown): string[] => { const r = validateSpec(raw, null); return r.ok ? [] : r.issues.map((i) => i.code) }
const v = (f: (x: ReturnType<typeof leave>) => void) => { const x = leave(); f(x); return codes(x) }

test('Telegram — passes · shape · block list', () => {
  const r = validateSpec(leave(), null)
  assert.ok(r.ok, JSON.stringify(!r.ok && r.issues))
  const tg = r.spec.sends!.find((s) => s.key === 'tg')!
  assert.equal(tg.via, 'telegram')
  assert.equal(tg.to, 'team')
  assert.equal(tg.subject, '')
  assert.equal(r.spec.sends!.find((s) => s.key === 'ask')!.via, undefined)
  assert.equal(r.spec.tables[0].moveAlerts![0].telegram, 'tg')
  assert.equal(r.spec.tables[0].alerts![0].telegram, 'tg')
  assert.ok(BLOCKS.some((b) => b.id === 'telegram'))
  assert.deepEqual(v((x) => { x.sends[0].via = 'mail' }), [])
})

test('Telegram — wrong ones', () => {
  assert.equal(v((x) => { x.sends[1].via = 'fax' })[0], 'INVALID')
  assert.equal(v((x) => { x.sends[1].to = 'owner' })[0], 'INVALID')
  assert.equal(v((x) => { x.sends[1].attachDoc = 'x' })[0], 'INVALID')
  assert.equal(v((x) => { x.sends[0].to = 'team' })[0], 'BAD_REF')
  assert.equal(v((x) => { delete x.sends[1].body })[0], 'REQUIRED')
  assert.deepEqual(v((x) => { ((x.tables[0].moveAlerts as Array<Record<string, unknown>>)[0]).send = 'tg' }), ['INVALID'])
  assert.deepEqual(v((x) => { ((x.tables[0].moveAlerts as Array<Record<string, unknown>>)[0]).telegram = 'ask' }), ['INVALID'])
  assert.deepEqual(v((x) => { ((x.tables[0].alerts as Array<Record<string, unknown>>)[0]).send = 'tg' }), ['INVALID'])
  assert.deepEqual(v((x) => { ((x.tables[0].alerts as Array<Record<string, unknown>>)[0]).telegram = 'ask' }), ['INVALID'])
  assert.deepEqual(v((x) => { ((x.tables[0].alerts as Array<Record<string, unknown>>)[0]).telegram = 'nope' }), ['BAD_REF'])
  assert.deepEqual(v((x) => { ((x.tables[0].alerts as Array<Record<string, unknown>>)[0]).telegram = 'Bad Key' }), ['BAD_KEY'])
  assert.deepEqual(v((x) => { x.sends[1].allowWhen = { status: ['draft'] } }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[1].allowWhen = { status: ['submitted'] } }), [])
  assert.deepEqual(v((x) => { ((x.tables[0].moveAlerts as Array<Record<string, unknown>>)[0]).notify = 'owner'; delete ((x.tables[0].moveAlerts as Array<Record<string, unknown>>)[0]).send }), [])
})

test('Telegram — text · fingerprint (chat not in fingerprint · empty subject)', () => {
  const r = validateSpec(leave(), null)
  assert.ok(r.ok)
  const t = r.spec.tables[0]
  const s = r.spec.sends!.find((x) => x.key === 'tg')!
  const m = buildSpecMail(t, s, { days: 3, status: 'submitted' }, '2026-11-09', { ownerEmail: 'o@x.ch', members: [] }, null)
  assert.equal(m.to, null)
  assert.equal(m.subject, '')
  assert.equal(m.text, 'Leave 3 days · submitted')
  assert.equal(specSendRefKey(s, m, '2026-11-09'), specSendRefKey(s, { ...m }, '2026-11-09'))
})

test('Telegram — reading the start node chat slot · format', () => {
  const wf = (chats: unknown) => ({ nodes: [{ id: 's', type: 'start', data: { triggerType: 'app', telegramChats: chats } }] })
  assert.deepEqual(appStartSettings(wf({ team: ' -1001234567890 ' })).telegramChats, { team: '-1001234567890' })
  assert.deepEqual(appStartSettings(wf({ team: '@team_chat' })).telegramChats, { team: '@team_chat' })
  assert.deepEqual(appStartSettings(wf({ team: 'https://t.me/x' })).telegramChats, {})
  assert.deepEqual(appStartSettings(wf({ team: '' })).telegramChats, {})
  assert.deepEqual(appStartSettings(wf(['x'])).telegramChats, {})
  assert.deepEqual(appStartSettings(wf(undefined)).telegramChats, {})
  assert.ok(isTelegramChatId('123') && isTelegramChatId('-100123') && isTelegramChatId('@abcd'))
  assert.ok(!isTelegramChatId('@ab') && !isTelegramChatId('12a') && !isTelegramChatId(''))
})

test('Telegram — MCP cannot change the chat · left out = kept · same value passes', () => {
  const stored = { nodes: [{ id: 'a', data: { telegramChats: { team: '-100111' }, label: 'A' } }, { id: 'b', data: {} }] }
  let inc: { nodes: Array<{ id: string; data: Record<string, unknown> }> } = { nodes: [{ id: 'a', data: { telegramChats: { team: ' -100111 ' } } }] }
  assert.deepEqual(guardStudioOnlyFields(inc, stored), [])
  inc = { nodes: [{ id: 'a', data: { label: 'A2' } }] }
  assert.deepEqual(guardStudioOnlyFields(inc, stored), [])
  assert.deepEqual(inc.nodes[0].data.telegramChats, { team: '-100111' })
  assert.equal(guardStudioOnlyFields({ nodes: [{ id: 'a', data: { telegramChats: { team: '-100999' } } }] }, stored).length, 1)
  assert.equal(guardStudioOnlyFields({ nodes: [{ id: 'a', data: { telegramChats: {} } }] }, stored).length, 1)
  assert.equal(guardStudioOnlyFields({ nodes: [{ id: 'b', data: { telegramChats: { team: '-100999' } } }] }, stored).length, 1)
  assert.equal(guardStudioOnlyFields({ nodes: [{ id: 'new', data: { telegramChats: { team: '@evil_group' } } }] }, stored).length, 1)
  assert.equal(guardStudioOnlyFields({ nodes: [{ id: 'a' } as never] }, stored).length, 1)
  assert.equal(guardStudioOnlyFields({ nodes: [{ id: 'b' } as never] }, stored).length, 0)
  assert.deepEqual(guardStudioOnlyFields({ nodes: [{ id: 'n', data: { telegramChats: {} } }] }, null), [])
})
