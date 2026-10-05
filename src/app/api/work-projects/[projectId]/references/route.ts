
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workOwnerRoute } from '@/lib/work/http'
import { createProjectReference } from '@/lib/work/references'
import { readReferenceSettings } from '@/lib/work/reference-views'

export const GET = workOwnerRoute<{ projectId: string }>('owner.references', async (_req, { userId, deps }, p) => {
  return readReferenceSettings(deps, { userId, projectId: p.projectId })
})

export const POST = workOwnerRoute<{ projectId: string }>('owner.references.create', async (req, { userId, deps }, p) => {
  const body = await readJsonBody(req)
  if (typeof body.toProjectId !== 'string' || !body.toProjectId) throw new WorkError('INVALID', 'toProjectId is required')
  if (body.includeUnconfirmed !== undefined && typeof body.includeUnconfirmed !== 'boolean') throw new WorkError('INVALID', 'includeUnconfirmed must be true or false')
  const ref = await createProjectReference(deps, {
    userId,
    fromProjectId: p.projectId,
    toProjectId: body.toProjectId,
    sheets: body.sheets as string[],
    includeUnconfirmed: body.includeUnconfirmed as boolean | undefined,
  })
  return { id: ref.id }
})
