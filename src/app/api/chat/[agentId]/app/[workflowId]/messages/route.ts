
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { WorkError } from '@/lib/work/errors'
import { workErrorResponse, workRoute } from '@/lib/work/http'
import { resolveWorkTeamAccess } from '@/lib/work/team-access'
import { defaultWorkFileDeps, readProjectFile } from '@/lib/work/files'
import { ensureAppProject } from '@/lib/work/projects'
import {
  HISTORY_MESSAGES, HISTORY_MESSAGE_CHARS, MAX_WORK_MESSAGE_CHARS, MAX_WORK_MESSAGE_FILES,
  checkWorkAppGraph, findWorkApp, listWorkMessages, saveWorkMessage,
} from '@/lib/work/app-chat'
import { closeWorkAppRun, openWorkAppRun } from '@/lib/work/app-scope'
import { MAX_TURN_BYTES, MODEL_IMAGE_MIME, readTurnRequest, shownOf, turnNotes } from '@/lib/work/turn-attachments'
import { assertServiceEntitlement } from '@/lib/entitlement'
import { isAgentLocked, AGENT_LOCKED_CODE } from '@/lib/agent-lock'
import { validateCPAWithCache } from '@/lib/cpa-service'
import { ChatStreamCollector } from '@/lib/chat/stream-collector'
import { decryptJson } from '@/lib/work/sealed'
import { WorkflowEngine } from '@/lib/workflow/engine'
import type { WorkflowContext } from '@/lib/workflow/types'
import { prisma } from '@/lib/prisma'
import { isSelfHosted } from '@/lib/edition'

const MAX_TURN_IMAGES = 12

type P = { agentId: string; workflowId: string }

