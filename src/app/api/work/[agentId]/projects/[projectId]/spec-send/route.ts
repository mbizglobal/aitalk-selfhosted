
import { workRoute, readJsonBody } from '@/lib/work/http'
import { WorkError } from '@/lib/work/errors'
import { createAssembledSendCard } from '@/lib/work/app-send'
import { createSpecHttpCard } from '@/lib/work/assembled-http'
import { createSpecCalendarCard } from '@/lib/work/assembled-calendar'
import { createSpecSmsCard } from '@/lib/work/assembled-sms'
import { listProjectSends } from '@/lib/work/send-api'
import { SPEC_SHEET_PREFIX } from '@/lib/work/assembled'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string }
const KEY = /^[a-z][a-z0-9_]{0,39}$/
const ID = /^[A-Za-z0-9_-]{1,40}$/

export const POST = workRoute<P>('spec-send.card', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const b = await readJsonBody(req)
  if (typeof b.sheetId !== 'string' || !ID.test(b.sheetId) || typeof b.rowId !== 'string' || !ID.test(b.rowId) || typeof b.send !== 'string' || !KEY.test(b.send)) throw new WorkError('INVALID', 'sheetId, rowId and send are required')
  const sheet = await deps.db.dataSheet.findFirst({ where: { id: b.sheetId, projectId: p.projectId, userId: access.userId, kind: 'project', template: null }, select: { name: true } })
  if (!sheet || !sheet.name.startsWith(SPEC_SHEET_PREFIX)) throw new WorkError('NOT_FOUND')
  if (b.via !== undefined && b.via !== 'http' && b.via !== 'calendar' && b.via !== 'sms') throw new WorkError('INVALID', 'via is "http", "calendar", "sms" or left out')
  const r = b.via === 'http'
    ? await createSpecHttpCard(deps, { userId: access.userId, projectId: p.projectId, by: access.actor }, b.send, b.rowId)
    : b.via === 'sms'
      ? await createSpecSmsCard(deps, { userId: access.userId, projectId: p.projectId, by: access.actor }, b.send, b.rowId)
      : b.via === 'calendar'
      ? await createSpecCalendarCard(deps, { userId: access.userId, projectId: p.projectId, by: access.actor }, b.send, b.rowId)
      : await createAssembledSendCard(deps, { userId: access.userId, projectId: p.projectId, by: access.actor }, b.send, b.rowId)
  const [send] = await listProjectSends(deps, { userId: access.userId, projectId: p.projectId }, access.actor, { ids: [r.sendId] })
  return { send }
})
