import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getDefaultAgentGreeting } from '@/lib/onboarding/agent-greeting'
import { isSelfHosted } from '@/lib/edition'

const ONBOARDING_FEATURE_SINCE = new Date('2026-06-17T14:00:00Z')

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const settings = await prisma.settings.findUnique({
    where: { id: userId },
    select: { onboardingCompletedAt: true, plan: true, createdAt: true, onboardingProfile: true, accountType: true },
  })
  const agent = await prisma.agent.findFirst({
    where: { userId, isDefault: true },
    select: { agentId: true },
  })

  const completed =
    isSelfHosted() ||
    !settings ||
    settings.onboardingCompletedAt != null ||
    settings.createdAt < ONBOARDING_FEATURE_SINCE

  const canVoice = !isSelfHosted() && !(settings?.plan || 'free').toLowerCase().includes('free')

  const intro = await getDefaultAgentGreeting(userId)

  return NextResponse.json({
    completed,
    agentId: agent?.agentId ?? null,
    canVoice,
    greeting: intro?.greeting ?? '',
    language: intro?.language ?? '',
    profile: settings?.onboardingProfile ?? null,
    accountType: settings?.accountType ?? null,
  })
}

const PROFILE_KEYS = ['address', 'services', 'hours', 'holidays', 'other'] as const
function sanitizeProfile(input: any): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null
  const out: Record<string, string> = {}
  for (const k of PROFILE_KEYS) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 4000)
  }
  return Object.keys(out).length > 0 ? out : null
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const body = await request.json().catch(() => ({}))
  const profile = sanitizeProfile(body?.profile)

  await prisma.settings.upsert({
    where: { id: userId },
    update: { onboardingCompletedAt: new Date(), ...(profile ? { onboardingProfile: profile } : {}) },
    create: { id: userId, onboardingCompletedAt: new Date(), ...(profile ? { onboardingProfile: profile } : {}) },
  })
  return NextResponse.json({ ok: true })
}
