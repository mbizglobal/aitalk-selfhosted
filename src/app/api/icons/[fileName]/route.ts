import { NextRequest, NextResponse } from 'next/server'
import { isSelfHosted } from '@/lib/edition'
import { selfHostedFileStore } from '@/lib/file-store'
import { ICON_FILE_NAME } from '@/lib/s3'
import { describeCaughtError } from '@/lib/log-mask'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileName: string }> }) {
  if (!isSelfHosted()) return new NextResponse(null, { status: 404 })
  const { fileName } = await params
  if (!ICON_FILE_NAME.test(fileName)) return new NextResponse(null, { status: 404 })
  let data: Buffer
  try {
    data = await selfHostedFileStore().get(`icons/${fileName}`)
  } catch (e) {
    const code = (e as { code?: string; name?: string })?.code ?? (e as { name?: string })?.name
    if (code === 'ENOENT' || code === 'NoSuchKey') return new NextResponse(null, { status: 404 })
    console.error('[icons] read failed:', describeCaughtError(e))
    return new NextResponse(null, { status: 500 })
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'public, max-age=86400',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  })
}
