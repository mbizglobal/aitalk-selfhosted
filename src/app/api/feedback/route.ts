import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { sendFeedbackEmailBackground } from '@/lib/background-email';
import { getApiTranslation } from '@/lib/translations';
import { getFeedbackRecipient } from '@/lib/brand';
import { isSelfHosted } from '@/lib/edition';

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
