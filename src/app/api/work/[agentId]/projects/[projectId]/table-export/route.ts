
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workErrorResponse } from '@/lib/work/http'
import { TABLE_EXPORT_FORMATS, TABLE_EXPORT_TYPES, exportTable, parseExportTable, type TableExportFormat } from '@/lib/work/table-export'
import { resolveWorkTeamAccess, assertTeamProject } from '@/lib/work/team-access'

export async function POST(req: NextRequest, { params }: { params: Promise<{ agentId: string; projectId: string }> }) {
  try {
    const p = await params
    const access = await resolveWorkTeamAccess(req, p.agentId)
    if (!access) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    await assertTeamProject(access, p.projectId)
    const body = await readJsonBody(req)
    if (!(TABLE_EXPORT_FORMATS as readonly unknown[]).includes(body.format)) throw new WorkError('INVALID', 'format must be xlsx, csv or pdf')
    const format = body.format as TableExportFormat
    const out = await exportTable(format, parseExportTable(body.table))
    return new NextResponse(new Uint8Array(out), {
      headers: { 'Content-Type': TABLE_EXPORT_TYPES[format], 'Content-Length': String(out.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (e) {
    if (e instanceof WorkError) return workErrorResponse(e)
    console.error('[work-api] table.export', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
