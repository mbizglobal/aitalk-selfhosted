import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_SQL_MAX_CHARS, checkAiSql, countFromRows, countSqlProblem, mssqlQueryFacts, normalizeSql } from './ai-sql-check'
import { aiSqlModeProblem } from './ai-sql'

const ok = (sql: string, engine: 'postgres' | 'mysql' | 'mssql' = 'postgres') => {
  const r = checkAiSql(sql, engine)
  if (!r.ok) throw new Error(`expected ok for ${sql}: ${r.code}`)
  return r
}
const code = (sql: unknown, engine: 'postgres' | 'mysql' | 'mssql' = 'postgres') => { const r = checkAiSql(sql, engine); return r.ok ? 'ok' : r.code }

test('AI SQL input bounds - not text, empty, comments/semicolons only, length, hidden characters, executable comments, U&', () => {
  assert.equal(code(undefined), 'SQL_EMPTY')
  assert.equal(code(42), 'SQL_EMPTY')
  assert.equal(code(''), 'SQL_EMPTY')
  assert.equal(code('   ;;; '), 'SQL_EMPTY')
  assert.equal(code('-- only a comment\n/* and this */'), 'SQL_EMPTY')
  assert.equal(code('SELECT 1 -- x', 'mysql'), 'ok')
  assert.equal(code(`SELECT '${'a'.repeat(AI_SQL_MAX_CHARS)}'`), 'SQL_TOO_LONG')
  assert.equal(code(`SELECT ${'1'.padEnd(AI_SQL_MAX_CHARS - 7, '1')}`), 'ok')
  assert.equal(code('SELECT 1\u0000'), 'SQL_HIDDEN_CHARS')
  assert.equal(code('SELECT ‮evil'), 'SQL_HIDDEN_CHARS')
  assert.equal(code('SELECT 1\tFROM t\r\n'), 'ok')
  assert.equal(code("SELECT 1 /*! INTO OUTFILE '/tmp/x' */", 'mysql'), 'SQL_EXEC_COMMENT')
  assert.equal(code('SELECT 1 /*M! , 2 */', 'mysql'), 'SQL_EXEC_COMMENT')
  assert.equal(code('SELECT 1 /* ! not exec */'), 'SQL_EXEC_COMMENT')
  assert.equal(code('SELECT U&"pg\\005fadvisory\\005flock"(1)'), 'SQL_HIDDEN_CHARS')
  assert.equal(code("SELECT u&'x'"), 'SQL_HIDDEN_CHARS')
})

test('normalize - drop comments and strings, keep quoted names, upper case, space before parenthesis', () => {
  assert.equal(normalizeSql("select 'drop table x' , a from t -- drop\n", 'postgres'), "SELECT '' , A FROM T")
  assert.equal(normalizeSql('select pg_catalog."pg_advisory_lock" (1)', 'postgres'), 'SELECT PG_CATALOG.PG_ADVISORY_LOCK(1)')
  assert.equal(normalizeSql('select $tag$ drop $tag$, 1', 'postgres'), "SELECT '' , 1")
  assert.equal(normalizeSql("select 'it\\'s', 1 # c\n", 'mysql'), "SELECT '' , 1")
  assert.equal(normalizeSql('select /* a /* nested */ b */ 1;', 'postgres'), 'SELECT 1')
})

