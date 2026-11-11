
import { stripCitationMarks } from './citation-marks'
import { randomUUID } from 'crypto'
import { describeCaughtError } from '@/lib/log-mask'
import { WorkError } from './errors'
import { memberOf, type WorkTeamAccess } from './team-access'
import { type RoomView } from './app-chat'
import { defaultWorkFileDeps, readProjectFile } from './files'
import { ensureAppProject } from './projects'
import { listProjectSends } from './send-api'
import { sendCardHistoryLine } from './send-report'
import { HISTORY_MESSAGES, HISTORY_MESSAGE_CHARS, MAX_WORK_MESSAGE_FILES, checkWorkAppGraph, findWorkApp, listWorkMessages, saveWorkMessage } from './app-chat'
import { closeWorkAppRun, enterTurn, openWorkAppRun, workAppRunCreditShort, workAppRunProposals, type WorkAppProposal, type WorkScope } from './app-scope'
import { MAX_TURN_BYTES, MODEL_IMAGE_MIME, shownOf, turnNotes, withServerPages, type TurnPart } from './turn-attachments'
import { assertServiceEntitlement } from '@/lib/entitlement'
import { isAgentLocked, AGENT_LOCKED_CODE } from '@/lib/agent-lock'
import { validateCPAWithCache } from '@/lib/cpa-service'
import { streamThenSave } from './turn-stream'
import { decryptJson } from './sealed'
import { WorkflowEngine } from '@/lib/workflow/engine'
import type { WorkflowContext } from '@/lib/workflow/types'
import { prisma } from '@/lib/prisma'
import { isSelfHosted } from '@/lib/edition'

const MAX_TURN_IMAGES = 12

