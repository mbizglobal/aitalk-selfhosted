
import { WorkError } from './errors'
import { appTemplateOf } from './app-templates'
import { readProjectFile, type WorkFileDeps } from './files'
import { readProjectSheet, type SheetActor } from './sheet-gate'
import { findTemplate } from './sheet-templates'

export const PREVIEW_READ_MERGE_MS = 10 * 60_000

export async function renderDesignPreview(
  deps: WorkFileDeps,
  q: { userId: string; projectId: string; actor: SheetActor; design: unknown; lang: string; docLang?: string; docCurrency?: string },
): Promise<Buffer> {
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  const tpl = appTemplateOf(p.kind)
  if (!tpl?.ui.design || !tpl.designPreview) throw new WorkError('NOT_FOUND', 'this app has no design tab')
  if (!q.design || typeof q.design !== 'object' || Array.isArray(q.design)) throw new WorkError('INVALID', 'design must be an object')

  const sheet = await deps.db.dataSheet.findFirst({
    where: { kind: 'project', projectId: q.projectId, userId: q.userId, templateFamily: tpl.ui.design.family },
    select: { id: true, template: true },
    orderBy: { id: 'asc' },
  })
  if (!sheet) throw new WorkError('NOT_FOUND', 'the design sheet is missing')
  const { rows } = await readProjectSheet(deps, { userId: q.userId, projectId: q.projectId, sheetId: sheet.id })
  const profile = rows[0]?.data ?? null

  const column = sheet.template ? findTemplate(deps.templates, sheet.template).ui?.image?.column : undefined
  const fileId = column && profile && typeof profile[column] === 'string' ? (profile[column] as string) : null
  let logo: Buffer | null = null
  if (fileId) {
    const owned = await deps.db.workFile.findFirst({ where: { id: fileId, projectId: q.projectId, userId: q.userId }, select: { id: true } })
    if (owned) logo = (await readProjectFile(deps, { userId: q.userId, fileId, actor: q.actor, mergeReadMs: PREVIEW_READ_MERGE_MS })).buffer
  }

  const files: Record<string, Buffer> = {}
  for (const f of tpl.ui.design.fields) {
    if (f.kind !== 'file' || !profile || typeof profile[f.name] !== 'string') continue
    const id = profile[f.name] as string
    const owned = await deps.db.workFile.findFirst({ where: { id, projectId: q.projectId, userId: q.userId }, select: { id: true } })
    if (owned) files[f.name] = (await readProjectFile(deps, { userId: q.userId, fileId: id, actor: q.actor, mergeReadMs: PREVIEW_READ_MERGE_MS })).buffer
  }

  return tpl.designPreview({ profile, logo, design: q.design as Record<string, unknown>, lang: q.lang, ...(q.docLang ? { docLang: q.docLang } : {}), ...(q.docCurrency ? { docCurrency: q.docCurrency } : {}), files })
}
