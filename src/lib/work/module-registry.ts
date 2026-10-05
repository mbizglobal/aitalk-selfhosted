
import { WorkError } from './errors'
import { moduleLabel, validateModuleRegistry, type ModuleRunCtx, type WorkModule } from './modules'
import type { SheetActor } from './sheet-gate'
import type { WorkFileDeps } from './files'
import { workModules } from './registry'

export function findWorkModule(id: string, modules: readonly WorkModule[] = workModules()): WorkModule {
  const m = modules.find((x) => x.id === id)
  if (!m) throw new WorkError('TEMPLATE_UNKNOWN', `module ${id}`)
  return m
}

export async function runWorkModule(deps: WorkFileDeps, req: { userId: string; projectId: string; moduleId: string; input: unknown; by: SheetActor }): Promise<unknown> {
  validateModuleRegistry(workModules(), deps.templates)
  const m = findWorkModule(req.moduleId)
  if (m.kind === 'calc') throw new WorkError('INVALID', `${moduleLabel(m)} runs inside a submission`)
  if (req.by.type !== 'human' && req.by.type !== 'ai') throw new WorkError('FORBIDDEN', 'a person or the project workflow must ask')
  const p = await deps.db.workProject.findFirst({ where: { id: req.projectId, userId: req.userId }, select: { modules: true, workflowId: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  if (!p.modules.includes(m.id)) throw new WorkError('FORBIDDEN', `${m.id} is not enabled in this project`)
  if (req.by.type === 'ai') {
    if (req.input && typeof req.input === 'object' && (req.input as { step?: unknown }).step === 'apply') throw new WorkError('FORBIDDEN', 'a person applies an import plan')
    if (!p.workflowId || p.workflowId !== req.by.workflowId) throw new WorkError('FORBIDDEN')
    const wf = await deps.db.workflow.findUnique({ where: { workflowId: p.workflowId }, select: { status: true } })
    if (!wf || wf.status === 'archived') throw new WorkError('FORBIDDEN')
  }
  const ctx: ModuleRunCtx = { deps, userId: req.userId, projectId: req.projectId, by: req.by }
  return m.run(ctx, req.input)
}
