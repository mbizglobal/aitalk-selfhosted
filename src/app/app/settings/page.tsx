'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useEdition } from '@/components/EditionProvider'
import { useLanguage } from '@/hooks/useLanguage'
import type { Language } from '@/lib/translations'
import { getCountryOptions } from '@/lib/countries'
import { useSession, signOut, signIn } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Save,
  RefreshCw,
  RotateCcw,
  Layers2,
  Globe,
  Bell,
  Database,
  Key,
  AlertCircle,
  Copy,
  ExternalLink,
  Code,
  Eye,
  EyeOff,
  Edit2,
  AlertTriangle,
  Bot,
  Users,
  Shield,
  Lock,
  Info,
  User,
  Check,
  Zap,
  Fingerprint,
  Trash2,
  Plus,
  Radio
} from 'lucide-react'
import { startRegistration } from '@simplewebauthn/browser'
import TeamTab from './components/TeamTab'
import SecretVaultSection from './components/SecretVaultSection'
import McpSection from './components/McpSection'
import { AiConnectionsSection } from './components/AiConnectionsSection'
import { LicenseSection, type LicenseInfo } from './components/LicenseSection'
import { OpenAIIcon, GeminiIcon, PineconeIcon, NoneIcon, getLlmProviderIcon } from '@/components/icons/ai-providers'
import { getRegionById } from '@/lib/managed/regions'

type TimeUnit = 'minute' | 'hour' | 'day'

const localeToLanguageMap: Record<string, Language> = {
  'en': 'en',
  'en-us': 'en',
  'de': 'de',
  'de-de': 'de',
  'fr': 'fr',
  'fr-fr': 'fr',
  'es': 'es',
  'es-es': 'es',
  'ko': 'ko',
  'ko-kr': 'ko',
}

function mapLocaleToLanguage(locale?: string): Language {
  if (!locale) {
    return 'en'
  }

  const normalized = locale.toLowerCase()
  const mapped = localeToLanguageMap[normalized as keyof typeof localeToLanguageMap]
  if (mapped) {
    return mapped
  }

  const [languageCode] = normalized.split('-')
  const supportedLanguages: Language[] = ['en', 'de', 'fr', 'es', 'ko']
  if (supportedLanguages.includes(languageCode as Language)) {
    return languageCode as Language
  }

  return 'en'
}

