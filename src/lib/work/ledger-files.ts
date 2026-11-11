import { WorkError } from './errors'
import { isCalendarDate } from './dates'
import { decryptJson, encryptJson } from './sealed'
import { recordWorkAppProposal, type WorkAppProposal } from './app-scope'
import { assertScanCardFiles } from './scan'
import { findLedgerPair } from './ledger-link'
import { linkedApps } from './linked-apps'
import { writeWorkEvent } from './projects'
import { assertProjectWritable, lockProjectForShare, lockProjectForWrite, openProjectSheetWriter, type SheetActor } from './sheet-gate'
import { workFileBlobPath, type WorkFileDeps } from './files'
import type { StoredDecision } from './file-decisions'
import { describeCaughtError } from '@/lib/log-mask'
import { blobRef } from '@/lib/managed/blob-storage'
import { visibleTo } from './app-chat'

export const LEDGER_FILES_MAX = 20
const TX_TIMEOUT_MS = 30_000

export type LedgerFilesCard = Extract<WorkAppProposal, { type: 'ledger_files' }>

async function readSources(deps: WorkFileDeps, q: { userId: string; projectId: string; ledgerProjectId: string; fileIds: readonly string[] }) {
  const rows = await deps.db.workFile.findMany({ where: { id: { in: [...q.fileIds] }, projectId: q.projectId, userId: q.userId, parentFileId: null }, select: { id: true, sha256: true, payload: true } })
  const inLedger = new Set((await deps.db.workFile.findMany({ where: { projectId: q.ledgerProjectId, userId: q.userId, sha256: { in: rows.map((r) => r.sha256) } }, select: { sha256: true } })).map((r) => r.sha256))
  const key = await deps.dataKey(deps.db, q.userId)
  const byId = new Map(rows.map((r) => [r.id, r]))
  return q.fileIds.flatMap((id) => {
    const r = byId.get(id)
    return r ? [{ fileId: id, name: decryptJson<{ originalName: string }>(r.payload, key).originalName.slice(0, 200), inLedger: inLedger.has(r.sha256) }] : []
  })
}

async function ledgerUrl(deps: WorkFileDeps, q: { userId: string; projectId: string }): Promise<string | null> {
  return (await linkedApps(deps.db, q)).find((a) => a.kind === 'ledger')?.url ?? null
}

export async function proposeLedgerFiles(deps: WorkFileDeps, q: { userId: string; projectId: string; runId: string; fileIds: readonly string[] }): Promise<{ proposed: boolean; files: string[]; already: string[]; setup?: string[] }> {
  const ids = [...new Set(q.fileIds)]
  if (ids.length === 0) return { proposed: false, files: [], already: [] }
  const pair = await findLedgerPair(deps.db, q)
  if ('need' in pair) return { proposed: false, files: [], already: [], setup: pair.need }
  const src = await readSources(deps, { ...q, ledgerProjectId: pair.ledgerProjectId, fileIds: ids })
  const send = src.filter((f) => !f.inLedger)
  const already = src.filter((f) => f.inLedger).map((f) => f.fileId)
  if (send.length === 0) return { proposed: false, files: [], already }
  const url = await ledgerUrl(deps, q)
  for (let i = 0; i < send.length; i += LEDGER_FILES_MAX) {
    const card: LedgerFilesCard = { type: 'ledger_files', ledgerProjectId: pair.ledgerProjectId, files: send.slice(i, i + LEDGER_FILES_MAX).map(({ fileId, name }) => ({ fileId, name })), ledgerUrl: url }
    if (!recordWorkAppProposal(q.runId, card)) throw new WorkError('INVALID', 'no open conversation turn to show the card in')
  }
  return { proposed: true, files: send.map((f) => f.fileId), already }
}

export async function storedLedgerFilesCard(deps: WorkFileDeps, q: { userId: string; projectId: string; messageId: string; index: number; reader: string | null }): Promise<LedgerFilesCard> {
  const m = await deps.db.workMessage.findFirst({ where: { id: q.messageId, projectId: q.projectId, userId: q.userId, role: 'assistant', ...visibleTo(q.reader) }, select: { body: true } })
  if (!m) throw new WorkError('NOT_FOUND')
  const body = decryptJson<{ proposals?: WorkAppProposal[]; scan?: string }>(m.body, await deps.dataKey(deps.db, q.userId))
  const p = body.proposals?.[q.index]
  if (!p || p.type !== 'ledger_files') throw new WorkError('NOT_FOUND')
  if (body.scan) await assertScanCardFiles(deps, { userId: q.userId, projectId: q.projectId, scanId: body.scan, fileIds: p.files.map((f) => f.fileId) })
  return p
}

