import { getApiTranslation } from '@/lib/translations'
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { encryptData } from '@/lib/encryption';
import { getTimezoneByLanguage, getTimeFormatByLanguage } from '@/lib/timezone-helper'
import OpenAI from 'openai';

async function checkApiKeyConfigured(userId: string): Promise<boolean> {
  const aiProviders = await prisma.aiProviders.findUnique({
    where: { id: userId }
  });

  if (aiProviders?.providers) {
    try {
      const providersConfig = JSON.parse(aiProviders.providers);
      for (const [, config] of Object.entries(providersConfig)) {
        if ((config as any)?.apiKey) {
          return true;
        }
      }
    } catch (e) {
    }
  }

  return false;
}

export async function GET(request: Request) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 });
    }

    const userId = session.user.id;

    const settings = await prisma.settings.findUnique({
      where: { id: userId }
    });

    const subscription = await prisma.subscription.findUnique({
      where: { id: userId },
      select: { serviceVariant: true, managedRegion: true }
    });
    const apiKeyConfigured = subscription?.serviceVariant === 'managed'
      ? true
      : await checkApiKeyConfigured(userId);

    if (!settings) {
      let language = 'en';
      let locale = 'en-US';

      try {
        const url = new URL(request.url);
        const referer = request.headers.get('referer');

        if (referer) {
          const refererUrl = new URL(referer);
          const langParam = refererUrl.searchParams.get('lang');
          if (langParam && ['en', 'de', 'fr', 'es', 'ko'].includes(langParam)) {
            language = langParam;
          }
        }

        const langParam = url.searchParams.get('lang');
        if (langParam && ['en', 'de', 'fr', 'es', 'ko'].includes(langParam)) {
          language = langParam;
        }
      } catch (e) {
      }

      if (language === 'de') {
        locale = 'de-DE';
      } else if (language === 'fr') {
        locale = 'fr-FR';
      } else if (language === 'es') {
        locale = 'es-ES';
      } else if (language === 'ko') {
        locale = 'ko-KR';
      }

      const supportedLanguages: Array<'en' | 'de' | 'fr' | 'es' | 'ko'> = ['en', 'de', 'fr', 'es', 'ko']
      const normalizedLanguage: 'en' | 'de' | 'fr' | 'es' | 'ko' = supportedLanguages.includes(language as any)
        ? (language as 'en' | 'de' | 'fr' | 'es' | 'ko')
        : 'en'

      const timezone = getTimezoneByLanguage(normalizedLanguage)
      const timeFormat = getTimeFormatByLanguage(normalizedLanguage)

      return NextResponse.json({
        success: true,
        settings: {
          id: userId,
          timezone,
          locale,
          time_format: timeFormat,
          plan: 'free',
          api_key_configured: apiKeyConfigured,
          serviceVariant: subscription?.serviceVariant || 'self',
          managedRegion: subscription?.managedRegion || null,
          createdAt: null,
          updatedAt: null
        }
      });
    }

    return NextResponse.json({
      success: true,
      settings: {
        ...settings,
        api_key_configured: apiKeyConfigured,
        serviceVariant: subscription?.serviceVariant || 'self',
        managedRegion: subscription?.managedRegion || null,
      }
    });
  } catch (error) {
    console.error('[SETTINGS_API] Error in GET:', error);
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null;

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 });
    }

    const userId = session.user.id;

    const body = await request.json();
    const { openaiApiKey, checkAgents = false } = body;

    if (!openaiApiKey || typeof openaiApiKey !== 'string') {
      return NextResponse.json({ error: t('api_error_openai_api_key_required') }, { status: 400 });
    }

    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    try {
      await openai.models.list();
    } catch (error) {
      return NextResponse.json({ error: t('api_error_invalid_openai_api_key') }, { status: 400 });
    }

    const encryptedKey = await encryptData(openaiApiKey);

    const existingAiProviders = await prisma.aiProviders.findUnique({
      where: { id: userId }
    });

    let providersConfig: Record<string, any> = {};
    if (existingAiProviders?.providers) {
      try {
        providersConfig = JSON.parse(existingAiProviders.providers);
      } catch (e) {
      }
    }

    providersConfig.openai = {
      apiKey: encryptedKey,
      updatedAt: new Date().toISOString()
    };

    await prisma.aiProviders.upsert({
      where: { id: userId },
      update: {
        providers: JSON.stringify(providersConfig),
      },
      create: {
        id: userId,
        providers: JSON.stringify(providersConfig),
        defaultProvider: 'openai',
      }
    });

    let createdVectorStores = [];

    if (checkAgents) {
        const agents = await prisma.agent.findMany({
          where: { id: userId }
      });

      for (const agent of agents) {
        if (!agent.vectorStoreId || !agent.vectorStoreName) {
          try {
            const vectorStore = await openai.vectorStores.create({
              name: `AITalk_Agent${agent.agentId}`
            });

            await prisma.agent.update({
              where: { agentId: agent.agentId },
              data: {
                vectorStoreId: vectorStore.id,
                vectorStoreName: vectorStore.name,
                updatedAt: new Date()
              }
            });

            createdVectorStores.push({
              agentId: agent.agentId,
              vectorStoreId: vectorStore.id,
              vectorStoreName: vectorStore.name
            });

          } catch (error) {
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'OpenAI API Key saved successfully',
      createdVectorStores: createdVectorStores.length > 0 ? createdVectorStores : undefined
    });

  } catch (error) {
    console.error('[SETTINGS_API] Error in POST:', error);
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 });
  }
}