export default function SettingsPage() {
  const { t, currentLanguage, setLanguage, isInitialized } = useLanguage()
  const countryOptions = useMemo(() => getCountryOptions(currentLanguage), [currentLanguage])
  const { data: session } = useSession()
  const userId = (session?.user as { id?: string })?.id ?? null
  const sessionEmail = (session?.user as { email?: string })?.email ?? ''
  const searchParams = useSearchParams()
  const router = useRouter()

  const [vaultEnabled, setVaultEnabled] = useState(false)

  const [isInitialDataLoaded, setIsInitialDataLoaded] = useState(false)
  const [isAiProvidersLoaded, setIsAiProvidersLoaded] = useState(false)
  const [isRagProviderLoaded, setIsRagProviderLoaded] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [maskedApiKey, setMaskedApiKey] = useState('')
  const [isEditingApiKey, setIsEditingApiKey] = useState(false)
  const [selectedModel, setSelectedModel] = useState('gpt-4.1-mini')
  const [temperature, setTemperature] = useState(1.0)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [systemMessage, setSystemMessage] = useState('')
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  const [isMobile, setIsMobile] = useState(false)
  const [isMobileChecked, setIsMobileChecked] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [agentCount, setAgentCount] = useState<number>(0)
  const [agentTitle, setAgentTitle] = useState<string>('')
  const [agentAccessMode, setAgentAccessMode] = useState<'public' | 'team'>('public')
  const [userPlan, setUserPlan] = useState<string>('free')
  const [serviceVariant, setServiceVariant] = useState<'self' | 'managed' | null>(null)
  const edition = useEdition()
  const byoTabsShown = serviceVariant !== 'managed' && edition !== 'selfhosted'
  const [managedRegion, setManagedRegion] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Usage limits state
  const [chatLimitCount, setChatLimitCount] = useState<string>('0')
  const [chatLimitUnit, setChatLimitUnit] = useState<TimeUnit>('day')
  const [chatLimitMessage, setChatLimitMessage] = useState<string>(t('chat_limit_message'))
  const [continuousAnswerLimit, setContinuousAnswerLimit] = useState<string>('0')
  const [continuousAnswerLimitMessage, setContinuousAnswerLimitMessage] = useState<string>(
    t('continuous_answer_limit_message')
  )
  const [originalChatLimitCount, setOriginalChatLimitCount] = useState<string>('0')
  const [originalChatLimitUnit, setOriginalChatLimitUnit] = useState<TimeUnit>('day')
  const [originalChatLimitMessage, setOriginalChatLimitMessage] = useState<string>(
    t('chat_limit_message')
  )
  const [originalContinuousAnswerLimit, setOriginalContinuousAnswerLimit] = useState<string>('0')
  const [originalContinuousAnswerLimitMessage, setOriginalContinuousAnswerLimitMessage] =
    useState<string>(t('continuous_answer_limit_message'))
  const [usageMessage, setUsageMessage] = useState('')
  const [isUsageError, setIsUsageError] = useState(false)
  const [isSavingUsageLimits, setIsSavingUsageLimits] = useState(false)
  const [usageErrors, setUsageErrors] = useState<{
    chatLimitCount?: string
    continuousAnswerLimit?: string
  }>({})

  // Data management state
  const [dataManagementMessage, setDataManagementMessage] = useState('')
  const [isDataManagementError, setIsDataManagementError] = useState(false)
  const [isDataManagementDialogOpen, setIsDataManagementDialogOpen] = useState(false)
  const [dataManagementAction, setDataManagementAction] = useState<'conversations' | 'anonymize' | 'usageLogs' | 'deleteAgent' | null>(null)
  const [confirmDataManagementText, setConfirmDataManagementText] = useState('')
  const [deleteReauthPassword, setDeleteReauthPassword] = useState('')
  const [isProcessingDataAction, setIsProcessingDataAction] = useState(false)

  // Profile settings state
  const [userTimezone, setUserTimezone] = useState<string>('UTC')
  const [userLocale, setUserLocale] = useState<string>('en-US')
  const [userTimeFormat, setUserTimeFormat] = useState<string>('DD.MM.YYYY HH:mm')
  const [userName, setUserName] = useState<string>('')
  const [userEmail, setUserEmail] = useState<string>('')
  const [companyName, setCompanyName] = useState<string>('')
  const [originalCompanyName, setOriginalCompanyName] = useState<string>('')
  const [userPhone, setUserPhone] = useState<string>('')
  const [originalUserPhone, setOriginalUserPhone] = useState<string>('')
  const [userCountry, setUserCountry] = useState<string>('')
  const [originalUserCountry, setOriginalUserCountry] = useState<string>('')
  const [currentPassword, setCurrentPassword] = useState<string>('')
  const [newPassword, setNewPassword] = useState<string>('')
  const [confirmPassword, setConfirmPassword] = useState<string>('')
  const [isGoogleUser, setIsGoogleUser] = useState<boolean>(false)

  // Passkey state
  const [passkeys, setPasskeys] = useState<Array<{
    id: string
    name: string | null
    deviceType: string | null
    backedUp: boolean
    createdAt: string
    lastUsedAt: string | null
  }>>([])
  const [isLoadingPasskeys, setIsLoadingPasskeys] = useState(false)
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false)
  const [passkeyError, setPasskeyError] = useState('')
  const [passkeySuccess, setPasskeySuccess] = useState('')

  // Email change state
  const [isEmailChangeDialogOpen, setIsEmailChangeDialogOpen] = useState(false)
  const [newEmailInput, setNewEmailInput] = useState('')
  const [isChangingEmail, setIsChangingEmail] = useState(false)
  const [emailChangeError, setEmailChangeError] = useState('')
  const [emailChangeSuccess, setEmailChangeSuccess] = useState('')

  // Original values for change detection
  const [originalUserTimezone, setOriginalUserTimezone] = useState<string>('UTC')
  const [originalUserLocale, setOriginalUserLocale] = useState<string>('en-US')
  const [originalUserTimeFormat, setOriginalUserTimeFormat] = useState<string>('DD.MM.YYYY HH:mm')
  const [originalUserName, setOriginalUserName] = useState<string>('')
  const [originalUserEmail, setOriginalUserEmail] = useState<string>('')

  // Original values for change detection
  const [originalAgentTitle, setOriginalAgentTitle] = useState<string>('')
  const [originalAgentAccessMode, setOriginalAgentAccessMode] = useState<'public' | 'team'>('public')
  const [originalSelectedModel, setOriginalSelectedModel] = useState('gpt-4.1-mini')
  const [originalTemperature, setOriginalTemperature] = useState(1.0)
  const [originalMaxTokens, setOriginalMaxTokens] = useState(2048)
  const [originalSystemMessage, setOriginalSystemMessage] = useState('')

  // AI Config save states
  const [isSavingAIConfig, setIsSavingAIConfig] = useState(false)
  const [aiConfigMessage, setAIConfigMessage] = useState('')
  const [isAIConfigError, setIsAIConfigError] = useState(false)
  const [isSavingSystemMessage, setIsSavingSystemMessage] = useState(false)
  const [systemMessageMessage, setSystemMessageMessage] = useState('')
  const [isSystemMessageError, setIsSystemMessageError] = useState(false)

  // Check if AI Assistant settings have changed
  const hasAIAssistantChanges = agentTitle !== originalAgentTitle || agentAccessMode !== originalAgentAccessMode

  // API Key derived states
  const isApiKeyConfigured = hasApiKey === true
  const displayedMaskedApiKey = maskedApiKey || '************'

  // Check if OpenAI API Key settings have changed
  const hasAPIKeyChanges = (isEditingApiKey && apiKeyValue.trim() !== '') || selectedModel !== originalSelectedModel

  // Check if AI Config settings have changed
  const hasAIConfigChanges = temperature !== originalTemperature || maxTokens !== originalMaxTokens

  // Check if System Message has changed
  const hasSystemMessageChanges = systemMessage !== originalSystemMessage

  const hasUsageLimitChanges =
    chatLimitCount !== originalChatLimitCount ||
    chatLimitUnit !== originalChatLimitUnit ||
    chatLimitMessage !== originalChatLimitMessage ||
    continuousAnswerLimit !== originalContinuousAnswerLimit ||
    continuousAnswerLimitMessage !== originalContinuousAnswerLimitMessage

  const isUsageFormValid =
    /^\d+$/.test(chatLimitCount.trim()) &&
    /^\d+$/.test(continuousAnswerLimit.trim())

  const sanitizeNumericInput = (value: string) => {
    const digitsOnly = value.replace(/\D/g, '')
    if (digitsOnly === '') {
      return ''
    }
    return digitsOnly.replace(/^0+(?=\d)/, '')
  }

  const openDataManagementDialog = (action: 'conversations' | 'anonymize' | 'usageLogs' | 'deleteAgent') => {
    setDataManagementAction(action)
    setIsDataManagementDialogOpen(true)
    setConfirmDataManagementText('')
    setDeleteReauthPassword('')
    setIsProcessingDataAction(false)
  }

  const closeDataManagementDialog = () => {
    setIsDataManagementDialogOpen(false)
    setDataManagementAction(null)
    setConfirmDataManagementText('')
    setDeleteReauthPassword('')
    setIsProcessingDataAction(false)
  }

  const handleConfirmDataManagementAction = async () => {
    if (!dataManagementAction) {
      return
    }

    setIsProcessingDataAction(true)
    setDataManagementMessage('')
    setIsDataManagementError(false)

    try {
      let endpoint = ''
      if (dataManagementAction === 'conversations') {
        endpoint = '/api/data-management/delete-conversations'
      } else if (dataManagementAction === 'anonymize') {
        endpoint = '/api/data-management/anonymize'
      } else if (dataManagementAction === 'usageLogs') {
        endpoint = '/api/data-management/delete-usage-logs'
      } else if (dataManagementAction === 'deleteAgent') {
        endpoint = '/api/data-management/delete-agent'
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: agentId,
          ...(dataManagementAction === 'anonymize' && deleteReauthPassword
            ? { password: deleteReauthPassword }
            : {}),
        }),
      })

      const result = await response.json()

      if (response.ok && result && result.ok !== false) {
        let message = result.message || t('settings_operation_completed')
        if (result.warnings && result.warnings.length > 0) {
          message += '\n\n' + t('warnings_label') + ':\n• ' + result.warnings.join('\n• ')
        }
        setDataManagementMessage(message)
        setIsDataManagementError(false)
        closeDataManagementDialog()

        if (dataManagementAction === 'deleteAgent') {
          setTimeout(() => {
            router.push('/app')
          }, 2000)
        }

        if (dataManagementAction === 'anonymize') {
          setTimeout(() => {
            signOut({ callbackUrl: '/auth' })
          }, 1500)
        }
      } else {
        if (result?.error === 'REAUTH_REQUIRED') {
          signIn('google', { callbackUrl: '/app/settings?tab=advanced' }, { prompt: 'login' })
          return
        }
        const REAUTH_MESSAGES: Record<string, string> = {
          PASSWORD_REQUIRED: t('settings_current_password_placeholder'),
          INVALID_PASSWORD: t('settings_delete_password_wrong'),
          RATE_LIMITED: t('settings_delete_rate_limited'),
        }
        let message = REAUTH_MESSAGES[result?.error as string]
          || result?.error || result?.message || t('settings_operation_failed')
        if (result?.errors && result.errors.length > 0) {
          message += '\n\n' + t('errors_label') + ':\n• ' + result.errors.join('\n• ')
        }
        if (result?.warnings && result.warnings.length > 0) {
          message += '\n\n' + t('warnings_label') + ':\n• ' + result.warnings.join('\n• ')
        }
        setDataManagementMessage(message)
        setIsDataManagementError(true)
        closeDataManagementDialog()
      }
    } catch (error) {
      setDataManagementMessage(t('settings_operation_failed'))
      setIsDataManagementError(true)
      closeDataManagementDialog()
    } finally {
      setIsProcessingDataAction(false)
    }
  }

  // Check if Profile settings have changed (email is changed separately via dialog)
  const hasProfileChanges =
    userTimezone !== originalUserTimezone ||
    userLocale !== originalUserLocale ||
    userTimeFormat !== originalUserTimeFormat ||
    userName !== originalUserName ||
    companyName !== originalCompanyName ||
    userPhone !== originalUserPhone ||
    userCountry !== originalUserCountry

  // Check if password change is valid
  const hasPasswordChanges = currentPassword !== '' && newPassword !== '' && confirmPassword !== '' && newPassword === confirmPassword

  // AI Providers state
  const [aiProviders, setAiProviders] = useState<Array<{
    id: string
    name: string
    hasApiKey: boolean
    maskedApiKey?: string
    isImplemented: boolean
  }>>([])
  const [isAiProvidersLoading, setIsAiProvidersLoading] = useState(false)
  const [defaultProvider, setDefaultProvider] = useState('openai')
  const [selectedProviderForEdit, setSelectedProviderForEdit] = useState<string | null>(null)
  const [providerApiKeyValue, setProviderApiKeyValue] = useState('')
  const [isSavingProvider, setIsSavingProvider] = useState(false)
  const [providerMessage, setProviderMessage] = useState('')
  const [isProviderError, setIsProviderError] = useState(false)

  // RAG Provider state
  const [ragProvider, setRagProvider] = useState<string>('')
  const [originalRagProvider, setOriginalRagProvider] = useState<string>('')
  const [ragConfiguredProviders, setRagConfiguredProviders] = useState<string[]>([])
  const [isRagProviderLoading, setIsRagProviderLoading] = useState(true)
  const [isSavingRagProvider, setIsSavingRagProvider] = useState(false)
  const [isResettingPinecone, setIsResettingPinecone] = useState(false)
  const [showResetPineconeDialog, setShowResetPineconeDialog] = useState(false)
  const [ragProviderMessage, setRagProviderMessage] = useState('')
  const [isRagProviderError, setIsRagProviderError] = useState(false)

  // Pinecone Configuration state
  const [pineconeApiKey, setPineconeApiKey] = useState('')
  const [pineconeHost, setPineconeHost] = useState('')
  const [pineconeIndexName, setPineconeIndexName] = useState('')
  const [pineconeNamespace, setPineconeNamespace] = useState('')
  const [pineconeEmbeddingModel, setPineconeEmbeddingModel] = useState('llama-text-embed-v2')
  const [pineconeDimension, setPineconeDimension] = useState(1024)
  const [originalPineconeConfig, setOriginalPineconeConfig] = useState({
    apiKey: '', host: '', indexName: '', namespace: '', embeddingModel: 'llama-text-embed-v2', dimension: 1024
  })
  const [isPineconeConfigChanged, setIsPineconeConfigChanged] = useState(false)

  const [isPineconeTestLoading, setIsPineconeTestLoading] = useState(false)
  const [pineconeTestResult, setPineconeTestResult] = useState<{
    success: boolean
    message: string
    details?: any
  } | null>(null)

  const [migrationRequired, setMigrationRequired] = useState(false)
  const [isMigrating, setIsMigrating] = useState(false)
  const [migrationMessage, setMigrationMessage] = useState('')
  const [isMigrationError, setIsMigrationError] = useState(false)

  const PINECONE_EMBEDDING_MODELS = [
    { id: 'llama-text-embed-v2', name: 'Pinecone llama-text-embed-v2', dimension: 1024, provider: 'pinecone' },
    { id: 'multilingual-e5-large', name: 'Pinecone multilingual-e5-large', dimension: 1024, provider: 'pinecone' },
    { id: 'pinecone-sparse-english-v0', name: 'Pinecone sparse-english-v0 (Sparse)', dimension: 0, provider: 'pinecone' },
    { id: 'text-embedding-3-small', name: 'OpenAI text-embedding-3-small', dimension: 1536, provider: 'openai' },
    { id: 'text-embedding-3-large', name: 'OpenAI text-embedding-3-large', dimension: 3072, provider: 'openai' },
  ]

  // Tab state from URL
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(() => {
    const validTabs = ['ai-providers', 'ai-agent', 'mcp', 'ai-connections', 'license', 'team', 'profile', 'ai-config', 'security', 'other', 'advanced']
    return validTabs.includes(tabParam || '') ? tabParam : 'ai-agent'
  })

  // Tab change handler with URL update
  const handleTabChange = useCallback((newTab: string) => {
    setActiveTab(newTab)
    router.push(`/app/settings?tab=${newTab}`, { scroll: false })
  }, [router])

  // Language change handler - updates both locale and preferred-language
  const handleLanguageChange = useCallback((localeValue: string) => {
    setUserLocale(localeValue)

    const languageCode = mapLocaleToLanguage(localeValue)

    setLanguage(languageCode)

    try {
      if (localStorage.getItem('cookie-consent') === 'true') {
        localStorage.setItem('preferred-language', languageCode)
      }
    } catch (error) {
      // Ignore storage errors
    }
  }, [setLanguage])

  useEffect(() => {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera || ''
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)

    if (isMobileUA) {
      setIsMobile(true)
      setIsMobileChecked(true)
      return
    }

    const checkMobile = () => {
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const isSmallScreen = window.innerWidth < 1024
      setIsMobile(isTouchDevice && isSmallScreen)
    }
    checkMobile()
    setIsMobileChecked(true)
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const [aiConnectionsAvailable, setAiConnectionsAvailable] = useState(false)
  useEffect(() => {
    fetch('/api/settings/ai-connections').then((r) => {
      const ok = r.status !== 404
      setAiConnectionsAvailable(ok)
      if (!ok && new URLSearchParams(window.location.search).get('tab') === 'ai-connections') handleTabChange('ai-agent')
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null | undefined>(undefined)
  useEffect(() => {
    fetch('/api/settings/license').then(async (r) => {
      if (r.status === 404) return setLicenseInfo(null)
      if (!r.ok) return
      const data = await r.json()
      setLicenseInfo(data?.canView ? (data as LicenseInfo) : null)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update activeTab when URL changes
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const validTabs = ['ai-providers', 'ai-agent', 'mcp', 'ai-connections', 'license', 'team', 'profile', 'ai-config', 'security', 'other', 'advanced']
    if (tabParam === 'license' && licenseInfo === null) {
      handleTabChange('ai-agent')
      return
    }
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, licenseInfo])

  // Load AI Providers data
  // Load AI Providers data
  const loadAiProviders = useCallback(async () => {
    setIsAiProvidersLoading(true)
    try {
      const response = await fetch('/api/settings/ai-providers')
      if (response.ok) {
        const data = await response.json()
        setAiProviders(data.providers || [])
        setDefaultProvider(data.defaultProvider || 'openai')
      }
    } catch (error) {
      console.error('Failed to load AI providers:', error)
    } finally {
      setIsAiProvidersLoading(false)
    }
  }, [])

  useEffect(() => {
    const handleProviderChanged = () => loadAiProviders()
    window.addEventListener('providerApiKeyChanged', handleProviderChanged)
    return () => window.removeEventListener('providerApiKeyChanged', handleProviderChanged)
  }, [loadAiProviders])

  // Check encryption migration status
  const checkMigrationStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/migrate-encryption')
      if (response.ok) {
        const data = await response.json()
        setMigrationRequired(data.migrationRequired === true)
      }
    } catch (error) {
      console.error('Failed to check migration status:', error)
    }
  }, [])

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

  // Load RAG Provider data
  const loadRagProvider = useCallback(async () => {
    setIsRagProviderLoading(true)
    try {
      const response = await fetch('/api/storage/rag-provider')
      if (response.ok) {
        const data = await response.json()
        setRagProvider(data.defaultProvider || 'none')
        setOriginalRagProvider(data.defaultProvider || 'none')
        setRagConfiguredProviders(data.configuredProviders || [])

        if (data.pineconeConfig) {
          setPineconeApiKey(data.pineconeConfig.apiKey || '')
          setPineconeHost(data.pineconeConfig.host || '')
          setPineconeIndexName(data.pineconeConfig.indexName || '')
          setPineconeNamespace(data.pineconeConfig.namespace || '')
          setPineconeEmbeddingModel(data.pineconeConfig.embeddingModel || 'llama-text-embed-v2')
          setPineconeDimension(data.pineconeConfig.dimension || 1024)
          setOriginalPineconeConfig({
            apiKey: data.pineconeConfig.apiKey || '',
            host: data.pineconeConfig.host || '',
            indexName: data.pineconeConfig.indexName || '',
            namespace: data.pineconeConfig.namespace || '',
            embeddingModel: data.pineconeConfig.embeddingModel || 'llama-text-embed-v2',
            dimension: data.pineconeConfig.dimension || 1024,
          })
        }
      }
    } catch (error) {
      console.error('Failed to load RAG provider:', error)
    } finally {
      setIsRagProviderLoading(false)
    }
  }, [])

  useEffect(() => {
    const handleRagChanged = () => loadRagProvider()
    window.addEventListener('ragProviderChanged', handleRagChanged)
    return () => window.removeEventListener('ragProviderChanged', handleRagChanged)
  }, [loadRagProvider])

  useEffect(() => {
    const handleProfileChanged = async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.user) {
            setUserName(data.user.name || '')
            setOriginalUserName(data.user.name || '')
            setCompanyName(data.user.companyName || '')
            setOriginalCompanyName(data.user.companyName || '')
            setUserPhone(data.user.phone || '')
            setOriginalUserPhone(data.user.phone || '')
            setUserCountry((data.user.country || '').toUpperCase())
            setOriginalUserCountry((data.user.country || '').toUpperCase())
          }
        }
      } catch { /* ignore */ }
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.settings) {
            const timezone = data.settings.timezone || 'UTC'
            const locale = data.settings.locale || 'en-US'
            const timeFormat = data.settings.time_format || 'DD.MM.YYYY HH:mm'
            setUserTimezone(timezone)
            setUserLocale(locale)
            setUserTimeFormat(timeFormat)
            setOriginalUserTimezone(timezone)
            setOriginalUserLocale(locale)
            setOriginalUserTimeFormat(timeFormat)
          }
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('profileChanged', handleProfileChanged)
    return () => window.removeEventListener('profileChanged', handleProfileChanged)
  }, [])

  const getRequiredLlmProvider = (ragProviderType: string): string => {
    const mapping: Record<string, string> = {
      openai_vector_store: 'openai',
      gemini_file_search: 'gemini',
      pinecone: 'openai', // Pinecone uses OpenAI for embeddings
    }
    return mapping[ragProviderType] || 'openai'
  }

  const hasRequiredApiKey = (ragProviderType: string): boolean => {
    if (ragProviderType === 'none') {
      return true
    }
    if (ragProviderType === 'pinecone') {
      const hasPineconeConfig = !!originalPineconeConfig.apiKey && !!originalPineconeConfig.indexName
      const isPineconeEmbedding = ['llama-text-embed-v2', 'multilingual-e5-large', 'pinecone-sparse-english-v0'].includes(pineconeEmbeddingModel)
      if (isPineconeEmbedding) {
        return hasPineconeConfig
      }
      const hasOpenAiKey = ragConfiguredProviders.includes('openai')
      return hasOpenAiKey && hasPineconeConfig
    }
    const requiredLlm = getRequiredLlmProvider(ragProviderType)
    return ragConfiguredProviders.includes(requiredLlm)
  }

  useEffect(() => {
    const isChanged =
      pineconeApiKey !== originalPineconeConfig.apiKey ||
      pineconeHost !== originalPineconeConfig.host ||
      pineconeIndexName !== originalPineconeConfig.indexName ||
      pineconeNamespace !== originalPineconeConfig.namespace ||
      pineconeEmbeddingModel !== originalPineconeConfig.embeddingModel
    setIsPineconeConfigChanged(isChanged)
  }, [pineconeApiKey, pineconeHost, pineconeIndexName, pineconeNamespace, pineconeEmbeddingModel, originalPineconeConfig])

  const handleEmbeddingModelChange = (modelId: string) => {
    setPineconeEmbeddingModel(modelId)
    const model = PINECONE_EMBEDDING_MODELS.find(m => m.id === modelId)
    if (model) {
      setPineconeDimension(model.dimension)
    }
    setPineconeTestResult(null)
  }

  const handleTestPineconeConnection = async () => {
    const useStoredKey = pineconeApiKey.includes('•') && originalPineconeConfig.apiKey

    if (!pineconeApiKey || (!useStoredKey && pineconeApiKey.includes('•'))) {
      setPineconeTestResult({
        success: false,
        message: t('pinecone_test_api_key_required')
      })
      return
    }
    if (!pineconeIndexName) {
      setPineconeTestResult({
        success: false,
        message: t('pinecone_test_index_required')
      })
      return
    }

    setIsPineconeTestLoading(true)
    setPineconeTestResult(null)

    try {
      const response = await fetch('/api/storage/rag-provider/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: useStoredKey ? undefined : pineconeApiKey,
          useStoredKey: !!useStoredKey,
          host: pineconeHost || undefined,
          indexName: pineconeIndexName,
          embeddingModel: pineconeEmbeddingModel,
          dimension: pineconeDimension,
        })
      })

      const data = await response.json()

      if (data.success) {
        setPineconeTestResult({
          success: true,
          message: t('pinecone_connection_success'),
          details: data.details
        })
      } else {
        const errorMessages: Record<string, string> = {
          'INDEX_NOT_FOUND': t('pinecone_error_index_not_found'),
          'DIMENSION_MISMATCH': t('pinecone_error_dimension_mismatch'),
          'EMBEDDING_FAILED': t('pinecone_error_embedding_failed'),
          'CONNECTION_FAILED': t('pinecone_error_connection_failed'),
          'INVALID_API_KEY': t('pinecone_error_invalid_api_key'),
          'UNKNOWN_ERROR': t('pinecone_connection_failed'),
        }
        const errorMessage = data.errorType ? errorMessages[data.errorType] : null
        setPineconeTestResult({
          success: false,
          message: errorMessage || t('pinecone_connection_failed'),
          details: data.details
        })
      }
    } catch (error) {
      setPineconeTestResult({
        success: false,
        message: t('pinecone_connection_failed')
      })
    } finally {
      setIsPineconeTestLoading(false)
    }
  }

  // Save RAG Provider
  const handleSaveRagProvider = async () => {
    if (ragProvider === 'pinecone') {
      const hasNewPineconeConfig = pineconeApiKey && !pineconeApiKey.includes('•') && pineconeIndexName
      const hasExistingPineconeConfig = originalPineconeConfig.apiKey && originalPineconeConfig.indexName
      if (!hasNewPineconeConfig && !hasExistingPineconeConfig) {
        setRagProviderMessage(t('pinecone_not_configured'))
        setIsRagProviderError(true)
        return
      }
      const isOpenAIEmbedding = ['text-embedding-3-small', 'text-embedding-3-large'].includes(pineconeEmbeddingModel)
      if (isOpenAIEmbedding && !ragConfiguredProviders.includes('openai')) {
        setRagProviderMessage(t('pinecone_openai_required'))
        setIsRagProviderError(true)
        return
      }
    } else if (!hasRequiredApiKey(ragProvider)) {
      setRagProviderMessage(t('rag_provider_api_key_required'))
      setIsRagProviderError(true)
      return
    }

    setIsSavingRagProvider(true)
    setRagProviderMessage('')
    setIsRagProviderError(false)

    try {
      const requestBody: any = { defaultProvider: ragProvider }
      if (ragProvider === 'pinecone') {
        requestBody.pineconeConfig = {
          apiKey: pineconeApiKey,
          host: pineconeHost,
          indexName: pineconeIndexName,
          namespace: pineconeNamespace,
          embeddingModel: pineconeEmbeddingModel,
          dimension: pineconeDimension,
        }
      }

      const response = await fetch('/api/storage/rag-provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()

      if (response.ok) {
        setRagProviderMessage(t('rag_provider_saved_success'))
        setIsRagProviderError(false)
        setOriginalRagProvider(ragProvider)
        setRagConfiguredProviders(data.configuredProviders || [])

        if (data.pineconeConfig) {
          setPineconeApiKey(data.pineconeConfig.apiKey || '')
          setPineconeHost(data.pineconeConfig.host || '')
          setPineconeIndexName(data.pineconeConfig.indexName || '')
          setPineconeNamespace(data.pineconeConfig.namespace || '')
          setPineconeEmbeddingModel(data.pineconeConfig.embeddingModel || 'llama-text-embed-v2')
          setPineconeDimension(data.pineconeConfig.dimension || 1024)
          setOriginalPineconeConfig({
            apiKey: data.pineconeConfig.apiKey || '',
            host: data.pineconeConfig.host || '',
            indexName: data.pineconeConfig.indexName || '',
            namespace: data.pineconeConfig.namespace || '',
            embeddingModel: data.pineconeConfig.embeddingModel || 'llama-text-embed-v2',
            dimension: data.pineconeConfig.dimension || 1024,
          })
        }
      } else {
        setRagProviderMessage(data.error || t('rag_provider_save_failed'))
        setIsRagProviderError(true)
      }
    } catch (error) {
      setRagProviderMessage(t('rag_provider_save_failed'))
      setIsRagProviderError(true)
    } finally {
      setIsSavingRagProvider(false)
    }
  }

  // Reset Pinecone Settings
  const handleResetPinecone = async () => {
    setIsResettingPinecone(true)
    setRagProviderMessage('')
    setIsRagProviderError(false)

    try {
      const response = await fetch('/api/storage/rag-provider', {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok) {
        setRagProviderMessage(t('pinecone_reset_success'))
        setIsRagProviderError(false)
        setRagProvider('none')
        setOriginalRagProvider('none')
        setPineconeApiKey('')
        setPineconeHost('')
        setPineconeIndexName('')
        setPineconeNamespace('')
        setPineconeEmbeddingModel('llama-text-embed-v2')
        setPineconeDimension(1024)
        setOriginalPineconeConfig({
          apiKey: '', host: '', indexName: '', namespace: '', embeddingModel: 'llama-text-embed-v2', dimension: 1024
        })
        setPineconeTestResult(null)
      } else {
        setRagProviderMessage(data.error || t('pinecone_reset_failed'))
        setIsRagProviderError(true)
      }
    } catch (error) {
      setRagProviderMessage(t('pinecone_reset_failed'))
      setIsRagProviderError(true)
    } finally {
      setIsResettingPinecone(false)
    }
  }

  // Load AI Providers when tab changes to api-key
  useEffect(() => {
    if (activeTab === 'api-key' && userId && !isAiProvidersLoaded) {
      setIsAiProvidersLoaded(true)
      loadAiProviders()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId])

  // Check migration status on mount
  useEffect(() => {
    if (userId) {
      checkMigrationStatus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Load RAG Provider when tab changes to ai-agent
  useEffect(() => {
    if (activeTab === 'ai-agent' && userId && !isRagProviderLoaded) {
      setIsRagProviderLoaded(true)
      loadRagProvider()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId])

  // Load passkeys when profile tab is active
  useEffect(() => {
    if (activeTab === 'profile' && userId && !isGoogleUser) {
      fetchPasskeys()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId, isGoogleUser])

  // Save Provider API Key
  const handleSaveProviderApiKey = async (providerId: string, setAsDefault: boolean = false) => {
    const provider = aiProviders.find(p => p.id === providerId)
    if (!providerApiKeyValue.trim() && !provider?.hasApiKey) {
      setProviderMessage('API key is required')
      setIsProviderError(true)
      return
    }

    setIsSavingProvider(true)
    setProviderMessage('')
    setIsProviderError(false)

    try {
      const requestBody: { provider: string; apiKey?: string; setAsDefault: boolean } = {
        provider: providerId,
        setAsDefault
      }
      if (providerApiKeyValue.trim()) {
        requestBody.apiKey = providerApiKeyValue
      }

      const response = await fetch('/api/settings/ai-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()

      if (response.ok) {
        setProviderMessage(data.message || 'API key saved successfully')
        setIsProviderError(false)
        setSelectedProviderForEdit(null)
        setProviderApiKeyValue('')
        loadAiProviders()
        window.dispatchEvent(new CustomEvent('providerApiKeyChanged'))
      } else {
        setProviderMessage(data.error || 'Failed to save API key')
        setIsProviderError(true)
      }
    } catch (error) {
      setProviderMessage('Failed to save API key')
      setIsProviderError(true)
    } finally {
      setIsSavingProvider(false)
    }
  }

  // Delete Provider API Key
  const handleDeleteProviderApiKey = async (providerId: string) => {
    if (!confirm(t('ai_providers_delete_confirm'))) {
      return
    }

    try {
      const response = await fetch(`/api/settings/ai-providers?provider=${providerId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        setProviderMessage(t('ai_providers_deleted'))
        setIsProviderError(false)
        setSelectedProviderForEdit(null)
        loadAiProviders()
        window.dispatchEvent(new CustomEvent('providerApiKeyChanged'))
      } else {
        const data = await response.json()
        setProviderMessage(data.error || 'Failed to delete API key')
        setIsProviderError(true)
      }
    } catch (error) {
      setProviderMessage('Failed to delete API key')
      setIsProviderError(true)
    }
  }

  // Load Vault status
  useEffect(() => {
    if (!userId) return
    fetch('/api/settings/secret-vault')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setVaultEnabled(data.vaultEnabled) })
      .catch(() => {})
  }, [userId])

  // Load data on component mount (only once when userId is set)
  useEffect(() => {
    if (!userId || isInitialDataLoaded) return
    setIsInitialDataLoaded(true)

    const loadAgentData = async () => {
      try {
        const response = await fetch('/api/agents')
        if (response.ok) {
          const data = await response.json()
          const agents = data.agents || data
          setAgentCount(Array.isArray(agents) ? agents.length : 0)

          if (agents && agents.length > 0) {
            const storedAgentId = localStorage.getItem('activeAgentId')
            let targetAgent = agents[0]

            if (storedAgentId) {
              const foundAgent = agents.find((a: any) => a.agentId === storedAgentId)
              if (foundAgent) {
                targetAgent = foundAgent
              }
            }

            setAgentId(targetAgent.agentId)
            setAgentTitle(targetAgent.title || '')
            setAgentAccessMode(targetAgent.accessMode || 'public')
            setOriginalAgentTitle(targetAgent.title || '')
            setOriginalAgentAccessMode(targetAgent.accessMode || 'public')

            const chatCountValue = targetAgent.chatLimitCount ?? 0
            const durationMinutes = targetAgent.chatLimitDurationMinutes ?? 1440
            const unitValue: TimeUnit = durationMinutes === 1 ? 'minute' : durationMinutes === 60 ? 'hour' : 'day'

            setChatLimitCount(String(chatCountValue))
            setOriginalChatLimitCount(String(chatCountValue))
            setChatLimitUnit(unitValue)
            setOriginalChatLimitUnit(unitValue)
            setChatLimitMessage(targetAgent.chatLimitMessage || '')
            setOriginalChatLimitMessage(targetAgent.chatLimitMessage || '')
            setContinuousAnswerLimit(String(targetAgent.continuousAnswerLimit ?? 0))
            setOriginalContinuousAnswerLimit(String(targetAgent.continuousAnswerLimit ?? 0))
            setContinuousAnswerLimitMessage(targetAgent.continuousAnswerLimitMessage || '')
            setOriginalContinuousAnswerLimitMessage(targetAgent.continuousAnswerLimitMessage || '')
            setUsageErrors({})
          } else {
            setAgentCount(0)
          }
        }

        const settingsResponse = await fetch('/api/settings')
        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json()
          if (settingsData.success && settingsData.settings) {
            setUserPlan(settingsData.settings.plan || 'free')
            if (settingsData.settings.serviceVariant) {
              setServiceVariant(settingsData.settings.serviceVariant)
              if (settingsData.settings.managedRegion) {
                setManagedRegion(settingsData.settings.managedRegion)
              }
              if ((settingsData.settings.serviceVariant === 'managed' || edition === 'selfhosted') && (activeTab === 'security' || activeTab === 'api-key')) {
                handleTabChange('ai-agent')
              }
            }
            const timezone = settingsData.settings.timezone || 'UTC'
            const locale = settingsData.settings.locale || 'en-US'
            const timeFormat = settingsData.settings.time_format || 'DD.MM.YYYY HH:mm'
            setUserTimezone(timezone)
            setUserLocale(locale)
            setUserTimeFormat(timeFormat)
            setOriginalUserTimezone(timezone)
            setOriginalUserLocale(locale)
            setOriginalUserTimeFormat(timeFormat)
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }

    const loadUserData = async () => {
      try {
        const response = await fetch('/api/user/profile')
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.user) {
            setUserName(data.user.name || '')
            setUserEmail(data.user.email || '')
            setCompanyName(data.user.companyName || '')
            setUserPhone(data.user.phone || '')
            setUserCountry((data.user.country || '').toUpperCase())
            setOriginalUserName(data.user.name || '')
            setOriginalUserEmail(data.user.email || '')
            setOriginalCompanyName(data.user.companyName || '')
            setOriginalUserPhone(data.user.phone || '')
            setOriginalUserCountry((data.user.country || '').toUpperCase())
            setIsGoogleUser(!data.user.password)
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }

    loadAgentData()
    loadUserData()
  }, [userId])

  const handleSave = async () => {
    if (!agentId) {
      setMessage(t('settings_no_agent_found'))
      setIsError(true)
      return
    }

    setIsSaving(true)
    setMessage('')
    setIsError(false)

    try {
      const response = await fetch(`/api/agents/${agentId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: agentTitle,
          accessMode: agentAccessMode,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setMessage(t('settings_saved_successfully'))
        setIsError(false)
        // Update original values after successful save
        setOriginalAgentTitle(agentTitle)
        setOriginalAgentAccessMode(agentAccessMode)
        setTimeout(() => {
          setMessage('')
        }, 3000)
      } else {
        setMessage(data.error || t('settings_save_failed'))
        setIsError(true)
      }
    } catch (error) {
      setMessage(t('settings_save_failed'))
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const getEmbedCode = () => {
    if (!agentId) return ''
    const baseUrl = window.location.origin
    return `<script>
  (function() {
    var script = document.createElement('script');
    script.src = '${baseUrl}/embed.min.js';
    script.setAttribute('data-agent-id', '${agentId}');
    script.setAttribute('data-base-url', '${baseUrl}');
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`
  }

  const handleSaveApiKey = async () => {
    if (!apiKeyValue.trim()) {
      setMessage(t('message_api_key_empty'))
      setIsError(true)
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/settings/openai-api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': currentLanguage,
        },
        body: JSON.stringify({
          apiKey: apiKeyValue,
          model: selectedModel,
          checkAgents: true,
          agentId: agentId
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setMessage(t('message_api_key_save_success'))
        setIsError(false)
        setApiKeyValue('')
        setIsEditingApiKey(false)
        await loadAiProviders() // Reload data

        // Clear message after 3 seconds
        setTimeout(() => {
          setMessage('')
        }, 3000)
      } else {
        setMessage(data.error || t('message_api_key_save_failed'))
        setIsError(true)
      }
    } catch (error) {
      setMessage(t('message_network_error'))
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteApiKey = async () => {
    setShowDeleteDialog(true)
  }

  const confirmDeleteApiKey = async () => {
    if (!deleteConfirmed) {
      return
    }

    try {
      const response = await fetch('/api/settings/openai-api-key', {
        method: 'DELETE',
        headers: {
          'Accept-Language': currentLanguage,
        },
      })

      const data = await response.json()

      if (response.ok) {
        setMessage(t('message_api_key_delete_success'))
        setIsError(false)
        setIsEditingApiKey(true)
        setApiKeyValue('')
        await loadAiProviders() // Reload data

        // Clear message after 3 seconds
        setTimeout(() => {
          setMessage('')
        }, 3000)
      } else {
        setMessage(data.error || t('message_api_key_delete_failed'))
        setIsError(true)
      }
    } catch (error) {
      setMessage(t('message_network_error'))
      setIsError(true)
    } finally {
      setShowDeleteDialog(false)
      setDeleteConfirmed(false)
    }
  }

  const cancelDeleteApiKey = () => {
    setShowDeleteDialog(false)
    setDeleteConfirmed(false)
  }

  const handleModelChange = (model: string) => {
    setSelectedModel(model)
  }

  const handleResetMessages = async () => {
    if (!agentId || !confirm(t('settings_other_reset_messages_confirm'))) {
      return
    }

    try {
      const defaultChatMessage = t('chat_limit_message')
      const defaultContinuousMessage = t('continuous_answer_limit_message')

      const response = await fetch(`/api/agents/${agentId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatLimitCount: Number(chatLimitCount),
          chatLimitUnit: chatLimitUnit,
          chatLimitMessage: defaultChatMessage,
          continuousAnswerLimit: Number(continuousAnswerLimit),
          continuousAnswerLimitMessage: defaultContinuousMessage,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setChatLimitMessage(defaultChatMessage)
        setContinuousAnswerLimitMessage(defaultContinuousMessage)
        setOriginalChatLimitMessage(defaultChatMessage)
        setOriginalContinuousAnswerLimitMessage(defaultContinuousMessage)
        setUsageMessage(t('settings_other_reset_messages_success'))
        setIsUsageError(false)
      } else {
        setUsageMessage(data.error || t('settings_other_reset_messages_error'))
        setIsUsageError(true)
      }
    } catch (error) {
      setUsageMessage(t('settings_other_reset_messages_error'))
      setIsUsageError(true)
    }
  }

  const handleSaveUsageLimits = async () => {
    if (!agentId) {
      setUsageMessage(t('settings_no_agent_found'))
      setIsUsageError(true)
      return
    }

    const errors: {
      chatLimitCount?: string
      continuousAnswerLimit?: string
    } = {}

    if (!/^\d+$/.test(chatLimitCount.trim())) {
      errors.chatLimitCount = t('settings_other_usage_limits_invalid_number')
    }

    if (!/^\d+$/.test(continuousAnswerLimit.trim())) {
      errors.continuousAnswerLimit = t('settings_other_usage_limits_invalid_number')
    }

    if (Object.keys(errors).length > 0) {
      setUsageErrors(errors)
      return
    }

    setUsageErrors({})
    setIsSavingUsageLimits(true)
    setUsageMessage('')
    setIsUsageError(false)

    try {
      const response = await fetch(`/api/agents/${agentId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatLimitCount: Number(chatLimitCount),
          chatLimitUnit: chatLimitUnit,
          chatLimitMessage,
          continuousAnswerLimit: Number(continuousAnswerLimit),
          continuousAnswerLimitMessage,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setUsageMessage(data.message || t('settings_other_usage_limits_success'))
        setIsUsageError(false)
        setOriginalChatLimitCount(chatLimitCount)
        setOriginalChatLimitUnit(chatLimitUnit)
        setOriginalChatLimitMessage(chatLimitMessage)
        setOriginalContinuousAnswerLimit(continuousAnswerLimit)
        setOriginalContinuousAnswerLimitMessage(continuousAnswerLimitMessage)
      } else {
        setUsageMessage(data.error || t('settings_other_usage_limits_error'))
        setIsUsageError(true)
      }
    } catch (error) {
      setUsageMessage(t('settings_other_usage_limits_error'))
      setIsUsageError(true)
    } finally {
      setIsSavingUsageLimits(false)
    }
  }

  const handleSaveProfile = async () => {
    setIsSaving(true)
    setMessage('')
    setIsError(false)

    try {
      const response = await fetch('/api/user/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: userName,
          companyName: companyName,
          phone: userPhone,
          country: userCountry,
          // email is changed separately via verification process
          currentPassword: currentPassword,
          newPassword: newPassword,
          timezone: userTimezone,
          locale: userLocale,
          timeFormat: userTimeFormat,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setMessage(t('settings_profile_updated'))
        setIsError(false)
        // Update original values after successful save
        setOriginalUserName(userName)
        setOriginalCompanyName(companyName)
        setOriginalUserPhone(userPhone)
        setOriginalUserCountry(userCountry)
        setOriginalUserTimezone(userTimezone)
        setOriginalUserLocale(userLocale)
        setOriginalUserTimeFormat(userTimeFormat)
        const languageCode = mapLocaleToLanguage(userLocale)
        if (languageCode !== currentLanguage) {
          setLanguage(languageCode)
        }
        try {
          if (localStorage.getItem('cookie-consent') === 'true') {
            localStorage.setItem('preferred-language', languageCode)
          }
        } catch (error) {
          // Ignore storage errors
        }


        // Clear password fields
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => {
          setMessage('')
        }, 3000)
      } else {
        setMessage(data.error || t('settings_profile_update_failed'))
        setIsError(true)
      }
    } catch (error) {
      setMessage(t('settings_profile_update_failed'))
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }

  // Passkey functions
  const fetchPasskeys = async () => {
    setIsLoadingPasskeys(true)
    try {
      const response = await fetch('/api/auth/passkey')
      if (response.ok) {
        const data = await response.json()
        setPasskeys(data.passkeys || [])
      }
    } catch (error) {
      console.error('Failed to fetch passkeys:', error)
    } finally {
      setIsLoadingPasskeys(false)
    }
  }

  const handleRegisterPasskey = async () => {
    setIsRegisteringPasskey(true)
    setPasskeyError('')
    setPasskeySuccess('')

    try {
      const optionsRes = await fetch('/api/auth/passkey/register')
      if (!optionsRes.ok) {
        throw new Error('Failed to get registration options')
      }
      const options = await optionsRes.json()

      const regResponse = await startRegistration({ optionsJSON: options })

      const verifyRes = await fetch('/api/auth/passkey/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: regResponse,
          name: navigator.platform || 'My Device',
        }),
      })

      if (!verifyRes.ok) {
        const result = await verifyRes.json()
        throw new Error(result.error || 'Registration failed')
      }

      setPasskeySuccess(t('settings_passkey_registered') || 'Passkey registered successfully')
      fetchPasskeys()
      setTimeout(() => setPasskeySuccess(''), 3000)
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        return
      }
      console.error('[Passkey Register Error]', err)
      setPasskeyError(err.message || t('settings_passkey_register_failed') || 'Failed to register passkey')
    } finally {
      setIsRegisteringPasskey(false)
    }
  }

  const handleDeletePasskey = async (passkeyId: string) => {
    if (!confirm(t('settings_passkey_delete_confirm') || 'Are you sure you want to delete this passkey?')) {
      return
    }

    try {
      const response = await fetch(`/api/auth/passkey?id=${passkeyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setPasskeySuccess(t('settings_passkey_deleted') || 'Passkey deleted successfully')
        fetchPasskeys()
        setTimeout(() => setPasskeySuccess(''), 3000)
      } else {
        const result = await response.json()
        setPasskeyError(result.error || t('settings_passkey_delete_failed') || 'Failed to delete passkey')
      }
    } catch (error) {
      setPasskeyError(t('settings_passkey_delete_failed') || 'Failed to delete passkey')
    }
  }

  // Email change handlers
  const handleOpenEmailChangeDialog = () => {
    setNewEmailInput('')
    setEmailChangeError('')
    setEmailChangeSuccess('')
    setIsEmailChangeDialogOpen(true)
  }

  const handleEmailChangeRequest = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!newEmailInput || !emailRegex.test(newEmailInput)) {
      setEmailChangeError(t('settings_email_change_invalid_email'))
      return
    }

    if (newEmailInput.toLowerCase() === userEmail.toLowerCase()) {
      setEmailChangeError(t('settings_email_change_same_email'))
      return
    }

    setIsChangingEmail(true)
    setEmailChangeError('')

    try {
      const response = await fetch('/api/dashboard/change-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newEmail: newEmailInput,
          language: currentLanguage
        })
      })

      const result = await response.json()

      if (result.success) {
        setEmailChangeSuccess(t('settings_email_change_success'))
        setIsEmailChangeDialogOpen(false)
        setTimeout(() => setEmailChangeSuccess(''), 5000)
      } else {
        switch (result.error) {
          case 'SAME_EMAIL':
            setEmailChangeError(t('settings_email_change_same_email'))
            break
          case 'EMAIL_EXISTS':
            setEmailChangeError(t('settings_email_change_email_exists'))
            break
          case 'INVALID_EMAIL':
            setEmailChangeError(t('settings_email_change_invalid_email'))
            break
          default:
            setEmailChangeError(t('settings_email_change_error'))
        }
      }
    } catch (error) {
      setEmailChangeError(t('settings_email_change_error'))
    } finally {
      setIsChangingEmail(false)
    }
  }

  const handleSaveModel = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/settings/openai-api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': currentLanguage,
        },
        body: JSON.stringify({
          apiKey: '', // Empty API key means only update model
          model: selectedModel,
          agentId: agentId
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setMessage(t('message_model_update_success'))
        setIsError(false)
        // Update original model value after successful save
        setOriginalSelectedModel(selectedModel)

        // Clear message after 3 seconds
        setTimeout(() => {
          setMessage('')
        }, 3000)
      } else {
        setMessage(data.error || t('message_model_update_failed'))
        setIsError(true)
      }
    } catch (error) {
      setMessage(t('message_network_error'))
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }

  if (!isMobileChecked) {
    return (
      <div className="space-y-6 px-2 sm:px-0">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-12 w-full bg-muted animate-pulse rounded" />
        <div className="h-64 w-full bg-muted animate-pulse rounded" />
      </div>
    )
  }

  return (
    <div className={cn("space-y-6 px-2 sm:px-0", isMobile && "overflow-x-hidden max-w-[100vw] w-full")}>
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight truncate">{t('settings_title')}</h1>
      </div>

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
                <p className={cn(
                  "text-sm mt-2",
                  isMigrationError ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
                )}>
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

      {/* Tab Navigation - Mobile Optimized */}
      <div className="w-full overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex flex-wrap gap-1 bg-muted rounded-lg p-1 w-full md:inline-flex md:flex-nowrap md:gap-0 md:w-auto">
            {false && (
            <button
              onClick={() => handleTabChange('api-key')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'api-key'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('settings_tab_api_key')}
            </button>
            )}
            <button
              onClick={() => handleTabChange('ai-agent')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'ai-agent'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('settings_tab_ai_assistant')}
            </button>
            <button
              onClick={() => handleTabChange('team')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'team'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('settings_tab_team')}
            </button>
            <button
              onClick={() => handleTabChange('mcp')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'mcp'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('settings_tab_mcp')}
            </button>
            {aiConnectionsAvailable && (
              <button
                onClick={() => handleTabChange('ai-connections')}
                className={cn(
                  'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                  activeTab === 'ai-connections'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('settings_tab_ai_connections')}
              </button>
            )}
            {licenseInfo && (
              <button
                onClick={() => handleTabChange('license')}
                className={cn(
                  'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                  activeTab === 'license'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('settings_tab_license')}
              </button>
            )}
            <button
              onClick={() => handleTabChange('profile')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'profile'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('settings_tab_profile')}
            </button>
            {byoTabsShown && (
            <button
              onClick={() => handleTabChange('security')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'security'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('settings_tab_security')}
            </button>
            )}
            <button
              onClick={() => handleTabChange('other')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'other'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('settings_tab_other')}
            </button>
            <button
              onClick={() => handleTabChange('advanced')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'advanced'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('settings_tab_advanced')}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {activeTab === 'api-key' && byoTabsShown && (
          <>
            {vaultEnabled && (
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-start gap-3">
                <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{t('vault_active_banner_title')}</p>
                  <p className="text-sm text-blue-600/80 dark:text-blue-400/80 mt-1">{t('vault_active_banner_description')}</p>
                </div>
              </div>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  {t('ai_providers_title')}
                </CardTitle>
                <CardDescription>
                  {t('ai_providers_description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Provider Message */}
                {providerMessage && (
                  <div className={cn(
                    'p-3 rounded-md text-sm',
                    isProviderError
                      ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                      : 'bg-green-500/10 text-green-500 border border-green-500/20'
                  )}>
                    {providerMessage}
                  </div>
                )}

                {/* Provider List */}
                <div className="space-y-4">
                  {aiProviders.map((provider) => (
                    <div
                      key={provider.id}
                      className={cn(
                        "p-3 sm:p-4 border rounded-lg space-y-3 overflow-hidden",
                        !provider.isImplemented && "opacity-60"
                      )}
                    >
                      <div className={cn(
                        "flex gap-2",
                        isMobile ? "flex-col" : "items-center justify-between"
                      )}>
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-wrap">
                          {getLlmProviderIcon(provider.id, { size: isMobile ? 16 : 20, className: provider.id === 'openai' ? 'text-gray-700 dark:text-gray-300 flex-shrink-0' : 'flex-shrink-0' })}
                          <div className="font-medium text-sm sm:text-base truncate">{provider.name}</div>
                          {provider.id === defaultProvider && provider.hasApiKey && (
                            <Badge variant="secondary" className="text-xs flex-shrink-0">{t('ai_providers_default')}</Badge>
                          )}
                          {!provider.isImplemented && (
                            <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/50 flex-shrink-0">{t('ai_providers_coming_soon')}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {provider.hasApiKey ? (
                            <>
                              <Badge variant="outline" className="text-green-500 border-green-500/50 text-xs">
                                <Check className="w-3 h-3 mr-1" />
                                {isMobile ? '' : t('ai_providers_configured')}
                              </Badge>
                              {!vaultEnabled && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={() => {
                                    setSelectedProviderForEdit(provider.id)
                                    setProviderApiKeyValue('')
                                  }}
                                >
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                              )}
                            </>
                          ) : (
                            vaultEnabled ? (
                              <Badge variant="outline" className="text-muted-foreground text-xs">
                                {t('ai_providers_not_in_vault')}
                              </Badge>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedProviderForEdit(provider.id)
                                  setProviderApiKeyValue('')
                                }}
                                disabled={!provider.isImplemented}
                              >
                                <Key className="w-4 h-4 mr-1 sm:mr-2" />
                                {isMobile ? 'Add' : t('ai_providers_add_key')}
                              </Button>
                            )
                          )}
                        </div>
                      </div>

                      {/* API Key Info */}
                      {provider.hasApiKey && provider.maskedApiKey && (
                        <div className="text-sm text-muted-foreground font-mono">
                          {provider.maskedApiKey}
                        </div>
                      )}

                      {/* Edit Form */}
                      {selectedProviderForEdit === provider.id && (
                        <div className="space-y-3 pt-3 border-t">
                          <div className="space-y-2">
                            <Label>{t('ai_providers_api_key_label')}</Label>
                            <Input
                              type="password"
                              placeholder={`Enter your ${provider.name} API key`}
                              value={providerApiKeyValue}
                              onChange={(e) => setProviderApiKeyValue(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <Button
                              size={isMobile ? "sm" : "default"}
                              onClick={() => handleSaveProviderApiKey(provider.id, false)}
                              disabled={isSavingProvider || !providerApiKeyValue.trim()}
                            >
                              {isSavingProvider ? (
                                <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-2 animate-spin" />
                              ) : (
                                <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                              )}
                              {isMobile ? 'Save' : t('ai_providers_save')}
                            </Button>
                            {provider.id !== defaultProvider && !isMobile && (
                              <Button
                                variant="outline"
                                size={isMobile ? "sm" : "default"}
                                onClick={() => handleSaveProviderApiKey(provider.id, true)}
                                disabled={isSavingProvider || (!providerApiKeyValue.trim() && !provider.hasApiKey)}
                              >
                                {t('ai_providers_save_default')}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size={isMobile ? "sm" : "default"}
                              onClick={() => {
                                setSelectedProviderForEdit(null)
                                setProviderApiKeyValue('')
                              }}
                            >
                              {isMobile ? 'Cancel' : t('ai_providers_cancel')}
                            </Button>
                            {provider.hasApiKey && (
                              <Button
                                variant="ghost"
                                size={isMobile ? "sm" : "default"}
                                className="ml-auto text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                onClick={() => handleDeleteProviderApiKey(provider.id)}
                              >
                                {isMobile ? <Trash2 className="w-4 h-4" /> : t('ai_providers_delete')}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Info Box */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="flex gap-3">
                    <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-500">
                      <p className="font-medium mb-1">{t('ai_providers_info_title')}</p>
                      <p className="text-blue-500/80">
                        {t('ai_providers_info_desc')}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Why API Key is Required - Separate Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  {t('api_key_why_required_title')}
                </CardTitle>
                <CardDescription>
                  {t('api_key_why_required_subtitle')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Key Benefits */}
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">{t('api_key_byok_title')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('api_key_byok_desc')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">{t('api_key_data_yours_title')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('api_key_data_yours_desc')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">{t('api_key_no_training_title')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('api_key_no_training_desc')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Transparent Costs */}
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="font-medium text-foreground mb-1">{t('api_key_transparent_costs_title')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('api_key_transparent_costs_desc')}
                  </p>
                </div>

                {/* YouTube Tutorial Links */}
                <div className="pt-2 space-y-2">
                  <button
                    onClick={() => window.open(t('openai_api_key_tutorial_url'), '_blank')}
                    className="text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer dark:text-blue-400 dark:hover:text-blue-300 text-sm flex items-center gap-1"
                  >
                    {t('openai_api_key_tutorial_link')}
                    <ExternalLink className="h-3 w-3" />
                  </button>
                  {currentLanguage === 'en' && (
                    <button
                      onClick={() => window.open('https://www.youtube.com/watch?v=6BRyynZkvf0', '_blank')}
                      className="text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer dark:text-blue-400 dark:hover:text-blue-300 text-sm flex items-center gap-1"
                    >
                      Youtube Video: How to Get Google Gemini API Key
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* AI Assistant Settings */}
        {activeTab === 'ai-agent' && (
          <div className={cn("w-full", isMobile && "overflow-x-hidden max-w-[100vw]")}>
            <Card className="overflow-hidden w-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  {t('ai_assistant_title')}
                </CardTitle>
                <CardDescription className="break-words">
                  <span className="block sm:inline">{t('ai_assistant_description')}</span>
                  <span className="block sm:inline sm:ml-2 mt-1 sm:mt-0">
                    · {t('chat_settings_ai_assistant_label')} <span className="font-medium truncate">{agentTitle || 'Agent 정보 로딩 중...'}</span>
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className={cn("space-y-6", isMobile && "overflow-x-hidden")}>
                {/* Message Display */}
                {message && activeTab === 'ai-agent' && (
                  <div className={`p-3 rounded-lg ${isError ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-400' : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'}`}>
                    {message}
                  </div>
                )}

                {/* 1. Assistant Name */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
                    <h3 className="text-lg font-semibold">1. {t('settings_assistant_name_label')}</h3>
                  </div>
                  <div className="space-y-2 pl-6">
                    <div className="space-y-1">
                      <Input
                        id="app-name"
                        value={agentTitle}
                        onChange={(e) => setAgentTitle(e.target.value)}
                        placeholder={t('settings_assistant_name_placeholder')}
                        maxLength={30}
                      />
                      <div className="flex justify-between items-center text-xs">
                        <span className={`${agentTitle.length >= 30 ? 'text-red-500' : 'text-muted-foreground'}`}>
                          {agentTitle.length >= 30 ? t('settings_assistant_name_max_chars') : t('settings_assistant_name_char_count').replace('{0}', agentTitle.length.toString())}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {serviceVariant === 'managed' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-6 bg-purple-500 rounded-full"></div>
                    <h3 className="text-lg font-semibold">2. {t('rag_provider_title')}</h3>
                  </div>
                  <div className="space-y-4 pl-6">
                    <p className="text-sm text-muted-foreground">
                      {t('rag_provider_description')}
                    </p>

                    {(isRagProviderLoading || serviceVariant === null) ? (
                      <div className="h-16 animate-pulse bg-muted rounded-lg w-full sm:w-[400px]" />
                    ) : serviceVariant === 'managed' && ragProvider === 'azure_ai_search' ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50 w-full sm:w-[400px]">
                          <Database className="h-5 w-5 text-blue-500" />
                          <div className="flex flex-col">
                            <span className="font-medium">Azure AI Search</span>
                            {managedRegion && (() => {
                              const region = getRegionById(managedRegion)
                              return region ? (
                                <span className="text-xs text-muted-foreground">{region.flag} {region.country}</span>
                              ) : null
                            })()}
                          </div>
                          <Badge variant="secondary" className="ml-auto text-xs">{t('managed_included')}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('managed_rag_description')}
                        </p>
                      </div>
                    ) : serviceVariant === 'managed' ? (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Vector DB is being prepared for your region. Chat is available without file search.
                        </p>
                      </div>
                    ) : (
                    <>
                    {/* RAG Provider Message */}
                    {ragProviderMessage && (
                      <div className={`p-3 rounded-lg ${isRagProviderError ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-400' : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'}`}>
                        {ragProviderMessage}
                      </div>
                    )}

                    {/* RAG Provider Selection */}
                    <div className="space-y-3">
                      <Select value={ragProvider} onValueChange={setRagProvider} disabled={isRagProviderLoading}>
                        <SelectTrigger className="w-full sm:w-[300px]">
                          {isRagProviderLoading ? (
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              {t('loading')}
                            </span>
                          ) : (
                            <SelectValue placeholder={t('rag_provider_select_placeholder')} />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            <div className="flex items-center gap-2">
                              <NoneIcon size={18} className="text-gray-500 dark:text-gray-400" />
                              <span>{t('rag_provider_none')}</span>
                              {originalRagProvider === 'none' && (
                                <Badge variant="secondary" className="text-xs">{t('ai_providers_default')}</Badge>
                              )}
                            </div>
                          </SelectItem>
                          <SelectItem value="openai_vector_store">
                            <div className="flex items-center gap-2">
                              <OpenAIIcon size={18} className="text-gray-700 dark:text-gray-300" />
                              <div className="flex flex-col items-start">
                                <span>OpenAI Vector Store</span>
                                <span className="text-xs text-muted-foreground">{t('rag_provider_openai_only')}</span>
                              </div>
                              {originalRagProvider === 'openai_vector_store' && (
                                <Badge variant="secondary" className="text-xs">{t('ai_providers_default')}</Badge>
                              )}
                            </div>
                          </SelectItem>
                          <SelectItem value="gemini_file_search">
                            <div className="flex items-center gap-2">
                              <GeminiIcon size={18} />
                              <div className="flex flex-col items-start">
                                <span>Gemini File Search</span>
                                <span className="text-xs text-muted-foreground">{t('rag_provider_gemini_only')}</span>
                              </div>
                              {originalRagProvider === 'gemini_file_search' && (
                                <Badge variant="secondary" className="text-xs">{t('ai_providers_default')}</Badge>
                              )}
                            </div>
                          </SelectItem>
                          <SelectItem value="pinecone">
                            <div className="flex items-center gap-2">
                              <PineconeIcon size={18} className="text-gray-700 dark:text-gray-300" />
                              <div className="flex flex-col items-start">
                                <span>Pinecone</span>
                                <span className="text-xs text-green-600 dark:text-green-400">{t('rag_provider_all_models')}</span>
                              </div>
                              {originalRagProvider === 'pinecone' && (
                                <Badge variant="secondary" className="text-xs">{t('ai_providers_default')}</Badge>
                              )}
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      {!isRagProviderLoading && (
                        <>
                          {!hasRequiredApiKey(ragProvider) && ragProvider !== 'pinecone' && (
                            <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20">
                              <CardContent className="pt-4">
                                <div className="flex items-start gap-3">
                                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                                  <div className="space-y-2 flex-1">
                                    <p className="text-sm font-medium text-red-800 dark:text-red-200">
                                      {ragProvider === 'openai_vector_store' && t('rag_provider_requires_openai')}
                                      {ragProvider === 'gemini_file_search' && t('rag_provider_requires_gemini')}
                                    </p>
                                    <p className="text-sm text-red-700 dark:text-red-300">
                                      {t('rag_provider_configure_api_key_first')}
                                    </p>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="mt-2 border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
                                      onClick={() => handleTabChange('api-key')}
                                    >
                                      <Key className="h-4 w-4 mr-2" />
                                      {t('rag_provider_go_to_api_keys')}
                                    </Button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {hasRequiredApiKey(ragProvider) && ragProvider !== 'pinecone' && (
                            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                              <Check className="h-4 w-4" />
                              <span>
                                {ragProvider === 'openai_vector_store' && t('rag_provider_openai_configured')}
                                {ragProvider === 'gemini_file_search' && t('rag_provider_gemini_configured')}
                              </span>
                            </div>
                          )}

                          {/* Pinecone Configuration Form */}
                          {ragProvider === 'pinecone' && (
                            <Card className="border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-950/20 overflow-hidden w-full max-w-full">
                              <CardContent className={cn("pt-4", isMobile && "overflow-x-hidden px-3")}>
                                <div className="space-y-4 w-full max-w-full overflow-hidden">
                                  <div className="flex items-center gap-2">
                                    <PineconeIcon size={20} className="text-purple-600 dark:text-purple-400" />
                                    <h4 className="text-sm font-semibold text-purple-800 dark:text-purple-200">
                                      {t('pinecone_config_title')}
                                    </h4>
                                  </div>
                                  <p className="text-xs text-purple-600 dark:text-purple-400">
                                    {t('pinecone_config_description')}
                                  </p>

                                  {['text-embedding-3-small', 'text-embedding-3-large'].includes(pineconeEmbeddingModel) &&
                                   !ragConfiguredProviders.includes('openai') && (
                                    <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
                                      <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                                      <div className="space-y-1">
                                        <p className="text-xs font-medium text-red-700 dark:text-red-300">
                                          {t('pinecone_openai_required')}
                                        </p>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300"
                                          onClick={() => handleTabChange('api-key')}
                                        >
                                          <Key className="h-3 w-3 mr-1" />
                                          {t('rag_provider_go_to_api_keys')}
                                        </Button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Pinecone API Key */}
                                  <div className="space-y-2">
                                    <Label htmlFor="pinecone-api-key" className="text-sm font-medium text-purple-800 dark:text-purple-200">
                                      {t('pinecone_api_key')} <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                      id="pinecone-api-key"
                                      type="password"
                                      value={pineconeApiKey}
                                      onChange={(e) => setPineconeApiKey(e.target.value)}
                                      placeholder={t('pinecone_api_key_placeholder')}
                                      className="bg-white dark:bg-gray-900 border-purple-200 dark:border-purple-700 focus:border-purple-500 w-full max-w-full"
                                    />
                                    <p className="text-xs text-purple-500 dark:text-purple-400">
                                      {t('pinecone_api_key_hint')}
                                    </p>
                                  </div>

                                  {/* Index Name */}
                                  <div className="space-y-2">
                                    <Label htmlFor="pinecone-index" className="text-sm font-medium text-purple-800 dark:text-purple-200">
                                      {t('pinecone_index_name')} <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                      id="pinecone-index"
                                      type="text"
                                      value={pineconeIndexName}
                                      onChange={(e) => setPineconeIndexName(e.target.value)}
                                      placeholder={t('pinecone_index_name_placeholder')}
                                      className="bg-white dark:bg-gray-900 border-purple-200 dark:border-purple-700 focus:border-purple-500 w-full max-w-full"
                                    />
                                    <p className="text-xs text-purple-500 dark:text-purple-400">
                                      {t('pinecone_index_name_hint')}
                                    </p>
                                  </div>

                                  {/* Host (Optional) */}
                                  <div className="space-y-2">
                                    <Label htmlFor="pinecone-host" className="text-sm font-medium text-purple-800 dark:text-purple-200">
                                      {t('pinecone_host')}
                                    </Label>
                                    <Input
                                      id="pinecone-host"
                                      type="text"
                                      value={pineconeHost}
                                      onChange={(e) => setPineconeHost(e.target.value)}
                                      placeholder={t('pinecone_host_placeholder')}
                                      className="bg-white dark:bg-gray-900 border-purple-200 dark:border-purple-700 focus:border-purple-500 w-full max-w-full"
                                    />
                                    <p className="text-xs text-purple-500 dark:text-purple-400">
                                      {t('pinecone_host_hint')}
                                    </p>
                                  </div>

                                  {/* Embedding Model */}
                                  <div className="space-y-2">
                                    <Label htmlFor="pinecone-embedding" className="text-sm font-medium text-purple-800 dark:text-purple-200">
                                      {t('pinecone_embedding_model')} <span className="text-red-500">*</span>
                                    </Label>
                                    <Select value={pineconeEmbeddingModel} onValueChange={handleEmbeddingModelChange}>
                                      <SelectTrigger className="bg-white dark:bg-gray-900 border-purple-200 dark:border-purple-700 w-full max-w-full">
                                        <SelectValue placeholder={t('pinecone_embedding_model_placeholder')} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {PINECONE_EMBEDDING_MODELS.map((model) => (
                                          <SelectItem key={model.id} value={model.id}>
                                            <div className="flex items-center gap-2">
                                              <span>{model.name}</span>
                                              <span className="text-xs text-muted-foreground">({model.dimension}d)</span>
                                            </div>
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-purple-500 dark:text-purple-400">
                                      {t('pinecone_embedding_model_hint')}
                                    </p>
                                    <div className="flex items-start gap-2 text-xs text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 px-3 py-2 rounded-lg">
                                      <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                      <span className="break-words">Dimension: <strong>{pineconeDimension}</strong> {!isMobile && `- ${t('pinecone_dimension_warning')}`}</span>
                                    </div>
                                  </div>

                                  {/* Namespace (Optional) */}
                                  <div className="space-y-2">
                                    <Label htmlFor="pinecone-namespace" className="text-sm font-medium text-purple-800 dark:text-purple-200">
                                      {t('pinecone_namespace')}
                                    </Label>
                                    <Input
                                      id="pinecone-namespace"
                                      type="text"
                                      value={pineconeNamespace}
                                      onChange={(e) => setPineconeNamespace(e.target.value)}
                                      placeholder={t('pinecone_namespace_placeholder')}
                                      className="bg-white dark:bg-gray-900 border-purple-200 dark:border-purple-700 focus:border-purple-500 w-full max-w-full"
                                    />
                                    <p className="text-xs text-purple-500 dark:text-purple-400">
                                      {t('pinecone_namespace_hint')}
                                    </p>
                                  </div>

                                  <div className={cn(
                                    "flex gap-2 pt-2",
                                    isMobile ? "flex-col" : "items-center gap-3"
                                  )}>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={handleTestPineconeConnection}
                                      disabled={isPineconeTestLoading || !pineconeApiKey || !pineconeIndexName}
                                      className="border-purple-300 text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-900/30 w-fit"
                                    >
                                      {isPineconeTestLoading ? (
                                        <>
                                          <RefreshCw className="h-4 w-4 mr-1 sm:mr-2 animate-spin" />
                                          {isMobile ? 'Testing' : t('pinecone_testing')}
                                        </>
                                      ) : (
                                        <>
                                          <Zap className="h-4 w-4 mr-1 sm:mr-2" />
                                          {isMobile ? 'Test' : t('pinecone_test_connection')}
                                        </>
                                      )}
                                    </Button>

                                    {!pineconeTestResult && originalPineconeConfig.apiKey && originalPineconeConfig.indexName && (
                                      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                                        <Check className="h-4 w-4" />
                                        <span className="truncate">{isMobile ? 'Configured' : t('pinecone_configured')}</span>
                                      </div>
                                    )}
                                  </div>

                                  {pineconeTestResult && (
                                    <div className={`p-3 rounded-lg text-sm ${pineconeTestResult.success
                                      ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'
                                      : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800'
                                      }`}>
                                      <div className="flex items-start gap-2">
                                        {pineconeTestResult.success ? (
                                          <Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                                        ) : (
                                          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                                        )}
                                        <div className="flex-1">
                                          <p className={pineconeTestResult.success
                                            ? 'text-green-700 dark:text-green-300 font-medium'
                                            : 'text-red-700 dark:text-red-300 font-medium'
                                          }>
                                            {pineconeTestResult.message}
                                          </p>
                                          {pineconeTestResult.success && pineconeTestResult.details && (
                                            <div className="mt-2 text-xs text-green-600 dark:text-green-400 space-y-1">
                                              <p>Index: {pineconeTestResult.details.indexName}</p>
                                              <p>Dimension: {pineconeTestResult.details.dimension}</p>
                                              <p>Vectors: {pineconeTestResult.details.totalVectorCount?.toLocaleString()}</p>
                                              {pineconeTestResult.details.namespaces?.length > 0 && (
                                                <p>Namespaces: {pineconeTestResult.details.namespaces.join(', ') || 'default'}</p>
                                              )}
                                            </div>
                                          )}
                                          {!pineconeTestResult.success && pineconeTestResult.details && (
                                            <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                                              {pineconeTestResult.details.indexDimension && (
                                                <p>Index Dimension: {pineconeTestResult.details.indexDimension} / Expected: {pineconeTestResult.details.expectedDimension}</p>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Gemini 48-hour Auto-Delete Warning */}
                          {ragProvider === 'gemini_file_search' && (
                            <Card className="border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 dark:border-amber-600 dark:from-amber-950/30 dark:to-orange-950/30">
                              <CardContent className="pt-4">
                                <div className="flex items-start gap-3">
                                  <div className="p-1.5 bg-amber-200 dark:bg-amber-800/50 rounded-full shrink-0">
                                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                  </div>
                                  <div className="space-y-2 flex-1">
                                    <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                                      {t('gemini_48h_warning_title')}
                                    </p>
                                    <p className="text-sm text-amber-700 dark:text-amber-300">
                                      {t('gemini_48h_warning_desc')}
                                    </p>
                                    <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-1 ml-4 list-disc">
                                      <li>{t('gemini_48h_warning_item1')}</li>
                                      <li>{t('gemini_48h_warning_item2')}</li>
                                      <li>{t('gemini_48h_warning_item3')}</li>
                                    </ul>
                                    <p className="text-xs text-amber-600/80 dark:text-amber-400/80 pt-1">
                                      {t('gemini_48h_warning_permanent')}
                                    </p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </>
                      )}
                    </div>

                    {ragProvider === 'pinecone' && (originalPineconeConfig.apiKey || ragProvider !== originalRagProvider || isPineconeConfigChanged) && (
                      <div className="pt-2 border-t mt-4">
                        <div className={cn(
                          "flex gap-3",
                          isMobile ? "flex-col" : "items-center justify-between"
                        )}>
                          {originalPineconeConfig.apiKey && (
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-destructive">{t('pinecone_reset_title')}</p>
                              <p className="text-xs text-muted-foreground mb-2">{t('pinecone_reset_description')}</p>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setShowResetPineconeDialog(true)}
                                disabled={isResettingPinecone}
                              >
                                {isResettingPinecone ? (
                                  <>
                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                    {isMobile ? 'Reset' : t('resetting_button')}
                                  </>
                                ) : (
                                  isMobile ? 'Reset' : t('pinecone_reset_button')
                                )}
                              </Button>
                            </div>
                          )}

                          {(ragProvider !== originalRagProvider || isPineconeConfigChanged) && (
                            <div className={cn("flex-shrink-0", !originalPineconeConfig.apiKey && "ml-auto")}>
                              <Button
                                onClick={handleSaveRagProvider}
                                disabled={isSavingRagProvider || !hasRequiredApiKey(ragProvider)}
                                size="sm"
                              >
                                {isSavingRagProvider ? (
                                  <>
                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                    {t('saving_button')}
                                  </>
                                ) : (
                                  <>
                                    <Save className="h-4 w-4 mr-2" />
                                    {t('rag_provider_save_button')}
                                  </>
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {ragProvider !== 'pinecone' && ragProvider !== originalRagProvider && (
                      <div className="pt-2 flex justify-end">
                        <Button
                          onClick={handleSaveRagProvider}
                          disabled={isSavingRagProvider || !hasRequiredApiKey(ragProvider)}
                          size="sm"
                        >
                          {isSavingRagProvider ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              {t('saving_button')}
                            </>
                          ) : (
                            <>
                              <Save className="h-4 w-4 mr-2" />
                              {t('rag_provider_save_button')}
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                    </>
                    )}
                  </div>
                </div>
                )}

                {/*
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-6 bg-purple-500 rounded-full"></div>
                    <h3 className="text-lg font-semibold">3. {t('settings_widget_integration_title')}</h3>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="widget-url">{t('settings_widget_url_label')}</Label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        id="widget-url"
                        value={agentId ? `${window.location.origin}/chat/${agentId}/preview` : t('settings_create_agent_first')}
                        readOnly
                        className="font-mono text-sm w-full min-w-0 flex-1 break-all overflow-hidden"
                        style={{wordBreak: 'break-all', overflowWrap: 'break-word'}}
                      />
                      {agentId && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto"
                            onClick={() => copyToClipboard(`${window.location.origin}/chat/${agentId}/preview`, 'widget-url')}
                          >
                            {copiedField === 'widget-url' ? t('settings_widget_url_copy') : <Copy className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto"
                            onClick={() => window.open(`/chat/${agentId}/preview`, '_blank')}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="iframe-code">{t('settings_iframe_label')}</Label>
                      {agentId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => copyToClipboard(`<iframe src="${window.location.origin}/chat/${agentId}" width="400" height="700" frameborder="0"></iframe>`, 'iframe')}
                        >
                          {copiedField === 'iframe' ? t('settings_widget_url_copy') : <Copy className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                    <Textarea
                      id="iframe-code"
                      value={agentId ? `<iframe src="${window.location.origin}/chat/${agentId}" width="400" height="700" frameborder="0"></iframe>` : t('settings_create_agent_first')}
                      readOnly
                      className="font-mono text-xs min-h-[80px] w-full min-w-0 break-all overflow-hidden"
                      style={{wordBreak: 'break-all', overflowWrap: 'break-word'}}
                    />
                  </div>

                  <div className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <Label htmlFor="embed-code">{t('settings_js_embed_label')}</Label>
                        <div className="flex gap-2">
                          {agentId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => copyToClipboard(getEmbedCode(), 'embed')}
                            >
                              {copiedField === 'embed' ? t('settings_widget_url_copy') : <Copy className="h-4 w-4" />}
                            </Button>
                          )}
                          {agentId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => setShowPreview(!showPreview)}
                            >
                              {showPreview ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                              {showPreview ? t('settings_hide_preview') : t('settings_show_preview')}
                            </Button>
                          )}
                        </div>
                      </div>
                      <Textarea
                        id="embed-code"
                        value={agentId ? getEmbedCode() : t('settings_create_agent_first')}
                        readOnly
                        className="font-mono text-xs min-h-[120px] w-full min-w-0 break-all overflow-hidden"
                        style={{wordBreak: 'break-all', overflowWrap: 'break-word'}}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('settings_js_embed_description')}
                      </p>
                    </div>

                  {showPreview && agentId && (
                    <div className="space-y-2">
                      <Label>{t('settings_widget_preview_label')}</Label>
                      <div className="border rounded-lg p-4 bg-muted/50 flex justify-center">
                        <div className="w-full md:w-1/2">
                          <iframe
                            src={`/chat/${agentId}`}
                            width="100%"
                            height="500"
                            className="rounded-lg"
                            style={{ border: '1px solid #e5e5e5' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                */}

                {/* Save Button for AI Assistant Settings - Only show if changes detected */}
                {hasAIAssistantChanges && (
                  <div className="pt-4 flex justify-end">
                    <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
                      {isSaving ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          {t('saving_button')}
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4 mr-2" />
                          {t('settings_save_ai_assistant')}
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Team Settings */}
        {activeTab === 'team' && agentId && (
          <TeamTab agentId={agentId} t={t} />
        )}
        {activeTab === 'team' && !agentId && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">{t('loading') || 'Loading...'}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'mcp' && (
          <McpSection t={t} language={currentLanguage} />
        )}

        {activeTab === 'ai-connections' && aiConnectionsAvailable && (
          <AiConnectionsSection t={t} language={currentLanguage} />
        )}

        {activeTab === 'license' && licenseInfo && <LicenseSection t={t} info={licenseInfo} />}

        {/* Profile Settings */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            {/* Message Display */}
            {message && activeTab === 'profile' && (
              <div className={`p-4 rounded-lg ${isError ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-400' : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'}`}>
                <div className="flex items-center gap-2">
                  {isError ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {message}
                </div>
              </div>
            )}

            {/* Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t('settings_personal_info_title')}
                </CardTitle>
                <CardDescription>
                  {t('settings_personal_info_description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t('settings_full_name_label')}</Label>
                    <Input
                      id="name"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder={t('settings_full_name_placeholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">{t('settings_email_label')}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="email"
                        type="email"
                        value={userEmail}
                        readOnly
                        disabled
                        className="bg-muted cursor-not-allowed flex-1"
                      />
                      {!isGoogleUser && (
                        <Button
                          variant="outline"
                          size="default"
                          onClick={handleOpenEmailChangeDialog}
                        >
                          {t('settings_email_change_button')}
                        </Button>
                      )}
                    </div>
                    {isGoogleUser && (
                      <p className="text-xs text-muted-foreground">
                        {t('settings_email_google_notice')}
                      </p>
                    )}
                    {emailChangeSuccess && (
                      <p className="text-xs text-green-600">
                        {emailChangeSuccess}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">{t('settings_company_name_label')}</Label>
                    <Input
                      id="companyName"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder={t('settings_company_name_placeholder')}
                      autoComplete="organization"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="userPhone">{t('settings_phone_label')}</Label>
                    <Input
                      id="userPhone"
                      value={userPhone}
                      onChange={(e) => setUserPhone(e.target.value)}
                      placeholder={t('settings_phone_placeholder')}
                      autoComplete="tel"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="userCountry">{t('settings_country_label')}</Label>
                    <select
                      id="userCountry"
                      value={userCountry ? userCountry.toUpperCase() : ''}
                      onChange={(e) => setUserCountry(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">{t('settings_country_select')}</option>
                      {countryOptions.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Password Section - Only show for non-Google users who don't have passkeys */}
                {!isGoogleUser && passkeys.length === 0 && (
                  <div className="border-t pt-4 mt-6">
                    <h4 className="text-sm font-medium mb-3">{t('settings_password_section_title')}</h4>
                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="current-password">{t('settings_current_password_label')}</Label>
                        <Input
                          id="current-password"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder={t('settings_current_password_placeholder')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-password">{t('settings_new_password_label')}</Label>
                        <Input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder={t('settings_new_password_placeholder')}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2 xl:col-span-1">
                        <Label htmlFor="confirm-password">{t('settings_confirm_password_label')}</Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder={t('settings_confirm_password_placeholder')}
                          className={confirmPassword && newPassword !== confirmPassword ? 'border-red-500' : ''}
                        />
                        {confirmPassword && newPassword !== confirmPassword && (
                          <p className="text-xs text-red-500">{t('settings_passwords_no_match')}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Passkey Section - Only show for non-Google users */}
                {!isGoogleUser && (
                  <div className="border-t pt-4 mt-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <Fingerprint className="h-4 w-4" />
                        {t('settings_passkey_section_title') || 'Passkeys'}
                      </h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRegisterPasskey}
                        disabled={isRegisteringPasskey}
                      >
                        {isRegisteringPasskey ? (
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 mr-2" />
                        )}
                        {t('settings_passkey_add') || 'Add Passkey'}
                      </Button>
                    </div>

                    {passkeyError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 dark:bg-red-950/20 dark:border-red-800">
                        <p className="text-sm text-red-700 dark:text-red-300">{passkeyError}</p>
                      </div>
                    )}

                    {passkeySuccess && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 dark:bg-green-950/20 dark:border-green-800">
                        <p className="text-sm text-green-700 dark:text-green-300">{passkeySuccess}</p>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground mb-3">
                      {t('settings_passkey_description') || 'Passkeys let you sign in securely using your fingerprint, face, or screen lock.'}
                    </p>

                    {isLoadingPasskeys ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        {t('loading') || 'Loading...'}
                      </div>
                    ) : passkeys.length === 0 ? (
                      <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                        {t('settings_passkey_empty') || 'No passkeys registered yet'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {passkeys.map((passkey) => (
                          <div
                            key={passkey.id}
                            className="flex items-center justify-between p-3 border rounded-lg"
                          >
                            <div className="flex items-center gap-3">
                              <Fingerprint className="h-5 w-5 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">
                                  {passkey.name || t('settings_passkey_unnamed') || 'Unnamed Passkey'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {t('settings_passkey_created') || 'Created'}: {new Date(passkey.createdAt).toLocaleDateString()}
                                  {passkey.lastUsedAt && (
                                    <> · {t('settings_passkey_last_used') || 'Last used'}: {new Date(passkey.lastUsedAt).toLocaleDateString()}</>
                                  )}
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeletePasskey(passkey.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Google User Notice */}
                {isGoogleUser && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 dark:bg-blue-950/20 dark:border-blue-800">
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        {t('settings_google_user_notice')}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Regional Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  {t('settings_regional_title')}
                </CardTitle>
                <CardDescription>
                  {t('settings_regional_description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="timezone">{t('settings_timezone_label')}</Label>
                    <Select value={userTimezone} onValueChange={setUserTimezone}>
                      <SelectTrigger id="timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="America/New_York">Eastern Time (America/New_York)</SelectItem>
                        <SelectItem value="America/Chicago">Central Time (America/Chicago)</SelectItem>
                        <SelectItem value="America/Denver">Mountain Time (America/Denver)</SelectItem>
                        <SelectItem value="America/Los_Angeles">Pacific Time (America/Los_Angeles)</SelectItem>
                        <SelectItem value="Europe/London">London (Europe/London)</SelectItem>
                        <SelectItem value="Europe/Paris">Paris (Europe/Paris)</SelectItem>
                        <SelectItem value="Europe/Berlin">Berlin (Europe/Berlin)</SelectItem>
                        <SelectItem value="Europe/Rome">Rome (Europe/Rome)</SelectItem>
                        <SelectItem value="Europe/Madrid">Madrid (Europe/Madrid)</SelectItem>
                        <SelectItem value="Europe/Zurich">Zurich (Europe/Zurich)</SelectItem>
                        <SelectItem value="Europe/Vienna">Vienna (Europe/Vienna)</SelectItem>
                        <SelectItem value="Asia/Tokyo">Tokyo (Asia/Tokyo)</SelectItem>
                        <SelectItem value="Asia/Seoul">Seoul (Asia/Seoul)</SelectItem>
                        <SelectItem value="Asia/Shanghai">Shanghai (Asia/Shanghai)</SelectItem>
                        <SelectItem value="Asia/Singapore">Singapore (Asia/Singapore)</SelectItem>
                        <SelectItem value="Asia/Dubai">Dubai (Asia/Dubai)</SelectItem>
                        <SelectItem value="Asia/Kolkata">Mumbai (Asia/Kolkata)</SelectItem>
                        <SelectItem value="America/Sao_Paulo">São Paulo (America/Sao_Paulo)</SelectItem>
                        <SelectItem value="America/Argentina/Buenos_Aires">Buenos Aires (America/Argentina/Buenos_Aires)</SelectItem>
                        <SelectItem value="Australia/Sydney">Sydney (Australia/Sydney)</SelectItem>
                        <SelectItem value="Australia/Melbourne">Melbourne (Australia/Melbourne)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="language">{t('settings_default_language_label')}</Label>
                    <Select value={userLocale} onValueChange={handleLanguageChange}>
                      <SelectTrigger id="language">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en-US">English</SelectItem>
                        <SelectItem value="de-DE">Deutsch</SelectItem>
                        <SelectItem value="fr-FR">Français</SelectItem>
                        <SelectItem value="ko-KR">한국어</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2 xl:col-span-1">
                    <Label htmlFor="timeformat">{t('settings_date_time_format_label')}</Label>
                    <Select value={userTimeFormat} onValueChange={setUserTimeFormat}>
                      <SelectTrigger id="timeformat">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DD.MM.YYYY HH:mm">DD.MM.YYYY HH:mm (15.01.2024 14:30)</SelectItem>
                        <SelectItem value="MM/DD/YYYY hh:mm AM">MM/DD/YYYY hh:mm AM (01/15/2024 2:30 PM)</SelectItem>
                        <SelectItem value="YYYY-MM-DD HH:mm">YYYY-MM-DD HH:mm (2024-01-15 14:30)</SelectItem>
                        <SelectItem value="DD/MM/YYYY HH:mm">DD/MM/YYYY HH:mm (15/01/2024 14:30)</SelectItem>
                        <SelectItem value="DD-MM-YYYY HH:mm">DD-MM-YYYY HH:mm (15-01-2024 14:30)</SelectItem>
                        <SelectItem value="YYYY/MM/DD HH:mm">YYYY/MM/DD HH:mm (2024/01/15 14:30)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Save Button - Only show if changes detected */}
            {(hasProfileChanges || hasPasswordChanges) && (
              <div className="flex justify-end">
                <Button onClick={handleSaveProfile} disabled={isSaving} className="w-full sm:w-auto">
                  {isSaving ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      {t('settings_saving_label')}
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {t('settings_save_profile_btn')}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {false && activeTab === 'ai-config' && (
          <div className="space-y-6">
            {/* Settings Panel - Same as Playground */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  {t('playground_settings')}
                </CardTitle>
                <CardDescription>
                  {t('settings_ai_config_description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="model">{t('playground_model_label')}</Label>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger className="mt-2">
                        <SelectValue placeholder={t('playground_model_select_placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                        <SelectItem value="gpt-4.1-mini">GPT-4.1 Mini</SelectItem>
                        <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t('playground_price_label')}</Label>
                    <div className="mt-2 p-3 bg-muted rounded-md text-xs">
                      <div className="space-y-1">
                        <div>{t('playground_price_input')} {
                          selectedModel === 'gpt-4.1' ? '$2.00' :
                            selectedModel === 'gpt-4o-mini' ? '$0.15' : '$0.40'
                        } {t('playground_price_per_tokens')}</div>
                        <div>{t('playground_price_output')} {
                          selectedModel === 'gpt-4.1' ? '$8.00' :
                            selectedModel === 'gpt-4o-mini' ? '$0.60' : '$1.60'
                        } {t('playground_price_per_tokens')}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="temperature">{t('playground_temperature_label')} {temperature}</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTemperature(1.0)}
                      className="h-6 w-6 p-0"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                  <Input
                    type="range"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    min={0}
                    max={2}
                    step={0.1}
                    className="mt-2"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="maxTokens">{t('playground_max_tokens_label')} {maxTokens}</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMaxTokens(2048)}
                      className="h-6 w-6 p-0"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                  <Input
                    type="range"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                    min={20}
                    max={16384}
                    step={1}
                    className="mt-2"
                  />
                </div>


                {/* Settings Message */}
                {aiConfigMessage && (
                  <div className={`p-3 rounded-lg text-sm ${isAIConfigError
                    ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-400'
                    : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'
                    }`}>
                    {aiConfigMessage}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* System Message Panel - Same as Playground */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="h-4 w-4" />
                    {t('playground_system_message')}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(t('playground_system_message_reset_confirm'))) {
                        const defaultMessage = t('default_system_message')
                        setSystemMessage(defaultMessage)
                        setOriginalSystemMessage(defaultMessage)
                        setSystemMessageMessage(t('playground_system_message_reset_success'))
                        setIsSystemMessageError(false)

                        setTimeout(() => {
                          setSystemMessageMessage('')
                        }, 3000)
                      }
                    }}
                    className="h-8 px-3"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {t('playground_system_message_reset')}
                  </Button>
                </div>
                <CardDescription>
                  {t('settings_system_message_description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Textarea
                    value={systemMessage}
                    onChange={(e) => setSystemMessage(e.target.value)}
                    placeholder={t('playground_system_message_placeholder')}
                    className="h-[576px] max-h-[576px] resize-none overflow-y-auto font-mono text-sm"
                  />
                </div>


                {/* System Message Message */}
                {systemMessageMessage && (
                  <div className={`p-3 rounded-lg text-sm ${isSystemMessageError
                    ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-400'
                    : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'
                    }`}>
                    {systemMessageMessage}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Save Button - Show at bottom right when there are changes */}
            {(hasAIConfigChanges || hasSystemMessageChanges) && (
              <div className="flex justify-end">
                <Button
                  onClick={async () => {
                    if (hasAIConfigChanges) {
                      setIsSavingAIConfig(true)
                      try {
                        const response = await fetch('/api/settings/openai-api-key', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Accept-Language': currentLanguage,
                          },
                          body: JSON.stringify({
                            apiKey: '',
                            model: selectedModel,
                            temp: temperature,
                            tokens: maxTokens,
                            systemMessage: hasSystemMessageChanges ? systemMessage : undefined,
                            agentId: agentId
                          }),
                        })

                        const data = await response.json()

                        if (response.ok) {
                          setAIConfigMessage(t('playground_settings_saved'))
                          setIsAIConfigError(false)
                          // Update original values
                          setOriginalSelectedModel(selectedModel)
                          setOriginalTemperature(temperature)
                          setOriginalMaxTokens(maxTokens)
                          if (hasSystemMessageChanges) {
                            setOriginalSystemMessage(systemMessage)
                          }

                          setTimeout(() => {
                            setAIConfigMessage('')
                          }, 3000)
                        } else {
                          setAIConfigMessage(data.error || t('playground_settings_save_failed'))
                          setIsAIConfigError(true)
                        }
                      } catch (error) {
                        setAIConfigMessage(t('playground_settings_save_failed'))
                        setIsAIConfigError(true)
                      } finally {
                        setIsSavingAIConfig(false)
                      }
                    } else if (hasSystemMessageChanges) {
                      setIsSavingSystemMessage(true)
                      try {
                        const response = await fetch('/api/settings/openai-api-key', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Accept-Language': currentLanguage,
                          },
                          body: JSON.stringify({
                            apiKey: '',
                            systemMessage: systemMessage,
                            agentId: agentId
                          }),
                        })

                        const data = await response.json()

                        if (response.ok) {
                          setSystemMessageMessage(t('playground_system_message_saved'))
                          setIsSystemMessageError(false)
                          setOriginalSystemMessage(systemMessage)

                          setTimeout(() => {
                            setSystemMessageMessage('')
                          }, 3000)
                        } else {
                          setSystemMessageMessage(data.error || t('playground_system_message_save_failed'))
                          setIsSystemMessageError(true)
                        }
                      } catch (error) {
                        setSystemMessageMessage(t('playground_system_message_save_failed'))
                        setIsSystemMessageError(true)
                      } finally {
                        setIsSavingSystemMessage(false)
                      }
                    }
                  }}
                  disabled={isSavingAIConfig || isSavingSystemMessage}
                  className="w-full sm:w-auto"
                >
                  {(isSavingAIConfig || isSavingSystemMessage) ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      {t('playground_settings_saving')}
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {t('settings_save_settings')}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'security' && byoTabsShown && (
          <SecretVaultSection t={t} language={currentLanguage} />
        )}

        {/* Other Settings */}
        {activeTab === 'other' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers2 className="h-4 w-4" />
                {t('settings_other_usage_limits_title')}
              </CardTitle>
              <CardDescription>
                {t('settings_other_usage_limits_description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {usageMessage && (
                <div
                  className={`p-3 rounded-lg ${isUsageError
                    ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-400'
                    : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'
                    }`}
                >
                  {usageMessage}
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="chat-limit-count">{t('settings_other_chat_limit_label')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings_other_chat_limit_help')}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-[200px_200px]">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground" htmlFor="chat-limit-count">
                        {t('settings_other_chat_limit_count_label')}
                      </Label>
                      <Input
                        id="chat-limit-count"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={chatLimitCount}
                        onChange={(event) => {
                          const sanitizedValue = sanitizeNumericInput(event.target.value)
                          setChatLimitCount(sanitizedValue)
                          setUsageErrors((prev) => ({ ...prev, chatLimitCount: undefined }))
                          setUsageMessage('')
                        }}
                      />
                      {usageErrors.chatLimitCount && (
                        <p className="text-sm text-red-500">{usageErrors.chatLimitCount}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground" htmlFor="chat-limit-unit">
                        {t('settings_other_time_unit_label')}
                      </Label>
                      <Select
                        value={chatLimitUnit}
                        onValueChange={(value) => {
                          setChatLimitUnit(value as TimeUnit)
                          setUsageMessage('')
                        }}
                      >
                        <SelectTrigger id="chat-limit-unit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="minute">
                            {t('settings_other_time_unit_minute')}
                          </SelectItem>
                          <SelectItem value="hour">{t('settings_other_time_unit_hour')}</SelectItem>
                          <SelectItem value="day">{t('settings_other_time_unit_day')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="chat-limit-message">
                    {t('settings_other_chat_limit_message_label')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings_other_chat_limit_message_help')}
                  </p>
                  <Textarea
                    id="chat-limit-message"
                    value={chatLimitMessage}
                    onChange={(event) => {
                      setChatLimitMessage(event.target.value)
                      setUsageMessage('')
                    }}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="continuous-limit">
                    {t('settings_other_continuous_limit_label')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings_other_continuous_limit_help')}
                  </p>
                  <div className="space-y-1">
                    <Input
                      id="continuous-limit"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={continuousAnswerLimit}
                      onChange={(event) => {
                        const sanitizedValue = sanitizeNumericInput(event.target.value)
                        setContinuousAnswerLimit(sanitizedValue)
                        setUsageErrors((prev) => ({ ...prev, continuousAnswerLimit: undefined }))
                        setUsageMessage('')
                      }}
                    />
                    {usageErrors.continuousAnswerLimit && (
                      <p className="text-sm text-red-500">{usageErrors.continuousAnswerLimit}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="continuous-limit-message">
                    {t('settings_other_continuous_limit_message_label')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings_other_continuous_limit_message_help')}
                  </p>
                  <Textarea
                    id="continuous-limit-message"
                    value={continuousAnswerLimitMessage}
                    onChange={(event) => {
                      setContinuousAnswerLimitMessage(event.target.value)
                      setUsageMessage('')
                    }}
                    rows={3}
                  />
                </div>

                <div className="pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={handleResetMessages}
                    className="w-full sm:w-auto"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {t('settings_other_reset_messages_button')}
                  </Button>
                </div>
              </div>

              {(hasUsageLimitChanges || isSavingUsageLimits) && (
                <div className="pt-2 flex justify-end">
                  <Button
                    onClick={() => {
                      handleSaveUsageLimits();
                    }}
                    disabled={
                      isSavingUsageLimits ||
                      !hasUsageLimitChanges ||
                      !isUsageFormValid
                    }
                    className="w-full sm:w-auto"
                  >
                    {isSavingUsageLimits ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        {t('playground_settings_saving')}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        {t('settings_other_usage_limits_save')}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Advanced Settings */}
        {activeTab === 'advanced' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                {t('data_management_title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {dataManagementMessage && (
                <div
                  className={`p-3 rounded-lg ${isDataManagementError
                    ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-400'
                    : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'
                    }`}
                >
                  {dataManagementMessage}
                </div>
              )}

              {/* Current Agent Information */}
              <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">
                      {t('data_management_current_agent_title')}
                    </h4>
                    <p className="text-sm text-blue-800 dark:text-blue-300 mb-3">
                      {t('data_management_current_agent_description')}
                    </p>
                    <div className="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded border border-blue-200 dark:border-blue-700">
                      <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <div>
                        <p className="text-xs text-muted-foreground">{t('data_management_agent_name')}</p>
                        <p className="font-medium text-sm">{agentTitle || t('settings_default_agent_name')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-3 p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">{t('delete_all_conversations')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('delete_all_conversations_description')}
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDataManagementMessage('')
                        setIsDataManagementError(false)
                        openDataManagementDialog('conversations')
                      }}
                    >
                      {t('delete_all_conversations')}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">{t('delete_all_usage_logs')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('delete_all_usage_logs_description')}
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDataManagementMessage('')
                        setIsDataManagementError(false)
                        openDataManagementDialog('usageLogs')
                      }}
                    >
                      {t('delete_all_usage_logs')}
                    </Button>
                  </div>
                </div>

                {agentCount > 1 ? (
                  <div className="flex flex-col gap-3 p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">{t('delete_current_agent')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('delete_current_agent_description')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <Bot className="h-4 w-4 text-red-500 flex-shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-red-600 dark:text-red-400">{t('delete_current_agent_target_label')}</span>
                        <span className="font-medium text-red-700 dark:text-red-300 truncate">{agentTitle || 'Untitled Agent'}</span>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setDataManagementMessage('')
                          setIsDataManagementError(false)
                          openDataManagementDialog('deleteAgent')
                        }}
                      >
                        {t('delete_current_agent')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/30 dark:bg-muted/10">
                    <div>
                      <p className="font-medium">{t('delete_current_agent')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('delete_current_agent_unavailable_description')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4" />
                      <span>{t('delete_current_agent_unavailable_hint')}</span>
                    </div>
                  </div>
                )}

                {/* Warning: Re-signup not allowed */}
                <div className="flex flex-col gap-3 p-4 border-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border-yellow-400">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-yellow-900 dark:text-yellow-200">
                        {t('anonymize_warning_re_signup')}
                      </p>
                      <p className="text-sm text-yellow-800 dark:text-yellow-300 mt-1">
                        {t('anonymize_warning_re_signup_description')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 p-4 border rounded-lg bg-destructive/10">
                  <div>
                    <p className="font-medium text-destructive">{t('anonymize_personal_information')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('anonymize_personal_information_description')}
                    </p>
                    {userPlan !== 'free' && (
                      <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2 font-medium">
                        {t('anonymize_active_subscription_warning') || '유료 구독 중에는 익명화할 수 없습니다. 구독 종료 후 진행해주세요.'}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="destructive"
                      disabled={userPlan !== 'free'}
                      onClick={() => {
                        setDataManagementMessage('')
                        setIsDataManagementError(false)
                        openDataManagementDialog('anonymize')
                      }}
                    >
                      {t('anonymize_personal_information')}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Email Change Dialog */}
      <Dialog open={isEmailChangeDialogOpen} onOpenChange={setIsEmailChangeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings_email_change_title')}</DialogTitle>
            <DialogDescription>
              {t('settings_email_change_description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-email">{t('settings_email_change_new_email')}</Label>
              <Input
                id="new-email"
                type="email"
                value={newEmailInput}
                onChange={(e) => setNewEmailInput(e.target.value)}
                placeholder={t('settings_email_change_new_email_placeholder')}
                disabled={isChangingEmail}
              />
            </div>
            {emailChangeError && (
              <p className="text-sm text-red-600">{emailChangeError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsEmailChangeDialogOpen(false)}
              disabled={isChangingEmail}
            >
              {t('settings_email_change_cancel')}
            </Button>
            <Button
              onClick={handleEmailChangeRequest}
              disabled={isChangingEmail || !newEmailInput}
            >
              {isChangingEmail ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {t('settings_email_change_confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API Key Deletion Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-2xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-center text-red-600 dark:text-red-400">
              {t('delete_api_key_dialog_title')}
            </DialogTitle>
            <DialogDescription className="text-center text-base mt-2">
              {t('delete_api_key_dialog_subtitle')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Warning 1 */}
            <div className="bg-yellow-50 dark:bg-yellow-950/20 border-l-4 border-yellow-400 p-4 rounded">
              <div className="flex items-start">
                <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                    {t('delete_api_key_warning_title_1')}
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    {t('delete_api_key_warning_text_1')}
                  </p>
                </div>
              </div>
            </div>

            {/* Warning 2 */}
            <div className="bg-red-50 dark:bg-red-950/20 border-l-4 border-red-400 p-4 rounded">
              <div className="flex items-start">
                <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-red-800 dark:text-red-200 mb-1">
                    {t('delete_api_key_warning_title_2')}
                  </h4>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {t('delete_api_key_warning_text_2')}
                  </p>
                </div>
              </div>
            </div>

            {/* Confirmation Checkbox */}
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="delete-confirmation"
                  checked={deleteConfirmed}
                  onChange={(e) => setDeleteConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                />
                <label
                  htmlFor="delete-confirmation"
                  className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer leading-5"
                >
                  {t('delete_api_key_confirmation_checkbox')}
                </label>
              </div>
            </div>
          </div>

          <DialogFooter className="flex justify-between items-center pt-4">
            <Button
              variant="outline"
              onClick={cancelDeleteApiKey}
              className="flex-1 mr-2"
            >
              {t('delete_api_key_cancel_button')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteApiKey}
              disabled={!deleteConfirmed}
              className="flex-1 ml-2"
            >
              {t('delete_api_key_delete_button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Data management confirmation dialog */}
      <Dialog
        open={isDataManagementDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeDataManagementDialog()
          }
        }}
      >
        <DialogContent className="max-w-lg select-text" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold select-text">
              {dataManagementAction === 'conversations'
                ? t('delete_all_conversations_dialog_title')
                : dataManagementAction === 'usageLogs'
                  ? t('delete_all_usage_logs_dialog_title')
                  : dataManagementAction === 'deleteAgent'
                    ? t('delete_current_agent_dialog_title')
                    : t('anonymize_personal_information_dialog_title')}
            </DialogTitle>
            <DialogDescription className="select-text">
              {dataManagementAction === 'conversations'
                ? t('delete_all_conversations_dialog_description')
                : dataManagementAction === 'usageLogs'
                  ? t('delete_all_usage_logs_dialog_description')
                  : dataManagementAction === 'deleteAgent'
                    ? t('delete_current_agent_dialog_description')
                    : t('anonymize_personal_information_dialog_description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {dataManagementAction === 'deleteAgent' && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-lg">
                <Bot className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-amber-600 dark:text-amber-400">{t('delete_current_agent_dialog_target')}</span>
                  <span className="font-semibold text-amber-800 dark:text-amber-200 truncate">{agentTitle || 'Untitled Agent'}</span>
                </div>
              </div>
            )}

            <div className="bg-red-50 dark:bg-red-950/20 border-l-4 border-red-400 p-4 rounded">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-200 select-text">
                  {t('settings_delete_type_to_confirm_before')}{' '}
                  <span className="font-semibold select-text cursor-text">{t('settings_delete_keyword')}</span>{' '}
                  {t('settings_delete_type_to_confirm_after')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="data-management-confirm" className="select-text">
                {t('settings_delete_type_delete_label_before')}{' '}
                <span className="font-semibold select-text cursor-text">{t('settings_delete_keyword')}</span>{' '}
                {t('settings_delete_type_delete_label_after')}
              </Label>
              <Input
                id="data-management-confirm"
                value={confirmDataManagementText}
                onChange={(event) => setConfirmDataManagementText(event.target.value)}
                placeholder={t('settings_delete_placeholder')}
                autoComplete="off"
              />
            </div>

            {dataManagementAction === 'anonymize' && (
              isGoogleUser ? (
                <p className="text-sm text-muted-foreground">
                  {t('settings_delete_reauth_google_notice')}
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="data-management-password">
                    {t('settings_current_password_label')}
                  </Label>
                  <Input
                    id="data-management-password"
                    type="password"
                    value={deleteReauthPassword}
                    onChange={(event) => setDeleteReauthPassword(event.target.value)}
                    placeholder={t('settings_current_password_placeholder')}
                    autoComplete="current-password"
                  />
                </div>
              )
            )}
          </div>

          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={closeDataManagementDialog}
              disabled={isProcessingDataAction}
            >
              {t('settings_delete_cancel_button')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDataManagementAction}
              disabled={
                isProcessingDataAction ||
                confirmDataManagementText.trim().toLowerCase() !== 'delete' ||
                (dataManagementAction === 'anonymize' && !isGoogleUser && !deleteReauthPassword)
              }
            >
              {isProcessingDataAction ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('processing')}
                </>
              ) : dataManagementAction === 'conversations' ? (
                t('delete_all_conversations')
              ) : dataManagementAction === 'usageLogs' ? (
                t('delete_all_usage_logs')
              ) : dataManagementAction === 'deleteAgent' ? (
                t('delete_current_agent')
              ) : (
                t('anonymize_personal_information')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Pinecone Confirmation Dialog */}
      <Dialog open={showResetPineconeDialog} onOpenChange={setShowResetPineconeDialog}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-destructive">
              {t('pinecone_reset_dialog_title')}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {t('pinecone_reset_dialog_description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-between items-center pt-4">
            <Button
              variant="outline"
              onClick={() => setShowResetPineconeDialog(false)}
              className="flex-1 mr-2"
            >
              {t('pinecone_reset_dialog_cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowResetPineconeDialog(false)
                handleResetPinecone()
              }}
              disabled={isResettingPinecone}
              className="flex-1 ml-2"
            >
              {isResettingPinecone ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('resetting_button')}
                </>
              ) : (
                t('pinecone_reset_dialog_confirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
