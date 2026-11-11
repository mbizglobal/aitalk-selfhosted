import { NextRequest, NextResponse } from 'next/server'
import { clientIpOf } from '@/lib/auth/app-rate-limit'
import { describeCaughtError } from '@/lib/log-mask'
import { defaultWorkSheetDeps } from '@/lib/work/sheet-gate'
import { addIntakeFormRow, allowIntakeSubmit, INTAKE_BODY_LIMIT } from '@/lib/work/intake-form'
import { readLimited } from '@/lib/work/read-limited'

export const dynamic = 'force-dynamic'

const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: H })

export async function POST(req: NextRequest) {
  if (!allowIntakeSubmit(clientIpOf(req.headers))) return json({ error: 'LIMIT' }, 429)
  const len = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(len) && len > INTAKE_BODY_LIMIT) return json({ error: 'TOO_LARGE' }, 413)
  let body: Record<string, unknown>
  try {
    const text = await readLimited(req, INTAKE_BODY_LIMIT)
    if (text === null) return json({ error: 'TOO_LARGE' }, 413)
    const b = JSON.parse(text)
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'NOT_FOUND' }, 404)
    body = b
  } catch {
    return json({ error: 'NOT_FOUND' }, 404)
  }
  try {
    const r = await addIntakeFormRow(await defaultWorkSheetDeps(), { token: body.token, values: body.values, opened: body.opened, trap: body.hp })
    if (r.ok) return json({ ok: true }, 200)
    if (r.code === 'INVALID') return json({ error: 'INVALID', detail: r.detail }, 400)
    if (r.code === 'LIMIT') return json({ error: 'LIMIT' }, 429)
    if (r.code === 'TAKEN') return json({ error: 'TAKEN' }, 409)
    if (r.code === 'TOO_SOON' || r.code === 'EXPIRED') return json({ error: r.code }, 400)
    return json({ error: 'NOT_FOUND' }, 404)
  } catch (e) {
    console.error('[public-intake] 실패:', describeCaughtError(e))
    return json({ error: 'INTERNAL' }, 500)
  }
}
