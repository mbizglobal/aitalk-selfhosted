
import { workRoute } from '@/lib/work/http'
import { assertTeamProject, memberOf } from '@/lib/work/team-access'
import { readProjectOverview } from '@/lib/work/views'
import { projectCapabilities } from '@/lib/work/send-api'
import { linkedApps } from '@/lib/work/linked-apps'
import { appLang, appScreenImports, appScreenMissingFrom, appScreenTabs } from '@/lib/work/app-screen'
import { isProjectDetached } from '@/lib/work/sheet-gate'
import { packageOfKind } from '@/lib/translations/work'

export const GET = workRoute<{ agentId: string; projectId: string }>('project.app-screen', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const k = { userId: access.userId, projectId: p.projectId }
  const [o, caps, links, row] = await Promise.all([
    readProjectOverview(deps, k),
    projectCapabilities(deps, k),
    linkedApps(deps.db, { ...k, onlyAgentId: access.isOwner ? null : access.agentId, ...memberOf(access) }),
    deps.db.workProject.findFirstOrThrow({ where: { id: p.projectId, userId: access.userId }, select: { workflowId: true, workflowLinkedAt: true } }),
  ])
  const readApps = links.filter((x) => x.relation.includes('reads')).map((x) => x.name)
  return {
    tabs: appScreenTabs(appLang(req.nextUrl.searchParams.get('lang')), o, { readApps, sends: { v3: caps.v3, pending: caps.pending }, archived: isProjectDetached(row) }),
    can: { owner: access.isOwner, readOnly: o.readOnly },
    pkg: packageOfKind(o.kind),
    imports: appScreenImports(o),
    missingFrom: appScreenMissingFrom(o),
  }
})
