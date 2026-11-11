
import type { PrismaClient } from '@prisma/client'
import type { Sender } from '../sends'
import { WorkError } from '../errors'
import { mssqlQueryFacts } from '../ai-sql-check'
import { CompanyDbError, dbParamValues, dbTargetLabel, isDbEngine, resolveDbConnection, writeCompanyDb, writeOutcome, type CompanyDbDeps } from '../company-db'

export function databaseSender(db: PrismaClient, deps: CompanyDbDeps = {}): Sender {
  return {
    async send(input) {
      const q = input.query
      if (!q || q.mode !== 'write' || !isDbEngine(q.engine)) return { status: 'refused', code: 'QUERY_CHANGED' }
      let values: unknown[]
      let config
      try {
        values = dbParamValues(q.params, input.payload.params)
        const conn = await resolveDbConnection(db, { userId: input.userId, workflowId: input.workflowId, slot: input.slot, engine: q.engine })
        if (!conn.ok) return { status: 'refused', code: conn.code }
        config = conn.config
      } catch (e) {
        if (e instanceof WorkError) return { status: 'refused', code: 'PARAMS_INVALID', detail: e.message.slice(0, 300) }
        console.error('[work-send] DB 써넣기 준비 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
        return { status: 'refused', code: 'PREPARE_FAILED', detail: e instanceof Error ? e.message.slice(0, 300) : 'error' }
      }
      try {
        const uncertain = q.engine === 'mssql' && mssqlQueryFacts(q.sql).uncertain
        const r = await writeCompanyDb(config, { sql: q.sql, values, names: q.params, uncertain }, deps)
        return { status: 'sent', affectedRows: r.affectedRows, detail: `${r.affectedRows} rows changed`, target: dbTargetLabel(config) }
      } catch (e) {
        if (e instanceof CompanyDbError) {
          console.warn(`[work-send] DB 써넣기 ${e.phase} ${e.code}: ${e.detail.slice(0, 200)}`)
          return { status: writeOutcome(e), code: e.code, detail: e.detail, target: dbTargetLabel(config) }
        }
        return { status: 'unknown', code: 'NO_RESPONSE', detail: e instanceof Error ? e.message.slice(0, 300) : 'error', target: dbTargetLabel(config) }
      }
    },
  }
}
