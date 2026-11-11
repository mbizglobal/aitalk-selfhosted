
import { workRoute, readJsonBody } from '@/lib/work/http'
import { WorkError } from '@/lib/work/errors'
import { createIntakeLink, listIntakeLinks, revokeIntakeLink } from '@/lib/work/intake-form'

type P = { agentId: string; projectId: string }

const ownerOnly = (isOwner: boolean) => { if (!isOwner) throw new WorkError('FORBIDDEN', 'only the owner manages intake links') }
const tableOf = (b: Record<string, unknown>) => {
  if (typeof b.table !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(b.table)) throw new WorkError('INVALID', 'table is a table key')
  return b.table
}

export const GET = workRoute<P>('intake-links.list', async (_req, { access, deps }, p) => {
  ownerOnly(access.isOwner)
  return { links: await listIntakeLinks(deps, { userId: access.userId, projectId: p.projectId }) }
})

export const POST = workRoute<P>('intake-links.create', async (req, { access, deps }, p) => {
  ownerOnly(access.isOwner)
  return createIntakeLink(deps, { userId: access.userId, projectId: p.projectId, tableKey: tableOf(await readJsonBody(req)) })
})

export const DELETE = workRoute<P>('intake-links.revoke', async (req, { access, deps }, p) => {
  ownerOnly(access.isOwner)
  return { revoked: await revokeIntakeLink(deps, { userId: access.userId, projectId: p.projectId, tableKey: tableOf(await readJsonBody(req)) }) }
})
