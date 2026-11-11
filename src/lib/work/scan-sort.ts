import { randomUUID } from 'crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { memberCanUseWorkflow } from '@/lib/memberAccess'
import { defaultWorkFileDeps, readProjectFile, type WorkFileDeps } from './files'
import { fileRows, fileStatuses } from './file-decisions'
import { privateRoomOf } from './app-chat'
import { hasOpenPersonRun } from './app-scope'
import { runWorkAppTurn, type WorkAppTurn, type WorkAppTurnInput } from './app-turn'
import { endScanAttempt } from './scan-fence'
import { ensurePdfPages, type ScanForm } from './scan'
import { decryptJson } from './sealed'

export const SCAN_LEASE_MS = 3 * 60_000
const LEASE_RENEW_MS = 60_000
export const SCAN_SETTLE_MS = 5_000
export const SCAN_BUSY_RETRY_MS = 2 * 60_000
const SCAN_OPEN_DAYS = 7
const MAX_PARALLEL = 2
const QUESTION_BATCH = 200
let questionCursor = ''

type Db = PrismaClient
type FileState = 'done' | 'question' | 'new'

export interface ScanSummary {
  rows: number
  lines: number
  excluded: number
  unreadable: number
  questions: number
  cards: number
  questionFiles: string[]
}

export interface ScanSortDeps {
  db: Db
  files: () => Promise<WorkFileDeps>
  runTurn: (i: WorkAppTurnInput) => Promise<WorkAppTurn>
  push: (q: { userId: string; actor: string; agentId: string; scanId: string; locale: string; summary: ScanSummary }) => Promise<boolean>
}

const defaults: ScanSortDeps = { db: prisma, files: defaultWorkFileDeps, runTurn: runWorkAppTurn, push: pushScanDone }

const running = new Set<string>()

type ScanRow = NonNullable<Awaited<ReturnType<Db['workScan']['findUnique']>>>

async function ownerStates(deps: WorkFileDeps, scan: { id: string; userId: string; projectId: string }) {
  const links = await deps.db.workScanFile.findMany({ where: { scanId: scan.id }, select: { fileId: true, owner: true }, orderBy: { createdAt: 'asc' } })
  const st = await fileStatuses(deps, { userId: scan.userId, projectId: scan.projectId })
  const states = new Map<string, FileState>()
  let rows = 0, excluded = 0, unreadable = 0
  const questionFiles: string[] = []
  for (const l of links) {
    if (!l.owner) continue
    const s = st.get(l.fileId)
    if (!s) continue
    if (s.status === 'new') { states.set(l.fileId, 'new'); continue }
    if (s.status === 'pending') { states.set(l.fileId, 'question'); questionFiles.push(l.fileId); continue }
    states.set(l.fileId, 'done')
    if (s.status === 'attached') rows++
    else if (s.status === 'excluded') excluded++
    else unreadable++
  }
  const fresh = [...states].filter(([, v]) => v === 'new').map(([k]) => k)
  const attached = links.filter((l) => l.owner && st.get(l.fileId)?.status === 'attached').map((l) => l.fileId)
  const lines = attached.length ? new Set([...(await fileRows(deps, { userId: scan.userId, projectId: scan.projectId, fileIds: attached })).values()].flat().map((r) => r.rowId)).size : 0
  return { states, fresh, linked: links.map((l) => l.fileId), counts: { rows, lines, excluded, unreadable, questions: questionFiles.length, questionFiles } }
}

export async function uploaderMay(db: Db, scan: { userId: string; projectId: string; actor: string }): Promise<{ agentId: string; workflowId: string; memberId?: number } | null> {
  const p = await db.workProject.findFirst({ where: { id: scan.projectId, userId: scan.userId, status: 'active' }, select: { workflowId: true } })
  if (!p?.workflowId) return null
  const wf = await db.workflow.findFirst({ where: { workflowId: p.workflowId, status: 'production', agent: { userId: scan.userId } }, select: { workflowId: true, agentId: true } })
  if (!wf) return null
  const m = /^member:(\d+)$/.exec(scan.actor)
  if (!m) return scan.actor === 'human' ? { agentId: wf.agentId, workflowId: wf.workflowId } : null
  const memberId = Number(m[1])
  const member = await db.agentMember.findUnique({ where: { id: memberId }, select: { status: true, agentAgentId: true } })
  if (!member || member.status !== 'active' || member.agentAgentId !== wf.agentId) return null
  if (!(await memberCanUseWorkflow(db, wf.agentId, memberId, wf.workflowId))) return null
  return { agentId: wf.agentId, workflowId: wf.workflowId, memberId }
}

