import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getConnectionSecret } from '@/lib/secret-vault'
import { isTelegramChatId } from '@/lib/work/app-chat'

const TEXT = 'AI Talk — test message. Telegram alerts of this work app will arrive in this chat.'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { agentId?: unknown; connectionId?: unknown; chatId?: unknown } | null
  const agentId = typeof body?.agentId === 'string' ? body.agentId : ''
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : ''
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : ''
  if (!agentId) return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
  if (!isTelegramChatId(chatId)) return NextResponse.json({ result: 'bad_format' })

  const agent = await prisma.agent.findFirst({ where: { agentId, userId }, select: { agentId: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const conn = connectionId
    ? await prisma.workflowConnection.findFirst({ where: { id: connectionId, agentId, userId, provider: 'telegram', status: 'active' }, select: { id: true, encryptedToken: true } })
    : null
  if (!conn?.encryptedToken) return NextResponse.json({ result: 'no_bot' })

  try {
    const token = await getConnectionSecret(prisma, userId, conn.id, conn.encryptedToken)
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: TEXT }),
      signal: AbortSignal.timeout(15_000),
    })
    const json = await res.json().catch(() => null) as { ok?: unknown; description?: unknown } | null
    if (res.ok && json?.ok === true) return NextResponse.json({ result: 'sent' })
    const desc = typeof json?.description === 'string' ? json.description.slice(0, 200) : ''
    console.warn('[telegram test-chat] not sent:', res.status, desc)
    if (res.status === 401 || res.status === 404) return NextResponse.json({ result: 'bad_bot' })
    if (res.status === 403) return NextResponse.json({ result: 'not_in_chat' })
    if (res.status === 400 && /chat not found/i.test(desc)) return NextResponse.json({ result: 'bad_chat' })
    return NextResponse.json({ result: 'failed' })
  } catch (e) {
    console.error('[telegram test-chat] error:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return NextResponse.json({ result: 'failed' })
  }
}
