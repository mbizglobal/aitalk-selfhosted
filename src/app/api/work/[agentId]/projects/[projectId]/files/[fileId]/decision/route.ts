import { WorkError, type WorkErrorCode, type WorkStop } from '@/lib/work/errors'
import { applyFileDecisions } from '@/lib/work/file-decisions'
import { workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'
import { retryScan, scanActorOf } from '@/lib/work/scan'

const ACTIONS: Record<string, string> = { exclude: 'excluded', reset: 'reset', detach: 'detach' }

export const POST = workRoute<{ agentId: string; projectId: string; fileId: string }>('file.decision', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const owned = await deps.db.workFile.findFirst({ where: { id: p.fileId, projectId: p.projectId, userId: access.userId, parentFileId: null }, select: { id: true } })
  if (!owned) throw new WorkError('NOT_FOUND')
  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { throw new WorkError('INVALID', 'body must be JSON') }
  const kind = typeof body?.action === 'string' ? ACTIONS[body.action] : undefined
  if (!kind) throw new WorkError('INVALID', 'action must be exclude, reset or detach')
  const { results } = await applyFileDecisions(
    { deps, userId: access.userId, projectId: p.projectId, actor: access.actor },
    [{ fileId: p.fileId, kind, ...(kind === 'excluded' ? { reason: body.reason, text: body.text } : {}) }],
  )
  const r = results[0]
  if (r?.error) {
    const code = typeof r.code === 'string' ? (r.code as WorkErrorCode) : 'INVALID'
    throw new WorkError(code, r.error === code ? '' : String(r.error), r.stop as WorkStop | undefined)
  }
  if (kind === 'reset' && body.resort === true) {
    const link = await deps.db.workScanFile.findFirst({ where: { owner: true, fileId: p.fileId, scan: { userId: access.userId, projectId: p.projectId, status: { in: ['done', 'failed', 'deferred'] } } }, select: { scanId: true } })
    if (link) {
      const again = await retryScan(deps.db, { userId: access.userId, scanId: link.scanId, actor: scanActorOf(access.actor), isOwner: access.isOwner }).catch((e) => { if (e instanceof WorkError && e.code === 'NOT_FOUND') return null; throw e })
      if (again) return { ok: true, scan: { id: link.scanId, status: again.status } }
    }
  }
  return { ok: true }
})
