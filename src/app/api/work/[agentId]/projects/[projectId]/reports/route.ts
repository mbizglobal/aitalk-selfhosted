
import { NextResponse } from 'next/server'
import { workRoute } from '@/lib/work/http'
import { isSelfHosted } from '@/lib/edition'
import { describeCaughtError } from '@/lib/log-mask'
import { readTurnRequest } from '@/lib/work/turn-attachments'
import { createReport } from '@/lib/work/reports'
import { emailService } from '@/lib/email'

const LANGS = new Set(['en', 'de', 'fr', 'ko'])

const post = workRoute<{ agentId: string; projectId: string }>('report.create', async (req, { access, deps }, p) => {
  const { payload, parts } = await readTurnRequest(req)
  const lang = typeof payload.lang === 'string' && LANGS.has(payload.lang) ? payload.lang : 'en'
  const r = await createReport(deps, { access, projectId: p.projectId, payload, parts, lang })
  void (async () => {
    try { await emailService.sendSupportReportNotice({ number: r.number, appId: r.appId, source: r.source, fileCount: r.fileCount, failures: r.failures, reportId: r.id, reporterEmail: r.reporterEmail, note: r.note }) } catch (e) { console.error('[work-report] notice mail', describeCaughtError(e)) }
    if (r.reporterEmail) {
      try { await emailService.sendSupportReceivedEmail(r.reporterEmail, lang, { number: r.number, fileCount: r.fileCount }) } catch (e) { console.error('[work-report] received mail', describeCaughtError(e)) }
    }
  })()
  return { number: r.number, mailed: !!r.reporterEmail }
})

export async function POST(req: Parameters<typeof post>[0], ctx: Parameters<typeof post>[1]) {
  if (isSelfHosted()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return post(req, ctx)
}
