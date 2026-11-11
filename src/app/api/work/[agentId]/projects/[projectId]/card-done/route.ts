
import { markCardDone, readerOf } from '@/lib/work/app-chat'
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string }>('card.done', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  if (access.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person presses a card')
  const body = await readJsonBody(req)
  if (typeof body.messageId !== 'string' || !body.messageId || body.messageId.length > 40) throw new WorkError('INVALID', 'messageId')
  if (!Number.isInteger(body.index) || (body.index as number) < 0 || (body.index as number) > 100) throw new WorkError('INVALID', 'index')
  return markCardDone(deps, { userId: access.userId, projectId: p.projectId, messageId: body.messageId, index: body.index as number, reader: readerOf(access.actor), result: body.result })
})
