
import { workRoute, readJsonBody } from '@/lib/work/http'
import { WorkError } from '@/lib/work/errors'
import { makeSpecDoc } from '@/lib/work/assembled-doc'
import { SPEC_SHEET_PREFIX } from '@/lib/work/assembled'

type P = { agentId: string; projectId: string }
const KEY = /^[a-z][a-z0-9_]{0,39}$/
const ID = /^[A-Za-z0-9_-]{1,40}$/

export const POST = workRoute<P>('spec-doc.make', async (req, { access, deps }, p) => {
  const b = await readJsonBody(req)
  if (typeof b.sheetId !== 'string' || !ID.test(b.sheetId) || typeof b.rowId !== 'string' || !ID.test(b.rowId) || typeof b.doc !== 'string' || !KEY.test(b.doc)) throw new WorkError('INVALID', 'sheetId, rowId and doc are required')
  const sheet = await deps.db.dataSheet.findFirst({ where: { id: b.sheetId, projectId: p.projectId, userId: access.userId, kind: 'project', template: null }, select: { name: true } })
  if (!sheet || !sheet.name.startsWith(SPEC_SHEET_PREFIX)) throw new WorkError('NOT_FOUND')
  return makeSpecDoc(deps, { userId: access.userId, projectId: p.projectId, table: sheet.name.slice(SPEC_SHEET_PREFIX.length), rowId: b.rowId, doc: b.doc, actor: access.actor })
})
