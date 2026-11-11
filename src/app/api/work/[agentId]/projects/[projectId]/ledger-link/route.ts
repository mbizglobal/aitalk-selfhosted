
import { readerOf } from '@/lib/work/app-chat'
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { ledgerLinkCardState, storedLedgerLinkCard } from '@/lib/work/ledger-link'
import { applyLedgerLink } from '@/lib/work/ledger-link-apply'
import { assertTeamProject } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string }>('ledger.link', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  if (typeof body.messageId !== 'string' || !body.messageId || body.messageId.length > 40) throw new WorkError('INVALID', 'messageId')
  if (!Number.isInteger(body.index) || (body.index as number) < 0 || (body.index as number) > 100) throw new WorkError('INVALID', 'index')
  const card = await storedLedgerLinkCard(deps, { userId: access.userId, projectId: p.projectId, messageId: body.messageId, index: body.index as number, reader: readerOf(access.actor) })
  if (!access.isOwner) await assertTeamProject(access, card.ledgerProjectId)
  return applyLedgerLink(deps, { userId: access.userId, projectId: p.projectId, actor: access.actor, card })
})

export const GET = workRoute<{ agentId: string; projectId: string }>('ledger.link.state', async (req, { access, deps }, p) => {
  const messageId = req.nextUrl.searchParams.get('messageId') ?? ''
  const index = Number(req.nextUrl.searchParams.get('index'))
  if (!messageId || messageId.length > 40) throw new WorkError('INVALID', 'messageId')
  if (!Number.isInteger(index) || index < 0 || index > 100) throw new WorkError('INVALID', 'index')
  const card = await storedLedgerLinkCard(deps, { userId: access.userId, projectId: p.projectId, messageId, index, reader: readerOf(access.actor) })
  if (!access.isOwner) await assertTeamProject(access, card.ledgerProjectId)
  return ledgerLinkCardState(deps, { userId: access.userId, projectId: p.projectId, card })
})
