import { WorkError } from './errors'
import { readProjectFile, type WorkFileDeps } from './files'
import { readProjectReferences } from './references'
import { templateId } from './sheet-templates'
import type { SheetActor } from './sheet-gate'

const ID = /^[A-Za-z0-9_-]{1,64}$/

export async function referencedFileSource(deps: WorkFileDeps, q: { userId: string; projectId: string; fileId: string }): Promise<string | null> {
  if (!ID.test(q.fileId)) return null
  const reader = await readProjectReferences(deps, { userId: q.userId, projectId: q.projectId })
  for (const ref of reader.references()) {
    for (const s of reader.sheets(ref.referenceId)) {
      const tpl = s.template ? deps.templates.find((t) => templateId(t) === s.template) : undefined
      const cols = [tpl?.ui?.file, tpl?.ui?.moreFiles].filter((c): c is string => typeof c === 'string')
      if (!cols.length) continue
      for (const r of reader.rows(ref.referenceId, s.id)) {
        for (const c of cols) {
          const v = r.data[c]
          if (typeof v === 'string' && v.split(',').some((x) => x.trim() === q.fileId)) return ref.sourceProjectId
        }
      }
    }
  }
  return null
}

export async function readReferencedFile(deps: WorkFileDeps, q: { userId: string; projectId: string; fileId: string; actor: SheetActor }) {
  const source = await referencedFileSource(deps, q)
  if (!source) throw new WorkError('NOT_FOUND')
  const own = await deps.db.workFile.findFirst({ where: { id: q.fileId, projectId: source, userId: q.userId, parentFileId: null }, select: { id: true } })
  if (!own) throw new WorkError('NOT_FOUND')
  return readProjectFile(deps, { userId: q.userId, fileId: q.fileId, actor: q.actor })
}
