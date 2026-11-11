
import type { SheetActor } from './sheet-gate'
import type { WorkFileDeps } from './files'
import { decryptJson } from './sealed'
import { saveWorkMessage, TEAM_ROOM } from './app-chat'
import { viewStatus, type SendPayload, type SendView } from './sends'

const KIND_WORD: Record<string, string> = { email: 'email', telegram: 'Telegram message', http: 'server call', db_write: 'database write', db_sql: 'SQL', sms: 'text message', call: 'call', work_app: 'rows for another work app', calendar: 'calendar event' }
const ROW_SQL_KINDS = new Set(['insert', 'update', 'delete', 'replace', 'merge'])
const SQL_IN_HISTORY = 2_000
const sqlForHistory = (sql: string) => (sql.length > SQL_IN_HISTORY ? `${sql.slice(0, SQL_IN_HISTORY)} …(cut — ${sql.length} chars in all)` : sql)

export function sendCardHistoryLine(v: SendView): string {
  const what = KIND_WORD[v.kind] ?? v.kind
  if (v.aiSql) return `[Card shown to the person: ${what} on ${v.slot} (${v.aiSql.targetLabel}) — status ${v.status}${v.code ? ` (${v.code})` : ''}: ${sqlForHistory(v.aiSql.sql)}]`
  const to = v.to.join(', ')
  return `[Card shown to the person: ${what}${to ? ` to ${to}` : ''}${v.subject ? ` — "${v.subject.slice(0, 120)}"` : ''} — status ${v.status}${v.code ? ` (${v.code})` : ''}]`
}

export async function reportSendResult(deps: WorkFileDeps, k: { userId: string; projectId: string; sendId: string; by: SheetActor }): Promise<void> {
  try {
    const row = await deps.db.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { status: true, claimedAt: true, dispatchedAt: true, code: true, kind: true, taskId: true, payload: true, result: true } })
    if (!row) return
    const status = viewStatus(row)
    if (status === 'pending' || status === 'sending') return
    const key = await deps.dataKey(deps.db, k.userId)
    const p = decryptJson<SendPayload>(row.payload, key)
    let sentTo: string[] | undefined
    let affected: number | undefined
    if (row.result) {
      try {
        const res = decryptJson<{ sentTo?: string[]; affectedRows?: unknown }>(row.result, key)
        sentTo = res.sentTo
        if (typeof res.affectedRows === 'number') affected = res.affectedRows
      } catch { }
    }
    const what = KIND_WORD[row.kind] ?? row.kind
    const to = (sentTo ?? p.to ?? []).map((x) => { if (row.kind !== 'http') return x; try { return new URL(x).host } catch { return '' } }).filter(Boolean).join(', ')
    const target = to ? ` to ${to}` : ''
    const subj = p.aiSql ? `: ${sqlForHistory(p.aiSql.sql)}` : p.subject ? ` — "${p.subject.slice(0, 120)}"` : p.query ? ` (${p.query.id})` : ''
    if (p.aiSql && !ROW_SQL_KINDS.has(p.aiSql.kind)) affected = undefined
    const rows = affected === undefined ? ''
      : p.appSend ? ` — ${affected} row${affected === 1 ? '' : 's'} added to its inbox, unconfirmed (its people check them)`
      : affected === 0 ? ' — 0 rows changed (nothing matched; tell the person)' : ` — ${affected} row${affected === 1 ? '' : 's'} changed`
    const text =
      status === 'sent' ? `Sent the ${what}${target}${subj}${rows}.`
      : status === 'discarded' ? `The ${what}${target} was discarded — not sent.`
      : status === 'unknown' ? `Could not confirm the ${what}${target}${subj} — no answer from the other side, it may have gone out. Do not resend on your own; the person decides.`
      : `The ${what}${target}${subj} was not sent (${status}${row.code ? `: ${row.code}` : ''}).`
    const taskId = row.taskId && (await deps.db.workTask.findFirst({ where: { id: row.taskId, projectId: k.projectId, userId: k.userId }, select: { id: true } })) ? row.taskId : null
    await saveWorkMessage(deps, { userId: k.userId, projectId: k.projectId, taskId, role: 'assistant', actor: k.by, body: { text, sendId: k.sendId }, view: TEAM_ROOM })
  } catch (e) {
    console.error('[work-send] 결과 한 줄 저장 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
  }
}

export async function reportReissue(deps: WorkFileDeps, k: { userId: string; projectId: string; sendId: string; by: SheetActor }): Promise<void> {
  try {
    const row = await deps.db.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { kind: true, taskId: true, payload: true } })
    if (!row) return
    const p = decryptJson<SendPayload>(row.payload, await deps.dataKey(deps.db, k.userId))
    const to = (p.to ?? []).map((x) => { if (row.kind !== 'http') return x; try { return new URL(x).host } catch { return '' } }).filter(Boolean).join(', ')
    const text = `Prepared the ${KIND_WORD[row.kind] ?? row.kind}${to ? ` to ${to}` : ''} again as a new card — waiting for the person to press Send.`
    const taskId = row.taskId && (await deps.db.workTask.findFirst({ where: { id: row.taskId, projectId: k.projectId, userId: k.userId }, select: { id: true } })) ? row.taskId : null
    await saveWorkMessage(deps, { userId: k.userId, projectId: k.projectId, taskId, role: 'assistant', actor: k.by, body: { text, proposals: [{ type: 'send', sendId: k.sendId }] }, view: TEAM_ROOM })
  } catch (e) {
    console.error('[work-send] 다시 보내기 카드 저장 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
  }
}
