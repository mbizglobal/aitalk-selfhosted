import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { isSelfHosted } from '@/lib/edition'
import { poweredByRuleFor } from '@/lib/selfhosted-policy'
import {
  mergeWidgetSettings,
  mergeWidgetButtonSettings,
  extractButtonSettings,
  extractChatSettings,
  WidgetSettings
} from '@/lib/widget-settings'
import { getLanguageFromHeaders, getTranslations, getErrorMessage } from '@/lib/translations/dashboard'

export async function GET(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')

    let parsedChatSettings: Partial<WidgetSettings> | null = null
    let parsedButtonSettings: any = null

    if (agentId) {
      const agent = await prisma.agent.findFirst({
        where: {
          agentId: agentId,
          userId: session.user.id
        },
        select: {
          widgetSettings: true,
          widgetButtonSettings: true
        }
      })

      if (agent?.widgetSettings) {
        try {
          parsedChatSettings = JSON.parse(agent.widgetSettings)
        } catch (error) {
          // Failed to parse widget settings JSON
        }
      }

      if (agent?.widgetButtonSettings) {
        try {
          parsedButtonSettings = JSON.parse(agent.widgetButtonSettings)
        } catch (error) {
          // Failed to parse widget button settings JSON
        }
      }
    } else {
      const agent = await prisma.agent.findFirst({
        where: { userId: session.user.id },
        select: {
          widgetSettings: true,
          widgetButtonSettings: true
        },
        orderBy: { createdAt: 'asc' }
      })

      if (agent?.widgetSettings) {
        try {
          parsedChatSettings = JSON.parse(agent.widgetSettings)
        } catch (error) {
          // Failed to parse widget settings JSON
        }
      }

      if (agent?.widgetButtonSettings) {
        try {
          parsedButtonSettings = JSON.parse(agent.widgetButtonSettings)
        } catch (error) {
          // Failed to parse widget button settings JSON
        }
      }
    }

    // Merge chat settings and button settings
    const merged = mergeWidgetSettings({
      ...parsedChatSettings,
      ...parsedButtonSettings,
    })

    const selfHosted = isSelfHosted()
    const subscription = selfHosted ? null : await prisma.subscription.findUnique({
      where: { id: session.user.id },
      select: { planType: true, serviceVariant: true, status: true }
    })

    const planType = (subscription?.status === 'active' ? subscription?.planType : 'free') || 'free'
    const serviceVariant = subscription?.serviceVariant || 'self'

    const plan = !selfHosted && planType === 'free' ? 'free' : 'paid'

    return NextResponse.json({
      success: true,
      settings: merged,
      plan,
      planType,
      serviceVariant,
      poweredByRule: poweredByRuleFor(selfHosted, planType, serviceVariant),
    })
  } catch (error) {
    const t = getTranslations(language)
    return NextResponse.json({ error: t.chat_settings_load_failed }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as { settings?: unknown; agentId?: string } | null

    if (!body || typeof body.settings !== 'object' || body.settings === null) {
      return NextResponse.json({ error: t.chat_settings_invalid_payload }, { status: 400 })
    }

    const merged = mergeWidgetSettings(body.settings as Partial<WidgetSettings>)

    // Extract button settings and chat settings
    const buttonSettings = extractButtonSettings(merged)
    const chatSettings = extractChatSettings(merged)

    // Serialize to JSON
    const buttonJson = JSON.stringify(buttonSettings)
    const chatJson = JSON.stringify(chatSettings)

    let widgetIconUrl = null
    if (buttonSettings.customIconData) {
      if (typeof buttonSettings.customIconData === 'string' &&
          buttonSettings.customIconData.startsWith('https://')) {
        widgetIconUrl = buttonSettings.customIconData
      }
    }

    if (body.agentId) {
      const agent = await prisma.agent.findFirst({
        where: {
          agentId: body.agentId,
          userId: session.user.id
        }
      })

      if (!agent) {
        return NextResponse.json({ error: getErrorMessage('chat_settings_agent_not_found', language) }, { status: 404 })
      }

      await prisma.agent.update({
        where: { agentId: body.agentId },
        data: {
          widgetSettings: chatJson,           // Chat settings only
          widgetButtonSettings: buttonJson,   // Button + Welcome Message
          widgetIconUrl: widgetIconUrl,
        }
      })
    } else {
      const agent = await prisma.agent.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'asc' }
      })

      if (agent) {
        await prisma.agent.update({
          where: { agentId: agent.agentId },
          data: {
            widgetSettings: chatJson,           // Chat settings only
            widgetButtonSettings: buttonJson,   // Button + Welcome Message
            widgetIconUrl: widgetIconUrl,
          }
        })
      }
    }

    return NextResponse.json({ success: true, message: t.chat_settings_saved })
  } catch (error) {
    return NextResponse.json({ error: t.chat_settings_save_failed }, { status: 500 })
  }
}
