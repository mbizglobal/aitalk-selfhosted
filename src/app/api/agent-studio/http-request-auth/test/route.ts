import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getConnectionSecret } from '@/lib/secret-vault'
import { httpUrlValid } from '@/lib/work/http-target'
import { authHeaders } from '@/lib/work/work-senders/http'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { agentId?: unknown; label?: unknown } | null
  const agentId = typeof body?.agentId === 'string' ? body.agentId : ''
  const label = typeof body?.label === 'string' ? body.label : ''
  if (!agentId || !label) return NextResponse.json({ error: 'agentId and label are required' }, { status: 400 })

  const agent = await prisma.agent.findFirst({ where: { agentId, userId }, select: { agentId: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const conn = await prisma.workflowConnection.findFirst({ where: { agentId, userId, provider: 'http_request', label, status: 'active' }, select: { id: true, encryptedToken: true } })
  if (!conn?.encryptedToken) return NextResponse.json({ result: 'no_connection' })

  let cred: Record<string, unknown> = {}
  try {
    const v = JSON.parse(await getConnectionSecret(prisma, userId, conn.id, conn.encryptedToken))
    if (v && typeof v === 'object') cred = v
  } catch {
    return NextResponse.json({ result: 'no_connection' })
  }
  const url = typeof cred.url === 'string' ? cred.url : ''
  if (!url || !httpUrlValid(url)) return NextResponse.json({ result: 'no_url' })
  const auth = authHeaders(cred)
  if (!auth) return NextResponse.json({ result: 'auth_unsupported' })

  try {
    const { safeFetch, SSRFError, DnsLookupError } = await import('@/lib/ssrfGuard')
    let res: Response
    try {
      res = await safeFetch(url, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'X-AITalk-Test': '1' },
        body: JSON.stringify({ aitalkTest: true, note: 'AI Talk — test from the studio. No row data.' }),
        signal: AbortSignal.timeout(15_000),
      }, 0)
    } catch (e) {
      if (e instanceof SSRFError || e instanceof DnsLookupError) return NextResponse.json({ result: 'blocked' })
      if (e instanceof Error && e.message.startsWith('Too many redirects')) return NextResponse.json({ result: 'redirect' })
      console.warn('[http test-send] no answer:', e instanceof Error ? e.name : 'error')
      return NextResponse.json({ result: 'no_answer' })
    }
    res.body?.cancel().catch(() => {})
    if (res.status >= 200 && res.status < 300) return NextResponse.json({ result: 'sent' })
    if (res.status >= 300 && res.status < 400) return NextResponse.json({ result: 'redirect' })
    if (res.status === 401 || res.status === 403) return NextResponse.json({ result: 'auth_refused', status: res.status })
    if (res.status >= 400 && res.status < 500) return NextResponse.json({ result: 'refused', status: res.status })
    return NextResponse.json({ result: 'server_error', status: res.status })
  } catch (e) {
    console.error('[http test-send] error:', e instanceof Error ? e.name : 'error')
    return NextResponse.json({ result: 'no_answer' })
  }
}
