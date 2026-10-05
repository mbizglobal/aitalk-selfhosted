import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getDefaultWidgetSettings, normalizeWidgetLanguage, type WidgetSettings } from '@/lib/widget-settings'

export async function POST(req: NextRequest) {
  try {
    const t = getApiTranslation(req)
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: t('api_error_unauthorized') },
        { status: 401 }
      )
    }

    const { timezone, locale, timeFormat } = await req.json()

    // Validate timezone format (should be like "Europe/Zurich", "UTC", etc.)
    if (!timezone || typeof timezone !== 'string') {
      return NextResponse.json(
        { error: t('api_error_invalid_timezone_format') },
        { status: 400 }
      )
    }

    // Validate locale format (should be like "en-US", "de-DE", "fr-FR")
    if (!locale || typeof locale !== 'string') {
      return NextResponse.json(
        { error: t('api_error_invalid_locale_format') },
        { status: 400 }
      )
    }

    // Validate time format
    if (!timeFormat || typeof timeFormat !== 'string') {
      return NextResponse.json(
        { error: t('api_error_invalid_time_format') },
        { status: 400 }
      )
    }

    // Validate supported locales
    const supportedLocales = ['en-US', 'de-DE', 'fr-FR', 'es-ES', 'ko-KR']
    if (!supportedLocales.includes(locale)) {
      return NextResponse.json(
        { error: t('api_error_unsupported_locale') },
        { status: 400 }
      )
    }

    // Validate supported time formats
    const supportedTimeFormats = [
      'DD.MM.YYYY HH:mm',
      'MM/DD/YYYY hh:mm AM',
      'YYYY-MM-DD HH:mm',
      'DD/MM/YYYY HH:mm',
      'DD-MM-YYYY HH:mm',
      'YYYY/MM/DD HH:mm'
    ]
    if (!supportedTimeFormats.includes(timeFormat)) {
      return NextResponse.json(
        { error: t('api_error_unsupported_time_format') },
        { status: 400 }
      )
    }

    const existingSettings = await prisma.settings.findUnique({
      where: { id: session.user.id }
    })

    // Update user settings
    await prisma.settings.upsert({
      where: {
        id: session.user.id
      },
      update: {
        timezone,
        locale,
        time_format: timeFormat,
        updatedAt: new Date()
      },
      create: {
        id: session.user.id,
        timezone,
        locale,
        time_format: timeFormat,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })

    if (existingSettings && existingSettings.locale !== locale) {
      try {
        let language: 'en' | 'de' | 'fr' | 'es' | 'ko' = 'en'
        if (locale.startsWith('de')) language = 'de'
        else if (locale.startsWith('fr')) language = 'fr'
        else if (locale.startsWith('es')) language = 'es'
        else if (locale.startsWith('ko')) language = 'ko'

        const previousLanguage = normalizeWidgetLanguage(existingSettings.locale || 'en')

        const previousWidgetDefaults = getDefaultWidgetSettings(previousLanguage)
        const newWidgetDefaults = getDefaultWidgetSettings(language)

        let translations;
        if (language === 'de') {
          translations = (await import('@/lib/translations/dashboard/de')).translations.de
        } else if (language === 'fr') {
          translations = (await import('@/lib/translations/dashboard/fr')).translations.fr
        } else if (language === 'es') {
          translations = (await import('@/lib/translations/dashboard/es')).translations.es
        } else if (language === 'ko') {
          translations = (await import('@/lib/translations/dashboard/ko')).translations.ko
        } else {
          translations = (await import('@/lib/translations/dashboard/en')).translations.en
        }

        const agents = await prisma.agent.findMany({
          where: { userId: session.user.id }
        })

        for (const agent of agents) {
          let widgetSettingsUpdate: string | undefined

          if (agent.widgetSettings) {
            try {
              const storedWidgetSettings = JSON.parse(agent.widgetSettings) as WidgetSettings

              const usesPreviousDefaults =
                storedWidgetSettings.initialMessage === previousWidgetDefaults.initialMessage &&
                storedWidgetSettings.inputPlaceholder === previousWidgetDefaults.inputPlaceholder &&
                Array.isArray(storedWidgetSettings.recommendedQuestions) &&
                storedWidgetSettings.recommendedQuestions[0] === previousWidgetDefaults.recommendedQuestions[0] &&
                storedWidgetSettings.privacyPolicy?.text === previousWidgetDefaults.privacyPolicy.text &&
                storedWidgetSettings.privacyPolicy?.linkText === previousWidgetDefaults.privacyPolicy.linkText

              if (usesPreviousDefaults) {
                storedWidgetSettings.initialMessage = newWidgetDefaults.initialMessage
                storedWidgetSettings.inputPlaceholder = newWidgetDefaults.inputPlaceholder

                if (Array.isArray(storedWidgetSettings.recommendedQuestions) && storedWidgetSettings.recommendedQuestions.length > 0) {
                  storedWidgetSettings.recommendedQuestions[0] = newWidgetDefaults.recommendedQuestions[0]
                }

                if (storedWidgetSettings.privacyPolicy) {
                  storedWidgetSettings.privacyPolicy.text = newWidgetDefaults.privacyPolicy.text
                  storedWidgetSettings.privacyPolicy.linkText = newWidgetDefaults.privacyPolicy.linkText
                }

                widgetSettingsUpdate = JSON.stringify(storedWidgetSettings)
              }
            } catch (error) {
              console.error('Failed to adjust widget settings for locale change:', error)
            }
          }

          await prisma.agent.update({
            where: { id: agent.id },
            data: {
              chatLimitMessage: translations.chat_limit_message,
              continuousAnswerLimitMessage: translations.continuous_answer_limit_message,
              updatedAt: new Date(),
              ...(widgetSettingsUpdate ? { widgetSettings: widgetSettingsUpdate } : {})
            }
          })
        }

      } catch (error) {
        console.error('Failed to update locale-dependent settings:', error)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Profile settings updated successfully'
    })

  } catch (error) {
    console.error('Error updating profile settings:', error)
    const t = getApiTranslation(req)
    return NextResponse.json(
      { error: t('api_error_internal_server_error') },
      { status: 500 }
    )
  }
}
