import { NextResponse, type NextRequest } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workErrorResponse } from '@/lib/work/http'
import { defaultWorkFileDeps } from '@/lib/work/files'
import { assertTeamProject, resolveWorkTeamAccess } from '@/lib/work/team-access'
import { EXPORT_MAX_ROWS, readAllRows, webScreenRows } from '@/lib/work/sheet-app'
import { sheetExportTable } from '@/lib/work/sheet-text'
import { appLang } from '@/lib/work/app-screen'
import { packageOfKind } from '@/lib/translations/work'
import { TABLE_EXPORT_FORMATS, TABLE_EXPORT_TYPES, exportTable, parseExportTable, type TableExportFormat } from '@/lib/work/table-export'
import { evidenceOf, pageQuery } from '@/lib/work/sheet-page-query'

export async function POST(req: NextRequest, { params }: { params: Promise<{ agentId: string; projectId: string; sheetId: string }> }) {
  try {
    const p = await params
    const access = await resolveWorkTeamAccess(req, p.agentId)
    if (!access) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    await assertTeamProject(access, p.projectId)
    const b = await readJsonBody(req)
    if (!(TABLE_EXPORT_FORMATS as readonly unknown[]).includes(b.format)) throw new WorkError('INVALID', 'format must be xlsx, csv or pdf')
    const format = b.format as TableExportFormat
    const lang = appLang(typeof b.lang === 'string' ? b.lang : null)
    const q = b.query && typeof b.query === 'object' && !Array.isArray(b.query) ? (b.query as Record<string, unknown>) : {}
    const sp = new URLSearchParams()
    for (const k of ['year', 'from', 'to', 'sort', 'hidden', 'f0', 'f1', 'f2', 'evidence']) if (typeof q[k] === 'string') sp.set(k, q[k] as string)
    const page = pageQuery(sp)
    const deps = await defaultWorkFileDeps()
    const proj = await deps.db.workProject.findFirst({ where: { id: p.projectId, userId: access.userId }, select: { kind: true } })
    const pkg = packageOfKind(proj?.kind)
    const read = await readAllRows(deps, { userId: access.userId, projectId: p.projectId }, p.sheetId, page, null)
    const list = webScreenRows(lang, pkg, read.first, read.list, { period: page.period, showHidden: page.showHidden, evidence: evidenceOf(sp), sort: page.sort ?? null })
    if (list.length > EXPORT_MAX_ROWS) throw new WorkError('INVALID', `more than ${EXPORT_MAX_ROWS} rows — choose a shorter period`)
    const out = await exportTable(format, parseExportTable(sheetExportTable(lang, pkg, read.first, list, read.cells)))
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    const name = `${(read.first.name || 'sheet').replace(/[^\p{L}\p{N}._-]+/gu, '_')}-${stamp}.${format}`
    return new NextResponse(new Uint8Array(out), {
      headers: {
        'Content-Type': TABLE_EXPORT_TYPES[format], 'Content-Length': String(out.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="export.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    })
  } catch (e) {
    if (e instanceof WorkError) return workErrorResponse(e)
    console.error('[work-api] sheet.export', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
