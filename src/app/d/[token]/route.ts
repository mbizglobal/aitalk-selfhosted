import { NextRequest, NextResponse } from 'next/server'
import { clientIpOf } from '@/lib/auth/app-rate-limit'
import { describeCaughtError } from '@/lib/log-mask'
import { defaultWorkFileDeps } from '@/lib/work/files'
import { allowPublicDownload, resolvePublicDownload } from '@/lib/work/public-download'

export const dynamic = 'force-dynamic'

const COMMON = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function notFound() {
  return new NextResponse('Not found', { status: 404, headers: { ...COMMON, 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!allowPublicDownload(clientIpOf(req.headers))) {
    return new NextResponse('Too many requests', { status: 429, headers: { ...COMMON, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' } })
  }
  const { token } = await ctx.params
  try {
    const found = await resolvePublicDownload(await defaultWorkFileDeps(), token)
    if (!found) return notFound()
    return new NextResponse(new Uint8Array(found.buffer), {
      status: 200,
      headers: {
        ...COMMON,
        'Content-Type': 'application/pdf',
        'Content-Length': String(found.buffer.length),
        'Content-Disposition': `attachment; filename="${found.fileName}"`,
      },
    })
  } catch (e) {
    console.error('[public-download] 실패:', describeCaughtError(e))
    return notFound()
  }
}
