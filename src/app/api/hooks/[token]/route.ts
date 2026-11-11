import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { defaultWorkSheetDeps } from '@/lib/work/sheet-gate'
import { addWebhookRow, WEBHOOK_BODY_LIMIT } from '@/lib/work/webhook'
import { readLimited } from '@/lib/work/read-limited'

export const dynamic = 'force-dynamic'

const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const json = (body: unknown, status: number, extra?: Record<string, string>) => NextResponse.json(body, { status, headers: { ...H, ...extra } })

type Ctx = { params: Promise<{ token: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, 415)
  const len = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(len) && len > WEBHOOK_BODY_LIMIT) return json({ error: 'TOO_LARGE' }, 413)
  let body: unknown
  try {
    const text = await readLimited(req, WEBHOOK_BODY_LIMIT)
    if (text === null) return json({ error: 'TOO_LARGE' }, 413)
    body = JSON.parse(text)
  } catch {
    return json({ error: 'INVALID', detail: 'the body is not valid JSON' }, 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'INVALID', detail: 'the body must be a JSON object' }, 400)
  try {
    const r = await addWebhookRow(await defaultWorkSheetDeps(), { token, body, headerId: req.headers.get('idempotency-key') })
    if (r.ok) return json(r.duplicate ? { ok: true, duplicate: true } : { ok: true }, 200)
    if (r.code === 'INVALID') return json({ error: 'INVALID', detail: r.detail }, 400)
    if (r.code === 'LIMIT') return json({ error: 'LIMIT' }, 429, { 'Retry-After': '600' })
    if (r.code === 'RATE') return json({ error: 'LIMIT' }, 429, { 'Retry-After': '60' })
    if (r.code === 'TAKEN') return json({ error: 'TAKEN' }, 409)
    return json({ error: 'NOT_FOUND' }, 404)
  } catch (e) {
    console.error('[webhook] 실패:', describeCaughtError(e))
    return json({ error: 'INTERNAL' }, 500)
  }
}

const notAllowed = () => json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' })
export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE }
