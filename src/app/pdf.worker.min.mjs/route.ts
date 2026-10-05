import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'

let cached: Buffer | null = null

export async function GET() {
  try {
    cached ??= await readFile(path.join(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'))
    return new NextResponse(new Uint8Array(cached), {
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('[pdf-worker] read failed:', describeCaughtError(error))
    return NextResponse.json({ error: 'Not available' }, { status: 500 })
  }
}
