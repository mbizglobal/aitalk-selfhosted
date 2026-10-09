
import { WorkError } from './errors'
import { assertProjectWritable, lockProjectForWrite, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { workModules } from './registry'
import { parseNeed, type WorkModule } from './modules'
import type { LocaleText } from './app-template-features'
import { appTemplateOf } from './app-templates'
import { writeWorkEvent } from './projects'

const TX_TIMEOUT_MS = 30_000

export interface ModuleChoice {
  id: string
  title: LocaleText
  description: LocaleText
  enabled: boolean
  required: boolean
  usable: boolean
}

type SheetRow = { template: string | null }

function needsMet(m: WorkModule, sheets: readonly SheetRow[]): boolean {
  return m.needs.map(parseNeed).every((n) => sheets.some((s) => {
    if (!s.template) return false
    const at = s.template.lastIndexOf('@')
    return s.template.slice(0, at) === n.name && Number(s.template.slice(at + 1)) >= n.minVersion
  }))
}

export async function listModuleChoices(deps: WorkSheetDeps, q: { userId: string; projectId: string }, modules: readonly WorkModule[] = workModules()): Promise<ModuleChoice[]> {
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, modules: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId }, select: { template: true } })
  const calc = appTemplateOf(p.kind)?.calcModule?.id ?? null
  return modules
    .map((m) => ({ id: m.id, title: m.title, description: m.description, enabled: p.modules.includes(m.id) || m.id === calc, required: m.id === calc, usable: needsMet(m, sheets) }))
    .filter((c) => c.enabled || c.usable)
}

export async function setProjectModule(
  deps: WorkSheetDeps,
  input: { userId: string; projectId: string; moduleId: string; enabled: unknown; actor: SheetActor },
  modules: readonly WorkModule[] = workModules(),
): Promise<string[]> {
  if (input.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person turns modules on or off')
  if (typeof input.enabled !== 'boolean') throw new WorkError('INVALID', 'enabled must be true or false')
  const m = modules.find((x) => x.id === input.moduleId)
  if (!m) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, input.projectId))
    const p = await tx.workProject.findUniqueOrThrow({ where: { id: input.projectId }, select: { kind: true, modules: true } })
    if (!input.enabled && appTemplateOf(p.kind)?.calcModule?.id === m.id) throw new WorkError('INVALID', 'the calculation module of the app template cannot be turned off')
    const has = p.modules.includes(m.id)
    if (has === input.enabled) return p.modules
    if (input.enabled) {
      const sheets = await tx.dataSheet.findMany({ where: { kind: 'project', projectId: input.projectId, userId: input.userId }, select: { template: true } })
      if (!needsMet(m, sheets)) throw new WorkError('INVALID', `${m.id} needs sheets this project does not have`)
    }
    const next = input.enabled ? [...p.modules, m.id] : p.modules.filter((x) => x !== m.id)
    await tx.workProject.update({ where: { id: input.projectId }, data: { modules: next } })
    await writeWorkEvent(tx, key, { userId: input.userId, projectId: input.projectId, actor: input.actor, action: input.enabled ? 'module_enable' : 'module_disable', detail: { module: m.id } })
    return next
  }, { timeout: TX_TIMEOUT_MS })
}
