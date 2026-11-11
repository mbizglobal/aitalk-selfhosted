
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { WorkError } from '@/lib/work/errors'
import { workErrorResponse, workRoute } from '@/lib/work/http'
import { resolveWorkTeamAccess, type WorkTeamAccess } from '@/lib/work/team-access'
import { markTeamRead, privateRoomOf, readerOf, TEAM_ROOM, type RoomView } from '@/lib/work/app-chat'
import { MAX_WORK_MESSAGE_CHARS, MAX_WORK_MESSAGE_FILES, listWorkMessages, saveWorkMessage } from '@/lib/work/app-chat'
import { readTurnRequest } from '@/lib/work/turn-attachments'
import { projectOf, runWorkAppTurn, taskOf } from '@/lib/work/app-turn'

type P = { agentId: string; workflowId: string }

const viewOf = (access: WorkTeamAccess, raw: unknown): RoomView => (raw === 'team' ? TEAM_ROOM : privateRoomOf(access.actor))

export const GET = workRoute<P>('app.messages.list', async (req, { access }, p) => {
  const { deps, projectId } = await projectOf(access, p.workflowId)
  const taskId = await taskOf(deps, access.userId, projectId, req.nextUrl.searchParams.get('taskId'))
  const view = viewOf(access, req.nextUrl.searchParams.get('room'))
  const asOf = new Date()
  const messages = await listWorkMessages(deps, { userId: access.userId, projectId, taskId, view })
  const reader = readerOf(access.actor)
  if (view.room === 'team' && reader) await markTeamRead(deps, { userId: access.userId, projectId, taskId, reader, asOf })
  const authors: Record<string, string> = {}
  const who = messages.map((m) => (m.role === 'notice' ? m.notice?.by : view.room === 'team' ? m.actor : undefined)).filter((x): x is string => !!x)
  {
    const ids = [...new Set(who.map((a) => /^member:(\d+)$/.exec(a)?.[1]).filter((x): x is string => !!x).map(Number))]
    if (ids.length) for (const m of await deps.db.agentMember.findMany({ where: { id: { in: ids }, agentAgentId: access.agentId }, select: { id: true, displayName: true, email: true } })) authors[`member:${m.id}`] = m.displayName || m.email
    if (who.includes('human')) {
      const o = await deps.db.user.findUnique({ where: { id: access.userId }, select: { name: true, email: true } })
      authors.human = o?.name || o?.email || 'Owner'
    }
  }
  return { projectId, taskId, room: view.room, me: reader, authors, messages }
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
    const view = viewOf(access, body.room)
    const askAi = view.room === 'private' || body.askAi === true || /^@ai\b/i.test(text)
    if (!askAi) {
      if (parts.length) throw new WorkError('INVALID', 'attachments are for the AI — save the file in the Files tab first')
      const { deps, projectId } = await projectOf(access, p.workflowId)
      const taskId = await taskOf(deps, access.userId, projectId, body.taskId)
      const ok = fileIds.length ? await deps.db.workFile.count({ where: { id: { in: fileIds as string[] }, projectId, userId: access.userId } }) : 0
      if (ok !== fileIds.length) throw new WorkError('NOT_FOUND', 'file')
      const saved = await saveWorkMessage(deps, { userId: access.userId, projectId, taskId, role: 'user', actor: access.actor, body: { text, ...(fileIds.length ? { files: fileIds as string[] } : {}) }, view })
      return NextResponse.json({ saved: true, id: saved.id })
    }

    const turn = await runWorkAppTurn({ access, workflowId: p.workflowId, view, taskId: body.taskId, text, fileIds: fileIds as string[], parts })
    if (turn.refused) return NextResponse.json(turn.refused, { status: turn.status })
    return turn.response
  } catch (e) {
    if (e instanceof WorkError) return workErrorResponse(e)
    console.error('[work-app] messages.send', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
