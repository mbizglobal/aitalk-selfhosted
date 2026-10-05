import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mergeWidgetSettings, WidgetSettings } from '@/lib/widget-settings'
import { getApiTranslation } from '@/lib/translations'
import { describeCaughtError } from '@/lib/log-mask'
import { isSelfHosted } from '@/lib/edition'
import { poweredByRuleFor, applyPoweredByRule } from '@/lib/selfhosted-policy'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params

    const selfHosted = isSelfHosted()
    const cloudAgent = selfHosted ? null : await prisma.agent.findUnique({
      where: { agentId },
      select: {
        id: true,
        userId: true,
        accessMode: true,
        title: true,
        widgetSettings: true,
        widgetButtonSettings: true,
        user: {
          select: {
            subscription: {
              select: {
                planType: true,
                serviceVariant: true,
                status: true,
              }
            }
          }
        }
      },
    })
    const agent = selfHosted
      ? await prisma.agent.findUnique({
          where: { agentId },
          select: { id: true, userId: true, accessMode: true, title: true, widgetSettings: true, widgetButtonSettings: true },
        })
      : cloudAgent

    if (!agent) {
      return NextResponse.json({ error: t('agent_not_found') }, { status: 404 })
    }

    let parsedChatSettings: Partial<WidgetSettings> | null = null
    let parsedButtonSettings: Partial<WidgetSettings> | null = null

    if (agent.widgetSettings) {
      try {
        parsedChatSettings = JSON.parse(agent.widgetSettings)
      } catch (error) {
        console.error('Failed to parse widget settings JSON:', describeCaughtError(error))
      }
    }

    if (agent.widgetButtonSettings) {
      try {
        parsedButtonSettings = JSON.parse(agent.widgetButtonSettings)
      } catch (error) {
        console.error('Failed to parse widget button settings JSON:', describeCaughtError(error))
      }
    }

    const merged = mergeWidgetSettings({
      ...parsedChatSettings,
      ...parsedButtonSettings,
    })

    const subscription = cloudAgent?.user?.subscription ?? null
    const planType = (subscription?.status === 'active' ? subscription?.planType : 'free') || 'free'
    const poweredByRule = poweredByRuleFor(selfHosted, planType, subscription?.serviceVariant)
    merged.poweredByImage = applyPoweredByRule(poweredByRule, merged.poweredByImage)

    return NextResponse.json({
      success: true,
      settings: merged,
      hasCustomSettings: !!agent.widgetSettings,
      agent: {
        accessMode: agent.accessMode,
        title: agent.title,
      }
    })
  } catch (error) {
    console.error('Failed to load widget settings:', describeCaughtError(error))
    const defaultSettings = mergeWidgetSettings()
    return NextResponse.json({
      success: true,
      settings: defaultSettings,
      hasCustomSettings: false
    })
  }
}