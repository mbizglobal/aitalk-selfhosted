
import { Prisma } from '@prisma/client'
import { decryptJson, encryptJson } from './sealed'
import { WorkError } from './errors'
import { assertAiMayWrite, assertProjectWritable, lockProjectForWrite, lockTaskForWrite, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { writeWorkEvent } from './projects'
import { fingerprint } from './references'
import { NOTE_KINDS } from './note-kinds'

const TX_TIMEOUT_MS = 30_000

export { NOTE_KINDS }
export type NoteKind = (typeof NOTE_KINDS)[number]
export const MAX_NOTE_CHARS = 20_000

interface PrevNote { kind: NoteKind; text: string; done?: boolean }
interface NoteBody { text: string; done?: boolean; prev?: PrevNote }

export type NoteStatus = 'accepted' | 'proposed'

export interface NoteView {
  id: string
  taskId: string | null
  kind: NoteKind
  text: string
  done: boolean | null
  status: NoteStatus
  previous: PrevNote | null
  createdAt: string
  updatedAt: string
}

type Tx = Prisma.TransactionClient
type NoteRow = { id: string; taskId: string | null; kind: string; body: Uint8Array; status: string; createdAt: Date; updatedAt: Date }

function view(r: NoteRow, key: Buffer): NoteView {
  const b = decryptJson<NoteBody>(r.body, key)
  return {
    id: r.id, taskId: r.taskId, kind: r.kind as NoteKind, text: b.text, done: r.kind === 'todo' ? b.done === true : null,
    status: r.status === 'proposed' ? 'proposed' : 'accepted', previous: r.status === 'proposed' ? b.prev ?? null : null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }
}

function parseKind(v: unknown): NoteKind {
  if (typeof v !== 'string' || !(NOTE_KINDS as readonly string[]).includes(v)) throw new WorkError('INVALID', 'kind must be conclusion, todo or source')
  return v as NoteKind
}

function parseText(v: unknown): string {
  const text = typeof v === 'string' ? v.trim() : ''
  if (!text || text.length > MAX_NOTE_CHARS) throw new WorkError('INVALID', `text must be 1–${MAX_NOTE_CHARS} characters`)
  return text
}

function assertHuman(actor: SheetActor) {
  if (actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person writes notes')
}

async function lockNoteScope(tx: Tx, userId: string, projectId: string, taskId: string | null) {
  assertProjectWritable(await lockProjectForWrite(tx, userId, projectId))
  if (taskId && (await lockTaskForWrite(tx, userId, projectId, taskId)).status !== 'open') throw new WorkError('LOCKED')
}

export async function listNotes(deps: WorkSheetDeps, q: { userId: string; projectId: string; taskId?: string | null }) {
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { id: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  let task: { status: string } | null = null
  if (q.taskId) {
    task = await deps.db.workTask.findFirst({ where: { id: q.taskId, projectId: q.projectId, userId: q.userId }, select: { status: true } })
    if (!task) throw new WorkError('NOT_FOUND')
  }
  const rows = await deps.db.workNote.findMany({
    where: { projectId: q.projectId, userId: q.userId, OR: [{ taskId: null }, ...(q.taskId ? [{ taskId: q.taskId }] : [])] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const key = await deps.dataKey(deps.db, q.userId)
  const all = rows.map((r) => view(r, key))
  return {
    project: all.filter((n) => n.taskId === null),
    task: q.taskId ? all.filter((n) => n.taskId === q.taskId) : null,
    taskLocked: task ? task.status !== 'open' : false,
  }
}

export async function createNote(deps: WorkSheetDeps, input: { userId: string; projectId: string; taskId?: string | null; kind: unknown; text: unknown; actor: SheetActor }): Promise<NoteView> {
  assertHuman(input.actor)
  const kind = parseKind(input.kind)
  const body: NoteBody = { text: parseText(input.text), ...(kind === 'todo' ? { done: false } : {}) }
  const taskId = input.taskId ?? null
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    await lockNoteScope(tx, input.userId, input.projectId, taskId)
    const r = await tx.workNote.create({ data: { projectId: input.projectId, userId: input.userId, taskId, kind, body: encryptJson(body, key) } })
    await writeWorkEvent(tx, key, { userId: input.userId, projectId: input.projectId, taskId: taskId ?? undefined, noteId: r.id, actor: input.actor, action: 'note_create', detail: { after: { kind, ...body } } })
    return view(r, key)
  }, { timeout: TX_TIMEOUT_MS })
}

export async function updateNote(
  deps: WorkSheetDeps,
  input: { userId: string; projectId: string; noteId: string; updatedAt: unknown; kind?: unknown; text?: unknown; done?: unknown; actor: SheetActor },
): Promise<NoteView> {
  assertHuman(input.actor)
  if (input.kind === undefined && input.text === undefined && input.done === undefined) throw new WorkError('INVALID', 'nothing to change')
  if (input.done !== undefined && typeof input.done !== 'boolean') throw new WorkError('INVALID', 'done must be true or false')
  const kind = input.kind === undefined ? undefined : parseKind(input.kind)
  const text = input.text === undefined ? undefined : parseText(input.text)
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    const before = await lockedNote(tx, input, key)
    const nextKind = kind ?? before.kind
    if (input.done !== undefined && nextKind !== 'todo') throw new WorkError('INVALID', 'only a to-do can be marked done')
    const body: NoteBody = {
      text: text ?? before.text,
      ...(nextKind === 'todo' ? { done: (input.done as boolean | undefined) ?? before.done ?? false } : {}),
      ...(before.previous ? { prev: before.previous } : {}),
    }
    const updatedAt = nextVersion(before)
    const r = await tx.workNote.update({ where: { id: before.id }, data: { kind: nextKind, body: encryptJson(body, key), updatedAt } })
    await writeWorkEvent(tx, key, {
      userId: input.userId, projectId: input.projectId, taskId: before.taskId ?? undefined, noteId: before.id, actor: input.actor, action: 'note_update',
      detail: { before: noteDetail(before), after: { kind: nextKind, ...body } },
    })
    return view(r, key)
  }, { timeout: TX_TIMEOUT_MS })
}

export async function deleteNote(deps: WorkSheetDeps, input: { userId: string; projectId: string; noteId: string; updatedAt: unknown; actor: SheetActor }): Promise<void> {
  assertHuman(input.actor)
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    const before = await lockedNote(tx, input, key)
    await tx.workNote.delete({ where: { id: before.id } })
    await writeWorkEvent(tx, key, { userId: input.userId, projectId: input.projectId, taskId: before.taskId ?? undefined, noteId: before.id, actor: input.actor, action: 'note_delete', detail: { before: noteDetail(before) } })
  }, { timeout: TX_TIMEOUT_MS })
}

