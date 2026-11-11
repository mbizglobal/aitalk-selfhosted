
import { workRoute } from '@/lib/work/http'
import { projectMembersTx } from '@/lib/work/sheet-gate'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string }

export const GET = workRoute<P>('members.list', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const owner = await deps.db.user.findUnique({ where: { id: access.userId }, select: { name: true, email: true } })
  const members = (await projectMembersTx(deps.db, access.userId, p.projectId)).filter((m) => m.active)
  return {
    members: [
      { key: 'owner', name: owner?.name ?? null, email: owner?.email ?? null },
      ...members.map((m) => ({ key: m.email, name: m.name, email: m.email })),
    ],
  }
})