test('read check - allow list, deny list (split by comments, case, space before parenthesis, quotes, prefix, INTO @)', () => {
  for (const s of ['SELECT * FROM t', 'with x as (select 1) select * from x', 'SHOW TABLES', 'EXPLAIN SELECT 1', 'DESCRIBE t', 'select 1;', "select 'for update' from t"]) assert.equal(ok(s, 'mysql').readable, true, s)
  for (const s of ['UPDATE t SET a=1', 'DROP TABLE t', 'CREATE TABLE x(a int)', 'CALL p()', 'INSERT INTO t VALUES (1)', 'SET x=1', 'BEGIN']) assert.equal(ok(s).readable, false, s)
  for (const s of ["SELECT 1 INTO OUTFILE '/tmp/x'", "select 1 into /*x*/ outfile '/tmp/x'", 'SELECT a INTO @v FROM t', 'select * from t for   update', 'SELECT * FROM t LOCK IN SHARE MODE', 'SELECT GET_LOCK (\'x\', 1)', 'select sleep(5)']) assert.equal(ok(s, 'mysql').readable, false, s)
  for (const s of ['SELECT pg_advisory_lock(1)', 'select pg_catalog."pg_advisory_lock"(1)', "SELECT pg_read_file('/etc/passwd')", 'select lo_import(\'/x\')', "SELECT dblink_exec('x','y')", 'SELECT * FROM t FOR NO KEY UPDATE', 'select pg_sleep(1)']) assert.equal(ok(s).readable, false, s)
})

test('one or two confirmations - judged on the whole statement', () => {
  assert.equal(ok('INSERT INTO t (a) VALUES (1)').oneStep, true)
  assert.equal(ok('INSERT INTO t SELECT * FROM s').oneStep, true)
  assert.equal(ok('INSERT INTO t VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2').oneStep, false)
  assert.equal(ok('INSERT INTO t VALUES (1) ON DUPLICATE KEY UPDATE a = 2', 'mysql').oneStep, false)
  assert.equal(ok('CREATE TABLE suppliers (name text, city text)').oneStep, true)
  assert.equal(ok('CREATE VIEW v AS SELECT 1').oneStep, false)
  assert.equal(ok('ALTER TABLE t ADD COLUMN c int').oneStep, true)
  assert.equal(ok('alter table t add c varchar(10)').oneStep, true)
  assert.equal(ok('ALTER TABLE t ADD COLUMN c int, DROP COLUMN d').oneStep, false)
  assert.equal(ok('ALTER TABLE t DROP COLUMN d').oneStep, false)
  assert.equal(ok('ALTER TABLE t RENAME TO u').oneStep, false)
  assert.equal(ok('ALTER TABLE t ADD CONSTRAINT k CHECK (a > 0)').oneStep, true)
  for (const s of ['UPDATE t SET a = 1 WHERE id = 1', 'DELETE FROM t WHERE id = 1', 'DROP TABLE t', 'TRUNCATE t', 'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', 'CALL p()', 'GRANT ALL ON t TO u', 'REPLACE INTO t VALUES (1)']) assert.equal(ok(s).oneStep, false, s)
})

test('MySQL - one confirmation only for INSERT, -- is a comment only when followed by a space', () => {
  assert.equal(ok('CREATE TABLE t (a int)', 'mysql').oneStep, false)
  assert.equal(ok('ALTER TABLE t ADD COLUMN c int', 'mysql').oneStep, false)
  assert.equal(ok('INSERT INTO t VALUES (1)', 'mysql').oneStep, true)
  assert.equal(ok("SELECT 1--1 INTO OUTFILE '/tmp/x'", 'mysql').readable, false)
  assert.equal(ok('SELECT 1 -- INTO OUTFILE', 'mysql').readable, true)
  assert.equal(ok("SELECT 1--1 INTO OUTFILE '/tmp/x'", 'postgres').readable, true)
})

test('MySQL block comments do not nest, a semicolon in the middle means several statements', () => {
  assert.equal(ok("SELECT 1 /* /* */ INTO OUTFILE '/tmp/x'", 'mysql').readable, false)
  assert.equal(ok('INSERT INTO t (a) VALUES (1) /* /* */ ON DUPLICATE KEY UPDATE a = 2', 'mysql').oneStep, false)
  assert.equal(ok('SELECT 1 /* /* nested */ still comment */', 'postgres').readable, true)
  assert.equal(code('SELECT 1; CREATE TABLE t (id int)', 'mysql'), 'SQL_MULTI')
  assert.equal(code('INSERT INTO t VALUES (1); DELETE FROM t'), 'SQL_MULTI')
  assert.equal(code("SELECT ';' AS x;"), 'ok')
  assert.equal(code('SELECT 1 -- ; trailing comment\n'), 'ok')
})

