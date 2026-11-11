
import { Prisma, PrismaClient } from '@prisma/client'
import { decryptBuffer, encryptBuffer } from '@/lib/encryption'
import { WorkError } from './errors'
import { encryptJson } from './sealed'
import { APP_WORKFLOW_KIND } from './app-canvas'
import { uniqueKeyHash } from './sheet-columns'
import { workFileBlobPath } from './files'
import { writeWorkEvent } from './projects'
import { ASSEMBLED_KIND, specNumberFloors, specSheetName, type AppSpec } from './assembled'
import { MYFORMS_KIND } from './myforms'
import { DOC_READ_MAX_PAGES, blockLooksDone, isPageRecList } from './doc-read'
import { docReadSetProblem } from './doc-find'

type Row = Record<string, unknown>
type Tx = Prisma.TransactionClient

export interface OriginalInput {
  db: PrismaClient
  userId: string
  key: Buffer
  region: string
  stagingPrefix: string
  manifest: Row
  table(dir: string, t: string): Row[]
  download(region: string, path: string): Promise<{ buffer: Buffer }>
  upload(region: string, path: string, data: Buffer): Promise<void>
  originalTx<T>(input: { userId: string; agentId: string; addsCanvas: boolean; body(tx: Tx): Promise<T> }): Promise<{ ok: true; value: T } | { ok: false; code: string; message?: string }>
  onCommit(tx: Tx, r: { projectIds: string[]; canvasId: string | null; names: Record<string, { name: string; kind: string }>; notRestored: string[] }): Promise<void>
}

export type OriginalOutcome =
  | { kind: 'done'; projectIds: string[]; canvasId: string | null; names: Record<string, { name: string; kind: string }>; notRestored: string[] }
  | { kind: 'copy'; reason: string }

const PROJECT_TABLES = ['work_project', 'work_app_spec', 'data_sheets', 'work_form', 'work_file', 'work_file_page_block', 'work_doc_find_block', 'data_sheet_rows', 'sheet_row_pair', 'work_task', 'work_submission', 'work_submission_source', 'work_submission_file', 'work_task_file', 'work_note', 'work_message', 'work_room_read', 'work_send', 'work_alert_fired', 'work_handoff_period', 'work_handoff', 'project_reference', 'work_event', 'work_public_link'] as const
const ID_TABLES = PROJECT_TABLES.filter((t) => t !== 'work_room_read')
const UPLOAD_WINDOW_MS = 10 * 60_000

async function columnsOf(tx: Tx, table: string): Promise<{ all: Set<string>; bytea: Set<string> }> {
  const rows = await tx.$queryRaw<Array<{ column_name: string; data_type: string }>>`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${table}`
  return { all: new Set(rows.map((r) => r.column_name)), bytea: new Set(rows.filter((r) => r.data_type === 'bytea').map((r) => r.column_name)) }
}

function sealedBytes(v: unknown, key: Buffer, why: string): Buffer | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v && '$sealed' in v && typeof (v as { $sealed: unknown }).$sealed === 'string') return Buffer.from((v as { $sealed: string }).$sealed, 'base64')
  if (typeof v === 'object' && v && '$json' in v) return Buffer.from(encryptJson((v as { $json: unknown }).$json, key))
  if (typeof v === 'object' && v && '$text' in v && typeof (v as { $text: unknown }).$text === 'string') return encryptBuffer(Buffer.from((v as { $text: string }).$text, 'utf8'), key)
  throw new WorkError('INVALID', `backup: sealed cell ${why}`)
}

