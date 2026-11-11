
import { WorkError } from '@/lib/work/errors'
import { workOwnerRoute } from '@/lib/work/http'
import { workflowDeletePreview } from '@/lib/work/workflow-apps'

export const GET = workOwnerRoute<{ workflowId: string }>('owner.workflow_apps', async (_req, { userId, deps }, { workflowId }) => {
  const key = await deps.dataKey(deps.db, userId)
  const preview = await workflowDeletePreview(deps.db, userId, key, workflowId)
  if (!preview) throw new WorkError('NOT_FOUND', 'workflow not found')
  return preview
})