test('kind and whether MySQL can wrap it in a transaction', () => {
  assert.equal(ok('drop table t').kind, 'drop')
  assert.equal(ok('create index i on t(a)').kind, 'create_other')
  assert.equal(ok('/* c */ truncate t').kind, 'truncate')
  assert.equal(ok('GRANT ALL ON t TO u').kind, 'other')
  assert.equal(ok('UPDATE t SET a=1').mysqlTx, true)
  assert.equal(ok('DROP TABLE t').mysqlTx, false)
  assert.equal(ok('CALL p()').mysqlTx, false)
  assert.equal(ok('REPLACE INTO t VALUES (1)').mysqlTx, false)
})

// ── SQL Server (flow.md §25 X-6) ──
const ms = (sql: string) => ok(sql, 'mssql')

test('SQL Server cleanup - [name], ]], nested comments, -- always a comment, backslash does not end a string', () => {
  assert.equal(normalizeSql('select [order date], [a]]b] from [dbo].[t]', 'mssql'), 'SELECT ORDER DATE , A]B FROM DBO . T')
  assert.ok(ms('UPDATE[t]SET[v]=[next_v]COMMIT').mssqlUncertain)
  assert.deepEqual(mssqlQueryFacts('UPDATE[t]SET[v]=[next_v]COMMIT').txControl, true)
  assert.ok(!ms('SELECT[a]FROM[t]WHERE[b]=1[UPDATE]').readable)
  assert.equal(normalizeSql('select 1 /* x /* y */ select 2 */', 'mssql'), 'SELECT 1')
  assert.equal(normalizeSql('select 1--x\n', 'mssql'), 'SELECT 1')
  assert.equal(normalizeSql("select N'it''s \\', 1", 'mssql'), "SELECT N '' , 1")
})

test('SQL Server read - only SELECT or WITH with no statement keyword anywhere', () => {
  for (const r of [
    'SELECT TOP 10 * FROM dbo.t ORDER BY id',
    ' -- c\n select*from t',
    'SELECT 이름 FROM 거래처',
    'WITH a AS (SELECT 1 AS n) SELECT n FROM a',
    "SELECT CASE WHEN x = 1 THEN 'a' ELSE 'b' END AS v FROM t",
    "SELECT * FROM t WHERE note = 'UPDATE t SET x = 1'",
    'SELECT geography::Point(1, 2, 4326) AS p',
    'SELECT * FROM OPENJSON(@j)',
    'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS',
  ]) assert.ok(ms(r).readable, r)
  for (const r of [
    'SELECT 1 AS a SELECT 2 AS b UPDATE t SET x = 1',
    'SELECT 1 AS a DELETE FROM t',
    'SELECT 1 AS a DISABLE TRIGGER trg ON t',
    'SELECT 1 AS a END CONVERSATION @h',
    'SELECT 1 AS a COMMIT BEGIN TRAN',
    'SELECT 1 AS a EXEC xp_cmdshell 1',
    'SELECT * INTO t2 FROM t',
    'SELECT * FROM t WITH (UPDLOCK)',
    'SELECT * FROM t WITH (TABLOCKX, HOLDLOCK)',
    "SELECT * FROM OPENROWSET('x', 'y', 'z')",
    "SELECT * FROM OPENQUERY(srv, 'x')",
    'SELECT NEXT VALUE FOR dbo.seq',
    'SELECT 1 AS a WAITFOR DELAY 1',
    'SELECT 1 AS a lbl: SELECT 2',
    'SELECT sp_who',
    'SELECT 1 AS a SET NOCOUNT ON',
    'SELECT 1 AS a DECLARE @x INT',
    'SHOW TABLES',
    'EXPLAIN SELECT 1',
    'TABLE t',
    'SELECT 1 AS [Update]',
    '[SELECT]',
    ' /* x */ "SELECT" 1',
    '한SELECT',
    'SELECT한 1',
  ]) assert.ok(!ms(r).readable, r)
})

