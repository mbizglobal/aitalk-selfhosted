import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { setDefaultAgentGreeting } from '@/lib/onboarding/agent-greeting'

const MAX_GREETING = 500

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const greeting = String(body?.greeting ?? '').trim().slice(0, MAX_GREETING)
  const language = body?.language ? String(body.language).trim().slice(0, 10) : undefined
  if (!greeting) {
    return NextResponse.json({ error: 'Greeting is required', code: 'EMPTY_GREETING' }, { status: 400 })
  }
  const updated = await setDefaultAgentGreeting(session.user.id, { greeting, language })
  if (updated === 0) {
    return NextResponse.json({ error: 'No agent workflow to update', code: 'NO_WORKFLOW' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, updated })
}
