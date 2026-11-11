
import { readerOf } from '@/lib/work/app-chat'
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { applyLedgerFiles, storedLedgerFilesCard } from '@/lib/work/ledger-files'
import { assertTeamProject } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string }>('ledger.files', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  if (typeof body.messageId !== 'string' || !body.messageId || body.messageId.length > 40) throw new WorkError('INVALID', 'messageId')
  if (!Number.isInteger(body.index) || (body.index as number) < 0 || (body.index as number) > 100) throw new WorkError('INVALID', 'index')
  const card = await storedLedgerFilesCard(deps, { userId: access.userId, projectId: p.projectId, messageId: body.messageId, index: body.index as number, reader: readerOf(access.actor) })
  if (!access.isOwner) await assertTeamProject(access, card.ledgerProjectId)
  return applyLedgerFiles(deps, { userId: access.userId, projectId: p.projectId, actor: access.actor, card })
})