function noteDetail(n: Pick<NoteView, 'kind' | 'text' | 'done'>) {
  return { kind: n.kind, text: n.text, ...(n.done === null ? {} : { done: n.done }) }
}

function nextVersion(before: Pick<NoteView, 'updatedAt'>): Date {
  return new Date(Math.max(Date.now(), Date.parse(before.updatedAt) + 1))
}

export async function proposeNote(
  deps: WorkSheetDeps,
  input: { userId: string; projectId: string; taskId?: string | null; noteId?: string | null; kind?: unknown; text: unknown; actor: SheetActor },
): Promise<NoteView> {
  if (input.actor.type !== 'ai') throw new WorkError('FORBIDDEN', 'only the work app AI proposes notes')
  const text = parseText(input.text)
  const kind = input.kind === undefined ? undefined : parseKind(input.kind)
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    if (!input.noteId) {
      const taskId = input.taskId ?? null
      const project = await lockProjectForWrite(tx, input.userId, input.projectId)
      assertProjectWritable(project)
      await assertAiMayWrite(tx, project, input.actor)
      if (taskId && (await lockTaskForWrite(tx, input.userId, input.projectId, taskId)).status !== 'open') throw new WorkError('LOCKED')
      const k = kind ?? 'conclusion'
      const body: NoteBody = { text, ...(k === 'todo' ? { done: false } : {}) }
      const r = await tx.workNote.create({ data: { projectId: input.projectId, userId: input.userId, taskId, kind: k, status: 'proposed', body: encryptJson(body, key) } })
      await writeWorkEvent(tx, key, { userId: input.userId, projectId: input.projectId, taskId: taskId ?? undefined, noteId: r.id, actor: input.actor, action: 'note_propose', detail: { after: { kind: k, text } } })
      return view(r, key)
    }
    const first = await tx.workNote.findFirst({ where: { id: input.noteId, projectId: input.projectId, userId: input.userId }, select: { taskId: true } })
    if (!first) throw new WorkError('NOT_FOUND')
    const project = await lockProjectForWrite(tx, input.userId, input.projectId)
    assertProjectWritable(project)
    await assertAiMayWrite(tx, project, input.actor)
    if (first.taskId && (await lockTaskForWrite(tx, input.userId, input.projectId, first.taskId)).status !== 'open') throw new WorkError('LOCKED')
    const r0 = await tx.workNote.findFirst({ where: { id: input.noteId, projectId: input.projectId, userId: input.userId } })
    if (!r0) throw new WorkError('NOT_FOUND')
    const before = view(r0, key)
    const nextKind = kind ?? before.kind
    const prev: PrevNote | undefined = before.status === 'accepted'
      ? { kind: before.kind, text: before.text, ...(before.done === null ? {} : { done: before.done }) }
      : before.previous ?? undefined
    const body: NoteBody = { text, ...(nextKind === 'todo' ? { done: before.done ?? false } : {}), ...(prev ? { prev } : {}) }
    const r = await tx.workNote.update({ where: { id: before.id }, data: { kind: nextKind, status: 'proposed', body: encryptJson(body, key), updatedAt: nextVersion(before) } })
    await writeWorkEvent(tx, key, {
      userId: input.userId, projectId: input.projectId, taskId: before.taskId ?? undefined, noteId: before.id, actor: input.actor, action: 'note_propose',
      detail: { before: { ...noteDetail(before), status: before.status }, after: { kind: nextKind, text } },
    })
    return view(r, key)
  }, { timeout: TX_TIMEOUT_MS })
}

