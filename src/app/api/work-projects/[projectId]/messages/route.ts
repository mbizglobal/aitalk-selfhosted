
import { workOwnerRoute } from '@/lib/work/http'
import { archivedProjectMessages } from '@/lib/work/archive-open'

export const GET = workOwnerRoute<{ projectId: string }>('owner.project.messages', async (req, { userId, deps }, p) =>
  archivedProjectMessages(deps, userId, p.projectId, { taskId: req.nextUrl.searchParams.get('taskId'), room: req.nextUrl.searchParams.get('room') }))