interface Copy { region: string; blobPath: string }

export async function applyLedgerFiles(deps: WorkFileDeps, q: { userId: string; projectId: string; actor: SheetActor; card: LedgerFilesCard }): Promise<{ sent: number; already: number; gone: number; ledgerUrl: string | null }> {
  if (q.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person sends files to the Bank ledger')
  const card = q.card
  if (card.ledgerProjectId === q.projectId) throw new WorkError('INVALID')
  if (!Array.isArray(card.files) || card.files.length === 0 || card.files.length > LEDGER_FILES_MAX) throw new WorkError('INVALID', 'an old card — ask the AI again')
  const pair0 = await findLedgerPair(deps.db, q)
  if ('need' in pair0 || pair0.ledgerProjectId !== card.ledgerProjectId) throw new WorkError('STALE', 'the reference lines changed')
  const ids = [...new Set(card.files.map((f) => f.fileId))]
  const sources = await deps.db.workFile.findMany({ where: { id: { in: ids }, projectId: q.projectId, userId: q.userId, parentFileId: null } })
  const pages = await deps.db.workFile.findMany({ where: { parentFileId: { in: sources.map((s) => s.id) }, projectId: q.projectId, userId: q.userId }, orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }] })
  const have = new Set((await deps.db.workFile.findMany({ where: { projectId: card.ledgerProjectId, userId: q.userId, sha256: { in: sources.map((s) => s.sha256) } }, select: { sha256: true } })).map((r) => r.sha256))
  const todo = sources.filter((s) => !have.has(s.sha256))
  const copies = new Map<string, Copy>()
  const uploaded: Copy[] = []
  const discard = async () => {
    for (const c of uploaded) {
      try { await deps.blob.delete(c.region, c.blobPath) } catch (e) { console.error(`[work] 보상 삭제 실패 — 고아 blob ${blobRef(c.blobPath)}:`, describeCaughtError(e)) }
    }
  }
  try {
    for (const f of [...todo, ...pages.filter((p) => todo.some((t) => t.id === p.parentFileId))]) {
      const { buffer } = await deps.blob.download(f.blobRegion, f.blobPath)
      const c = { region: f.blobRegion, blobPath: workFileBlobPath(q.userId, card.ledgerProjectId, f.sha256) }
      await deps.blob.upload(c.region, c.blobPath, buffer, 'application/octet-stream')
      uploaded.push(c)
      copies.set(f.id, c)
    }
    const key = await deps.dataKey(deps.db, q.userId)
    const out = await deps.db.$transaction(async (tx) => {
      const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${q.userId} FOR SHARE`
      if (u.length === 0) throw new WorkError('NOT_FOUND')
      for (const id of [q.projectId, card.ledgerProjectId].sort()) {
        if (id === card.ledgerProjectId) assertProjectWritable(await lockProjectForWrite(tx, q.userId, id))
        else await lockProjectForShare(tx, q.userId, id)
      }
      const pair = await findLedgerPair(tx, q)
      if ('need' in pair || pair.ledgerProjectId !== card.ledgerProjectId) throw new WorkError('STALE', 'the reference lines changed')
      const now = await tx.workFile.findMany({ where: { id: { in: sources.map((x) => x.id) }, projectId: q.projectId, userId: q.userId }, select: { id: true, decision: true, decisionState: true } })
      const alive = new Set(now.map((f) => f.id))
      let sent = 0
      const used = new Set<string>()
      for (const s of todo) {
        if (!alive.has(s.id)) continue
        if (await tx.workFile.findUnique({ where: { projectId_sha256: { projectId: card.ledgerProjectId, sha256: s.sha256 } }, select: { id: true } })) continue
        const c = copies.get(s.id)!
        const file = await tx.workFile.create({
          data: {
            projectId: card.ledgerProjectId, userId: q.userId, kind: s.kind, blobRegion: c.region, blobPath: c.blobPath, mimeType: s.mimeType, sizeBytes: s.sizeBytes, sha256: s.sha256, payload: s.payload,
            ...(s.readText ? { readText: s.readText } : {}),
            ...(s.readCard && s.readCardState ? { readCard: s.readCard, readCardState: s.readCardState, readCardV: s.readCardV } : {}),
          },
        })
        used.add(s.id)
        await writeWorkEvent(tx, key, { userId: q.userId, projectId: card.ledgerProjectId, fileId: file.id, actor: q.actor, action: 'file_upload' })
        for (const pg of pages.filter((p) => p.parentFileId === s.id)) {
          if (await tx.workFile.findUnique({ where: { projectId_sha256: { projectId: card.ledgerProjectId, sha256: pg.sha256 } }, select: { id: true } })) continue
          const pc = copies.get(pg.id)!
          await tx.workFile.create({ data: { projectId: card.ledgerProjectId, userId: q.userId, kind: pg.kind, parentFileId: file.id, blobRegion: pc.region, blobPath: pc.blobPath, mimeType: pg.mimeType, sizeBytes: pg.sizeBytes, sha256: pg.sha256, payload: pg.payload } })
          used.add(pg.id)
        }
        sent++
      }
      const note: StoredDecision = { kind: 'excluded', reason: 'statement', text: 'sent to the Bank ledger', by: 'human', at: new Date().toISOString() }
      for (const f of now) {
        if (f.decisionState === 'row') continue
        let was: StoredDecision | null = null
        if (f.decision) { try { was = decryptJson<StoredDecision>(f.decision, key) } catch { was = null } }
        if (was && was.by === 'human' && !(was.kind === 'excluded' && was.reason === 'statement')) continue
        await tx.workFile.update({ where: { id: f.id }, data: { decision: encryptJson(note, key), decisionState: 'excluded' } })
      }
      return { sent, used, alive: now.length }
    }, { timeout: TX_TIMEOUT_MS })
    const unused = [...copies.entries()].filter(([id]) => !out.used.has(id)).map(([, c]) => c)
    uploaded.length = 0
    uploaded.push(...unused)
    await discard()
    return { sent: out.sent, already: out.alive - out.sent, gone: ids.length - out.alive, ledgerUrl: await ledgerUrl(deps, q) }
  } catch (e) {
    await discard()
    throw e
  }
}

//

export const STATEMENT_IMPORT_KINDS: ReadonlySet<string> = new Set(['receipts'])
const LEDGER_ACCOUNTS = 'ledger.accounts'
const STATEMENT_BANKS = ['ubs', 'wise', 'revolut', 'other']
export type LedgerStatementCard = Extract<WorkAppProposal, { type: 'ledger_statement' }>

const cents = (v: unknown): bigint | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const m = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/.exec(String(v).trim())
  if (!m) return null
  const c = BigInt(m[2]) * BigInt(100) + BigInt((m[3] ?? '').padEnd(2, '0') || '0')
  return m[1] ? -c : c
}
const fmt = (c: bigint) => { const a = c < BigInt(0) ? -c : c; return `${c < BigInt(0) ? '-' : ''}${a / BigInt(100)}.${String(a % BigInt(100)).padStart(2, '0')}` }

export async function proposeLedgerStatement(
  deps: WorkFileDeps,
  q: { userId: string; projectId: string; runId: string; fileId: string; statement: unknown; account: unknown },
): Promise<{ proposed: boolean; adds?: 'ok' | 'rounding' | 'off'; diff?: string; lines?: number; setup?: string[] }> {
  const pair = await findLedgerPair(deps.db, q)
  if ('need' in pair) return { proposed: false, setup: pair.need }
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const s = q.statement
  if (!isObj(s) || typeof s.currency !== 'string' || !/^[A-Z]{3}$/.test(s.currency) || typeof s.from !== 'string' || typeof s.until !== 'string' || !Array.isArray(s.lines) || s.lines.length > 500) throw new WorkError('INVALID', 'statement must be { currency, from, until, opening, closing, lines } — see the tool description')
  const opening = cents(s.opening)
  const closing = cents(s.closing)
  if (opening === null || closing === null) throw new WorkError('INVALID', 'statement opening and closing must be amounts (negative when money is owed on a card)')
  const day = (v: unknown): v is string => typeof v === 'string' && isCalendarDate(v)
  if (!day(s.from) || !day(s.until) || s.from > s.until) throw new WorkError('INVALID', 'statement from / until must be dates YYYY-MM-DD (from not after until) — read the period again from the statement')
  let sum = opening
  for (const [i, l] of (s.lines as unknown[]).entries()) {
    const a = isObj(l) ? cents(l.amount) : null
    if (!isObj(l) || a === null || a <= BigInt(0) || (l.direction !== 'in' && l.direction !== 'out')) throw new WorkError('INVALID', `statement lines[${i}] needs date, amount above 0 and direction in or out`)
    if (!day(l.date) || l.date < (s.from as string) || l.date > (s.until as string)) throw new WorkError('INVALID', `statement lines[${i}].date must be a date YYYY-MM-DD inside from … until — every line of a statement has a printed date (the payment to the card too); read that line again in the full text (work_read_files) and never leave it empty or ask the person for it`)
    if (l.card != null && l.card !== '' && !(typeof l.card === 'string' && /^\d{4}$/.test(l.card.trim()))) throw new WorkError('INVALID', `statement lines[${i}].card must be the last four digits of the card (never the full card number)`)
    if (l.cardHolder != null && (typeof l.cardHolder !== 'string' || /\d{5,}/.test(l.cardHolder.replace(/[\s\-.]/g, '')))) throw new WorkError('INVALID', `statement lines[${i}].cardHolder must be the name printed for the card — no card numbers`)
    sum += l.direction === 'in' ? a : -a
  }
  const a = q.account
  if (!isObj(a)) throw new WorkError('INVALID', 'account = { type, last4 (card) or iban (bank), bank, label }')
  if (a.type !== undefined && a.type !== 'card' && a.type !== 'bank') throw new WorkError('INVALID', 'account.type must be card or bank')
  const type = a.type === 'bank' || (a.type === undefined && typeof a.iban === 'string') ? 'bank' as const : 'card' as const
  const iban = type === 'bank' && typeof a.iban === 'string' ? a.iban.replace(/\s/g, '').toUpperCase() : ''
  if (type === 'card' && (typeof a.last4 !== 'string' || !/^\d{4}$/.test(a.last4))) throw new WorkError('INVALID', 'account.last4 = the last four digits of the card account (never the full card number)')
  if (type === 'bank' && !/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) throw new WorkError('INVALID', 'account.iban = the IBAN printed on the bank statement')
  const last4 = type === 'card' ? a.last4 as string : iban.slice(-4)
  const bank = typeof a.bank === 'string' && STATEMENT_BANKS.includes(a.bank) ? a.bank : 'other'
  const rawLabel = typeof a.label === 'string' ? a.label.trim().slice(0, 120) : ''
  const label = /\d{12,}/.test(rawLabel.replace(/[\s\-.]/g, '')) ? '' : rawLabel
  const diff = closing - sum
  const abs = diff < BigInt(0) ? -diff : diff
  const adds = abs === BigInt(0) ? 'ok' as const : abs <= BigInt(5) ? 'rounding' as const : 'off' as const
  if (adds === 'off') return { proposed: false, adds, diff: fmt(diff), lines: s.lines.length }
  const file = await deps.db.workFile.findFirst({ where: { id: q.fileId, projectId: q.projectId, userId: q.userId, parentFileId: null }, select: { sha256: true, payload: true } })
  if (!file) throw new WorkError('NOT_FOUND', 'fileId is not a saved file of this work app')
  const key = await deps.dataKey(deps.db, q.userId)
  const card: LedgerStatementCard = {
    type: 'ledger_statement', ledgerProjectId: pair.ledgerProjectId, fileId: q.fileId,
    fileName: decryptJson<{ originalName: string }>(file.payload, key).originalName.slice(0, 200),
    statement: s, account: { type, last4, ...(type === 'bank' ? { iban } : {}), currency: s.currency, bank, label },
    summary: { lines: s.lines.length, from: s.from, until: s.until, opening: fmt(opening), closing: fmt(closing), ...(adds === 'rounding' ? { rounding: fmt(diff < BigInt(0) ? -diff : diff) } : {}) },
  }
  if (!recordWorkAppProposal(q.runId, card)) throw new WorkError('INVALID', 'no open conversation turn to show the card in')
  return { proposed: true, adds, ...(adds === 'rounding' ? { diff: fmt(diff) } : {}), lines: s.lines.length }
}

export async function storedLedgerStatementCard(deps: WorkFileDeps, q: { userId: string; projectId: string; messageId: string; index: number; reader: string | null }): Promise<LedgerStatementCard> {
  const m = await deps.db.workMessage.findFirst({ where: { id: q.messageId, projectId: q.projectId, userId: q.userId, role: 'assistant', ...visibleTo(q.reader) }, select: { body: true } })
  if (!m) throw new WorkError('NOT_FOUND')
  const body = decryptJson<{ proposals?: WorkAppProposal[]; scan?: string }>(m.body, await deps.dataKey(deps.db, q.userId))
  const p = body.proposals?.[q.index]
  if (!p || p.type !== 'ledger_statement') throw new WorkError('NOT_FOUND')
  if (body.scan) await assertScanCardFiles(deps, { userId: q.userId, projectId: q.projectId, scanId: body.scan, fileIds: [p.fileId] })
  return p
}

export async function applyLedgerStatement(deps: WorkFileDeps, q: { userId: string; projectId: string; actor: SheetActor; card: LedgerStatementCard }): Promise<{ ledgerProjectId: string; fileId: string; fileName: string; reader: { statement: unknown }; accounts: Record<string, string>; accountCreated: boolean }> {
  if (q.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person imports a statement')
  const card = q.card
  const sent = await applyLedgerFiles(deps, { userId: q.userId, projectId: q.projectId, actor: q.actor, card: { type: 'ledger_files', ledgerProjectId: card.ledgerProjectId, files: [{ fileId: card.fileId, name: card.fileName }], ledgerUrl: null } })
  if (sent.gone > 0) throw new WorkError('NOT_FOUND', 'the statement file was deleted')
  const src = await deps.db.workFile.findFirst({ where: { id: card.fileId, projectId: q.projectId, userId: q.userId }, select: { sha256: true } })
  const lf = src && await deps.db.workFile.findFirst({ where: { projectId: card.ledgerProjectId, userId: q.userId, sha256: src.sha256, parentFileId: null }, select: { id: true } })
  if (!lf) throw new WorkError('STALE', 'the statement file is not in the Bank ledger')
  const key = await deps.dataKey(deps.db, q.userId)
  const sheets = await deps.db.dataSheet.findMany({ where: { projectId: card.ledgerProjectId, userId: q.userId, kind: 'project', templateFamily: LEDGER_ACCOUNTS }, select: { id: true } })
  if (sheets.length !== 1) throw new WorkError('STALE', 'the Bank ledger has no accounts sheet')
  const { last4, currency, bank, label } = card.account
  const type = card.account.type === 'bank' ? 'bank' : 'card'
  const iban = type === 'bank' ? card.account.iban ?? '' : ''
  const squash = (v: unknown) => (typeof v === 'string' ? v.replace(/\s/g, '').toUpperCase() : '')
  const { accountKey, created } = await deps.db.$transaction(async (tx) => {
    const w = await openProjectSheetWriter(tx, deps, key, { userId: q.userId, projectId: card.ledgerProjectId, sheetIds: [sheets[0].id], actor: q.actor })
    const rows = await w.rows(sheets[0].id)
    const same = rows.filter((r) => r.data.currency === currency && (type === 'card'
      ? r.data.type === 'card' && r.data.accountNumber === last4 && (r.data.bank ?? 'other') === bank
      : r.data.type !== 'card' && squash(r.data.accountNumber) === iban))
    if (same.length > 1) throw new WorkError('INVALID', `several accounts in the Bank ledger match (${same.map((r) => String(r.data.accountKey)).join(', ')}) — keep one`)
    if (same.length === 1) return { accountKey: String(same[0].data.accountKey), created: false }
    const taken = new Set(rows.map((r) => String(r.data.accountKey)))
    const base = `${type === 'card' ? 'CARD' : 'BANK'}-${bank.toUpperCase()}-${last4}-${currency}`
    let k = base
    for (let i = 2; taken.has(k); i++) k = `${base}-${i}`
    await w.insert(sheets[0].id, { accountKey: k, type, bank, currency, accountNumber: type === 'card' ? last4 : iban, ...(label ? { label } : {}) })
    return { accountKey: k, created: true }
  }, { timeout: TX_TIMEOUT_MS })
  return { ledgerProjectId: card.ledgerProjectId, fileId: lf.id, fileName: card.fileName, reader: { statement: card.statement }, accounts: { [`${currency}|statement`]: accountKey }, accountCreated: created }
}
