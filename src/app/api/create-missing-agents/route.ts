import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { createDefaultAgent } from '@/lib/agent'
import { isSelfHosted } from '@/lib/edition'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const existing = await prisma.agent.count({ where: { userId } })
    if (existing > 0) {
      return NextResponse.json({ success: true, results: [] })
    }

    const subscription = isSelfHosted() ? null : await prisma.subscription.findUnique({
      where: { id: userId },
      select: { num_assistant: true, signupSource: true },
    })

    if (subscription?.signupSource === 'web_pending') {
      return NextResponse.json({ success: true, results: [], pending: true })
    }

    const limit = isSelfHosted() ? SELF_HOSTED_POLICY.agentLimit : (subscription?.num_assistant || 1)
    if (existing >= limit) {
      return NextResponse.json({ success: true, results: [] })
    }

    const settings = await prisma.settings.findUnique({
      where: { id: userId },
      select: { locale: true },
    })
    const locale = settings?.locale || 'en-US'
    const languageMap: Record<string, 'en' | 'de' | 'fr' | 'es' | 'ko'> = {
      'en-US': 'en', 'de-DE': 'de', 'fr-FR': 'fr', 'es-ES': 'es', 'ko-KR': 'ko',
    }
    const language = languageMap[locale] || 'en'

    const agent = await createDefaultAgent(userId, language, prisma)
    return NextResponse.json({
      success: true,
      results: [{ userId, agentId: agent.agentId, success: true }],
    })
  } catch (error) {
    console.error('[create-missing-agents] failed:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to create missing agent' },
      { status: 500 }
    )
  }
}
