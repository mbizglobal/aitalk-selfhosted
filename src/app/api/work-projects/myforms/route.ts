import { prisma } from '@/lib/prisma'
import { isSelfHosted } from '@/lib/edition'
import { workOwnerRoute } from '@/lib/work/http'
import { startCompanyForms } from '@/lib/work/scan'
import { parseWorkLang } from '@/lib/translations/work'

async function openOf(userId: string): Promise<{ agentId: string; workflowId: string } | null> {
  const p = await prisma.workProject.findFirst({ where: { userId, kind: 'myforms', status: 'active', workflowId: { not: null } }, select: { workflow: { select: { workflowId: true, agentId: true } } } })
  return p?.workflow ? { agentId: p.workflow.agentId, workflowId: p.workflow.workflowId } : null
}

export const GET = workOwnerRoute('owner.myforms', async (_req, { userId }) => {
  return { available: !isSelfHosted(), open: await openOf(userId) }
})

export const POST = workOwnerRoute('owner.myforms.start', async (req, { userId }) => {
  const b = await req.json().catch(() => ({})) as { lang?: unknown }
  await startCompanyForms(prisma, { userId, isOwner: true, lang: parseWorkLang(typeof b.lang === 'string' ? b.lang : 'en') })
  return { open: await openOf(userId) }
})
