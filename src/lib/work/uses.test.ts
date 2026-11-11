import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeWorkApps } from './registry'
import type { WorkAppPackage } from './package'
import type { WorkAppUses } from './uses'
import type { SheetTemplate } from './sheet-templates'
import { exampleWorkApp } from '@/work-apps/example'

const ORDERS: SheetTemplate = {
  name: 'example.orders',
  version: 1,
  family: 'example.orders',
  columns: [
    { name: 'phone', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'note', type: 'string', encrypted: true },
    { name: 'qty', type: 'number' },
  ],
  confirm: { calcColumns: [] },
}

const USES: WorkAppUses = {
  connections: [
    { id: 'mail', kind: 'email', label: 'example.slot.mail' },
    { id: 'erp', kind: 'database', engine: 'postgres', label: 'example.slot.erp' },
  ],
  sends: [
    { id: 'example.report', via: 'mail', to: { setting: 'reportEmail' }, auto: true, label: 'example.send.report' },
    { id: 'example.notify', via: 'mail', to: { fixed: ['a@example.com'] }, label: 'example.send.notify' },
    { id: 'example.post-decl', query: 'example.post', label: 'example.send.post' },
  ],
  webSearch: true,
  knowledge: true,
  dbQueries: [
    { id: 'example.sales', via: 'erp', mode: 'read', label: 'example.q.sales' },
    { id: 'example.post', via: 'erp', mode: 'write', label: 'example.q.post' },
  ],
  inbox: [{ family: 'example.orders', identify: { column: 'phone', by: 'phone' }, readable: ['status'] }],
}

const LABELS = ['example.slot.mail', 'example.slot.erp', 'example.send.report', 'example.send.notify', 'example.send.post', 'example.q.sales', 'example.q.post']

function v3(over: { uses?: unknown; dbQueries?: unknown; core?: number; settings?: string[] } = {}): WorkAppPackage {
  const base = exampleWorkApp()
  const tpl = base.appTemplates[0]
  const en = { ...base.meta.i18n.en, ...Object.fromEntries(LABELS.map((k) => [k, k])) }
  const meta = { ...base.meta, i18n: { en }, uses: (over.uses === undefined ? { example: USES } : over.uses) as WorkAppPackage['meta']['uses'] }
  return {
    ...base,
    core: over.core ?? 3,
    meta,
    sheetTemplates: [...base.sheetTemplates, ORDERS],
    appTemplates: [{
      ...tpl,
      sheets: [...tpl.sheets, { template: 'example.orders@1', name: 'Orders' }],
      ui: { ...tpl.ui, settings: (over.settings ?? ['reportEmail']).map((name) => ({ name, type: 'text' as const })) },
    }],
    dbQueries: (over.dbQueries === undefined
      ? { 'example.sales': { sql: 'SELECT 1 WHERE $1 = $1', params: ['month'] }, 'example.post': { sql: 'UPDATE t SET x = $1', params: ['x'] } }
      : over.dbQueries) as WorkAppPackage['dbQueries'],
  } as WorkAppPackage
}

const compose = (p: WorkAppPackage) => composeWorkApps([() => p], [p.meta])
const throwsWith = (p: WorkAppPackage, re: RegExp) =>
  assert.throws(() => compose(p), (e: unknown) => e instanceof Error && e.message.startsWith('work app registry:') && re.test(e.message), String(re))
const withUses = (patch: Partial<WorkAppUses>) => v3({ uses: { example: { ...USES, ...patch } } })

test('a valid contract 3 package registers', () => {
  const r = compose(v3())
  assert.equal(r.packages[0].core, 3)
})

test('contract 3 fields only on contract 3 packages', () => {
  throwsWith(v3({ core: 2 }), /uses \/ dbQueries need core 3/)
  throwsWith(v3({ core: 2, uses: {} as unknown }), /need core 3/)
  const p = v3({ core: 2 })
  compose({ ...p, meta: { ...p.meta, uses: undefined }, dbQueries: undefined })
})

test('uses keys only for that package app templates', () => {
  throwsWith(v3({ uses: { example: USES, other: {} } }), /uses for unknown app template "other"/)
})

test('connection slots - kind, id, duplicates, text key', () => {
  throwsWith(withUses({ connections: [{ id: 'mail', kind: 'fax' as never, label: 'example.slot.mail' }] }), /kind "fax"/)
  throwsWith(withUses({ connections: [{ id: 'Mail!', kind: 'email', label: 'example.slot.mail' }] }), /connection id "Mail!"/)
  throwsWith(withUses({ connections: [...USES.connections!, { id: 'mail', kind: 'email', label: 'example.slot.mail' }] }), /connection listed twice: mail/)
  throwsWith(withUses({ connections: [{ id: 'mail', kind: 'email', label: 'example.nope' }, USES.connections![1]] }), /label "example.nope" is not an i18n key/)
})

