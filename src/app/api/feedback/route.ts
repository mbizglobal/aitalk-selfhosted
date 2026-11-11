import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { sendFeedbackEmailBackground } from '@/lib/background-email';
import { getApiTranslation } from '@/lib/translations';
import { getFeedbackRecipient } from '@/lib/brand';
import { isSelfHosted } from '@/lib/edition';
import { emailService } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { describeCaughtError } from '@/lib/log-mask';

const REPLY_EVERY_MS = 24 * 60 * 60 * 1000
const lastReply = new Map<string, number>()

function claimAutoReply(userId: string, now = Date.now()): boolean {
  const last = lastReply.get(userId)
  if (last !== undefined && now - last < REPLY_EVERY_MS) return false
  if (lastReply.size > 10_000) for (const [k, v] of lastReply) if (now - v >= REPLY_EVERY_MS) lastReply.delete(k)
  lastReply.set(userId, now)
  return true
}

export async function POST(request: NextRequest) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as { user?: { id?: string; email?: string } } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 });
    }

    if (!getFeedbackRecipient()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json();
    const { content, email } = body;

    if (!content || !content.trim()) {
      return NextResponse.json({ error: t('api_error_feedback_content_required') }, { status: 400 });
    }

    const feedbackEmail = email || session.user.email || (isSelfHosted() ? 'anonymous' : 'anonymous@aitalk.ch');

    sendFeedbackEmailBackground(feedbackEmail, content.trim());

    const userId = session.user.id
    const to = session.user.email
    if (!isSelfHosted() && to && claimAutoReply(userId)) {
      void (async () => {
        try {
          const s = await prisma.settings.findUnique({ where: { id: userId }, select: { locale: true } })
          await emailService.sendSupportReceivedEmail(to, (s?.locale || 'en').slice(0, 2), {})
        } catch (e) { console.error('[feedback] auto reply', describeCaughtError(e)) }
      })()
    }

    return NextResponse.json({
      success: true,
      message: 'Feedback sent successfully'
    });

  } catch (error) {
    const t = getApiTranslation(request)
    console.error('Feedback submission error:', error);
    return NextResponse.json({
      error: t('api_error_failed_to_send_feedback')
    }, { status: 500 });
  }
}