function assertDocReadRows(pid: string, T: (t: string) => Row[]): void {
  const originals = new Set(T('work_file').filter((f) => !f.parent_file_id).map((f) => str(f.id)))
  const seen = new Set<string>()
  for (const r of T('work_file_page_block')) {
    const b = r.block_no; const total = r.total_pages
    const pages = r.pages && typeof r.pages === 'object' && '$json' in r.pages ? (r.pages as { $json: unknown }).$json : null
    if (r.project_id !== pid || !originals.has(str(r.file_id)) || !Number.isInteger(b) || !Number.isInteger(total) || (b as number) < 0 || (total as number) < 1 || (total as number) > DOC_READ_MAX_PAGES || (b as number) * 10 >= (total as number)
      || (r.state !== 'partial' && r.state !== 'done') || !isPageRecList(pages, b as number, total as number) || (r.state === 'done' && !blockLooksDone(pages, b as number, total as number))) throw new WorkError('INVALID', 'backup: document page block')
    const k = `${str(r.file_id)}|${b}`
    if (seen.has(k)) throw new WorkError('INVALID', 'backup: two page blocks for one file block')
    seen.add(k)
  }
  const seenF = new Set<string>()
  for (const r of T('work_doc_find_block')) {
    const b = r.block_no
    const result = r.result === null || r.result === undefined ? null : r.result && typeof r.result === 'object' && '$json' in r.result ? (r.result as { $json: unknown }).$json : undefined
    if (r.project_id !== pid || !originals.has(str(r.file_id)) || !Number.isInteger(b) || (b as number) < 0 || (b as number) >= DOC_READ_MAX_PAGES / 10 || typeof r.fields_hash !== 'string' || !/^[0-9a-f]{64}$/.test(r.fields_hash)
      || (r.state !== 'open' && r.state !== 'done') || (r.state === 'done' && result === null) || result === undefined) throw new WorkError('INVALID', 'backup: document find block')
    const k = `${str(r.file_id)}|${r.fields_hash}|${b}`
    if (seenF.has(k)) throw new WorkError('INVALID', 'backup: two find blocks for one file block')
    seenF.add(k)
  }
  const problem = docReadSetProblem(
    T('work_file_page_block').map((r) => ({ file: str(r.file_id), blockNo: r.block_no as number, totalPages: r.total_pages as number })),
    T('work_doc_find_block').map((r) => ({ file: str(r.file_id), blockNo: r.block_no as number, result: r.result === null || r.result === undefined ? null : (r.result as { $json: unknown }).$json })),
  )
  if (problem) throw new WorkError('INVALID', `backup: ${problem}`)
}

