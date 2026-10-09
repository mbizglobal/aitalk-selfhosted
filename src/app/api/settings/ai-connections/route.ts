import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { isSelfHosted } from '@/lib/edition'
import { isInstallAdmin } from '@/lib/auth/selfhosted-setup'
import { describeCaughtError } from '@/lib/log-mask'

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const optStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function GET() {
  if (!isSelfHosted()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = await getServerSession(authOptions as any) as any
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const canManage = await isInstallAdmin(session.user)
  if (!canManage) return NextResponse.json({ success: true, canManage: false, connections: [] })
  try {
    const { listAiConnections } = await import('@/lib/ai-connections/manage')
    const { pgvectorStatus } = await import('@/lib/knowledge/pgvector-status')
    const pgvector = await pgvectorStatus().catch((e) => { console.error('[ai-connections] pgvector check failed:', describeCaughtError(e)); return null })
    return NextResponse.json({ success: true, canManage: true, connections: await listAiConnections(), pgvector })
  } catch (e) {
    console.error('[ai-connections] list failed:', describeCaughtError(e))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!isSelfHosted()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = await getServerSession(authOptions as any) as any
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  if (!(await isInstallAdmin(session.user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const m = await import('@/lib/ai-connections/manage')
  const id = str(body?.id)
  const input = () => {
    let headers: Record<string, string> | undefined
    if (body?.headers !== undefined && body?.headers !== null && body?.headers !== '') {
      if (typeof body.headers !== 'object' || Array.isArray(body.headers)) throw new m.AiConnectionInputError('headers must be name → value')
      headers = body.headers
    }
    const max = body?.maxOutputTokens === null || body?.maxOutputTokens === '' || body?.maxOutputTokens === undefined ? null : Number(body.maxOutputTokens)
    return {
      name: str(body?.name), kind: str(body?.kind) as any, baseUrl: str(body?.baseUrl), apiKey: str(body?.apiKey),
      ...(headers !== undefined ? { headers } : {}),
      apiVersion: optStr(body?.apiVersion), textModel: str(body?.textModel), imageModel: optStr(body?.imageModel),
      embeddingModel: optStr(body?.embeddingModel), maxOutputTokens: max,
    }
  }

  try {
    switch (body?.action) {
      case 'create': return NextResponse.json({ success: true, id: await m.createAiConnection(input()) })
      case 'update': if (!id) break; await m.updateAiConnection(id, input()); return NextResponse.json({ success: true })
      case 'delete': if (!id) break; await m.deleteAiConnection(id); return NextResponse.json({ success: true })
      case 'setDefault': if (!id) break; await m.setDefaultAiConnection(id); return NextResponse.json({ success: true })
      case 'check': if (!id) break; return NextResponse.json({ success: true, check: await m.checkAiConnection(id) })
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (e) {
    if (e instanceof m.AiConnectionInputError) return NextResponse.json({ error: e.message }, { status: 400 })
    if (e instanceof m.AiConnectionNotFoundError || (e as { code?: string } | null)?.code === 'P2025') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('[ai-connections] action failed:', describeCaughtError(e))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
