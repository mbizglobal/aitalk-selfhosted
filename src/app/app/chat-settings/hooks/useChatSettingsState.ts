'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useLanguage } from '@/hooks/useLanguage'
import type { Language } from '@/lib/translations'
import { getTranslations as getDashboardTranslations } from '@/lib/translations/dashboard'
import { getTranslations as getAppTranslations } from '@/lib/translations/app'
import {
  getDefaultWidgetSettings,
  mergeWidgetSettings,
  normalizeRecommendedQuestions,
  WidgetSettings,
} from '@/lib/widget-settings'
import { VALID_TABS } from '../constants'
import { cloneSettings, applyLanguageDefaults } from '../utils'
import type { TranslationFn } from '../types'
import { applyPoweredByRule, type PoweredByRule } from '@/lib/selfhosted-policy'

export function useChatSettingsState() {
  const { currentLanguage } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const latestLanguageRef = useRef(currentLanguage)

  // Translations
  const translations = useMemo(() => {
    const dashboardTrans = getDashboardTranslations(currentLanguage)
    const appTrans = getAppTranslations(currentLanguage)
    return { ...dashboardTrans, ...appTrans }
  }, [currentLanguage])

  const t = useMemo(() => {
    const fn = (key: string) => (translations as any)[key] || key
    return Object.assign(fn, translations) as unknown as TranslationFn
  }, [translations])

  // Settings state
  const [settings, setSettings] = useState<WidgetSettings>(() => {
    const defaultSettings = cloneSettings(getDefaultWidgetSettings())
    defaultSettings.headerTitle = ''
    return defaultSettings
  })
  const [initialSettings, setInitialSettings] = useState<WidgetSettings>(() => {
    const defaultSettings = cloneSettings(getDefaultWidgetSettings())
    defaultSettings.headerTitle = ''
    return defaultSettings
  })

  // Tab state
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(() => {
    return VALID_TABS.includes(tabParam as any) ? tabParam : 'general'
  })

  // Loading states
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [planLoading, setPlanLoading] = useState(true)

  // Agent info
  const [agentId, setAgentId] = useState<string>('')
  const [agentTitle, setAgentTitle] = useState('')
  const [userPlan, setUserPlan] = useState<string>('')
  const [userServiceVariant, setUserServiceVariant] = useState<string>('self')
  const [poweredByRule, setPoweredByRule] = useState<PoweredByRule>('show')

  // Track language changes
  useEffect(() => {
    latestLanguageRef.current = currentLanguage
  }, [currentLanguage])

  // Tab change handler
  const handleTabChange = useCallback(
    (newTab: string) => {
      setActiveTab(newTab)
      router.push(`/app/chat-settings?tab=${newTab}`, { scroll: false })
    },
    [router]
  )

  // Update activeTab when URL changes
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam && VALID_TABS.includes(tabParam as any)) {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  // Update default values when language changes
  useEffect(() => {
    setSettings((prevSettings) =>
      applyLanguageDefaults(prevSettings, currentLanguage)
    )
  }, [currentLanguage])

  // Fetch settings on mount
  useEffect(() => {
    const controller = new AbortController()

    const fetchSettings = async () => {
      try {
        // Fetch agents first
        const agentsResponse = await fetch('/api/agents', {
          signal: controller.signal,
        })
        let currentAgentId = ''
        let currentAgentTitle = ''

        if (agentsResponse.ok) {
          const agentsData = await agentsResponse.json()
          if (
            agentsData?.success &&
            agentsData.agents &&
            agentsData.agents.length > 0
          ) {
            const storedAgentId = localStorage.getItem('activeAgentId')
            let targetAgent = agentsData.agents[0]

            if (storedAgentId) {
              const foundAgent = agentsData.agents.find(
                (a: any) => a.agentId === storedAgentId
              )
              if (foundAgent) {
                targetAgent = foundAgent
              }
            }

            currentAgentId = targetAgent.agentId || ''
            currentAgentTitle = targetAgent.title || ''
          }
        }

        setAgentId(currentAgentId)
        setAgentTitle(currentAgentTitle)

        // Fetch chat settings
        const settingsUrl = currentAgentId
          ? `/api/chat-settings?agentId=${currentAgentId}`
          : '/api/chat-settings'
        const response = await fetch(settingsUrl, { signal: controller.signal })
        if (!response.ok) {
          throw new Error('Failed to load chat settings.')
        }
        const data = await response.json()

        // Update plan info
        if (data?.success && data.plan) {
          setUserPlan(data.plan)
          setUserServiceVariant(data.serviceVariant || 'self')
          setPoweredByRule(data.poweredByRule || 'show')
          setTimeout(
            () => {
              setPlanLoading(false)
            },
            data.plan === 'free' ? 800 : 300
          )
        } else {
          setUserPlan('free')
          setTimeout(() => {
            setPlanLoading(false)
          }, 300)
        }

        if (data?.success && data.settings) {
          const merged = mergeWidgetSettings(data.settings)
          merged.poweredByImage = applyPoweredByRule(data.poweredByRule || 'show', merged.poweredByImage)
          const adjusted = applyLanguageDefaults(
            merged,
            latestLanguageRef.current
          )
          const finalSettings = cloneSettings(adjusted)
          setSettings(finalSettings)
          setInitialSettings(cloneSettings(finalSettings))
        } else {
          const defaultSettings = cloneSettings(
            applyLanguageDefaults(
              getDefaultWidgetSettings(),
              latestLanguageRef.current
            )
          )
          defaultSettings.headerTitle = currentAgentTitle
          setSettings(defaultSettings)
          setInitialSettings(cloneSettings(defaultSettings))
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          toast.error(t('chat_settings_load_failed'))
          const defaultSettings = cloneSettings(
            applyLanguageDefaults(
              getDefaultWidgetSettings(),
              latestLanguageRef.current
            )
          )
          setSettings(defaultSettings)
          setInitialSettings(cloneSettings(defaultSettings))
        }
      } finally {
        setLoading(false)
      }
    }

    fetchSettings()

    return () => {
      controller.abort()
    }
  }, [])

  // Check if settings have changed
  const isDirty = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(initialSettings)
  }, [settings, initialSettings])

  // Update handler for nested paths
  const handleUpdate = useCallback((path: string, value: unknown) => {
    setSettings((prev) => {
      const segments = path.split('.')
      const next: any = { ...prev }
      let cursor: any = next

      for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i]
        const nextKey = segments[i + 1]
        const isNextIndex = /^\d+$/.test(nextKey)
        const existing = cursor[key]

        if (Array.isArray(existing)) {
          cursor[key] = [...existing]
        } else if (existing && typeof existing === 'object') {
          cursor[key] = { ...existing }
        } else {
          cursor[key] = isNextIndex ? [] : {}
        }

        cursor = cursor[key]
      }

      const lastKey = segments[segments.length - 1]
      if (Array.isArray(cursor) && /^\d+$/.test(lastKey)) {
        cursor[Number(lastKey)] = value
      } else if (Array.isArray(cursor[lastKey]) && Array.isArray(value)) {
        cursor[lastKey] = value
      } else {
        cursor[lastKey] = value
      }

      if (segments[0] === 'recommendedQuestions') {
        next.recommendedQuestions = normalizeRecommendedQuestions(
          next.recommendedQuestions
        )
      }

      return next
    })
  }, [])

  // Reset to defaults
  const handleReset = useCallback(() => {
    const resetSettings = cloneSettings(getDefaultWidgetSettings(currentLanguage))
    resetSettings.headerTitle = agentTitle
    setSettings(resetSettings)
  }, [currentLanguage, agentTitle])

  // Discard changes
  const handleDiscard = useCallback(() => {
    setSettings(cloneSettings(initialSettings))
  }, [initialSettings])

  // Save settings
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/chat-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settings, agentId }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        try {
          const errorData = JSON.parse(errorText)
          throw new Error(errorData.error || t('chat_settings_save_error'))
        } catch (parseError) {
          throw new Error(t('chat_settings_save_error'))
        }
      }

      const data = await response.json()
      if (data?.success) {
        toast.success(t('chat_settings_saved'))
        const cloned = cloneSettings(settings)
        setInitialSettings(cloned)
        setSettings(cloned)
      } else {
        toast.error(data?.error || t('chat_settings_save_failed'))
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('chat_settings_save_failed')
      )
    } finally {
      setSaving(false)
    }
  }, [settings, agentId, t])

  return {
    // Settings
    settings,
    setSettings,
    initialSettings,
    setInitialSettings,
    loading,
    saving,
    isDirty,

    // Agent info
    agentId,
    agentTitle,
    userPlan,
    userServiceVariant,
    poweredByRule,
    planLoading,

    // Tab
    activeTab,
    handleTabChange,

    // Handlers
    handleUpdate,
    handleSave,
    handleReset,
    handleDiscard,

    // Translations
    t,
    currentLanguage,
  }
}