export async function projectOf(access: WorkTeamAccess, workflowId: string) {
  const deps = await defaultWorkFileDeps()
  const w = await findWorkApp(deps.db, { userId: access.userId, agentId: access.agentId, workflowId, ...memberOf(access) })
  const project = await ensureAppProject(deps, { userId: access.userId, workflowId: w.workflowId })
  const p = await deps.db.workProject.findFirst({ where: { id: project.id, userId: access.userId, agentId: access.agentId }, select: { id: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  return { deps, w, projectId: p.id }
}

export async function taskOf(deps: { db: typeof prisma }, userId: string, projectId: string, raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') throw new WorkError('INVALID', 'taskId must be a string')
  const t = await deps.db.workTask.findFirst({ where: { id: raw, projectId, userId }, select: { id: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  return t.id
}

export interface WorkAppTurnInput {
  access: WorkTeamAccess
  workflowId: string
  view: RoomView
  taskId: unknown
  text: string
  fileIds: string[]
  parts: TurnPart[]
  scan?: NonNullable<WorkScope['scan']>
  aiNote?: string
  mayWrite?: () => Promise<boolean>
}

const TURN_SAVE_WAIT_MS = 120_000

export interface WorkAppTurnEnd {
  proposals: WorkAppProposal[]
  content: string
  sawError: boolean
}

export type WorkAppTurn =
  | { refused: { error: 'SERVICE_BLOCKED'; reason?: string } | { error: typeof AGENT_LOCKED_CODE } | { error: 'INSUFFICIENT_CPA' }; status: 403 | 402 }
  | { refused?: undefined; response: Response; finished: Promise<WorkAppTurnEnd> }

export async function runWorkAppTurn(i: WorkAppTurnInput): Promise<WorkAppTurn> {
  const { access, text, view } = i
  const app = await findWorkApp(prisma, { userId: access.userId, agentId: access.agentId, workflowId: i.workflowId, ...memberOf(access) })
  const graphProblem = checkWorkAppGraph(app.workflowJson)
  if (graphProblem) throw new WorkError('FORBIDDEN', `work app graph: ${graphProblem}`)
  const entitlement = await assertServiceEntitlement(access.userId)
  if (!entitlement.allowed) return { refused: { error: 'SERVICE_BLOCKED', reason: entitlement.reason }, status: 403 }
  if (await isAgentLocked(access.agentId)) return { refused: { error: AGENT_LOCKED_CODE }, status: 403 }
  const cpa = await validateCPAWithCache(access.userId, null)
  if (!cpa.allowed) return { refused: { error: 'INSUFFICIENT_CPA' }, status: 402 }
  const parts = await withServerPages(i.parts, { maxImages: MAX_TURN_IMAGES, maxBytes: MAX_TURN_BYTES })

  const { deps, w, projectId } = await projectOf(access, i.workflowId)
  if (checkWorkAppGraph(w.workflowJson)) throw new WorkError('FORBIDDEN', 'work app graph changed')

  const taskId = await taskOf(deps, access.userId, projectId, i.taskId)
  const fileIds = i.fileIds
  const found = fileIds.length
    ? await deps.db.workFile.findMany({ where: { id: { in: fileIds }, projectId, userId: access.userId }, select: { id: true, mimeType: true, kind: true, parentFileId: true, payload: true, sizeBytes: true } })
    : []
  if (found.length !== fileIds.length) throw new WorkError('NOT_FOUND', 'file')
  const files = fileIds.map((id) => found.find((f) => f.id === id)!)

  const pdfIds = files.filter((f) => f.mimeType === 'application/pdf').map((f) => f.id)
  const storedPages = pdfIds.length
    ? await deps.db.workFile.findMany({ where: { parentFileId: { in: pdfIds }, projectId, userId: access.userId, kind: 'page_image' }, select: { id: true, mimeType: true, parentFileId: true, payload: true, sizeBytes: true }, orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }] })
    : []

  const workflowJson = JSON.parse(w.workflowJson as string)
  const requestedBy = access.actor.memberId === undefined ? {} : { memberId: access.actor.memberId }
  const aiActor = { type: 'ai' as const, workflowId: w.workflowId, requestedBy }
  const uploadedFiles: NonNullable<WorkflowContext['uploadedFiles']> = []
  parts.forEach((pt, n) => {
    if (MODEL_IMAGE_MIME.has(pt.mimeType) && uploadedFiles.length < MAX_TURN_IMAGES) {
      uploadedFiles.push({ id: `turn-${n}`, name: pt.name, type: 'image', base64: pt.buffer.toString('base64'), size: pt.buffer.length })
    }
  })
  const fileNotes: string[] = []
  const key = await deps.dataKey(deps.db, access.userId)
  let imageBytes = parts.reduce((n, pt) => n + pt.buffer.length, 0)
  const addImage = async (f: { id: string; mimeType: string; sizeBytes: number }, name: string): Promise<boolean> => {
    if (!MODEL_IMAGE_MIME.has(f.mimeType) || uploadedFiles.length >= MAX_TURN_IMAGES || imageBytes + f.sizeBytes > MAX_TURN_BYTES) return false
    imageBytes += f.sizeBytes
    const read = await readProjectFile(deps, { userId: access.userId, fileId: f.id, actor: aiActor })
    uploadedFiles.push({ id: f.id, name, type: 'image', base64: read.buffer.toString('base64'), size: read.buffer.length })
    return true
  }
  for (const f of files) {
    const name = decryptJson<{ originalName: string }>(f.payload, key).originalName
    const shownImage = await addImage(f, name)
    const pages = storedPages.filter((pg) => pg.parentFileId === f.id)
    let sent = 0
    for (const pg of pages) if (await addImage(pg, decryptJson<{ originalName: string }>(pg.payload, key).originalName)) sent++
    const seen = pages.length ? `, shown as ${sent} of ${pages.length} page images` : MODEL_IMAGE_MIME.has(f.mimeType) && !shownImage ? ', not shown (image limit reached)' : ''
    fileNotes.push(`- fileId ${f.id}: ${name} (${f.mimeType}${f.parentFileId ? `, page image of file ${f.parentFileId}` : ''}${seen})`)
  }

  const saveKey = `${projectId}|${taskId ?? ''}|${view.room === 'team' ? 'team' : `private:${view.owner}`}`
  const turn = enterTurn(saveKey, TURN_SAVE_WAIT_MS)
  try {
    await turn.wait
    const past = await listWorkMessages(deps, { userId: access.userId, projectId, taskId, view, limit: HISTORY_MESSAGES, noNotices: true })
    const cardIds = [...new Set(past.flatMap((m) => m.proposals.flatMap((x) => (x.type === 'send' ? [x.sendId] : []))))]
    const cards = new Map<string, string>()
    if (cardIds.length) {
      try {
        for (const v of await listProjectSends(deps, { userId: access.userId, projectId }, access.actor, { ids: cardIds })) cards.set(v.id, sendCardHistoryLine(v))
      } catch (e) {
        console.error('[work-app] 앞 대화 카드 읽기 실패:', describeCaughtError(e))
      }
    }
    const history = past
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m.role !== 'notice')
      .map((m) => ({
        role: m.role,
        content: [
          m.text.slice(0, HISTORY_MESSAGE_CHARS),
          m.files.length ? `[Attached project files: ${m.files.slice(0, MAX_WORK_MESSAGE_FILES).map((f) => `${f.name.slice(0, 120)} (fileId ${f.id})`).join(', ')}]` : '',
          m.shown.length ? `[Shown only in that turn, not saved: ${m.shown.slice(0, MAX_WORK_MESSAGE_FILES).map((f) => f.name.slice(0, 120)).join(', ')}]` : '',
          ...m.proposals.map((x) => x.type === 'bank_import'
            ? `[Suggested to the person: import ${x.rows} rows from file ${x.fileId} — an import button was shown]`
            : x.type === 'send'
              ? cards.get(x.sendId) ?? '[A card was shown to the person — its details are no longer available]'
              : x.type === 'module_run'
                ? `[Suggested to the person: run ${x.module} — a button was shown (${x.detail.slice(0, 120)})]`
                : x.type === 'confirm_rows'
                  ? `[Suggested to the person: confirm ${x.count} rows of sheet ${x.sheetId} — a confirm button was shown]`
                  : x.type === 'ledger_link'
                    ? `[Suggested to the person: link ${x.count} bank lines of the Bank ledger to rows of this work app — a bank link button was shown]`
                  : x.type === 'ledger_files'
                    ? `[Suggested to the person: send ${x.files.length} statement files to the Bank ledger — a send button was shown]`
                  : x.type === 'ledger_statement'
                    ? `[Suggested to the person: import the statement ${x.fileId} (${x.summary.lines} lines) into the Bank ledger — an import card was shown]`
                  : x.type === 'report_files'
                    ? `[Offered a card to send ${x.files.length} problem files to AI Talk (${x.files.slice(0, 10).map((f) => f.fileId).join(', ')}) — the person decides; do not offer the same files again]`
                  : x.type === 'attach_files'
                    ? `[Suggested to the person: attach their own files${x.detail ? ` (${x.detail.slice(0, 120)})` : ''} — a button that opens the file picker was shown]`
                  : `[Suggested to the person: apply app template "${x.kind}" — a confirm button was shown]`),
        ].filter(Boolean).join('\n'),
      }))
      .filter((m) => m.content)

    const scanMark = i.scan ? { scan: i.scan.scanId } : {}
    await saveWorkMessage(deps, { userId: access.userId, projectId, taskId, role: 'user', actor: access.actor, body: { text, ...(files.length ? { files: files.map((f) => f.id) } : {}), ...(parts.length ? { shown: shownOf(parts) } : {}), ...scanMark }, view })

    const subscription = isSelfHosted() ? null : await prisma.subscription.findUnique({ where: { id: access.userId }, select: { serviceVariant: true, managedRegion: true } })
    const runId = randomUUID()
    openWorkAppRun(runId, { projectId, person: !i.scan })
    const notes = [await turnNotes(parts), fileNotes.length ? `[Saved files picked from the Files tab]\n${fileNotes.join('\n')}` : '', i.aiNote ?? ''].filter(Boolean)
    const message = notes.length ? `${text || '(files attached)'}\n\n${notes.join('\n\n')}` : text
    const context: WorkflowContext = {
      message,
      agentId: access.agentId,
      userId: access.userId,
      workflowId: w.workflowId,
      uploadedFiles,
      chatHistory: history,
      isTestMode: false,
      isManaged: subscription?.serviceVariant === 'managed',
      managedRegion: subscription?.managedRegion || undefined,
      workScope: { projectId, taskId, runId, view, requestedBy, ...(i.scan ? { scan: i.scan } : {}) },
    }

    let result
    try {
      result = await new WorkflowEngine().execute(workflowJson, context)
    } catch (e) {
      closeWorkAppRun(runId)
      throw e
    }
    const stream = result.streamResponse.body
    if (!stream) {
      const proposals = closeWorkAppRun(runId)
      turn.release()
      return { response: result.streamResponse, finished: Promise.resolve({ proposals, content: '', sawError: true }) }
    }
    let finish!: (end: WorkAppTurnEnd) => void
    const finished = new Promise<WorkAppTurnEnd>((r) => { finish = r })
    void finished.then(turn.release)
    const out = streamThenSave(stream, async (collected) => {
      const proposals = workAppRunProposals(runId)
      const creditShort = workAppRunCreditShort(runId)
      const sawError = collected.sawError || collected.readFailed
      const end = { proposals, content: collected.content, sawError }
      try {
        if ((sawError || !collected.content.trim()) && proposals.length === 0 && !creditShort) return
        if (i.mayWrite && !(await i.mayWrite())) return
        await saveWorkMessage(deps, {
          userId: access.userId, projectId, taskId, role: 'assistant', actor: aiActor,
          body: { text: sawError ? '' : stripCitationMarks(collected.content), ...(proposals.length ? { proposals } : {}), ...(creditShort ? { creditShort: true as const } : {}), ...scanMark }, view,
        })
      } catch (e) {
        console.error('[work-app] 대화 저장 실패:', describeCaughtError(e))
      } finally {
        closeWorkAppRun(runId)
        finish(end)
      }
    })
    return { response: new Response(out, { status: result.streamResponse.status, headers: result.streamResponse.headers }), finished }
  } catch (e) {
    turn.release()
    throw e
  }
}
