
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workOwnerRoute } from '@/lib/work/http'
import { deleteProjectReference, updateProjectReference } from '@/lib/work/references'
import type { WorkSheetDeps } from '@/lib/work/sheet-gate'

async function assertOutgoing(deps: WorkSheetDeps, userId: string, projectId: string, referenceId: string): Promise<void> {
  const r = await deps.db.projectReference.findFirst({ where: { id: referenceId, userId, fromProjectId: projectId }, select: { id: true } })
  if (!r) throw new WorkError('NOT_FOUND')
}

export const PATCH = workOwnerRoute<{ projectId: string; referenceId: string }>('owner.references.update', async (req, { userId, deps }, p) => {
  await assertOutgoing(deps, userId, p.projectId, p.referenceId)
  const body = await readJsonBody(req)
  if (body.includeUnconfirmed !== undefined && typeof body.includeUnconfirmed !== 'boolean') throw new WorkError('INVALID', 'includeUnconfirmed must be true or false')
  await updateProjectReference(deps, {
    userId,
    referenceId: p.referenceId,
    sheets: body.sheets as string[] | undefined,
    includeUnconfirmed: body.includeUnconfirmed as boolean | undefined,
  })
  return { ok: true }
})

export const DELETE = workOwnerRoute<{ projectId: string; referenceId: string }>('owner.references.delete', async (_req, { userId, deps }, p) => {
  await assertOutgoing(deps, userId, p.projectId, p.referenceId)
  await deleteProjectReference(deps, { userId, referenceId: p.referenceId })
  return { ok: true }
})
