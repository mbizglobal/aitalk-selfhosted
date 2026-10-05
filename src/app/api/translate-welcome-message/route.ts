import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import {
  createLLMClient,
  getConfiguredProviders,
  LLMProviderType,
} from '@/lib/ai-providers'
import { getProviderApiKey } from '@/lib/secret-vault'
import { AzureOpenAI } from 'openai'
import { getManagedAzureConfig } from '@/lib/managed/api-key'
import { getRegionById } from '@/lib/managed/regions'
import { chargeCPA, refundCPACharge } from '@/lib/cpa-service'

const TRANSLATION_MODELS: Record<LLMProviderType, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  claude: 'claude-sonnet-4-6',
  deepseek: 'deepseek-chat',
  grok: 'grok-4-1-fast-reasoning',
}

const PROVIDER_PRIORITY: LLMProviderType[] = ['openai', 'gemini', 'deepseek', 'grok', 'claude']

const MANAGED_TRANSLATION_MODEL = 'gpt-4.1-mini'
const MANAGED_TRANSLATION_CPA = 1

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  'pt-pt': 'Portuguese (Portugal)',
  'pt-br': 'Portuguese (Brazil)',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  el: 'Greek',
  tr: 'Turkish',
  cs: 'Czech',
  is: 'Icelandic',
  zh: 'Chinese (Simplified)',
  'zh-hk': 'Chinese (Traditional, Hong Kong)',
  'zh-tw': 'Chinese (Traditional, Taiwan)',
  ja: 'Japanese',
  ar: 'Arabic',
  he: 'Hebrew',
  ru: 'Russian',
  uk: 'Ukrainian',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  hi: 'Hindi',
}

function buildPrompt(sourceLang: string, targetLang: string, text: string) {
  const sourceLangName = LANGUAGE_NAMES[sourceLang.toLowerCase()] || sourceLang
  const targetLangName = LANGUAGE_NAMES[targetLang.toLowerCase()] || targetLang
  return {
    system: `You are a professional translator. Your task is to translate text accurately.

IMPORTANT RULES:
1. Translate the user's text from ${sourceLangName} to ${targetLangName}
2. Return ONLY the translated text
3. Do NOT add any explanations, notes, or additional content
4. Do NOT modify or expand the original meaning
5. Preserve the original tone and style`,
    user: `Translate this to ${targetLangName}:\n\n${text}`,
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    const body = await request.json()
    const { sourceLanguage, targetLanguage, text, agentId } = body as {
      sourceLanguage?: string
      targetLanguage?: string
      text?: string
      agentId?: string
    }

    if (!sourceLanguage || !targetLanguage || !text) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id: userId },
      select: { serviceVariant: true, managedRegion: true },
    })
    const isManaged = subscription?.serviceVariant === 'managed'

    const prompt = buildPrompt(sourceLanguage, targetLanguage, text)

    if (isManaged) {
      if (!agentId) {
        return NextResponse.json(
          { success: false, error: 'agentId required for managed translation', errorCode: 'AGENT_ID_REQUIRED' },
          { status: 400 }
        )
      }

      const agent = await prisma.agent.findFirst({
        where: { agentId, userId },
        select: { agentId: true },
      })
      if (!agent) {
        return NextResponse.json(
          { success: false, error: 'Agent not found', errorCode: 'AGENT_NOT_FOUND' },
          { status: 404 }
        )
      }

      const region = subscription?.managedRegion
      if (!region) {
        return NextResponse.json(
          {
            success: false,
            error: 'Managed region is not configured.',
            errorCode: 'MANAGED_REGION_MISSING',
          },
          { status: 200 }
        )
      }

      const regionInfo = getRegionById(region)
      if (
        !regionInfo ||
        !(regionInfo.models as readonly string[]).includes(MANAGED_TRANSLATION_MODEL)
      ) {
        console.error(
          `[translate-welcome-message] region '${region}' missing model '${MANAGED_TRANSLATION_MODEL}'`
        )
        return NextResponse.json(
          {
            success: false,
            error: 'Managed translation is not available for this region.',
            errorCode: 'MANAGED_UNAVAILABLE',
          },
          { status: 200 }
        )
      }

      let azureConfig
      try {
        azureConfig = await getManagedAzureConfig(region)
      } catch (error) {
        console.error('[translate-welcome-message] managed config error:', error)
        return NextResponse.json(
          {
            success: false,
            error: 'Managed service is not available for this region.',
            errorCode: 'MANAGED_UNAVAILABLE',
          },
          { status: 200 }
        )
      }

      const receipt = await chargeCPA(agentId, MANAGED_TRANSLATION_CPA)
      if (!receipt) {
        return NextResponse.json(
          {
            success: false,
            error: 'Insufficient CPA. Please upgrade your plan or purchase a booster.',
            errorCode: 'INSUFFICIENT_CPA',
          },
          { status: 200 }
        )
      }

      const azureClient = new AzureOpenAI({
        apiKey: azureConfig.apiKey,
        endpoint: azureConfig.endpoint,
        apiVersion: azureConfig.apiVersion,
        deployment: MANAGED_TRANSLATION_MODEL,
      })

      let translatedText = ''
      try {
        const completion = await azureClient.chat.completions.create({
          model: MANAGED_TRANSLATION_MODEL,
          temperature: 0.1,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        })
        translatedText = completion.choices[0]?.message?.content?.trim() || ''
      } catch (error) {
        console.error('[translate-welcome-message] managed LLM error:', error)
        await refundCPACharge(receipt)
        return NextResponse.json(
          { success: false, error: 'Translation failed' },
          { status: 500 }
        )
      }

      if (!translatedText) {
        await refundCPACharge(receipt)
        return NextResponse.json(
          { success: false, error: 'Empty translation' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        translatedText,
        provider: 'managed-azure',
        model: MANAGED_TRANSLATION_MODEL,
        cpaCharged: MANAGED_TRANSLATION_CPA,
      })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { aiProviders: true, zki: true }
    })

    if (!user || !user.encryptedDataKey || !user.aiProviders?.providers) {
      return NextResponse.json(
        {
          success: false,
          error: 'AI API key not configured. Please configure your API key in Settings.',
          errorCode: 'API_KEY_NOT_CONFIGURED'
        },
        { status: 200 }
      )
    }

    const configuredProviders = getConfiguredProviders(user)
    if (configuredProviders.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'AI API key not configured. Please configure your API key in Settings.',
          errorCode: 'API_KEY_NOT_CONFIGURED'
        },
        { status: 200 }
      )
    }

    let selectedProvider: LLMProviderType | null = null
    for (const provider of PROVIDER_PRIORITY) {
      if (configuredProviders.includes(provider)) {
        selectedProvider = provider
        break
      }
    }
    if (!selectedProvider) {
      selectedProvider = configuredProviders[0]
    }

    const apiKey = await getProviderApiKey(prisma, userId, selectedProvider, user)
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to get API key',
          errorCode: 'API_KEY_NOT_CONFIGURED'
        },
        { status: 200 }
      )
    }

    const client = createLLMClient(selectedProvider, apiKey)
    const model = TRANSLATION_MODELS[selectedProvider]

    const response = await client.chat(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      {
        model,
        temperature: 0.1,
      }
    )

    const translatedText = response.content?.trim() || ''

    return NextResponse.json({
      success: true,
      translatedText,
      provider: selectedProvider,
    })
  } catch (error) {
    console.error('Translation error:', error)
    return NextResponse.json(
      { error: 'Translation failed' },
      { status: 500 }
    )
  }
}