test('SQL Server single check - only an exact INSERT ... VALUES shape', () => {
  for (const r of ['INSERT INTO dbo.t (a, b) VALUES (1, N\'x\')', 'insert t values (1), (2), (CAST(3 AS INT))', 'INSERT INTO [t] VALUES (DEFAULT)']) assert.ok(ms(r).oneStep, r)
  for (const r of [
    'INSERT INTO t VALUES (1) SELECT 2 AS b',
    'INSERT INTO t VALUES (1) DELETE FROM t',
    'INSERT INTO t (a) OUTPUT inserted.a VALUES (1)',
    'INSERT INTO t SELECT * FROM u',
    'INSERT INTO t DEFAULT VALUES',
    'INSERT INTO t VALUES (1) EXEC p',
    'INSERT INTO t VALUES ((SELECT 1))',
    'INSERT INTO [my table] VALUES (1)',
    'INSERT INTO [dbo].[t]([a]) VALUES (1)',
    'CREATE TABLE t (a INT)',
    'ALTER TABLE t ADD c INT',
    'UPDATE t SET a = 1',
    'MERGE t USING u ON 1 = 1 WHEN MATCHED THEN DELETE',
  ]) assert.ok(!ms(r).oneStep, r)
})

test('SQL Server kinds - error after sending (transaction control, procedures)', () => {
  assert.equal(ms('SELECT * INTO t2 FROM t').kind, 'create_table')
  assert.equal(ms('EXEC dbo.p').kind, 'call')
  assert.equal(ms('UPDATE t SET a = 1').mssqlUncertain, false)
  for (const r of ['UPDATE t SET a = 1 COMMIT', 'dbo.p @x = 1', 'p', '[UPDATE] @x = 1', ' -- c\n /* a /* b */ */ "DELETE" 1', '한UPDATE 1', 'EXEC dbo.p', 'EXECUTE dbo.p', 'BEGIN TRAN UPDATE t SET a = 1', 'UPDATE t SET a = 1 SAVE TRAN s', 'SELECT 1 AS a ROLLBACK', 'UPDATE t SET a = 1 sp_x']) assert.ok(ms(r).mssqlUncertain, r)
  assert.equal(ok('UPDATE t SET a = 1 COMMIT').mssqlUncertain, false, 'PG 에는 해당 없음')
  assert.deepEqual(mssqlQueryFacts('UPDATE t SET a = @a'), { readable: false, txControl: false, uncertain: false })
  assert.deepEqual(mssqlQueryFacts('EXEC dbo.p @a'), { readable: false, txControl: false, uncertain: true })
  assert.deepEqual(mssqlQueryFacts('SELECT a FROM t WHERE b = @b'), { readable: true, txControl: false, uncertain: false })
})