async function insertRows(tx: Tx, key: Buffer, table: string, rows: Row[], o: { omit?: string[]; set?: Row } = {}): Promise<void> {
  if (!rows.length) return
  const { all, bytea } = await columnsOf(tx, table)
  const omit = new Set(o.omit ?? [])
  const cols = [...all].filter((c) => !omit.has(c) && (rows.some((r) => c in r) || (o.set && c in o.set)))
  const prepared = rows.map((r) => {
    const out: Row = {}
    for (const c of cols) {
      let v = o.set && c in o.set ? o.set[c] : r[c]
      if (bytea.has(c)) { const b = sealedBytes(v, key, `${table}.${c}`); v = b ? `\\x${b.toString('hex')}` : null }
      out[c] = v === undefined ? null : v
    }
    return out
  })
  const list = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')
  for (let i = 0; i < prepared.length; i += 500) {
    await tx.$executeRawUnsafe(`INSERT INTO ${table} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, JSON.stringify(prepared.slice(i, i + 500)))
  }
}

export async function raiseCounters(db: PrismaClient, userId: string, rows: Row[]): Promise<void> {
  if (!countersToRaise(rows).length) return
  await db.$transaction((tx) => raiseCountersTx(tx, userId, rows))
}
const countersToRaise = (rows: Row[]) => rows.filter((r) => typeof r.name === 'string' && Number.isSafeInteger(r.value) && (r.value as number) >= 0)
export async function raiseCountersTx(tx: Tx, userId: string, rows: Row[]): Promise<void> {
  for (const r of countersToRaise(rows)) {
    await tx.$executeRaw`INSERT INTO work_counter (user_id, name, value) VALUES (${userId}, ${String(r.name).slice(0, 60)}, ${r.value as number})
      ON CONFLICT (user_id, name) DO UPDATE SET value = GREATEST(work_counter.value, EXCLUDED.value)`
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const openedJson = (v: unknown): unknown => (v && typeof v === 'object' && '$json' in v ? (v as { $json: unknown }).$json : null)

export function assertAssembledSpec(kind: unknown, specRows: readonly Row[]): void {
  if (kind !== ASSEMBLED_KIND) return
  if (specRows.length !== 1) throw new WorkError('INVALID', 'backup: this backup of an assembled app was made before its design (app spec) was included')
}

export function assertMyFormsForms(kind: unknown, sheets: readonly Row[], forms: readonly Row[]): void {
  if (kind !== MYFORMS_KIND) return
  const formSheets = new Set(forms.map((f) => str(f.sheet_id)))
  if (sheets.some((s) => str(s.name).startsWith('form_') && !formSheets.has(str(s.id)))) throw new WorkError('INVALID', 'backup: this backup of my forms was made before its forms were included')
  const sheetIds = new Set(sheets.map((s) => str(s.id)))
  if (forms.some((f) => !sheetIds.has(str(f.sheet_id)))) throw new WorkError('INVALID', 'backup: a form points to a sheet that is not in the backup')
}

export function assertOneMyForms(kinds: readonly unknown[]): boolean {
  const n = kinds.filter((k) => k === MYFORMS_KIND).length
  if (n > 1) throw new WorkError('INVALID', 'backup: the set has more than one my forms work app')
  return n === 1
}

export async function assertNoMyFormsTx(tx: Tx, userId: string): Promise<void> {
  if (await tx.workProject.count({ where: { userId, kind: MYFORMS_KIND } })) throw new WorkError('INVALID', 'backup: this account already has a my forms work app — delete it first')
}

export function assembledFloors(projectId: string, T: (t: string) => Row[]): Array<{ name: string; value: number }> {
  if (T('work_project')[0]?.kind !== ASSEMBLED_KIND) return []
  const spec = openedJson(T('work_app_spec')[0]?.info) as AppSpec | null
  if (!spec || !Array.isArray(spec.tables)) throw new WorkError('INVALID', 'backup: app spec shape')
  const sheets = T('data_sheets')
  const rows = T('data_sheet_rows')
  return specNumberFloors(spec, projectId, (tableKey) => {
    const sh = sheets.find((x) => x.name === specSheetName(tableKey))
    if (!sh) return []
    return rows.filter((r) => r.sheet_id === sh.id).flatMap((r) => {
      let plain: Row = {}
      try { const v = JSON.parse(str(r.row_data)); if (v && typeof v === 'object' && !Array.isArray(v)) plain = v as Row } catch { }
      const sealed = openedJson(r.sealed)
      return [plain, ...(sealed && typeof sealed === 'object' && !Array.isArray(sealed) ? [sealed as Row] : [])]
    })
  })
}
const dedupe = (rows: Row[]) => { const seen = new Set<string>(); return rows.filter((r) => { const k = str(r.id); if (!k || seen.has(k)) return false; seen.add(k); return true }) }

export async function restoreSetOriginal(i: OriginalInput): Promise<OriginalOutcome> {
  const { userId, key } = i
  const mf = i.manifest
  const projectIds = Array.isArray(mf.projectIds) ? (mf.projectIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  if (!projectIds.length) throw new WorkError('INVALID', 'backup: no apps in the set')
  const wfRows = i.table('workflow', 'workflows')
  const hidden = wfRows.filter((w) => w.kind === APP_WORKFLOW_KIND)
  const canvasRow = mf.scope === 'workflow' ? wfRows.find((w) => w.workflowId === mf.targetId && w.kind !== APP_WORKFLOW_KIND) ?? null : null
  if (projectIds.some((pid) => !hidden.some((h) => h.app_project_id === pid))) return { kind: 'copy', reason: 'LEGACY' }
  const agentId = str((canvasRow ?? hidden[0]).agentId)
  if (!agentId || [canvasRow, ...hidden].some((w) => w && str(w.agentId) !== agentId)) return { kind: 'copy', reason: 'AGENT_MIXED' }

  const T = (pid: string, t: string) => i.table(`apps/${pid}`, t)
  for (const pid of projectIds) for (const t of PROJECT_TABLES) if (T(pid, t).some((r) => r.user_id !== userId)) throw new WorkError('INVALID', `backup: ${t} row of another account`)
  for (const pid of projectIds) assertAssembledSpec(T(pid, 'work_project')[0]?.kind, T(pid, 'work_app_spec'))
  for (const pid of projectIds) assertMyFormsForms(T(pid, 'work_project')[0]?.kind, T(pid, 'data_sheets'), T(pid, 'work_form'))
  for (const pid of projectIds) assertDocReadRows(pid, (t) => T(pid, t))
  const hasMyForms = assertOneMyForms(projectIds.map((pid) => T(pid, 'work_project')[0]?.kind))
  const floors = projectIds.flatMap((pid) => assembledFloors(pid, (t) => T(pid, t)))

  const fileById = new Map(dedupe(projectIds.flatMap((pid) => T(pid, 'work_file'))).map((f) => [str(f.id), f]))
  const placed = new Set<string>()
  const fileOrder: Row[] = []
  const place = (f: Row, depth: number): void => {
    const id = str(f.id)
    if (placed.has(id)) return
    const par = str(f.parent_file_id)
    if (par) {
      if (depth > 20 || !fileById.has(par)) throw new WorkError('INVALID', 'backup: derived file without its original')
      place(fileById.get(par)!, depth + 1)
    }
    placed.add(id); fileOrder.push(f)
  }
  for (const f of fileById.values()) place(f, 0)

  const fileBytes = projectIds.reduce((n, pid) => n + T(pid, 'work_file').reduce((m, f) => m + (Number(f.size_bytes) || 0), 0), 0)
  const deadline = new Date(Date.now() + UPLOAD_WINDOW_MS + Math.ceil(fileBytes / (100 * 1024 * 1024)) * 60_000)
  const reserve = await i.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR NO KEY UPDATE`
    const agent = await tx.agent.findFirst({ where: { agentId, userId }, select: { agentId: true } })
    if (!agent) return { copy: 'AGENT_GONE' as const }
    if (await tx.workPurge.count({ where: { userId, projectId: { in: projectIds } } })) throw new WorkError('STALE', 'WAIT_PURGE')
    if (await tx.workProject.count({ where: { id: { in: projectIds } } })) return { copy: 'ORIGINAL_ALIVE' as const }
    const hiddenIds = hidden.map((h) => str(h.workflowId))
    if (await tx.workflow.count({ where: { workflowId: { in: hiddenIds } } })) return { copy: 'ORIGINAL_ALIVE' as const }
    for (const t of ID_TABLES) {
      const ids = projectIds.flatMap((pid) => T(pid, t).map((r) => str(r.id))).filter(Boolean)
      if (!ids.length) continue
      const n = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${t} WHERE id = ANY($1::text[])`, ids)
      if (n[0].n && t !== 'project_reference' && t !== 'work_handoff' && t !== 'work_handoff_period') return { copy: 'ORIGINAL_ALIVE' as const }
    }
    if (hasMyForms) await assertNoMyFormsTx(tx, userId)
    const canvasFree = !!canvasRow && (await tx.workflow.count({ where: { workflowId: str(canvasRow.workflowId) } })) === 0
    const purges: string[] = []
    for (const pid of projectIds) purges.push((await tx.workPurge.create({ data: { userId, kind: 'upload', state: 'uploading', projectId: pid, blobRegions: [i.region], deadline } })).id)
    return { purges, canvasFree }
  })
  if ('copy' in reserve) return { kind: 'copy', reason: reserve.copy! }
  const { purges, canvasFree } = reserve as { purges: string[]; canvasFree: boolean }
  await raiseCounters(i.db, userId, [...i.table('account', 'work_counter'), ...floors])

  const newPath = new Map<string, string>()
  for (const pid of projectIds) {
    for (const f of T(pid, 'work_file')) {
      if (Date.now() >= deadline.getTime()) throw new WorkError('STALE', 'upload took too long')
      const id = str(f.id)
      const buf = decryptBuffer((await i.download(i.region, `${i.stagingPrefix}x/${id}.bin`)).buffer, key)
      const path = workFileBlobPath(userId, pid, str(f.sha256))
      await i.upload(i.region, path, encryptBuffer(buf, key))
      newPath.set(id, path)
    }
  }

  const notRestored = new Set<string>()
  const names: Record<string, { name: string; kind: string }> = {}
  for (const pid of projectIds) {
    const h = hidden.find((x) => x.app_project_id === pid)!
    names[pid] = { name: str(h.name) || 'Work app', kind: str(T(pid, 'work_project')[0]?.kind) || 'free' }
  }
  const r = await i.originalTx({
    userId, agentId, addsCanvas: canvasFree,
    body: async (tx) => {
      const held = await tx.$queryRaw<Array<{ state: string; deadline: Date | null }>>`SELECT state, deadline FROM work_purge WHERE id = ANY(${purges}::text[]) ORDER BY id FOR UPDATE`
      if (held.length !== purges.length || held.some((x) => x.state !== 'uploading' || !x.deadline || x.deadline.getTime() <= Date.now())) throw new WorkError('STALE', 'upload window closed')
      if (hasMyForms) { await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR NO KEY UPDATE`; await assertNoMyFormsTx(tx, userId) }
      if (canvasFree) await insertRows(tx, key, 'workflows', [canvasRow!], { omit: ['id'], set: { status: 'draft', traffic_weight: 0, updated_at: new Date().toISOString() } })
      await insertRows(tx, key, 'workflows', hidden, { omit: ['id'], set: { status: 'archived', traffic_weight: 0, ...(canvasFree ? {} : { parent_workflow_id: null }) } })
      const wfIds = [...(canvasFree ? [str(canvasRow!.workflowId)] : []), ...hidden.map((h) => str(h.workflowId))]
      await insertRows(tx, key, 'workflow_version', i.table('workflow', 'workflow_version').filter((v) => wfIds.includes(str(v.workflow_id))), { omit: ['id'] })
      const access = i.table('workflow', 'agent_member_access').filter((a) => wfIds.includes(str(a.workflow_id)))
      if (access.length) {
        const live = new Set((await tx.agentMember.findMany({ where: { id: { in: access.map((a) => Number(a.member_id)) } }, select: { id: true } })).map((m) => m.id))
        if (access.some((a) => !live.has(Number(a.member_id)))) notRestored.add('member_access_of_removed_members')
        await insertRows(tx, key, 'agent_member_access', access.filter((a) => live.has(Number(a.member_id))))
      }
      const items = i.table('workflow', 'workflow_group_items').filter((g) => wfIds.includes(str(g.workflow_id)))
      for (const g of dedupe(i.table('workflow', 'workflow_groups'))) {
        if (!items.some((x) => x.group_id === g.id) || str(g.agentId) !== agentId) continue
        if (!(await tx.workflowGroup.count({ where: { id: str(g.id) } }))) await insertRows(tx, key, 'workflow_groups', [g])
      }
      const groupsNow = new Set((await tx.workflowGroup.findMany({ where: { id: { in: items.map((x) => str(x.group_id)) } }, select: { id: true } })).map((g) => g.id))
      if (items.some((x) => !groupsNow.has(str(x.group_id)))) notRestored.add('workflow_groups')
      await insertRows(tx, key, 'workflow_group_items', items.filter((x) => groupsNow.has(str(x.group_id))))

      for (const pid of projectIds) await insertRows(tx, key, 'work_project', T(pid, 'work_project'), { set: { workflow_id: null } })
      const all = (t: string) => dedupe(projectIds.flatMap((pid) => T(pid, t)))
      await insertRows(tx, key, 'work_app_spec', all('work_app_spec'))
      await insertRows(tx, key, 'data_sheets', all('data_sheets'))
      await insertRows(tx, key, 'work_form', all('work_form'))
      for (const f of fileOrder) await insertRows(tx, key, 'work_file', [f], { set: { blob_path: newPath.get(str(f.id))!, blob_region: i.region } })
      await insertRows(tx, key, 'work_file_page_block', all('work_file_page_block'), { set: { claim_id: null, claim_until: null } })
      await insertRows(tx, key, 'work_doc_find_block', all('work_doc_find_block'), { set: { claim_id: null, claim_until: null } })
      const rows = all('data_sheet_rows')
      await insertRows(tx, key, 'data_sheet_rows', rows)
      const keyData: Prisma.SheetRowKeyCreateManyInput[] = []
      for (const sh of all('data_sheets')) {
        let schema: { unique?: unknown } = {}
        try { schema = JSON.parse(str(sh.schema)) } catch { }
        const unique = Array.isArray(schema.unique) ? schema.unique.filter((u): u is string => typeof u === 'string') : []
        if (!unique.length) continue
        const fam = str(sh.template_family) || `sheet:${str(sh.id)}`
        for (const r of rows.filter((x) => x.sheet_id === sh.id)) {
          let plain: Row = {}
          try { plain = JSON.parse(str(r.row_data)) } catch { }
          const sealed = r.sealed && typeof r.sealed === 'object' && '$json' in r.sealed ? ((r.sealed as { $json: unknown }).$json as Row) : {}
          keyData.push({ projectId: str(r.project_id), userId, templateFamily: fam, keyHash: uniqueKeyHash(unique, { ...plain, ...sealed }), rowId: str(r.id) })
        }
      }
      if (keyData.length) await tx.sheetRowKey.createMany({ data: keyData })
      await insertRows(tx, key, 'sheet_row_pair', all('sheet_row_pair'))
      const tasks = all('work_task')
      await insertRows(tx, key, 'work_task', tasks, { set: { current_submission_id: null } })
      await insertRows(tx, key, 'work_submission', all('work_submission'))
      for (const t of tasks) if (t.current_submission_id) await tx.workTask.update({ where: { id: str(t.id) }, data: { currentSubmissionId: str(t.current_submission_id) } })
      for (const t of ['work_submission_source', 'work_submission_file', 'work_task_file', 'work_note', 'work_message', 'work_room_read', 'work_send', 'work_alert_fired', 'work_event', 'work_public_link']) {
        await insertRows(tx, key, t, t === 'work_room_read' ? projectIds.flatMap((pid) => T(pid, t)) : all(t))
      }
      const alive = new Set([...projectIds, ...(await tx.workProject.findMany({ where: { userId, status: 'active' }, select: { id: true } })).map((p) => p.id)])
      const fresh = async (t: string, rs: Row[]) => {
        const ids = rs.map((r) => str(r.id))
        const have = new Set(ids.length ? (await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM ${t} WHERE id = ANY($1::text[])`, ids)).map((x) => x.id) : [])
        return rs.filter((r) => !have.has(str(r.id)))
      }
      if (all('work_handoff_period').some((x) => !alive.has(str(x.to_project_id)))) notRestored.add('outside_links')
      const periods = await fresh('work_handoff_period', all('work_handoff_period').filter((x) => alive.has(str(x.to_project_id))))
      await insertRows(tx, key, 'work_handoff_period', periods)
      const periodIds = new Set([...periods.map((x) => str(x.id)), ...(await tx.workHandoffPeriod.findMany({ where: { id: { in: all('work_handoff').map((h) => str(h.period_id)).filter(Boolean) } }, select: { id: true } })).map((x) => x.id)])
      const handoffs = all('work_handoff')
      const reachable = handoffs.filter((h) => alive.has(str(h.to_project_id)) && alive.has(str(h.from_project_id)) && (!h.period_id || periodIds.has(str(h.period_id))))
      if (reachable.length < handoffs.length) notRestored.add('outside_links')
      const okHandoffs = await fresh('work_handoff', reachable)
      await insertRows(tx, key, 'work_handoff', okHandoffs)
      const refs = all('project_reference')
      const okRefs = await fresh('project_reference', refs.filter((x) => alive.has(str(x.from_project_id)) && alive.has(str(x.to_project_id))))
      if (refs.some((x) => !alive.has(str(x.from_project_id)) || !alive.has(str(x.to_project_id)))) notRestored.add('outside_links')
      await insertRows(tx, key, 'project_reference', okRefs)
      for (const pid of projectIds) await writeWorkEvent(tx, key, { userId, projectId: pid, actor: { type: 'human' }, action: 'backup_import', detail: { mode: 'original', createdAt: mf.createdAt ?? null } })
      await tx.workPurge.deleteMany({ where: { id: { in: purges } } })
      await i.onCommit(tx, { projectIds, canvasId: canvasFree ? str(canvasRow!.workflowId) : null, names, notRestored: [...notRestored] })
      return true
    },
  })
  if (!r.ok) throw new WorkError(r.code === 'workflow_limit_reached' ? 'INVALID' : r.code === 'STALE' ? 'STALE' : 'INVALID', r.code === 'INVALID' && r.message ? r.message : r.code)
  return { kind: 'done', projectIds, canvasId: canvasFree ? str(canvasRow!.workflowId) : null, names, notRestored: [...notRestored] }
}