async function localeOf(db: Db, userId: string): Promise<string> {
  const s = await db.settings.findUnique({ where: { id: userId }, select: { locale: true } })
  const l = (s?.locale ?? 'en').slice(0, 2).toLowerCase()
  return ['en', 'de', 'fr', 'ko'].includes(l) ? l : 'en'
}

async function askedMoved(db: Db, s: ScanRow, asked: string[]): Promise<boolean> {
  const files = await db.workFile.findMany({ where: { id: { in: asked }, userId: s.userId, projectId: s.projectId }, select: { decisionState: true } })
  if (files.length !== asked.length || files.some((f) => f.decisionState !== 'pending')) return true
  for (const id of asked) {
    const hit = await db.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one FROM data_sheet_rows WHERE sheet_id IN (SELECT id FROM data_sheets WHERE project_id = ${s.projectId} AND user_id = ${s.userId}) AND row_data LIKE ${`%${id}%`} LIMIT 1`
    if (hit.length) return true
  }
  return false
}

const summaryOf = (c: Awaited<ReturnType<typeof ownerStates>>['counts'], cards: number): ScanSummary => ({ ...c, cards })

async function settle(d: ScanSortDeps, scan: ScanRow, attemptId: string | null, data: { status: string; summary?: ScanSummary; deferReason?: string | null; retryAt?: Date | null; failed?: boolean; changed?: boolean; stale?: { runs: number; left: number }; expired?: boolean }): Promise<boolean> {
  const now = new Date()
  const r = await d.db.workScan.updateMany({
    where: { id: scan.id, ...(attemptId ? { attemptId, status: 'sorting' } : { status: scan.status }), ...(data.expired ? { leaseUntil: { lt: now } } : {}) },
    data: {
      status: data.status, attemptId: null, leaseUntil: null,
      deferReason: data.deferReason ?? null, retryAt: data.retryAt ?? null,
      ...(data.summary ? { summary: data.summary as object } : {}),
      ...(data.failed ? { failedAt: now } : {}),
      ...(data.changed || data.status === 'done' ? { changedAt: now } : {}),
      ...(data.stale ? { staleRuns: data.stale.runs, staleLeft: data.stale.left } : { staleRuns: 0, staleLeft: null }),
    },
  })
  if (r.count !== 1) return false
  if (data.status === 'cancelled') await d.db.workScanFile.deleteMany({ where: { scanId: scan.id } })
  if (data.status === 'done' && data.summary) await pushOnce(d, scan, data.summary)
  return true
}

async function pushOnce(d: ScanSortDeps, scan: ScanRow, summary: ScanSummary): Promise<void> {
  let claimed = false
  try {
    const may = await uploaderMay(d.db, scan)
    if (!may) return
    const claim = await d.db.workScan.updateMany({ where: { id: scan.id, pushedAt: null }, data: { pushedAt: new Date() } })
    if (claim.count !== 1) return
    claimed = true
    if (await d.push({ userId: scan.userId, actor: scan.actor, agentId: may.agentId, scanId: scan.id, locale: await localeOf(d.db, scan.userId), summary })) return
  } catch (e) {
    console.error('[scan-sort] push', describeCaughtError(e))
  }
  if (claimed) await d.db.workScan.updateMany({ where: { id: scan.id }, data: { pushedAt: null } }).catch(() => {})
}

export interface ScanSortResult { closed: number; reclaimed: number; woke: number; started: string[] }

export async function processScanSorts(over: Partial<ScanSortDeps> & { wait?: boolean } = {}): Promise<ScanSortResult> {
  const d: ScanSortDeps = { ...defaults, ...over }
  const now = Date.now()
  const out: ScanSortResult = { closed: 0, reclaimed: 0, woke: 0, started: [] }

  const old = await d.db.workScan.findMany({ where: { status: 'open', createdAt: { lt: new Date(now - SCAN_OPEN_DAYS * 86_400_000) } }, take: 100 })
  for (const s of old) if (await settle(d, s, null, { status: 'cancelled' })) out.closed++

  const deps = await d.files()

  const expired = await d.db.workScan.findMany({ where: { status: 'sorting', leaseUntil: { lt: new Date(now) } }, take: 50 })
  for (const s of expired) {
    const st = await ownerStates(deps, s)
    let ok: boolean
    if (!st.fresh.length) ok = await settle(d, s, s.attemptId, { status: 'done', summary: summaryOf(st.counts, 0), expired: true })
    else {
      const runs = s.staleLeft !== null && st.fresh.length >= s.staleLeft ? s.staleRuns + 1 : 1
      ok = runs >= 2
        ? await settle(d, s, s.attemptId, { status: 'failed', failed: true, summary: summaryOf(st.counts, 0), expired: true })
        : await settle(d, s, s.attemptId, { status: 'ready', stale: { runs, left: st.fresh.length }, expired: true })
    }
    if (!ok) continue
    if (s.attemptId) running.delete(s.attemptId)
    out.reclaimed++
  }

  const busy = await d.db.workScan.findMany({ where: { status: 'deferred', deferReason: 'BUSY', retryAt: { lte: new Date(now) } }, take: 100 })
  const asking = await d.db.workScan.findMany({ where: { status: { in: ['done', 'failed'] }, summary: { path: ['questions'], gt: 0 }, id: { gt: questionCursor } }, orderBy: { id: 'asc' }, take: QUESTION_BATCH })
  questionCursor = asking.length < QUESTION_BATCH ? '' : asking[asking.length - 1].id
  for (const s of [...busy, ...asking]) {
    if (s.status === 'deferred') { if (await settle(d, s, null, { status: 'ready' })) out.woke++; continue }
    const asked = ((s.summary ?? {}) as Partial<ScanSummary>).questionFiles ?? []
    if (!asked.length) continue
    if (!(await askedMoved(d.db, s, asked))) continue
    const st = await ownerStates(deps, s)
    if (asked.every((f) => st.states.get(f) === 'question')) continue
    const cards = ((s.summary ?? {}) as Partial<ScanSummary>).cards ?? 0
    if (st.fresh.length) { if (await settle(d, s, null, { status: 'ready', changed: true, summary: summaryOf(st.counts, cards) })) out.woke++ }
    else if (s.status === 'failed') { if (await settle(d, s, null, { status: 'done', summary: summaryOf(st.counts, cards) })) out.woke++ }
    else await d.db.workScan.updateMany({ where: { id: s.id, status: s.status }, data: { summary: summaryOf(st.counts, cards) as object } })
  }

  const unsent = await d.db.workScan.findMany({ where: { status: 'done', pushedAt: null, summary: { not: Prisma.DbNull }, changedAt: { gt: new Date(now - 86_400_000) } }, take: 20 })
  for (const s of unsent) await pushOnce(d, s, s.summary as unknown as ScanSummary)

  const free = MAX_PARALLEL - running.size
  if (free <= 0) return out
  const ready = await d.db.workScan.findMany({ where: { status: 'ready', completedAt: { not: null }, changedAt: { lte: new Date(now - SCAN_SETTLE_MS) } }, orderBy: { changedAt: 'asc' }, take: free * 3 })
  const jobs: Promise<void>[] = []
  for (const s of ready) {
    if (jobs.length >= free) continue
    const started = await grab(d, deps, s)
    if (!started) continue
    out.started.push(s.id)
    jobs.push(started.job)
  }
  if (over.wait) await Promise.all(jobs)
  return out
}

async function refillPages(deps: WorkFileDeps, scan: ScanRow, owners: string[], workflowId: string): Promise<void> {
  const pdfs = await deps.db.workFile.findMany({ where: { id: { in: owners }, userId: scan.userId, mimeType: 'application/pdf', parentFileId: null }, select: { id: true, payload: true, _count: { select: { derived: true } } } })
  const missing = pdfs.filter((f) => f._count.derived === 0)
  if (!missing.length) return
  const key = await deps.dataKey(deps.db, scan.userId)
  for (const f of missing) {
    try {
      const actor = { type: 'ai' as const, workflowId }
      const r = await readProjectFile(deps, { userId: scan.userId, fileId: f.id, actor })
      const { originalName } = decryptJson<{ originalName: string }>(f.payload, key)
      await ensurePdfPages(deps, { userId: scan.userId, projectId: scan.projectId, fileId: f.id, mimeType: 'application/pdf', parentFileId: null, buffer: r.buffer, originalName, actor })
    } catch (e) {
      console.error('[scan-sort] refill pages', describeCaughtError(e))
    }
  }
}

async function grab(d: ScanSortDeps, deps: WorkFileDeps, s: ScanRow): Promise<{ job: Promise<void> } | null> {
  const may = await uploaderMay(d.db, s)
  if (!may) { await settle(d, s, null, { status: 'cancelled' }); return null }
  const before = await ownerStates(deps, s)
  if (before.fresh.length) await refillPages(deps, s, before.fresh, may.workflowId)
  const st = before.fresh.length ? await ownerStates(deps, s) : before
  if (!st.fresh.length) { await settle(d, s, null, { status: 'done', summary: summaryOf(st.counts, 0) }); return null }
  if (hasOpenPersonRun(s.projectId)) {
    await settle(d, s, null, { status: 'deferred', deferReason: 'BUSY', retryAt: new Date(Date.now() + SCAN_BUSY_RETRY_MS) })
    return null
  }

  const attemptId = randomUUID()
  const took = await d.db.workScan.updateMany({
    where: { id: s.id, status: 'ready', changedAt: s.changedAt },
    data: { status: 'sorting', attempt: { increment: 1 }, attemptId, leaseUntil: new Date(Date.now() + SCAN_LEASE_MS), deferReason: null, retryAt: null },
  })
  if (took.count !== 1) return null
  running.add(attemptId)
  return { job: runAttempt(d, deps, { ...s, status: 'sorting' }, attemptId, st.fresh, st.linked, may) }
}

const SORT_TEXT: Record<string, (n: number) => string> = {
  en: (n) => `Please sort the files from my phone scan (${n}).`,
  de: (n) => `Bitte ordne die Dateien aus meinem Handy-Scan (${n}).`,
  fr: (n) => `Merci de trier les fichiers de mon scan mobile (${n}).`,
  ko: (n) => `휴대폰으로 스캔한 파일 ${n}개를 정리해 주세요.`,
}

const FORM_HINT: Record<ScanForm, string> = {
  receipts: 'They are receipts or received invoices.',
  claims: 'They are receipts for an employee expense claim — after the rows are in, put the expense claim card if this app offers one.',
  statement: 'They are bank or card statements — propose importing them into the Bank ledger (the import card); do not type statement lines as rows by hand.',
  chart: 'It is a trial balance or a list of accounts — propose the chart of accounts card.',
  myforms: 'They are personal documents for the forms of this app. Choose for each document the form it belongs to; if no form fits, or two fit equally well, decide it pending with one short question — do not put it into the only form there is just because it is the only one.',
}

function sortNote(form: ScanForm, allowed: string[], chosen: { name: string; sheetId: string } | 'deleted' | null = null, company: readonly string[] = []): string {
  return [
    '[Phone scan — this turn was started by the server; the person is not watching and will review on the phone]',
    `Sort ONLY these files: ${allowed.map((f) => `fileId ${f}`).join(', ')}.`,
    chosen === 'deleted'
      ? 'The person chose a form for these documents, but that form was deleted since. Put NO rows: decide every file pending with one short question (which form to use, or a new form).'
      : chosen
      ? `The person chose the form «${chosen.name}» (sheet id ${chosen.sheetId}) for these documents. Put them there; if a document clearly is not such a document, decide it pending with one short question instead.`
      : FORM_HINT[form],
    ...(company.length ? [`The person says these files ARE documents of this business: ${company.map((f) => `fileId ${f}`).join(', ')}. Do not exclude them as not_business, other_company or not_expense again — put the rows, or decide pending with one short question when a fact is missing.`] : []),
    'Other files of this app belong to other uploads — do not read, decide or put them on cards (the tools refuse them).',
    'Read the files with work_read_documents, then decide every one of them with work_file_decisions: rows, excluded with a reason, or pending with one short question when only the person knows the fact. Never guess a value.',
    'Put all rows of one file in one work_insert_rows call.',
    'Answer briefly: what was added, what was excluded and why, and the open questions.',
    'Write that answer once, at the very end after all tool calls. Do not write a summary before or between tool calls.',
  ].join('\n')
}

async function chosenForm(db: Db, s: ScanRow): Promise<{ name: string; sheetId: string } | 'deleted' | null> {
  if (!s.formId) return null
  const f = await db.workForm.findFirst({ where: { id: s.formId, userId: s.userId }, select: { name: true, sheetId: true, deletedAt: true } })
  return !f || f.deletedAt ? 'deleted' : { name: f.name, sheetId: f.sheetId }
}

async function runAttempt(d: ScanSortDeps, deps: WorkFileDeps, s: ScanRow, attemptId: string, allowed: string[], linked: string[], may: { agentId: string; workflowId: string; memberId?: number }): Promise<void> {
  const mine = async () => (await d.db.workScan.count({ where: { id: s.id, attemptId, status: 'sorting' } })) === 1
  const lease = setInterval(() => {
    d.db.workScan.updateMany({ where: { id: s.id, attemptId, status: 'sorting' }, data: { leaseUntil: new Date(Date.now() + SCAN_LEASE_MS) } })
      .catch((e) => console.error('[scan-sort] lease', describeCaughtError(e)))
  }, LEASE_RENEW_MS)
  lease.unref?.()
  try {
    const actor = may.memberId === undefined ? { type: 'human' as const } : { type: 'human' as const, memberId: may.memberId }
    const locale = await localeOf(d.db, s.userId)
    const turn = await d.runTurn({
      access: { userId: s.userId, agentId: may.agentId, isOwner: may.memberId === undefined, actor },
      workflowId: may.workflowId, view: privateRoomOf(actor), taskId: null,
      text: (SORT_TEXT[locale] ?? SORT_TEXT.en)(allowed.length), fileIds: [], parts: [],
      scan: { scanId: s.id, attemptId, allowed, linked }, aiNote: sortNote(s.form as ScanForm, allowed, await chosenForm(d.db, s), (await d.db.workScanFile.findMany({ where: { scanId: s.id, fileId: { in: allowed }, hint: 'company' }, select: { fileId: true } })).map((x) => x.fileId)), mayWrite: mine,
    })
    if (turn.refused) {
      await settle(d, s, attemptId, { status: 'deferred', deferReason: turn.refused.error === 'INSUFFICIENT_CPA' ? 'NO_CREDIT' : 'BLOCKED' })
      return
    }
    const body = turn.response.body
    if (body) { const r = body.getReader(); while (!(await r.read()).done) { } }
    const end = await turn.finished
    await afterTurn(end.proposals.length)
  } catch (e) {
    console.error('[scan-sort] turn', describeCaughtError(e))
    await afterTurn(0).catch(async (x) => {
      console.error('[scan-sort] after turn', describeCaughtError(x))
      await settle(d, s, attemptId, { status: 'failed', failed: true }).catch((y) => console.error('[scan-sort] mark failed', describeCaughtError(y)))
    })
  } finally {
    clearInterval(lease)
    endScanAttempt(attemptId)
    running.delete(attemptId)
  }

  async function afterTurn(cards: number): Promise<void> {
    const st = await ownerStates(deps, s)
    const left = st.fresh.filter((f) => allowed.includes(f))
    const summary = summaryOf(st.counts, cards)
    if (left.length) await settle(d, s, attemptId, { status: 'failed', failed: true, summary })
    else if (st.fresh.length) await settle(d, s, attemptId, { status: 'ready', changed: true, summary })
    else await settle(d, s, attemptId, { status: 'done', summary })
  }
}

const PUSH_TEXT: Record<string, { title: string; body: (s: ScanSummary) => string }> = {
  en: { title: 'Scan sorted', body: (s) => `${s.lines} added · ${s.excluded + s.unreadable} left out · ${s.questions} questions` },
  de: { title: 'Scan sortiert', body: (s) => `${s.lines} erfasst · ${s.excluded + s.unreadable} ausgelassen · ${s.questions} Fragen` },
  fr: { title: 'Scan trié', body: (s) => `${s.lines} saisis · ${s.excluded + s.unreadable} écartés · ${s.questions} questions` },
  ko: { title: '스캔 정리 끝', body: (s) => `넣음 ${s.lines} · 뺌 ${s.excluded + s.unreadable} · 질문 ${s.questions}` },
}

async function pushScanDone(q: { userId: string; actor: string; agentId: string; scanId: string; locale: string; summary: ScanSummary }): Promise<boolean> {
  const { loadFcmConfig, getAccessToken, sendToToken } = await import('@/lib/miniapp/push')
  const sa = await loadFcmConfig()
  if (!sa) return true
  const m = /^member:(\d+)$/.exec(q.actor)
  const tokens = await prisma.appPushToken.findMany({ where: { enabled: true, ...(m ? { agentMemberId: Number(m[1]) } : { userId: q.userId }) }, select: { id: true, token: true } })
  if (!tokens.length) return true
  const t = PUSH_TEXT[q.locale] ?? PUSH_TEXT.en
  const access = await getAccessToken(sa)
  let sent = false
  let retry = false
  for (const tk of tokens) {
    try {
      const r = await sendToToken(sa, access, tk.token, { title: t.title, body: t.body(q.summary) }, { type: 'work_scan', scanId: q.scanId, agentId: q.agentId }, { channelId: 'scan', tag: `scan-${q.scanId}` })
      if (r.ok) sent = true
      else if (r.status === 'invalid_token') await prisma.appPushToken.update({ where: { id: tk.id }, data: { enabled: false } }).catch(() => {})
      else retry = true
    } catch (e) {
      console.error('[scan-sort] push token', describeCaughtError(e))
      retry = true
    }
  }
  return sent || !retry
}