test('count target · mode — plain INSERT · UPDATE · DELETE on PG · MySQL only (company-db.md §6-1 · D2 (5))', () => {
  const ct = (sql: string, e: 'postgres' | 'mysql' | 'mssql' = 'postgres') => { const r = checkAiSql(sql, e); assert.ok(r.ok); return r.countTarget }
  assert.equal(ct('UPDATE items SET price = 12.5 WHERE sku = \'A-100\''), true)
  assert.equal(ct('DELETE FROM items WHERE id = 3', 'mysql'), true)
  assert.equal(ct('INSERT INTO items (sku) VALUES (\'A\'), (\'B\')'), true)
  assert.equal(ct('INSERT INTO items (sku) VALUES (\'A\') ON CONFLICT DO NOTHING'), false)
  assert.equal(ct('INSERT INTO items (sku) VALUES (\'A\') ON DUPLICATE KEY UPDATE sku = sku', 'mysql'), false)
  assert.equal(ct('INSERT IGNORE INTO items (sku) VALUES (\'A\')', 'mysql'), false)
  assert.equal(ct('UPDATE IGNORE items SET v = 1', 'mysql'), false)
  assert.equal(ct('REPLACE INTO items (sku) VALUES (\'A\')', 'mysql'), false)
  assert.equal(ct('MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE'), false)
  assert.equal(ct('CREATE TABLE z (a int)'), false)
  assert.equal(ct('CALL p()', 'mysql'), false)
  assert.equal(ct('UPDATE t SET v = 1', 'mssql'), false)
  assert.equal(ct('DELETE FROM t WHERE id = 1 SELECT 1 AS v INTO newt', 'mssql'), false)
  const mp = (mode: 'read' | 'rows' | 'schema', sql: string, e: 'postgres' | 'mysql' | 'mssql' = 'postgres') => { const r = checkAiSql(sql, e); assert.ok(r.ok); return aiSqlModeProblem(mode, r) }
  assert.equal(mp('read', 'UPDATE t SET v = 1'), 'AI_SQL_READ_ONLY')
  assert.equal(mp('read', 'SELECT 1'), null)
  assert.equal(mp('rows', 'UPDATE t SET v = 1'), null)
  assert.equal(mp('rows', 'DROP TABLE t'), 'AI_SQL_NOT_ROWS')
  assert.equal(mp('rows', 'UPDATE t SET v = 1 DROP TABLE x', 'mssql'), 'AI_SQL_NOT_ROWS')
  assert.equal(mp('rows', 'INSERT INTO t VALUES (1) ON CONFLICT DO NOTHING'), 'AI_SQL_NOT_ROWS')
  assert.equal(mp('schema', 'DROP TABLE t'), null)
  assert.equal(mp('schema', 'UPDATE t SET v = 1', 'mssql'), null)
})

test('count SELECT — read only · sequence functions refused · result is one row · one column · whole number 0 or more (company-db.md D3 (2))', () => {
  assert.equal(countSqlProblem('SELECT COUNT(*) FROM items WHERE id <= 2', 'postgres'), null)
  assert.equal(countSqlProblem('SELECT 3', 'mysql'), null)
  assert.equal(countSqlProblem('UPDATE t SET v = 1', 'postgres'), 'COUNT_NOT_READ')
  assert.equal(countSqlProblem("SELECT nextval('s')", 'postgres'), 'COUNT_NUMBER_FUNCTION')
  assert.equal(countSqlProblem('SELECT LAST_INSERT_ID(5)', 'mysql'), 'COUNT_NUMBER_FUNCTION')
  assert.equal(countSqlProblem('SELECT COUNT(*) FROM t FOR UPDATE', 'postgres'), 'COUNT_NOT_READ')
  assert.equal(countSqlProblem('', 'postgres'), 'SQL_EMPTY')
  assert.equal(countFromRows([{ count: '2' }], false), 2)
  assert.equal(countFromRows([{ n: 0 }], false), 0)
  assert.equal(countFromRows([{ n: 7n }], false), 7)
  assert.equal(countFromRows([{ n: null }], false), null)
  assert.equal(countFromRows([{ n: -1 }], false), null)
  assert.equal(countFromRows([{ n: 1.5 }], false), null)
  assert.equal(countFromRows([{ n: 'abc' }], false), null)
  assert.equal(countFromRows([{ n: ' 2' }], false), null)
  assert.equal(countFromRows([{ n: '9999999999999999' }], false), null)
  assert.equal(countFromRows([{ n: '2147483647' }], false), 2147483647)
  assert.equal(countFromRows([{ n: '2147483648' }], false), null)
  assert.equal(countFromRows([{ a: 1, b: 2 }], false), null)
  assert.equal(countFromRows([{ n: 1 }, { n: 2 }], false), null)
  assert.equal(countFromRows([], false), null)
  assert.equal(countFromRows([{ n: 1 }], true), null)
})
