import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '../[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { ensurePendingSubscription } from '@/lib/auth/provision-user'
import { normalizeWidgetLanguage } from '@/lib/widget-settings'
import { isSelfHosted } from '@/lib/edition'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (isSelfHosted()) return NextResponse.json({ pending: false })

  try {
    const lang = normalizeWidgetLanguage((await cookies()).get('preferred-language')?.value)
    await ensurePendingSubscription(session.user.id, lang)

    const sub = await prisma.subscription.findUnique({
      where: { id: session.user.id },
      select: { signupSource: true },
    })
    const pending = !sub || sub.signupSource === 'web_pending'
    return NextResponse.json({ pending })
  } catch (e) {
    console.error('[access-status] failed:', e)
    return NextResponse.json({ pending: true })
  }
}