export async function reviewNote(
  deps: WorkSheetDeps,
  input: { userId: string; projectId: string; noteId: string; updatedAt: unknown; accept: boolean; actor: SheetActor },
): Promise<NoteView | null> {
  assertHuman(input.actor)
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    const before = await lockedNote(tx, input, key)
    if (before.status !== 'proposed') throw new WorkError('INVALID', 'the note is not a proposal')
    const common = { userId: input.userId, projectId: input.projectId, taskId: before.taskId ?? undefined, noteId: before.id, actor: input.actor }
    if (input.accept) {
      const body: NoteBody = { text: before.text, ...(before.kind === 'todo' ? { done: before.done ?? false } : {}) }
      const r = await tx.workNote.update({ where: { id: before.id }, data: { status: 'accepted', body: encryptJson(body, key), updatedAt: nextVersion(before) } })
      await writeWorkEvent(tx, key, { ...common, action: 'note_accept', detail: { after: noteDetail(before) } })
      return view(r, key)
    }
    if (!before.previous) {
      await tx.workNote.delete({ where: { id: before.id } })
      await writeWorkEvent(tx, key, { ...common, action: 'note_discard', detail: { before: noteDetail(before) } })
      return null
    }
    const p = before.previous
    const body: NoteBody = { text: p.text, ...(p.kind === 'todo' ? { done: p.done ?? false } : {}) }
    const r = await tx.workNote.update({ where: { id: before.id }, data: { kind: p.kind, status: 'accepted', body: encryptJson(body, key), updatedAt: nextVersion(before) } })
    await writeWorkEvent(tx, key, { ...common, action: 'note_discard', detail: { before: noteDetail(before), after: noteDetail({ kind: p.kind, text: p.text, done: p.kind === 'todo' ? p.done ?? false : null }) } })
    return view(r, key)
  }, { timeout: TX_TIMEOUT_MS })
}

async function lockedNote(tx: Tx, input: { userId: string; projectId: string; noteId: string; updatedAt: unknown }, key: Buffer): Promise<NoteView> {
  if (typeof input.updatedAt !== 'string' || !input.updatedAt) throw new WorkError('INVALID', 'updatedAt from the read is required')
  const first = await tx.workNote.findFirst({ where: { id: input.noteId, projectId: input.projectId, userId: input.userId }, select: { taskId: true } })
  if (!first) throw new WorkError('NOT_FOUND')
  await lockNoteScope(tx, input.userId, input.projectId, first.taskId)
  const r = await tx.workNote.findFirst({ where: { id: input.noteId, projectId: input.projectId, userId: input.userId } })
  if (!r) throw new WorkError('NOT_FOUND')
  if (r.updatedAt.toISOString() !== input.updatedAt) throw new WorkError('STALE', 'the note changed since it was read — read it again')
  return view(r, key)
}

export async function noteDigests(tx: Tx, key: Buffer, a: { userId: string; projectId: string; taskId: string }) {
  const rows = await tx.workNote.findMany({ where: { projectId: a.projectId, userId: a.userId, OR: [{ taskId: null }, { taskId: a.taskId }] }, orderBy: { id: 'asc' } })
  const fp = (r: NoteRow) => {
    const n = view(r, key)
    return { id: r.id, fp: fingerprint(key, 'note', n.status === 'proposed' ? { ...noteDetail(n), status: n.status } : noteDetail(n)) }
  }
  return { task: rows.filter((r) => r.taskId !== null).map(fp), project: rows.filter((r) => r.taskId === null).map(fp) }
}
