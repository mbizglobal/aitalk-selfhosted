
import { workRoute, readJsonBody } from '@/lib/work/http'
import { WorkError } from '@/lib/work/errors'
import { createWebhook, listWebhooks, revokeWebhook } from '@/lib/work/webhook'

type P = { agentId: string; projectId: string }

const ownerOnly = (isOwner: boolean) => { if (!isOwner) throw new WorkError('FORBIDDEN', 'only the owner manages webhook addresses') }
const tableOf = (b: Record<string, unknown>) => {
  if (typeof b.table !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(b.table)) throw new WorkError('INVALID', 'table is a table key')
  return b.table
}

export const GET = workRoute<P>('webhooks.list', async (_req, { access, deps }, p) => {
  ownerOnly(access.isOwner)
  return { links: await listWebhooks(deps, { userId: access.userId, projectId: p.projectId }) }
})

export const POST = workRoute<P>('webhooks.create', async (req, { access, deps }, p) => {
  ownerOnly(access.isOwner)
  return createWebhook(deps, { userId: access.userId, projectId: p.projectId, tableKey: tableOf(await readJsonBody(req)) })
})

export const DELETE = workRoute<P>('webhooks.revoke', async (req, { access, deps }, p) => {
  ownerOnly(access.isOwner)
  return { revoked: await revokeWebhook(deps, { userId: access.userId, projectId: p.projectId, tableKey: tableOf(await readJsonBody(req)) }) }
})