async function projectOf(access: { userId: string; agentId: string }, workflowId: string) {
  const deps = await defaultWorkFileDeps()
  const w = await findWorkApp(deps.db, { userId: access.userId, agentId: access.agentId, workflowId })
  const project = await ensureAppProject(deps, { userId: access.userId, workflowId: w.workflowId })
  const p = await deps.db.workProject.findFirst({ where: { id: project.id, userId: access.userId, agentId: access.agentId }, select: { id: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  return { deps, w, projectId: p.id }
}

async function taskOf(deps: { db: typeof prisma }, userId: string, projectId: string, raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') throw new WorkError('INVALID', 'taskId must be a string')
  const t = await deps.db.workTask.findFirst({ where: { id: raw, projectId, userId }, select: { id: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  return t.id
}

export const GET = workRoute<P>('app.messages.list', async (req, { access }, p) => {
  const { deps, projectId } = await projectOf(access, p.workflowId)
  const taskId = await taskOf(deps, access.userId, projectId, req.nextUrl.searchParams.get('taskId'))
  return { projectId, taskId, messages: await listWorkMessages(deps, { userId: access.userId, projectId, taskId }) }
})

export async function POST(req: NextRequest, { params }: { params: Promise<P> }) {
  try {
    const p = await params
    const access = await resolveWorkTeamAccess(req, p.agentId)
    if (!access) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

    const { payload: body, parts } = await readTurnRequest(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const fileIds = Array.isArray(body.fileIds) ? [...new Set(body.fileIds)] : []
    if (fileIds.some((x) => typeof x !== 'string' || !x) || fileIds.length > MAX_WORK_MESSAGE_FILES) throw new WorkError('INVALID', `fileIds: up to ${MAX_WORK_MESSAGE_FILES} ids`)
    if (!text && fileIds.length === 0 && parts.length === 0) throw new WorkError('INVALID', 'text or files are required')
    if (text.length > MAX_WORK_MESSAGE_CHARS) throw new WorkError('INVALID', `text over ${MAX_WORK_MESSAGE_CHARS} characters`)

    const app = await findWorkApp(prisma, { userId: access.userId, agentId: access.agentId, workflowId: p.workflowId })
    const graphProblem = checkWorkAppGraph(app.workflowJson)
    if (graphProblem) throw new WorkError('FORBIDDEN', `work app graph: ${graphProblem}`)
    const entitlement = await assertServiceEntitlement(access.userId)
    if (!entitlement.allowed) return NextResponse.json({ error: 'SERVICE_BLOCKED', reason: entitlement.reason }, { status: 403 })
    if (await isAgentLocked(access.agentId)) return NextResponse.json({ error: AGENT_LOCKED_CODE }, { status: 403 })
    const cpa = await validateCPAWithCache(access.userId, null)
    if (!cpa.allowed) return NextResponse.json({ error: 'INSUFFICIENT_CPA' }, { status: 402 })

    const { deps, w, projectId } = await projectOf(access, p.workflowId)
    if (checkWorkAppGraph(w.workflowJson)) throw new WorkError('FORBIDDEN', 'work app graph changed')

    const taskId = await taskOf(deps, access.userId, projectId, body.taskId)
    const found = fileIds.length
      ? await deps.db.workFile.findMany({ where: { id: { in: fileIds as string[] }, projectId, userId: access.userId }, select: { id: true, mimeType: true, kind: true, parentFileId: true, payload: true, sizeBytes: true } })
      : []
    if (found.length !== fileIds.length) throw new WorkError('NOT_FOUND', 'file')
    const files = (fileIds as string[]).map((id) => found.find((f) => f.id === id)!)

    const pdfIds = files.filter((f) => f.mimeType === 'application/pdf').map((f) => f.id)
    const storedPages = pdfIds.length
      ? await deps.db.workFile.findMany({ where: { parentFileId: { in: pdfIds }, projectId, userId: access.userId, kind: 'page_image' }, select: { id: true, mimeType: true, parentFileId: true, payload: true, sizeBytes: true }, orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }] })
      : []

    const workflowJson = JSON.parse(w.workflowJson as string)
    const aiActor = { type: 'ai' as const, workflowId: w.workflowId }
    const uploadedFiles: NonNullable<WorkflowContext['uploadedFiles']> = []
    parts.forEach((pt, i) => {
      if (MODEL_IMAGE_MIME.has(pt.mimeType) && uploadedFiles.length < MAX_TURN_IMAGES) {
        uploadedFiles.push({ id: `turn-${i}`, name: pt.name, type: 'image', base64: pt.buffer.toString('base64'), size: pt.buffer.length })
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

    const history = (await listWorkMessages(deps, { userId: access.userId, projectId, taskId, limit: HISTORY_MESSAGES }))
      .map((m) => ({
        role: m.role,
        content: [
          m.text.slice(0, HISTORY_MESSAGE_CHARS),
          m.files.length ? `[Attached project files: ${m.files.slice(0, MAX_WORK_MESSAGE_FILES).map((f) => `${f.name.slice(0, 120)} (fileId ${f.id})`).join(', ')}]` : '',
          m.shown.length ? `[Shown only in that turn, not saved: ${m.shown.slice(0, MAX_WORK_MESSAGE_FILES).map((f) => f.name.slice(0, 120)).join(', ')}]` : '',
          ...m.proposals.map((x) => x.type === 'bank_import'
            ? `[Suggested to the person: import ${x.rows} rows from file ${x.fileId} — an import button was shown]`
            : `[Suggested to the person: apply app template "${x.kind}" — a confirm button was shown]`),
        ].filter(Boolean).join('\n'),
      }))
      .filter((m) => m.content)

    await saveWorkMessage(deps, { userId: access.userId, projectId, taskId, role: 'user', actor: access.actor, body: { text, ...(files.length ? { files: files.map((f) => f.id) } : {}), ...(parts.length ? { shown: shownOf(parts) } : {}) } })

    const subscription = isSelfHosted() ? null : await prisma.subscription.findUnique({ where: { id: access.userId }, select: { serviceVariant: true, managedRegion: true } })
    const runId = randomUUID()
    openWorkAppRun(runId)
    const notes = [turnNotes(parts), fileNotes.length ? `[Saved files picked from the Files tab]\n${fileNotes.join('\n')}` : ''].filter(Boolean)
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
      workScope: { projectId, taskId, runId },
    }

    let result
    try {
      result = await new WorkflowEngine().execute(workflowJson, context)
    } catch (e) {
      closeWorkAppRun(runId)
      throw e
    }
    const stream = result.streamResponse.body
    if (!stream) { closeWorkAppRun(runId); return result.streamResponse }
    const collector = new ChatStreamCollector()
    const decoder = new TextDecoder('utf-8')
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
        try { collector.push(decoder.decode(chunk, { stream: true })) } catch { }
      },
      async flush() {
        try { collector.push(decoder.decode()); collector.end() } catch { }
        const collected = collector.result
        const proposals = closeWorkAppRun(runId)
        if ((collected.sawError || !collected.content.trim()) && proposals.length === 0) return
        try {
          await saveWorkMessage(deps, {
            userId: access.userId, projectId, taskId, role: 'assistant', actor: aiActor,
            body: { text: collected.content, ...(proposals.length ? { proposals } : {}) },
          })
        } catch (e) {
          console.error('[work-app] 대화 저장 실패:', describeCaughtError(e))
        }
      },
    })
    return new Response(stream.pipeThrough(transform), { status: result.streamResponse.status, headers: result.streamResponse.headers })
  } catch (e) {
    if (e instanceof WorkError) return workErrorResponse(e)
    console.error('[work-app] messages.send', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
