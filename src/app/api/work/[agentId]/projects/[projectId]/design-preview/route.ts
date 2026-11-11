
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { WorkError } from '@/lib/work/errors'
import { defaultWorkFileDeps } from '@/lib/work/files'
import { readJsonBody, workErrorResponse } from '@/lib/work/http'
import { renderDesignPreview } from '@/lib/work/design-preview'
import { resolveWorkTeamAccess, assertTeamProject } from '@/lib/work/team-access'

export async function POST(req: NextRequest, { params }: { params: Promise<{ agentId: string; projectId: string }> }) {
  try {
    const p = await params
    const access = await resolveWorkTeamAccess(req, p.agentId)
    if (!access) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    await assertTeamProject(access, p.projectId)
    const body = await readJsonBody(req)
    const lang = typeof body.lang === 'string' ? body.lang.slice(0, 5) : 'en'
    const docLang = typeof body.docLang === 'string' && body.docLang ? body.docLang.slice(0, 5) : undefined
    const docCurrency = typeof body.docCurrency === 'string' && /^[A-Za-z]{3}$/.test(body.docCurrency) ? body.docCurrency.toUpperCase() : undefined
    const pdf = await renderDesignPreview(await defaultWorkFileDeps(), { userId: access.userId, projectId: p.projectId, actor: access.actor, design: body.design, lang, docLang, docCurrency })
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(pdf.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (e) {
    if (e instanceof WorkError) return workErrorResponse(e)
    console.error('[work-api] design.preview', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