test('sends - recipient is a setting or a constant, via is a sending connection', () => {
  const s = USES.sends!
  throwsWith(withUses({ sends: [{ ...s[0], to: { setting: 'nope' } } as never, s[2]] }), /setting "nope" is not a setting/)
  throwsWith(withUses({ sends: [{ ...s[1], to: { fixed: [] } } as never, s[2]] }), /fixed recipient is empty/)
  throwsWith(withUses({ sends: [{ ...s[1], to: { fixed: ['  '] } } as never, s[2]] }), /fixed recipient is empty/)
  throwsWith(withUses({ sends: [{ ...s[1], to: { ai: true } } as never, s[2]] }), /needs to: \{ setting \} or \{ fixed \}/)
  throwsWith(withUses({ sends: [{ ...s[1], to: undefined } as never, s[2]] }), /needs to:/)
  throwsWith(withUses({ sends: [{ ...s[1], via: 'erp' }, s[2]] }), /via "erp" is not a sending connection/)
  throwsWith(withUses({ sends: [{ ...s[1], via: 'ghost' }, s[2]] }), /via "ghost" is not a sending connection/)
  throwsWith(withUses({ sends: [{ ...s[1], id: 'notify' }, s[2]] }), /send id "notify" must start with "example."/)
  throwsWith(withUses({ sends: [{ ...s[1], auto: 'yes' as never }, s[2]] }), /auto must be true or false/)
  throwsWith(withUses({ sends: [s[1], { ...s[1] }, s[2]] }), /send id listed twice: example.notify/)
})

test('DB write declaration - write queries only - auto is rejected (always a card)', () => {
  const s = USES.sends!
  throwsWith(withUses({ sends: [{ id: 'example.x', query: 'example.sales', label: 'example.send.post' }] }), /query "example.sales" is not a write query/)
  throwsWith(withUses({ sends: [{ id: 'example.x', query: 'example.ghost', label: 'example.send.post' }] }), /query "example.ghost" is not a write query/)
  throwsWith(withUses({ sends: [{ ...s[2], auto: true as never }] }), /database writes are always cards, auto must be false/)
  compose(withUses({ sends: [s[2], { ...s[2], id: 'example.post-card', auto: false }] }))
})

test('DB queries - connection kind, mode, declared ids = implemented ids', () => {
  const q = USES.dbQueries!
  throwsWith(withUses({ dbQueries: [{ ...q[0], via: 'mail' }, q[1]] }), /via "mail" is not a database connection/)
  throwsWith(withUses({ dbQueries: [{ ...q[0], mode: 'delete' as never }, q[1]] }), /mode "delete"/)
  throwsWith(v3({ dbQueries: { 'example.sales': { sql: 'SELECT 1', params: [] } } }), /dbQueries \[example.sales\] ≠ declared/)
  throwsWith(v3({ dbQueries: { 'example.sales': { sql: ' ', params: [] }, 'example.post': { sql: 'x', params: [] } } }), /example.sales has no sql/)
  throwsWith(v3({ dbQueries: { 'example.sales': { sql: 'x', params: [''] }, 'example.post': { sql: 'x', params: [] } } }), /params must be names/)
  throwsWith(v3({ dbQueries: { 'example.sales': { sql: 'x', params: ['id', 'id'] }, 'example.post': { sql: 'x', params: [] } } }), /param listed twice: id/)
  for (const maxRows of [0, 1_001, 1.5]) throwsWith(v3({ dbQueries: { 'example.sales': { sql: 'x', params: [], maxRows }, 'example.post': { sql: 'x', params: [] } } }), /maxRows must be 1–1000/)
  compose(v3({ dbQueries: { 'example.sales': { sql: 'x', params: [], maxRows: 1_000 }, 'example.post': { sql: 'x', params: [] } } }))
})

