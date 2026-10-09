'use client'

import { useState, useEffect, useRef } from 'react'
import { useEdition, useFeedbackEnabled } from '@/components/EditionProvider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Bot,
  Plus,
  AlertCircle,
  Settings,
  MessageCircle,
  Clock,
  AlertTriangle,
  Shield,
  RefreshCw,
  Pencil,
  Lock,
} from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { useSession } from 'next-auth/react'
import { getRegionById } from '@/lib/managed/regions'
import { ConversationUsageChart } from '@/components/dashboard/conversation-usage-chart'
import { BookingStatsCard } from '@/components/dashboard/booking-stats-card'
import { VoiceQuizStatsCard } from '@/components/dashboard/voice-quiz-stats-card'
import { McpServerCard } from '@/components/dashboard/mcp-server-card'
import { formatDateOnlyWithUserSettings } from '@/lib/format-date-with-user-settings'
function formatLocation(country?: string | null, region?: string | null, city?: string | null): string {
  const parts = [country, region, city].filter(Boolean)
  if (parts.length === 0) return ''
  return parts.join(' > ')
}

function getLocationDisplay(ip: string | null | undefined, locationCache: Record<string, any>): string {
  if (!ip || !locationCache[ip]) return ''
  const location = locationCache[ip]
  return formatLocation(location.country, location.region, location.city)
}

function formatDateTime(value: string | Date, timeFormat: string = 'DD.MM.YYYY HH:mm', timezone: string = 'UTC') {
  try {
    const date = new Date(value)

    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }

    if (timeFormat.includes('AM') || timeFormat.includes('hh:mm AM')) {
      options.hour12 = true
    }

    const formattedDate = new Intl.DateTimeFormat('en-GB', options).format(date)
    const [dateStr, timeStr] = formattedDate.split(', ')
    const [day, month, year] = dateStr.split('/')

    let finalTimeStr = timeStr
    if (options.hour12 && timeStr) {
      const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
      if (timeMatch) {
        finalTimeStr = `${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3]}`
      }
    }

    switch (timeFormat) {
      case 'DD.MM.YYYY HH:mm':
        return `${day}.${month}.${year} ${finalTimeStr.replace(/\s*(AM|PM)/i, '')}`
      case 'MM/DD/YYYY hh:mm AM':
        return `${month}/${day}/${year} ${finalTimeStr}`
      case 'YYYY-MM-DD HH:mm':
        return `${year}-${month}-${day} ${finalTimeStr.replace(/\s*(AM|PM)/i, '')}`
      case 'DD/MM/YYYY HH:mm':
        return `${day}/${month}/${year} ${finalTimeStr.replace(/\s*(AM|PM)/i, '')}`
      case 'DD-MM-YYYY HH:mm':
        return `${day}-${month}-${year} ${finalTimeStr.replace(/\s*(AM|PM)/i, '')}`
      case 'YYYY/MM/DD HH:mm':
        return `${year}/${month}/${day} ${finalTimeStr.replace(/\s*(AM|PM)/i, '')}`
      default:
        return `${day}.${month}.${year} ${finalTimeStr.replace(/\s*(AM|PM)/i, '')}`
    }
  } catch (error) {
    return value.toString()
  }
}

interface Agent {
  id: string
  agentId: string
  title: string
  accessMode?: 'public' | 'team'
  createdAt: string
  workflowCount?: number
  locked?: boolean
}

const QUICK_SETUP_STRINGS = {
  en: { title: 'Try & customize', desc: 'Talk to your AI or edit what it knows.', call: '🎙️ Call your AI now', edit: '✏️ Edit AI setup', salesRep: 'Sales rep', salesRepNone: 'None' },
  de: { title: 'Testen & anpassen', desc: 'Sprechen Sie mit Ihrer KI oder bearbeiten Sie ihr Wissen.', call: '🎙️ KI jetzt anrufen', edit: '✏️ KI-Setup bearbeiten', salesRep: 'Vertriebsmitarbeiter', salesRepNone: 'Keiner' },
  fr: { title: 'Tester & personnaliser', desc: 'Parlez à votre IA ou modifiez ses connaissances.', call: '🎙️ Appeler votre IA', edit: '✏️ Modifier la config IA', salesRep: 'Commercial', salesRepNone: 'Aucun' },
  es: { title: 'Probar y personalizar', desc: 'Habla con tu IA o edita lo que sabe.', call: '🎙️ Llama a tu IA ahora', edit: '✏️ Editar config. de IA', salesRep: 'Comercial', salesRepNone: 'Ninguno' },
  ko: { title: '체험 & 수정', desc: 'AI와 통화하거나 학습 내용을 수정하세요.', call: '🎙️ 지금 AI에게 전화', edit: '✏️ AI 설정 수정', salesRep: '세일즈 담당자', salesRepNone: '없음' },
} as const

function isLifecycleSuspended(state?: string): boolean {
  return !!state && state !== 'active' && state !== 'paid_grace'
}

