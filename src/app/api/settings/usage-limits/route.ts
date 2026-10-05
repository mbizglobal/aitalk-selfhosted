import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

type TimeUnit = 'minute' | 'hour' | 'day';

const unitToMinutes: Record<TimeUnit, number> = {
  minute: 1,
  hour: 60,
  day: 1440,
};

const parseNonNegativeInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
  }
  return null;
};

export async function POST(request: NextRequest) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 });
    }

    const userId = session.user.id;

    const body = await request.json();
    const {
      chatLimitCount,
      chatLimitUnit,
      chatLimitMessage,
      continuousAnswerLimit,
      continuousAnswerLimitMessage,
    } = body;

    const parsedChatLimitCount = parseNonNegativeInt(chatLimitCount);
    const parsedContinuousLimit = parseNonNegativeInt(continuousAnswerLimit);

    if (parsedChatLimitCount === null) {
      return NextResponse.json({ error: t('api_error_invalid_chat_limit_count') }, { status: 400 });
    }

    if (parsedContinuousLimit === null) {
      return NextResponse.json({ error: t('api_error_invalid_continuous_answer_limit') }, { status: 400 });
    }

    const unit: TimeUnit = ['minute', 'hour', 'day'].includes(chatLimitUnit)
      ? chatLimitUnit
      : 'day';

    const durationInMinutes = unitToMinutes[unit];


    await prisma.settings.upsert({
      where: { id: userId },
      update: {
        chat_limit_count: parsedChatLimitCount,
        chat_limit_duration_minutes: durationInMinutes,
        chat_limit_message: typeof chatLimitMessage === 'string' ? chatLimitMessage : null,
        continuous_answer_limit: parsedContinuousLimit,
        continuous_answer_limit_message:
          typeof continuousAnswerLimitMessage === 'string'
            ? continuousAnswerLimitMessage
            : null,
      },
      create: {
        id: userId,
        chat_limit_count: parsedChatLimitCount,
        chat_limit_duration_minutes: durationInMinutes,
        chat_limit_message: typeof chatLimitMessage === 'string' ? chatLimitMessage : null,
        continuous_answer_limit: parsedContinuousLimit,
        continuous_answer_limit_message:
          typeof continuousAnswerLimitMessage === 'string'
            ? continuousAnswerLimitMessage
            : null,
      },
    });

    return NextResponse.json({ success: true, message: 'Usage limits saved successfully.' });
  } catch (error) {
    console.error('Failed to update usage limits:', error);
    const t = getApiTranslation(request)
    return NextResponse.json(
      { error: t('api_error_failed_to_save_usage_limits') },
      { status: 500 }
    );
  }
}