test('DB slot engine - required on database slots, forbidden on others (flow.md §18 D-1)', () => {
  const c = USES.connections!
  const erp = c.find((x) => x.id === 'erp')!
  const others = c.filter((x) => x.id !== 'erp')
  throwsWith(withUses({ connections: [...others, { ...erp, engine: undefined }] }), /connection erp engine "undefined"/)
  const { engine: _e, ...noEngine } = erp
  const free = { ...USES, connections: [...others, noEngine], dbQueries: [], sends: USES.sends!.filter((x) => !('query' in x)) }
  compose(v3({ uses: { example: free }, dbQueries: {} }))
  throwsWith(v3({ uses: { example: { ...USES, connections: [...others, noEngine] } } }), /slot "erp" has no engine/)
  throwsWith(v3({ uses: { example: { ...free, dbQueries: [USES.dbQueries![1]], sends: USES.sends } }, dbQueries: { 'example.post': { sql: 'UPDATE t SET x = $1', params: ['x'] } } }), /slot "erp" has no engine/)
  throwsWith(withUses({ connections: [...others, { ...erp, engine: 'oracle' as never }] }), /connection erp engine "oracle"/)
  throwsWith(withUses({ connections: [...others, { ...erp, engine: null as never }] }), /connection erp engine "null"/)
  throwsWith(withUses({ connections: [...others, { ...erp, engine: '' as never }] }), /connection erp engine ""/)
  throwsWith(withUses({ connections: [...c.map((x) => (x.id === 'mail' ? { ...x, engine: 'mysql' as const } : x))] }), /connection mail engine "mysql"/)
  compose(withUses({ connections: [...others, { ...erp, engine: 'mysql' }] }))
})

test('SQL Server queries - @name - reads are a single SELECT - writes have no transaction control', () => {
  const c = USES.connections!
  const ms = { uses: { example: { ...USES, connections: c.map((x) => (x.id === 'erp' ? { ...x, engine: 'mssql' as const } : x)) } } }
  const q = (sales: string, post: string, params: [string[], string[]] = [['month'], ['x']]) => v3({ ...ms, dbQueries: { 'example.sales': { sql: sales, params: params[0] }, 'example.post': { sql: post, params: params[1] } } })
  compose(q('SELECT TOP 10 [name] FROM dbo.t WHERE m = @month', 'UPDATE t SET x = @x'))
  compose(q('WITH a AS (SELECT 1 AS n) SELECT CASE WHEN n = @Month THEN 1 END AS v FROM a', 'EXEC dbo.p @x = @x'))
  throwsWith(q('SELECT 1 WHERE $1 = $1', 'UPDATE t SET x = @x'), /param "month" — SQL Server queries use @month/)
  throwsWith(q('SELECT 1 WHERE m = @monthly', 'UPDATE t SET x = @x'), /SQL Server queries use @month/)
  throwsWith(q('SELECT 1 AS a', 'UPDATE t SET x = @x', [['bad-name'], ['x']]), /letters, digits and _/)
  for (const read of ['SELECT @month AS a UPDATE t SET x = 1', 'SELECT @month AS a COMMIT BEGIN TRAN', 'SELECT * INTO t2 FROM t WHERE m = @month', 'SELECT @month AS a DISABLE TRIGGER trg ON t', 'SELECT @month AS a END CONVERSATION @h', 'SELECT * FROM t WITH (UPDLOCK) WHERE m = @month', 'SELECT * FROM OPENQUERY(srv, \'x\') WHERE 1 = @month', 'EXEC dbo.p @month']) {
    throwsWith(q(read, 'UPDATE t SET x = @x'), /a SQL Server read must be one SELECT/)
  }
  throwsWith(q('SELECT @month AS a', 'UPDATE t SET x = @x COMMIT'), /a SQL Server write cannot BEGIN, COMMIT/)
  throwsWith(q('SELECT @month AS a', 'BEGIN TRAN UPDATE t SET x = @x'), /a SQL Server write cannot BEGIN, COMMIT/)
  compose(v3())
})

test('inbox - sheet and columns of that app template, a family no calculation module reads', () => {
  const b = USES.inbox![0]
  throwsWith(withUses({ inbox: [{ ...b, family: 'example.ghost' }] }), /inbox family "example.ghost" is not a sheet/)
  throwsWith(withUses({ inbox: [{ ...b, family: 'example.expenses', identify: { column: 'description', by: 'phone' }, readable: [] }] }), /is read by the calculation module/)
  throwsWith(withUses({ inbox: [{ ...b, identify: { column: 'ghost', by: 'phone' } }] }), /identify column "ghost"/)
  throwsWith(withUses({ inbox: [{ ...b, identify: { column: 'phone', by: 'email' as never } }] }), /identify.by "email"/)
  throwsWith(withUses({ inbox: [{ ...b, readable: ['ghost'] }] }), /readable column "ghost"/)
  throwsWith(withUses({ inbox: [b, b] }), /inbox family listed twice/)
  throwsWith(withUses({ inbox: [{ ...b, identify: { column: 'qty', by: 'phone' } }] }), /identify column "qty" is not a text column/)
  const noConfirm = withUses({ inbox: [b] })
  noConfirm.sheetTemplates = noConfirm.sheetTemplates.map((t) => (t.name === 'example.orders' ? { ...t, confirm: undefined } : t))
  throwsWith(noConfirm, /inbox example.orders sheet template must declare confirm/)
  compose(withUses({ inbox: [{ ...b, readable: ['status', 'note'] }] }))
})

