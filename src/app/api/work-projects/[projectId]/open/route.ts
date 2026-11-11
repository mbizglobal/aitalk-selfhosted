
import { workOwnerRoute } from '@/lib/work/http'
import { openArchivedProject } from '@/lib/work/archive-open'

export const GET = workOwnerRoute<{ projectId: string }>('owner.project.open', async (_req, { userId, deps }, p) => openArchivedProject(deps, userId, p.projectId))
