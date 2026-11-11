import { WorkError } from './errors'
import { findTemplate } from './sheet-templates'
import { decodeRow, lockProjectForShare, openProjectSheetWriter, personOf, type ProjectSheetWriter, type SheetActor } from './sheet-gate'
import { moduleNoticeOf, writeWorkNotice } from './notices'
import { runWorkModule } from './module-registry'
import type { WorkFileDeps } from './files'
import { LEDGER_EXPLANATIONS, LEDGER_PROPOSE, explFingerprints, findLedgerPair, linkFingerprint, normalizeLinkItems, normalizeOwn, readLinkState, sameLink, type LedgerLinkCard, type LedgerLinkItem, type LedgerLinkSkip } from './ledger-link'

const TX_TIMEOUT_MS = 30_000

export async function applyLedgerLink(
  deps: WorkFileDeps,
  q: { userId: string; projectId: string; actor: SheetActor; card: LedgerLinkCard },
): Promise<{ linked: number; skipped: LedgerLinkSkip[] }> {
  if (q.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person links bank lines')
  const card = q.card
  const key = await deps.dataKey(deps.db, q.userId)
  return deps.db.$transaction(async (tx) => {
    const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${q.userId} FOR SHARE`
    if (u.length === 0) throw new WorkError('NOT_FOUND')
    if (card.ledgerProjectId === q.projectId) throw new WorkError('INVALID')
    const explSheets = await tx.dataSheet.findMany({ where: { projectId: card.ledgerProjectId, userId: q.userId, kind: 'project' }, select: { id: true, template: true } })
    const explIds = explSheets.filter((s) => s.template && findTemplate(deps.templates, s.template)?.family === LEDGER_EXPLANATIONS).map((s) => s.id)
    if (explIds.length !== 1) throw new WorkError('STALE', 'the Bank ledger has no explanations sheet')
    const ownRows = Array.isArray(card.own) && card.own.length
      ? await tx.dataSheetRow.findMany({ where: { id: { in: card.own.map((u) => u.rowId) }, projectId: q.projectId, userId: q.userId }, select: { id: true, sheetId: true } })
      : []
    let human: ProjectSheetWriter | null = null
    let mine: ProjectSheetWriter | null = null
    for (const id of [q.projectId, card.ledgerProjectId].sort()) {
      if (id === card.ledgerProjectId) human = await openProjectSheetWriter(tx, deps, key, { userId: q.userId, projectId: id, sheetIds: explIds, actor: q.actor })
      else if (ownRows.length) mine = await openProjectSheetWriter(tx, deps, key, { userId: q.userId, projectId: id, sheetIds: [...new Set(ownRows.map((r) => r.sheetId))], actor: q.actor })
      else await lockProjectForShare(tx, q.userId, id)
    }
    const w = human!
    w.manageChecks()
    const pair = await findLedgerPair(tx, q)
    if ('need' in pair || pair.ledgerProjectId !== card.ledgerProjectId) throw new WorkError('STALE', 'the reference lines changed')
    const items = normalizeLinkItems(pair.appKind, card.items)
    const own = normalizeOwn(card.own, items)
    const st = await readLinkState(deps, { userId: q.userId, projectId: q.projectId, ledgerProjectId: card.ledgerProjectId, items })
    if (!Array.isArray(card.expl) || card.expl.length !== items.length) throw new WorkError('STALE', 'an old card — ask the AI again')
    if (linkFingerprint(key, { projectId: q.projectId, ledgerProjectId: card.ledgerProjectId, items, expl: card.expl, own }, st) !== card.fingerprint) throw new WorkError('STALE', 'the bank lines or the targets changed after the card was made')
    const now = explFingerprints(key, items, st)
    const skipped: LedgerLinkSkip[] = []
    const todo: LedgerLinkItem[] = []
    items.forEach((it, i) => {
      const s = st.lines.get(`${it.accountKey}|${it.lineKey}`)!
      if (s.expl?.confirmed) {
        if (!sameLink(it, s.expl.data)) throw new WorkError('STALE', 'a bank line was explained differently in the Bank ledger')
        skipped.push({ accountKey: it.accountKey, lineKey: it.lineKey, reason: 'confirmed' })
        return
      }
      if (now[i] !== card.expl[i]) throw new WorkError('STALE', 'the Bank ledger changed an explanation after the card was made')
      todo.push(it)
    })
    if (todo.length === 0) return { linked: 0, skipped }
    const out = await runWorkModule(deps, {
      userId: q.userId, projectId: card.ledgerProjectId, moduleId: LEDGER_PROPOSE, input: { items: todo.map(({ chosen: _shown, ...it }) => it) }, by: q.actor,
      writeIn: (req, actor) => openProjectSheetWriter(tx, deps, key, { userId: q.userId, projectId: card.ledgerProjectId, sheetIds: req.sheetIds, actor, ...(req.taskId ? { taskId: req.taskId } : {}), ...(req.exception ? { exception: req.exception } : {}) }),
    }) as { results?: Array<{ accountKey: string; lineKey: string; result: string; reason?: string; rowId?: string }> }
    const rowIds: string[] = []
    for (const r of out.results ?? []) {
      if (r.result === 'skipped' || !r.rowId) skipped.push({ accountKey: r.accountKey, lineKey: r.lineKey, reason: r.reason ?? 'skipped' })
      else rowIds.push(r.rowId)
    }
    if (rowIds.length > 0) await w.confirmRows(rowIds, { onFail: 'throw' })
    await w.finishChecks()
    if (mine && own.length) {
      const linkedLines = new Set((out.results ?? []).filter((r) => r.result !== 'skipped' && r.rowId).map((r) => `${r.accountKey}|${r.lineKey}`))
      const linkedTargets = new Set(todo.filter((it) => linkedLines.has(`${it.accountKey}|${it.lineKey}`)).flatMap((it) => it.allocations.map((a) => a.rowId)))
      const sheetOf = new Map(ownRows.map((r) => [r.id, r.sheetId]))
      mine.manageChecks()
      for (const u of own) {
        const sheetId = sheetOf.get(u.rowId)
        if (!sheetId || !linkedTargets.has(u.rowId)) continue
        await mine.update(sheetId, u.rowId, u.patch, { confirm: u.confirm })
      }
      await mine.finishChecks()
      await mine.writeNotices()
    }
    const doneLines = new Set((out.results ?? []).filter((r) => r.result !== 'skipped' && r.rowId).map((r) => `${r.accountKey}|${r.lineKey}`))
    const targetIds = [...new Set(todo.filter((it) => doneLines.has(`${it.accountKey}|${it.lineKey}`)).flatMap((it) => it.allocations.map((a) => a.rowId)))]
    if (targetIds.length) {
      const rows = await tx.dataSheetRow.findMany({ where: { id: { in: targetIds }, projectId: q.projectId, userId: q.userId } })
      const sheets = await tx.dataSheet.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sheetId))] }, userId: q.userId }, select: { id: true, template: true } })
      const p = personOf(q.actor)
      const by = p ? (p.owner ? 'human' : `member:${p.memberId}`) : undefined
      for (const r of rows) {
        const tpl = sheets.find((s) => s.id === r.sheetId)?.template
        const hook = tpl ? findTemplate(deps.templates, tpl)?.rowNotice : undefined
        if (!hook) continue
        const data = decodeRow(r, key).data
        let n = null
        try { n = moduleNoticeOf({ notice: hook({ action: 'linked', before: data, after: data }) }) } catch { n = null }
        if (n) await writeWorkNotice(tx, key, { userId: q.userId, projectId: q.projectId, notice: { ...n, ...(by ? { by } : {}) }, ...(by ? { alsoPrivate: by } : {}) })
      }
    }
    return { linked: rowIds.length, skipped }
  }, { timeout: TX_TIMEOUT_MS })
}