test('webSearch and knowledge are booleans only', () => {
  throwsWith(withUses({ webSearch: 'yes' as never }), /webSearch \/ knowledge must be true or false/)
})

test('contract 3 extra tools - declared only; existing tool lists of contracts 1, 2 and free unchanged', async () => {
  const { v3ToolDefs, workAppToolDefs, WORK_APP_TOOL_DEFS } = await import('./app-ai')
  const reg = compose(v3())
  const names = (k: string, r?: typeof reg) => v3ToolDefs(k, r).map((d) => d.name)
  assert.deepEqual(names('example', reg), ['work_search_docs', 'work_send', 'work_db_query', 'work_db_write'])
  assert.deepEqual(names('vat'), [])
  assert.deepEqual(names('free'), [])
  const bare = compose(v3({ uses: { example: {} }, dbQueries: {} }))
  assert.deepEqual(names('example', bare), [])
  const onlyKnowledge = compose(v3({ uses: { example: { knowledge: true } }, dbQueries: {} }))
  assert.deepEqual(names('example', onlyKnowledge), ['work_search_docs'])
  const onlyDb = compose(v3({ uses: { example: { connections: [USES.connections![1]], dbQueries: [USES.dbQueries![1]] } }, dbQueries: { 'example.post': { sql: 'x', params: [] } } }))
  assert.deepEqual(names('example', onlyDb), ['work_db_write'], 'DB 연결만이면 보내기 도구(work_send)는 없다')
  const base = WORK_APP_TOOL_DEFS.map((d) => d.name)
  assert.deepEqual(workAppToolDefs('free').map((d) => d.name), base)
  assert.deepEqual(workAppToolDefs('vat').map((d) => d.name).slice(0, base.length), base)
  assert.ok(!workAppToolDefs('vat').some((d) => ['work_search_docs', 'work_send', 'work_db_query', 'work_db_write'].includes(d.name)))
  assert.ok(!workAppToolDefs('vat').some((d) => d.name === 'work_read_references'))
  assert.ok(workAppToolDefs('vat', [], false, [], true).some((d) => d.name === 'work_read_references'))
})

test('web search option - not declared / declared + off null / off / declared but the AI connection cannot', async () => {
  const { workAppWebSearchOn } = await import('./app-ai')
  const on = compose(v3())
  const off = compose(v3({ uses: { example: { ...USES, webSearch: false } } }))
  const base = { kind: 'example', capabilityOff: null, aiConnectionKind: null, model: 'gpt-6-sol' }
  assert.equal(workAppWebSearchOn(base, off), false, '선언 없음')
  assert.equal(workAppWebSearchOn(base, on), true, '선언 있음 + 끄기 칸 null (Cloud)')
  assert.equal(workAppWebSearchOn({ ...base, capabilityOff: {} }, on), true, '끄기 칸 {}')
  assert.equal(workAppWebSearchOn({ ...base, capabilityOff: { webSearchOff: true } }, on), false, '쓰는 쪽이 끔')
  assert.equal(workAppWebSearchOn({ ...base, aiConnectionKind: 'azure' }, on), true, 'Self-hosted Azure 연결')
  assert.equal(workAppWebSearchOn({ ...base, aiConnectionKind: 'openai_compatible' }, on), false, 'OpenAI 호환 연결')
  assert.equal(workAppWebSearchOn({ ...base, aiConnectionKind: 'anthropic' }, on), false, 'Anthropic 연결')
  assert.equal(workAppWebSearchOn({ ...base, model: 'gpt-4.1-nano' }, on), false, '못 하는 모델')
  assert.equal(workAppWebSearchOn({ ...base, kind: 'vat' }), false, '판 1')
})

test('Start (App) settings - document space number is a positive integer, digits only', async () => {
  const { appStartSettings } = await import('./app-chat')
  const wf = (ragSpaceId: unknown) => JSON.stringify({ nodes: [{ id: 's', type: 'custom', data: { nodeType: 'start', triggerType: 'app', ragSpaceId } }], edges: [] })
  assert.equal(appStartSettings(wf(7)).ragSpaceId, 7)
  assert.equal(appStartSettings(wf('12')).ragSpaceId, 12)
  for (const bad of [true, false, [], [3], 0, -1, 1.5, '', ' ', '1.5', '01', 'x', null, {}]) assert.equal(appStartSettings(wf(bad)).ragSpaceId, null, JSON.stringify(bad))
  const conn = JSON.stringify({ nodes: [{ id: 's', type: 'custom', data: { nodeType: 'start', triggerType: 'app', connections: { shop: { mail: 'c1', bad: 3, empty: '' }, broken: 'x', list: [] } } }], edges: [] })
  assert.deepEqual(appStartSettings(conn).connections, { shop: { mail: 'c1' } })
})