export default function DashboardPage() {
  const { t, currentLanguage } = useLanguage()
  const selfHosted = useEdition() === 'selfhosted'
  const feedbackEnabled = useFeedbackEnabled()
  const qs = QUICK_SETUP_STRINGS[(currentLanguage === 'de-ch' ? 'de' : currentLanguage) as keyof typeof QUICK_SETUP_STRINGS] || QUICK_SETUP_STRINGS.en
  const { data: session } = useSession()
  const userId = (session?.user as { id?: string })?.id ?? null
  const userEmail = (session?.user as { email?: string })?.email ?? ''
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean>(true)
  const [aiReady, setAiReady] = useState<boolean | null>(null)
  const [plan, setPlan] = useState<string>('free')
  const [planReady, setPlanReady] = useState(false)
  const [maxAgents, setMaxAgents] = useState<number>(1)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)

  const formatNumber = (num: number): string => {
    const locale = currentLanguage === 'ko' ? 'ko-KR'
      : currentLanguage === 'de' ? 'de-DE'
      : currentLanguage === 'fr' ? 'fr-FR'
      : currentLanguage === 'es' ? 'es-ES'
      : 'en-US'
    return new Intl.NumberFormat(locale).format(num)
  }
  const [userInfo, setUserInfo] = useState<{
    last_login_at: string | null
    plan: string
    time_format: string
    locale: string
    api_key_configured: boolean
    num_assistant: number | null
    service_period: {
      start_date: string
      end_date: string
    } | null
    isTrial?: boolean
    trialEndsAt?: string | null
    lifecycle?: {
      state: 'active' | 'trial_expired' | 'paid_grace' | 'suspended_retain' | 'suspended_purged'
      dataDeletionDate: string | null
      previousPlan: string | null
    }
    partnerName?: string | null
    mcp?: {
      token_count: number
      last_used_at: string | null
      last_used_ip: string | null
      last_used_country: string | null
      last_used_token_name: string | null
    }
    cpa_data: {
      available: number
      total: number
      has_data: boolean
      voice_minutes?: {
        chat: number
        realtime: number | null
        realtime_mini: number | null
      } | null
    }
    booster_data?: {
      eligible: boolean
      balance: number
      total: number
      expiresAt: string | null
    } | null
    status?: string
    platform?: string | null
    serviceVariant?: string
    paymentStatus?: string | null
    pendingInvoice?: {
      id: string
      invoiceNumber: string
      totalAmount: number
      currency: string
      planType: string
      dueDate: string
    } | null
    cpaResetDate?: string | null
    managedRegion?: string | null
    downgradeSchedule?: {
      newPlanType: string
      newBillingCycle: string
      scheduledDate: string
    } | null
  } | null>(null)
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const [feedbackContent, setFeedbackContent] = useState('')
  const [feedbackEmail, setFeedbackEmail] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [recentConversations, setRecentConversations] = useState<{
    id: string
    conversation_id: string
    user: string
    message: string
    time: string
    status: string
    title: string
    userIP?: string | null
  }[]>([])
  const [locationCache, setLocationCache] = useState<Record<string, { country?: string; region?: string; city?: string }>>({})
  const [loadingLocation, setLoadingLocation] = useState(false)
  const isCreatingAgentRef = useRef(false)

  const [migrationRequired, setMigrationRequired] = useState(false)
  const [isMigrating, setIsMigrating] = useState(false)
  const [migrationMessage, setMigrationMessage] = useState('')
  const [isMigrationError, setIsMigrationError] = useState(false)

  const translateTimeDisplay = (timeStr: string): string => {
    if (timeStr.includes('recent_conversations_time_min_ago')) {
      const minutes = timeStr.replace(' recent_conversations_time_min_ago', '')
      return `${minutes} ${t('recent_conversations_time_min_ago')}`
    } else if (timeStr.includes('recent_conversations_time_hour_ago')) {
      const hours = timeStr.replace(' recent_conversations_time_hour_ago', '')
      return `${hours} ${t('recent_conversations_time_hour_ago')}`
    } else if (timeStr.includes('recent_conversations_time_hours_ago')) {
      const hours = timeStr.replace(' recent_conversations_time_hours_ago', '')
      return `${hours} ${t('recent_conversations_time_hours_ago')}`
    } else if (timeStr.includes('recent_conversations_time_day_ago')) {
      const days = timeStr.replace(' recent_conversations_time_day_ago', '')
      return `${days} ${t('recent_conversations_time_day_ago')}`
    } else if (timeStr.includes('recent_conversations_time_days_ago')) {
      const days = timeStr.replace(' recent_conversations_time_days_ago', '')
      return `${days} ${t('recent_conversations_time_days_ago')}`
    }
    return timeStr
  }

  const translateMessage = (message: string): string => {
    if (message === 'recent_conversations_no_message') {
      return t('recent_conversations_no_message')
    } else if (message === 'recent_conversations_encrypted_message') {
      return t('recent_conversations_encrypted_message')
    }
    return message
  }

  const translateUser = (user: string): string => {
    if (user === 'recent_conversations_anonymous_user') {
      return t('recent_conversations_anonymous_user')
    } else if (user.startsWith('recent_conversations_user_with_id')) {
      const id = user.replace('recent_conversations_user_with_id', '')
      return `${t('recent_conversations_user_with_id')}${id}`
    }
    return user
  }

  useEffect(() => {
    if (agents.length > 0) {
      const stored = localStorage.getItem('activeAgentId')
      const storedAgentExists = stored && agents.some(a => a.agentId === stored)

      if (storedAgentExists) {
        setActiveAgentId(stored)
      } else {
        setActiveAgentId(agents[0].agentId)
        localStorage.setItem('activeAgentId', agents[0].agentId)
      }
    }
  }, [agents])

  useEffect(() => {
    const fetchAgents = async () => {
      if (!userId) {
        setLoading(false)
        return
      }

      try {
        const response = await fetch('/api/agents')
        const data = await response.json()

        if (data.success) {
          setAgents(data.agents)

          if (data.agents.length === 0 && !isCreatingAgentRef.current) {
            isCreatingAgentRef.current = true
            try {
              const createResponse = await fetch('/api/create-missing-agents', {
                method: 'POST'
              })
              const createData = await createResponse.json()

              if (createData.success && createData.results.length > 0) {
                const refetchResponse = await fetch('/api/agents')
                const refetchData = await refetchResponse.json()
                if (refetchData.success) {
                  setAgents(refetchData.agents)
                }
              }
            } catch (error) {
            } finally {
              isCreatingAgentRef.current = false
            }
          }
        }
      } catch (error) {
      } finally {
        setLoading(false)
      }
    }

    fetchAgents()
  }, [userId])

  useEffect(() => {
    const handleTitleChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.agentId && detail?.title) {
        setAgents(prev => prev.map(a =>
          a.agentId === detail.agentId ? { ...a, title: detail.title } : a
        ))
      }
    }
    window.addEventListener('agentTitleChanged', handleTitleChanged)
    return () => window.removeEventListener('agentTitleChanged', handleTitleChanged)
  }, [])

  useEffect(() => {
    if (!selfHosted || !userId) return
    fetch('/api/settings/ai-connections', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.canManage) return setAiReady(null)
        const list: { isDefault?: boolean; checkValid?: boolean }[] = Array.isArray(d.connections) ? d.connections : []
        setAiReady(list.some((c) => c.isDefault && c.checkValid))
      })
      .catch(() => {})
  }, [selfHosted, userId])

  useEffect(() => {
    const fetchSettings = async () => {
      if (!userId) {
        return
      }

      try {
        const response = await fetch('/api/settings')
        const data = await response.json()

        if (data.success && data.settings) {
          setApiKeyConfigured(data.settings.api_key_configured)
          const planValue = typeof data.settings.plan === 'string' ? data.settings.plan.toLowerCase() : 'free'
          setPlan(planValue)

          const urlParams = new URLSearchParams(window.location.search)
          const urlLang = urlParams.get('lang')

          if (urlLang && ['en', 'de', 'fr', 'es', 'ko'].includes(urlLang)) {
            const currentLocale = data.settings.locale || 'en-US'
            const urlLocaleMap: Record<string, string> = {
              'en': 'en-US',
              'de': 'de-DE',
              'fr': 'fr-FR',
              'es': 'es-ES',
              'ko': 'ko-KR'
            }
            const expectedLocale = urlLocaleMap[urlLang]

            if (currentLocale !== expectedLocale) {
              try {
                await fetch('/api/settings/profile', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    timezone: data.settings.timezone || 'Europe/Zurich',
                    locale: expectedLocale,
                    timeFormat: data.settings.time_format || 'DD.MM.YYYY HH:mm'
                  })
                })
              } catch (error) {
              }
            }
          }
        }
      } catch (error) {
      }
    }

    fetchSettings()
  }, [userId])

  useEffect(() => {
    const fetchUserInfo = async () => {
      if (!userId) {
        return
      }

      try {
        const response = await fetch('/api/dashboard/user-info')
        const data = await response.json()

        if (data.success && data.data) {
          setUserInfo(data.data)
          setMaxAgents(data.data.num_assistant ?? Number.POSITIVE_INFINITY)
          setPlan(data.data.plan || 'free')
          setPlanReady(true)
        }
      } catch (error) {
      }
    }

    fetchUserInfo()
  }, [userId])

  const loadLocationInfo = async (conversations: Array<{ userIP?: string | null }>) => {
    const uniqueIPs = [
      ...new Set(
        conversations
          .map(c => c.userIP)
          .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0)
      )
    ]

    if (uniqueIPs.length === 0) {
      return
    }

    const uncachedIPs = uniqueIPs.filter(ip => !locationCache[ip])

    if (uncachedIPs.length === 0) {
      return
    }

    setLoadingLocation(true)
    try {
      const response = await fetch('/api/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips: uncachedIPs }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.results) {
          const newLocationCache = { ...locationCache }
          data.results.forEach((result: any) => {
            if (result.ip) {
              newLocationCache[result.ip] = result.location
            }
          })
          setLocationCache(newLocationCache)
        }
      }
    } catch (error) {
    } finally {
      setLoadingLocation(false)
    }
  }

  useEffect(() => {
    const fetchRecentConversations = async () => {
      if (!userId || !activeAgentId) {
        return
      }

      try {
        const response = await fetch(`/api/dashboard/recent-conversations?agentId=${activeAgentId}`)
        const data = await response.json()

        if (data.success && data.conversations) {
          setRecentConversations(data.conversations)

          await loadLocationInfo(data.conversations)
        }
      } catch (error) {
      }
    }

    fetchRecentConversations()
  }, [userId, activeAgentId])

  useEffect(() => {
    if (feedbackModalOpen && userEmail && !feedbackEmail) {
      setFeedbackEmail(userEmail)
    }
  }, [feedbackModalOpen, userEmail, feedbackEmail])

  // Check encryption migration status
  useEffect(() => {
    const checkMigrationStatus = async () => {
      if (!userId) return
      try {
        const response = await fetch('/api/settings/migrate-encryption')
        if (response.ok) {
          const data = await response.json()
          setMigrationRequired(data.migrationRequired === true)
        }
      } catch (error) {
        console.error('Failed to check migration status:', error)
      }
    }
    checkMigrationStatus()
  }, [userId])

  // Execute encryption key migration
  const handleMigration = async () => {
    setIsMigrating(true)
    setMigrationMessage('')
    setIsMigrationError(false)

    try {
      const response = await fetch('/api/settings/migrate-encryption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await response.json()

      if (response.ok && data.success) {
        setMigrationRequired(false)
        setMigrationMessage(t('migration_success'))
        setIsMigrationError(false)
      } else {
        setMigrationMessage(data.error || t('migration_failed'))
        setIsMigrationError(true)
      }
    } catch (error) {
      setMigrationMessage(t('migration_failed'))
      setIsMigrationError(true)
    } finally {
      setIsMigrating(false)
    }
  }

  const canCreateMore = agents.length < maxAgents
  const agentCountLabel = Number.isFinite(maxAgents) ? `${agents.length}/${maxAgents}` : String(agents.length)
  const [isCreatingAgent, setIsCreatingAgent] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const handleSaveAgentTitle = async (agentId: string) => {
    const trimmed = editingTitle.trim()
    if (!trimmed) {
      setEditingAgentId(null)
      return
    }
    const agent = agents.find(a => a.agentId === agentId)
    if (agent && agent.title === trimmed) {
      setEditingAgentId(null)
      return
    }
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (res.ok) {
        setAgents(prev => prev.map(a => a.agentId === agentId ? { ...a, title: trimmed } : a))
      }
    } catch (e) {
      console.error('Failed to update agent title:', e)
    }
    setEditingAgentId(null)
  }

  const handleCreateAgent = async () => {
    if (!canCreateMore || isCreatingAgent) return

    setIsCreatingAgent(true)
    try {
      const response = await fetch('/api/agents/create', {
        method: 'POST',
        headers: {
          'Accept-Language': currentLanguage,
        },
      })

      const data = await response.json()

      if (response.ok && data.success) {
        const refetchResponse = await fetch('/api/agents')
        const refetchData = await refetchResponse.json()

        if (refetchData.success) {
          setAgents(refetchData.agents)
          if (data.agent?.agentId) {
            setActiveAgentId(data.agent.agentId)
            localStorage.setItem('activeAgentId', data.agent.agentId)
          }
        }
      } else {
        alert(data.error || 'Failed to create agent')
      }
    } catch (error) {
      alert('Failed to create agent')
    } finally {
      setIsCreatingAgent(false)
    }
  }

  const handleActivateAgent = (agentId: string) => {
    setActiveAgentId(agentId)
    localStorage.setItem('activeAgentId', agentId)
    window.dispatchEvent(new CustomEvent('activeAgentChanged', { detail: { agentId } }))
  }

  const handleFeedbackSubmit = async () => {
    if (!feedbackContent.trim()) {
      alert(t('feedback_required_alert'))
      return
    }

    setFeedbackSending(true)

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: feedbackContent,
          email: feedbackEmail || session?.user?.email || (selfHosted ? 'anonymous' : 'anonymous@aitalk.ch'),
        }),
      })

      if (response.ok) {
        alert(t('feedback_success_message'))
        setFeedbackModalOpen(false)
        setFeedbackContent('')
        setFeedbackEmail('')
      } else {
        throw new Error('Failed to send feedback')
      }
    } catch (error) {
      alert(t('feedback_error_message'))
    } finally {
      setFeedbackSending(false)
    }
  }



  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('dashboard_title')}</h1>
      </div>

      {selfHosted && aiReady === false && (
        <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <h3 className="font-medium text-yellow-800 dark:text-yellow-200">{t('aic_dash_title')}</h3>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">{t('aic_dash_desc')}</p>
                <Button
                  size="sm"
                  className="bg-yellow-600 hover:bg-yellow-700 text-white"
                  onClick={() => { window.location.href = '/app/settings?tab=ai-connections' }}
                >
                  {t('aic_dash_button')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Security Migration Alert Banner */}
      {migrationRequired && (
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                {t('migration_required_title')}
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                {t('migration_required_description')}
              </p>
              {migrationMessage && (
                <p className={`text-sm mt-2 ${isMigrationError ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                  {migrationMessage}
                </p>
              )}
              <Button
                onClick={handleMigration}
                disabled={isMigrating}
                className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                size="sm"
              >
                {isMigrating ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {t('migrating')}
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4 mr-2" />
                    {t('migrate_now')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {userInfo?.lifecycle
        && userInfo.lifecycle.state !== 'active'
        && userInfo.lifecycle.state !== 'paid_grace'
        && (() => {
        const lc = userInfo.lifecycle!
        const dateLocale = currentLanguage === 'ko' ? 'ko-KR'
          : (currentLanguage === 'de' || currentLanguage === 'de-ch') ? 'de-DE'
          : currentLanguage === 'fr' ? 'fr-FR'
          : currentLanguage === 'es' ? 'es-ES'
          : 'en-US'
        const delDate = lc.dataDeletionDate
          ? new Date(lc.dataDeletionDate).toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' })
          : null
        const title = lc.state === 'trial_expired' ? t('banner_trial_expired_title') : t('banner_suspended_title')
        const desc = lc.state === 'suspended_purged' ? t('banner_purged_desc') : t('banner_retain_desc')
        const buttonLabel = lc.state === 'suspended_purged' ? t('banner_subscribe_button') : t('banner_reactivate_button')
        return (
          <div className="rounded-lg p-5 border-2 shadow-md bg-red-50 border-red-400 dark:bg-red-950 dark:border-red-600">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <div className="space-y-2 flex-1">
                <h3 className="font-semibold text-red-800 dark:text-red-200">{title}</h3>
                <p className="text-sm text-red-700 dark:text-red-300">
                  {desc}{delDate ? <> <strong>{delDate}</strong></> : null}
                </p>
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => window.location.href = '/app/subscription'}
                >
                  {buttonLabel}
                </Button>
              </div>
            </div>
          </div>
        )
      })()}

      {userInfo?.pendingInvoice && (
        <div className="bg-orange-50 dark:bg-orange-950 border-2 border-orange-400 dark:border-orange-600 rounded-lg p-5 shadow-md">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 bg-orange-100 dark:bg-orange-900 rounded-full p-2.5">
              <AlertTriangle className="h-6 w-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="flex-1 space-y-3">
              <h3 className="text-lg font-bold text-orange-800 dark:text-orange-200">
                {t('pending_payment_title')}
              </h3>
              <p className="text-sm text-orange-700 dark:text-orange-300">
                {t('pending_payment_description')}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-orange-100/50 dark:bg-orange-900/30 rounded-md p-3">
                <div>
                  <div className="text-xs text-orange-600 dark:text-orange-400">{t('pending_payment_invoice')}</div>
                  <div className="font-semibold text-sm text-orange-900 dark:text-orange-100">{userInfo.pendingInvoice.invoiceNumber}</div>
                </div>
                <div>
                  <div className="text-xs text-orange-600 dark:text-orange-400">{t('pending_payment_plan')}</div>
                  <div className="font-semibold text-sm text-orange-900 dark:text-orange-100">{userInfo.pendingInvoice.planType.charAt(0).toUpperCase() + userInfo.pendingInvoice.planType.slice(1)}</div>
                </div>
                <div>
                  <div className="text-xs text-orange-600 dark:text-orange-400">{t('pending_payment_amount')}</div>
                  <div className="font-semibold text-sm text-orange-900 dark:text-orange-100">{userInfo.pendingInvoice.currency} {userInfo.pendingInvoice.totalAmount.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-orange-600 dark:text-orange-400">{t('pending_payment_due_date')}</div>
                  <div className="font-semibold text-sm text-orange-900 dark:text-orange-100">{userInfo.pendingInvoice.dueDate ? formatDateOnlyWithUserSettings(userInfo.pendingInvoice.dueDate, userInfo.time_format) : '-'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold text-orange-700 dark:text-orange-300">
                <Clock className="h-4 w-4" />
                {(() => {
                  const dueDate = new Date(userInfo.pendingInvoice.dueDate);
                  const today = new Date();
                  const daysRemaining = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  if (daysRemaining > 0) {
                    return `${daysRemaining} ${t('payment_pending_days_remaining')}`;
                  } else if (daysRemaining === 0) {
                    return t('payment_pending_due_today');
                  } else {
                    return `${Math.abs(daysRemaining)} ${t('payment_pending_days_overdue')}`;
                  }
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Management Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0 mb-0">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            {t('ai_agents_title')}
          </CardTitle>
          {planReady && (
            <Button
              size="sm"
              disabled={!canCreateMore || isCreatingAgent}
              title={!canCreateMore ? t('agent_limit_reached') : ''}
              onClick={handleCreateAgent}
            >
              <Plus className="h-4 w-4 mr-1" />
              {isCreatingAgent ? t('creating') || 'Creating...' : `${t('new_agent_button')} (${agentCountLabel})`}
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0 mt-0">
          {/* Loading State */}
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="h-12 w-12 mx-auto mb-4 opacity-50 animate-pulse" />
              <p className="text-sm">{t('dashboard_loading_agents')}</p>
            </div>
          ) : agents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">{t('dashboard_no_agents_found')}</p>
              <p className="text-xs mt-1">{t('dashboard_create_first_agent')}</p>
            </div>
          ) : (
            <>
              {/* Agent Grid Layout */}
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-4">
            {agents.map((agent, index) => {
              const isActive = agent.agentId === activeAgentId
              return (
                <div
                  key={agent.id}
                  className={`p-4 border rounded-lg transition-shadow ${
                    isActive
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Bot className="h-5 w-5 text-primary flex-shrink-0" />
                      {editingAgentId === agent.agentId ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => handleSaveAgentTitle(agent.agentId)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveAgentTitle(agent.agentId)
                            if (e.key === 'Escape') setEditingAgentId(null)
                          }}
                          className="font-medium text-sm bg-transparent border-b border-primary outline-none w-full min-w-0"
                          autoComplete="off"
                        />
                      ) : (
                        <div
                          className="flex items-center gap-1 min-w-0 cursor-pointer group/edit"
                          title={t('click_to_edit') || 'Click to edit'}
                          onClick={() => {
                            setEditingAgentId(agent.agentId)
                            setEditingTitle(agent.title)
                            setTimeout(() => editInputRef.current?.focus(), 0)
                          }}
                        >
                          <h4 className="font-medium text-sm truncate group-hover/edit:text-primary transition-colors">
                            {agent.title}
                          </h4>
                          <Pencil className="h-3 w-3 flex-shrink-0 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      #{index + 1}
                    </div>
                  </div>

                  <div className="mb-3">
                    <p className="text-xs text-muted-foreground">
                      {agent.workflowCount ?? 0} Workflow{(agent.workflowCount ?? 0) !== 1 ? 's' : ''}
                    </p>
                    {agent.locked && (
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <Lock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                        <span>
                          {t('agent_locked_plan_limit')}{' '}
                          <a href="/app/subscription" className="underline font-medium">{t('agent_locked_upgrade')}</a>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {isActive ? (
                      <Button
                        variant="default"
                        size="default"
                        className="w-full h-auto py-3"
                        onClick={() => window.location.href = `/app/agents/${agent.agentId}/workflows`}
                      >
                        {t('agent_manage_workflows')}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="default"
                        className="w-full h-auto py-3"
                        onClick={() => handleActivateAgent(agent.agentId)}
                      >
                        {t('agent_activate')}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
              {(() => {
                if (agents.length !== 1) return null
                if (!userInfo?.isTrial) return null
                const voiceAgentId = agents[0]?.agentId
                const canVoice = !!plan && !plan.toLowerCase().includes('free')
                if (!voiceAgentId || !canVoice) return null
                return (
                  <div className="p-4 border border-dashed rounded-lg flex flex-col">
                    <h4 className="font-medium text-sm mb-1">{qs.title}</h4>
                    <p className="text-xs text-muted-foreground mb-3">{qs.desc}</p>
                    <div className="flex flex-col gap-2 mt-auto">
                      <Button
                        className="w-full"
                        onClick={() => window.open(`/voice/${voiceAgentId}`, 'aitalk-voice', 'width=420,height=680')}
                      >
                        {qs.call}
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => window.dispatchEvent(new CustomEvent('open-ai-setup'))}
                      >
                        {qs.edit}
                      </Button>
                    </div>
                  </div>
                )
              })()}
              </div>

              {/* Plan Status */}
              {planReady && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">{agentCountLabel}</span> {t('agents_used')}
                    {!selfHosted && (plan === 'free'
                      ? <span className="ml-2">{t('agents_used_suspended')}</span>
                      : <span className="ml-2 capitalize">({plan.charAt(0).toUpperCase() + plan.slice(1)} plan)</span>)}
                  </div>
                  {!canCreateMore && !selfHosted && (
                    <Button
                      variant="link"
                      size="sm"
                      className="text-xs"
                      onClick={() => window.location.href = '/app/subscription'}
                    >
                      {t('upgrade_to_add_more')}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <BookingStatsCard ready={planReady} />

      <VoiceQuizStatsCard ready={planReady} />

      <McpServerCard
        mcp={userInfo?.mcp}
        formatDateTime={(value) => formatDateTime(value, userInfo?.time_format, 'Europe/Zurich')}
      />

      {!selfHosted && (
      <ConversationUsageChart
        plan={plan}
        ready={planReady}
        agentId={activeAgentId ?? (agents.length > 0 ? agents[0].agentId : undefined)}
      />
      )}

      {/* Charts Section */}
      <div className={selfHosted ? 'grid gap-4' : 'grid gap-4 md:grid-cols-2'}>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard_greeting')}, {session?.user?.name || 'User'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col pt-0 text-muted-foreground">
              <ul className="list-disc pl-8 space-y-2 flex-shrink-0">
                <li>
                  <span className="font-semibold text-foreground">{t('dashboard_last_login')}:</span>{' '}
                  {userInfo?.last_login_at
                    ? formatDateTime(userInfo.last_login_at, userInfo.time_format, 'Europe/Zurich')
                    : t('dashboard_never_logged_in')
                  }
                </li>
                {!selfHosted && !isLifecycleSuspended(userInfo?.lifecycle?.state) && (
                  <li>
                    <span className="font-semibold text-foreground">{t('dashboard_plan_label')}:</span>{' '}
                    {userInfo?.plan ? userInfo.plan.charAt(0).toUpperCase() + userInfo.plan.slice(1) : 'Free'}
                    {userInfo?.isTrial && ' (Trial)'}
                  </li>
                )}
                {userInfo?.serviceVariant === 'managed' && userInfo?.managedRegion && (() => {
                  const region = getRegionById(userInfo.managedRegion!);
                  return region ? (
                    <li>
                      <span className="font-semibold text-foreground">{t('dashboard_azure_region')}:</span>{' '}
                      {region.flag} {region.country}
                    </li>
                  ) : null;
                })()}
                {!isLifecycleSuspended(userInfo?.lifecycle?.state) && userInfo?.service_period && (
                  <li>
                    <span className="font-semibold text-foreground">{t('dashboard_service_period')}:</span>{' '}
                    {formatDateTime(userInfo.service_period.start_date, userInfo.time_format, 'Europe/Zurich')} - {formatDateTime(
                      userInfo.isTrial && userInfo.trialEndsAt ? userInfo.trialEndsAt : userInfo.service_period.end_date,
                      userInfo.time_format, 'Europe/Zurich')}
                  </li>
                )}
                {!selfHosted && (
                <li>
                  <span className="font-semibold text-foreground">{qs.salesRep}:</span>{' '}
                  {userInfo?.partnerName || qs.salesRepNone}
                </li>
                )}
                {!selfHosted && !isLifecycleSuspended(userInfo?.lifecycle?.state) && userInfo?.cpaResetDate && (
                  <li>
                    <span className="font-semibold text-foreground">{t('dashboard_cpa_reset_date')}:</span>{' '}
                    {formatDateTime(userInfo.cpaResetDate, userInfo.time_format, 'Europe/Zurich')}
                  </li>
                )}
                {userInfo?.status === 'cancelled' && userInfo?.service_period && (
                  <li>
                    <span className="font-semibold text-orange-600 dark:text-orange-400">{t('subscription_cancelled_label')}</span>{' '}
                    <span className="text-orange-600 dark:text-orange-400">
                      {t('subscription_cancelled_dashboard_message').replace('{date}', formatDateTime(userInfo.service_period.end_date, userInfo.time_format, 'Europe/Zurich'))}
                    </span>
                  </li>
                )}
                {userInfo?.downgradeSchedule && (
                  <li>
                    <span className="font-semibold text-orange-600 dark:text-orange-400">{t('subscription_downgrade_scheduled_label')}</span>{' '}
                    <span className="text-orange-600 dark:text-orange-400">
                      {t('subscription_downgrade_dashboard_message')
                        .replace('{newPlan}', userInfo.downgradeSchedule.newPlanType.charAt(0).toUpperCase() + userInfo.downgradeSchedule.newPlanType.slice(1))
                        .replace('{date}', formatDateTime(userInfo.downgradeSchedule.scheduledDate, userInfo.time_format, 'Europe/Zurich'))}
                    </span>
                  </li>
                )}
              </ul>

              {feedbackEnabled && (
              <div className="mt-6 mb-4 flex justify-center px-6">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs w-full max-w-[200px]"
                  onClick={() => setFeedbackModalOpen(true)}
                >
                  <MessageCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                  <span className="truncate">{t('dashboard_send_feedback')}</span>
                </Button>
              </div>
              )}
            </div>
          </CardContent>
        </Card>

        {!selfHosted && (
        <Card>
          <CardHeader>
            <CardTitle>{t('usage_chart_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="min-h-[160px] flex flex-col justify-center px-4">
              {userInfo?.cpa_data && (() => {
                const lcState = userInfo.lifecycle?.state
                if (lcState && lcState !== 'active' && lcState !== 'paid_grace') {
                  return (
                    <div className="text-center text-sm text-muted-foreground py-6">
                      {t('cpa_usage_suspended')}
                    </div>
                  )
                }
                const hasExtra = !!(userInfo.booster_data && userInfo.booster_data.balance > 0 && userInfo.booster_data.expiresAt)
                const planAvailable = userInfo.cpa_data.available
                const planTotal = userInfo.cpa_data.total
                const planPct = planTotal > 0 ? Math.round((planAvailable / planTotal) * 100) : 0
                const extraBalance = userInfo.booster_data?.balance ?? 0
                const extraTotal = userInfo.booster_data?.total ?? 0
                const extraPct = extraTotal > 0 ? Math.round((extraBalance / extraTotal) * 100) : 0
                const expiresText = userInfo.booster_data?.expiresAt
                  ? t('cpa_extra_expires_suffix').replace('{date}', formatDateOnlyWithUserSettings(userInfo.booster_data.expiresAt, userInfo.time_format))
                  : ''

                return (
                <>
                  {/* Plan bar */}
                  {hasExtra && (
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t('cpa_plan_label')}</span>
                      <span>{formatNumber(planAvailable)} / {formatNumber(planTotal)}</span>
                    </div>
                  )}
                  <div className={hasExtra ? 'mb-3' : 'mb-4'}>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6">
                      <div
                        className="bg-blue-600 h-6 rounded-full flex items-center justify-end pr-3 min-w-0 transition-all duration-300"
                        style={{ width: `${Math.max(5, planPct)}%` }}
                      >
                        <span className="text-white text-sm font-medium">{planPct}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Extra bar */}
                  {hasExtra && (
                    <>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{t('cpa_extra_label')} · {expiresText}</span>
                        <span>{formatNumber(extraBalance)} / {formatNumber(extraTotal)}</span>
                      </div>
                      <div className="mb-3">
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6">
                          <div
                            className="bg-amber-500 h-6 rounded-full flex items-center justify-end pr-3 min-w-0 transition-all duration-300"
                            style={{ width: `${Math.max(5, extraPct)}%` }}
                          >
                            <span className="text-white text-sm font-medium">{extraPct}%</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Available / Total Info */}
                  <div className="text-center mb-2">
                    {hasExtra ? (
                      <span className="text-sm font-medium">
                        {t('cpa_total_available').replace('{amount}', formatNumber(planAvailable + extraBalance))}
                      </span>
                    ) : (
                      <span className="text-sm font-medium">
                        {t('cpa_usage_available')}: {formatNumber(planAvailable)} / {formatNumber(planTotal)}
                      </span>
                    )}
                  </div>

                  {userInfo.cpa_data.voice_minutes && (
                    <div className="text-center mb-2 text-xs text-muted-foreground">
                      ≈ {formatNumber(userInfo.cpa_data.voice_minutes.chat)} {t('cpa_voice_minutes_chat')}
                      {userInfo.cpa_data.voice_minutes.realtime !== null && (
                        <> · {formatNumber(userInfo.cpa_data.voice_minutes.realtime)} {t('cpa_voice_minutes_realtime')}</>
                      )}
                      {userInfo.cpa_data.voice_minutes.realtime_mini !== null && (
                        <> · {formatNumber(userInfo.cpa_data.voice_minutes.realtime_mini)} {t('cpa_voice_minutes_realtime_mini')}</>
                      )}
                    </div>
                  )}


                </>
                )
              })()}
            </div>
          </CardContent>
        </Card>
        )}
      </div>


      {/* Feedback Modal */}
      <Dialog open={feedbackModalOpen} onOpenChange={setFeedbackModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('feedback_modal_title')}</DialogTitle>
            <DialogDescription className="mt-2">
              {t('feedback_modal_description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div>
              <Label htmlFor="feedback-content" className="text-sm font-medium">
                {t('feedback_content_label')}
              </Label>
              <p className="text-xs text-muted-foreground mt-1 mb-2">
                {t('feedback_content_help')}
              </p>
              <Textarea
                id="feedback-content"
                placeholder={t('feedback_content_placeholder')}
                value={feedbackContent}
                onChange={(e) => setFeedbackContent(e.target.value)}
                className="min-h-[120px] resize-none"
              />
            </div>

            <div>
              <p className="text-sm text-center text-muted-foreground mb-4">
                {t('feedback_help_message')}
              </p>

              <Label htmlFor="feedback-email" className="text-sm font-medium">
                {t('feedback_email_label')}
              </Label>
              <Input
                id="feedback-email"
                type="email"
                placeholder={selfHosted ? '' : t('feedback_email_placeholder')}
                value={feedbackEmail}
                onChange={(e) => setFeedbackEmail(e.target.value)}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('feedback_email_help')}
              </p>
            </div>
          </div>

          <div className="flex justify-end space-x-2 mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setFeedbackModalOpen(false)
                setFeedbackContent('')
                setFeedbackEmail('')
              }}
              disabled={feedbackSending}
            >
              {t('feedback_cancel')}
            </Button>
            <Button
              onClick={handleFeedbackSubmit}
              disabled={feedbackSending || !feedbackContent.trim()}
            >
              {feedbackSending ? t('feedback_sending') : t('feedback_send')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
