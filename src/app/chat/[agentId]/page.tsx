'use client'

import React, { useState, useEffect, useRef, use, useCallback, useMemo } from 'react'
import { useEdition } from '@/components/EditionProvider'
import { brandAssets } from '@/lib/brand-assets'
import { v4 as uuidv4 } from 'uuid'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { MessageContent } from '@/components/chat/MessageContent'
import { signIn } from 'next-auth/react'
import { useLanguage } from '@/hooks/useLanguage'
import { WidgetSettings, mergeWidgetSettings, normalizeRecommendedQuestions, safeColorValue } from '@/lib/widget-settings'
import { convertPdfToImages, isPdfFile } from '@/lib/pdf-to-image'
import { formatTimeOnlyWithUserSettings } from '@/lib/format-date-with-user-settings'
import { shouldOverwritePersistedConversation, type PersistedConversationMeta } from '@/lib/chat/persist-lww'
import {
  X, RotateCcw, Maximize2, Minimize2, Send,
  MessageSquarePlus, MessageCirclePlus, RefreshCw,
  Expand, ArrowUpLeft, ChevronsLeftRight,
  Shrink, ArrowDownRight, ChevronsRightLeft,
  LogOut, ChevronDown, CircleX, SendHorizontal,
  Navigation, CornerDownLeft, Paperclip,
  MessageCircle, Mic,
} from 'lucide-react'
import { VoiceCallView } from '@/components/chat/VoiceCallView'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'error' | 'system'
  content: string
  timestamp: Date
}

type AgentAccessMode = 'public' | 'team'

interface AgentInfo {
  title: string
  id: string
  vectorStoreId?: string | null
  accessMode: AgentAccessMode
  authorized: boolean
  ownerAuthorized?: boolean
  member?: {
    id: number
    email: string
    displayName?: string | null
  }
  reason?: 'not_team' | 'missing_token' | 'token_invalid' | 'inactive_member'
  rateLimitSettings?: {
    chatLimitCount: number
    chatLimitDurationMinutes: number
    continuousAnswerLimit: number
    chatLimitMessage?: string | null
    continuousAnswerLimitMessage?: string | null
  }
  workflowMode?: 'simple' | 'workflow' | null
  fileInput?: {
    imageInput?: boolean
    pdfInput?: boolean
    csvInput?: boolean
  } | null
}

type AuthErrorState = { key: string } | { message: string }

// SVG Icon Component
interface SvgIconProps {
  src: string
  alt: string
  color: string
  className?: string
}

// Helper function to get the appropriate icon based on filename
const getIconComponent = (type: 'close' | 'newConversation' | 'maximize' | 'minimize' | 'send', filename: string) => {
  if (type === 'close') {
    if (filename.includes('logout')) return LogOut
    if (filename.includes('chevron')) return ChevronDown
    if (filename.includes('circle-x')) return CircleX
    return X
  }

  if (type === 'newConversation') {
    if (filename.includes('rotate')) return RotateCcw
    if (filename.includes('circle')) return MessageCirclePlus
    if (filename.includes('refresh')) return RefreshCw
    return MessageSquarePlus
  }

  if (type === 'maximize') {
    if (filename.includes('expand')) return Expand
    if (filename.includes('arrow')) return ArrowUpLeft
    if (filename.includes('chevrons')) return ChevronsLeftRight
    return Maximize2
  }

  if (type === 'minimize') {
    if (filename.includes('shrink')) return Shrink
    if (filename.includes('arrow')) return ArrowDownRight
    if (filename.includes('chevrons')) return ChevronsRightLeft
    return Minimize2
  }

  if (type === 'send') {
    if (filename.includes('send-horizontal')) return SendHorizontal
    if (filename.includes('navigation')) return Navigation
    if (filename.includes('corner-down-left')) return CornerDownLeft
    return Send
  }

  return X // Default fallback
}







interface ChatPageProps {
  params: Promise<{
    agentId: string
  }>
}

const SUPPORTED_WIDGET_LANGS = [
  'en','es','fr','de','it','pt-PT','pt-BR','nl','pl','sv','no','da','fi','el','tr','cs','is',
  'zh','zh-HK','ja','ko','th','vi','id','ms','tl','hi',
  'ar','he','fa',
] as const
const SUPPORTED_WIDGET_LANGS_LOWER = SUPPORTED_WIDGET_LANGS.map((k) => k.toLowerCase())
const INVALID_LANG_VALUES = new Set(['', 'x-default', 'auto', 'und', 'null', 'undefined'])

const normalizeLang = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null
  const trimmed = String(raw).trim().toLowerCase()
  if (INVALID_LANG_VALUES.has(trimmed)) return null
  const exactIdx = SUPPORTED_WIDGET_LANGS_LOWER.indexOf(trimmed)
  if (exactIdx !== -1) return SUPPORTED_WIDGET_LANGS[exactIdx]
  const short = trimmed.split('-')[0]
  if (!/^[a-z]{2}$/.test(short)) return null
  const baseIdx = SUPPORTED_WIDGET_LANGS_LOWER.indexOf(short)
  if (baseIdx !== -1) return SUPPORTED_WIDGET_LANGS[baseIdx]
  return null
}

const getForcedLang = (): string | null => {
  try {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    return normalizeLang(params.get('lang'))
  } catch {
    return null
  }
}

const getBrowserLanguage = (): string | null => {
  try {
    return normalizeLang(navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage)
  } catch {
    return null
  }
}

const pickFromObject = (obj: Record<string, string>, lang: string | null): string | null => {
  if (!lang) return null
  if (obj[lang]) return obj[lang]
  const base = lang.split('-')[0]
  if (base !== lang && obj[base]) return obj[base]
  return null
}

const getMultiLangText = (multiLangObj: Record<string, string> | string | null | undefined, fallbackText: string = ''): string => {
  // If it's a string (old format), return as is
  if (typeof multiLangObj === 'string') return multiLangObj

  // If null or undefined, return fallback
  if (!multiLangObj || typeof multiLangObj !== 'object') return fallbackText

  const supportedLangs = Object.keys(multiLangObj)
  if (supportedLangs.length === 0) return fallbackText

  const forcedPick = pickFromObject(multiLangObj, getForcedLang())
  if (forcedPick) return forcedPick

  const browserPick = pickFromObject(multiLangObj, getBrowserLanguage())
  if (browserPick) return browserPick

  if (multiLangObj['en']) return multiLangObj['en']

  const firstKey = supportedLangs[0]
  return multiLangObj[firstKey] || fallbackText
}

export default function ChatPage({ params }: ChatPageProps) {
  const { agentId } = use(params)
  const { t, currentLanguage } = useLanguage()
  const edition = useEdition()

  const [workflowId, setWorkflowId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const urlParams = new URLSearchParams(window.location.search)
    return urlParams.get('workflowId')
  })

  const [pageContext, setPageContext] = useState<{
    url: string
    path: string
    title: string
  } | null>(() => {
    if (typeof window === 'undefined') return null
    const urlParams = new URLSearchParams(window.location.search)
    const pageUrl = urlParams.get('pageUrl')
    const pagePath = urlParams.get('pagePath')
    const pageTitle = urlParams.get('pageTitle')
    if (pageUrl && pagePath) {
      return { url: pageUrl, path: pagePath, title: pageTitle || '' }
    }
    return null
  })

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null)
  const [memberToken, setMemberToken] = useState<string | null>(null)
  const [infoLoading, setInfoLoading] = useState(true)
  const [authError, setAuthError] = useState<AuthErrorState | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isGoogleLoggingIn, setIsGoogleLoggingIn] = useState(false)
  const [isEmbedded, setIsEmbedded] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [lastResponseId, setLastResponseId] = useState<string | null>(null)
  const [chatSummary, setChatSummary] = useState<{ summary: string; coveredCount: number } | null>(null)
  const requestGenerationRef = useRef(0)
  const inflightAbortRef = useRef<AbortController | null>(null)
  const sendingRef = useRef(false)
  const agentInfoGenerationRef = useRef(0)

  const invalidateInflightRequest = useCallback(() => {
    requestGenerationRef.current += 1
    inflightAbortRef.current?.abort()
    inflightAbortRef.current = null
    sendingRef.current = false
    setIsLoading(false)
    setStreamingContent('')
  }, [])
  const [viewportHeight, setViewportHeight] = useState('100vh')
  const [isDesktop, setIsDesktop] = useState(false)
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false)
  const [widgetSettings, setWidgetSettings] = useState<WidgetSettings | null>(null)
  const [widgetSettingsLoading, setWidgetSettingsLoading] = useState(true)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [clientId, setClientId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [myConversationId, setMyConversationId] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'chat' | 'voice'>('chat')
  const [webVoiceEnabled, setWebVoiceEnabled] = useState(false)
  const [webVoiceWorkflowId, setWebVoiceWorkflowId] = useState<string | null>(null)
  const [webVoiceTimeLimitMin, setWebVoiceTimeLimitMin] = useState(10)


  // File upload states
  const [uploadedFiles, setUploadedFiles] = useState<Array<{
    id: string
    name: string
    type: 'image' | 'pdf' | 'csv'
    base64?: string
    text?: string
    size: number
  }>>([])
  const [isUploading, setIsUploading] = useState(false)

  // Rate limiting states
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null)
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0)
  const [continuousCount, setContinuousCount] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const welcomeShownRef = useRef(false)

  // Rate limiting functions
  const checkRateLimit = useCallback(() => {
    if (!agentInfo?.rateLimitSettings || !clientId) return { allowed: true }

    const { chatLimitCount, chatLimitDurationMinutes, chatLimitMessage } = agentInfo.rateLimitSettings

    if (chatLimitCount === 0) return { allowed: true }

    const rateLimitKey = `aitalk-rate-limit-${agentId}-${clientId}`
    const messageTimestamps = JSON.parse(localStorage.getItem(rateLimitKey) || '[]') as number[]
    const now = Date.now()
    const timeWindowMs = chatLimitDurationMinutes * 60 * 1000

    const recentTimestamps = messageTimestamps.filter(timestamp => now - timestamp < timeWindowMs)

    if (recentTimestamps.length >= chatLimitCount) {
      const oldestTimestamp = Math.min(...recentTimestamps)
      const resetTime = new Date(oldestTimestamp + timeWindowMs)
      const remainingMs = resetTime.getTime() - now

      return {
        allowed: false,
        message: chatLimitMessage || t('chat_widget.rate_limit.default_message')
          .replace('{0}', chatLimitCount.toString())
          .replace('{1}', chatLimitDurationMinutes.toString()),
        resetTime,
        remainingMs
      }
    }

    return { allowed: true }
  }, [agentInfo, agentId, clientId])

  const addMessageTimestamp = useCallback(() => {
    if (!agentInfo?.rateLimitSettings || !clientId) return

    const { chatLimitCount, chatLimitDurationMinutes } = agentInfo.rateLimitSettings
    if (chatLimitCount === 0) return

    const rateLimitKey = `aitalk-rate-limit-${agentId}-${clientId}`
    const messageTimestamps = JSON.parse(localStorage.getItem(rateLimitKey) || '[]') as number[]
    const now = Date.now()
    const timeWindowMs = chatLimitDurationMinutes * 60 * 1000

    messageTimestamps.push(now)

    const recentTimestamps = messageTimestamps.filter(timestamp => now - timestamp < timeWindowMs)

    localStorage.setItem(rateLimitKey, JSON.stringify(recentTimestamps))
  }, [agentInfo, agentId, clientId])

  // Check continuous answer limit
  const checkContinuousAnswerLimit = useCallback(() => {
    if (!agentInfo?.rateLimitSettings || !clientId) return { allowed: true }

    const { continuousAnswerLimit, continuousAnswerLimitMessage } = agentInfo.rateLimitSettings

    if (continuousAnswerLimit === 0) return { allowed: true }

    if (continuousCount >= continuousAnswerLimit) {
      return {
        allowed: false,
        shouldResetConversation: true,
        message: continuousAnswerLimitMessage || t('chat_widget.continuous_answer.limit_reached').replace('{0}', continuousAnswerLimit.toString())
      }
    }

    if (continuousCount === continuousAnswerLimit - 1) {
      return {
        allowed: true,
        isLastAnswer: true,
        message: t('chat_widget.continuous_answer.warning_last_answer')
          .replace('{0}', (continuousCount + 1).toString())
          .replace('{1}', continuousAnswerLimit.toString())
      }
    }

    return { allowed: true }
  }, [agentInfo, clientId, continuousCount])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let embedded = false
    try {
      embedded = window.self !== window.top
    } catch {
      embedded = true
    }
    setIsEmbedded(embedded)

    const ua = navigator.userAgent.toLowerCase()
    const isMobile = /iphone|ipad|ipod|android|windows phone/.test(ua)
    setIsDesktop(!isMobile)
    setShouldAutoFocus(!embedded)

    // Initialize client ID
    const CLIENT_ID_KEY = `aitalk-client-id-${agentId}`
    let storedClientId = localStorage.getItem(CLIENT_ID_KEY)
    if (!storedClientId) {
      storedClientId = uuidv4()
      localStorage.setItem(CLIENT_ID_KEY, storedClientId)
    }
    setClientId(storedClientId)

    const MY_CONVERSATION_KEY = `aitalk-my-conversation-id-${agentId}`
    let storedMyConversationId = localStorage.getItem(MY_CONVERSATION_KEY)
    if (!storedMyConversationId) {
      storedMyConversationId = uuidv4()
      localStorage.setItem(MY_CONVERSATION_KEY, storedMyConversationId)
    }
    setMyConversationId(storedMyConversationId)

    // Load conversation from LocalStorage if exists
    const CONVERSATION_KEY = `aitalk-conversation-${agentId}`
    const savedConversation = localStorage.getItem(CONVERSATION_KEY)
    if (savedConversation) {
      try {
        const parsed = JSON.parse(savedConversation)
        if (parsed.messages && Array.isArray(parsed.messages)) {
          const restored = parsed.messages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          }))
          setMessages(restored)
          setConversationId(parsed.conversationId || null) // OpenAI response ID

          const saved = parsed.chatSummary
          const billableCount = restored.filter(
            (m: any) => (m.role === 'user' || m.role === 'assistant')
              && typeof m.id === 'string' && !m.id.startsWith('welcome-')
              && typeof m.content === 'string'
          ).length
          const validSummary =
            saved
            && typeof saved.summary === 'string'
            && Number.isInteger(saved.coveredCount)
            && saved.coveredCount >= 0
            && saved.coveredCount <= billableCount
          if (saved && !validSummary) {
            console.warn('[Chat Widget] stored chat summary discarded — invalid or out of range', {
              coveredCount: saved?.coveredCount, billableCount,
            })
          }
          setChatSummary(validSummary ? saved : null)
          welcomeShownRef.current = true
        }
      } catch (e) {
        console.error('Failed to restore conversation:', e)
      }
    }
  }, [agentId])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const updateViewportHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight
      setViewportHeight(`${height}px`)

      if (!isDesktop) {
        const windowHeight = window.innerHeight
        const viewportHeight = window.visualViewport?.height ?? windowHeight
        const heightDifference = windowHeight - viewportHeight

        setIsKeyboardOpen(heightDifference > 150)
      }
    }

    const viewport = window.visualViewport

    updateViewportHeight()

    window.addEventListener('resize', updateViewportHeight)
    window.addEventListener('orientationchange', updateViewportHeight)
    viewport?.addEventListener('resize', updateViewportHeight)

    return () => {
      window.removeEventListener('resize', updateViewportHeight)
      window.removeEventListener('orientationchange', updateViewportHeight)
      viewport?.removeEventListener('resize', updateViewportHeight)
    }
  }, [isDesktop])

  const tokenStorageKey = useMemo(() => `aitalk-team-token-${agentId}`, [agentId])

  const authErrorMessage = useMemo(() => {
    if (!authError) return null
    if ('message' in authError) {
      return authError.message
    }
    return t(authError.key)
  }, [authError, t])


  const isTeamLocked = useMemo(() => {
    return agentInfo?.accessMode === 'team' && !agentInfo?.authorized
  }, [agentInfo])

  const shouldShowFileUpload = useMemo(() => {
    if (agentInfo?.workflowMode !== 'workflow') return false
    const fi = agentInfo?.fileInput
    if (!fi) return false

    return !!(fi.imageInput || fi.pdfInput || fi.csvInput)
  }, [agentInfo])

  const allowedFileTypes = useMemo(() => {
    const fi = agentInfo?.fileInput
    if (!fi) return ''

    const types = []
    if (fi.imageInput) {
      types.push('.png', '.jpg', '.jpeg', '.webp', '.gif')
    }
    if (fi.pdfInput) {
      types.push('.pdf')
    }
    if (fi.csvInput) {
      types.push('.csv')
    }

    return types.join(',')
  }, [agentInfo])

  useEffect(() => {
    if (!shouldAutoFocus) return
    if (isLoading || streamingContent) return
    if (infoLoading || isTeamLocked) return

    const textarea = textareaRef.current
    if (!textarea) return

    if (isDesktop) {
      textarea.focus({ preventScroll: true })
    } else {
      textarea.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [shouldAutoFocus, isDesktop, isLoading, streamingContent, infoLoading, isTeamLocked, messages.length])
  const loadAgentInfo = useCallback(async (token?: string | null) => {
    const generation = ++agentInfoGenerationRef.current
    const isOutdated = () => agentInfoGenerationRef.current !== generation

    try {
      setInfoLoading(true)
      const headers: HeadersInit = {}
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const url = workflowId
        ? `/api/chat/${agentId}/info?workflowId=${workflowId}`
        : `/api/chat/${agentId}/info`

      const response = await fetch(url, { headers })
      if (isOutdated()) return

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setAgentInfo(null)
        setAuthError(data?.error ? { message: data.error } : { key: 'chat_widget.errors.info_load_failed' })
        if (token && typeof window !== 'undefined') {
          sessionStorage.removeItem(tokenStorageKey)
        }
        setMemberToken(null)
        return
      }

      const data = await response.json() as AgentInfo
      if (isOutdated()) return
      setAgentInfo(data)

      if (data.accessMode === 'team') {
        if (data.authorized) {
          setAuthError(null)
          if (data.member?.email) {
            setLoginEmail(prev => prev || data.member!.email)
          }
          if (token && typeof window !== 'undefined') {
            sessionStorage.setItem(tokenStorageKey, token)
          }
          if (token) {
            setMemberToken(token)
          } else if (!data.ownerAuthorized) {
            const stored = typeof window !== 'undefined' ? sessionStorage.getItem(tokenStorageKey) : null
            setMemberToken(stored)
          }
        } else {
          setMemberToken(null)
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem(tokenStorageKey)
          }
          setAuthError({ key: 'chat_widget.errors.team_login_required' })
        }
      } else {
        setAuthError(null)
        setMemberToken(null)
      }
    } catch (error) {
      if (isOutdated()) return
      console.error('Failed to load agent info:', error)
      setAuthError({ key: 'chat_widget.errors.info_load_failed' })
    } finally {
      if (!isOutdated()) setInfoLoading(false)
    }
  }, [agentId, tokenStorageKey, workflowId])

  // Auto-resize textarea
  const autoResize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '0'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }

  const createWelcomeMessage = useCallback((): Message => ({
    id: `welcome-${Date.now()}` ,
    role: 'assistant',
    content: getMultiLangText(widgetSettings?.initialMessage, 'How can I help you today?'),
    timestamp: new Date(),
  }), [widgetSettings])

  const getBillableMessages = useCallback(() => messages
    .filter(m => (m.role === 'user' || m.role === 'assistant')
      && !m.id.startsWith('welcome-') && typeof m.content === 'string')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })), [messages])

  const buildManagedHistoryPayload = useCallback(() => {
    const uncovered = getBillableMessages().slice(chatSummary?.coveredCount || 0)
    return {
      summaryProtocol: 1,
      conversationHistory: uncovered.length > 0 ? uncovered : undefined,
      conversationSummary: chatSummary?.summary || undefined,
    }
  }, [getBillableMessages, chatSummary])

  const resetConversationContext = useCallback(() => {
    setLastResponseId(null)
    setChatSummary({ summary: '', coveredCount: getBillableMessages().length })
  }, [getBillableMessages])

  const applySummaryUpdate = useCallback((summary: string, foldedCount: number) => {
    setChatSummary(prev => ({
      summary,
      coveredCount: (prev?.coveredCount || 0) + (foldedCount || 0),
    }))
  }, [])

  // Load widget settings and agent info together
  useEffect(() => {
    const loadWidgetSettings = async () => {
      try {
        setWidgetSettingsLoading(true)
        const response = await fetch(`/api/widget-settings/${agentId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.settings) {
            setWidgetSettings(data.settings)
            // Set agent access mode from the unified response
            if (data.agent) {
              setAgentInfo(prev => prev ? { ...prev, accessMode: data.agent.accessMode } : {
                id: agentId,
                title: data.agent.title,
                accessMode: data.agent.accessMode,
                authorized: false,
                vectorStoreId: null
              })
            }
          } else {
            // Fallback to default settings
            setWidgetSettings(mergeWidgetSettings())
          }
        } else {
          // Fallback to default settings
          setWidgetSettings(mergeWidgetSettings())
        }
      } catch (error) {
        console.error('Failed to load widget settings:', error)
        // Fallback to default settings
        setWidgetSettings(mergeWidgetSettings())
      } finally {
        setWidgetSettingsLoading(false)
      }
    }

    loadWidgetSettings()

    const loadWebVoiceStatus = async () => {
      try {
        const url = workflowId
          ? `/api/chat/${agentId}/button?workflowId=${workflowId}`
          : `/api/chat/${agentId}/button`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          if (data.webVoiceEnabled) {
            setWebVoiceEnabled(true)
            setWebVoiceWorkflowId(data.webVoiceWorkflowId || null)
            setWebVoiceTimeLimitMin(data.webVoiceTimeLimitMin || 10)
          }
        }
      } catch {
        // ignore — voice is optional
      }
    }
    loadWebVoiceStatus()
  }, [agentId, workflowId])

  useEffect(() => {
    const messageListener = (event: MessageEvent) => {
      if (event.data.type === 'WIDGET_STATE_CHANGED') {
        setIsExpanded(event.data.isExpanded)
      }
    }

    window.addEventListener('message', messageListener)

    const storedToken = typeof window !== 'undefined' ? sessionStorage.getItem(tokenStorageKey) : null
    if (storedToken) {
      setMemberToken(storedToken)
    }
    loadAgentInfo(storedToken)

    return () => window.removeEventListener('message', messageListener)
  }, [agentId, loadAgentInfo, workflowId])

  useEffect(() => {
    setLastResponseId(null)
    setChatSummary(null)
  }, [agentId])

  useEffect(() => {
    if (!agentInfo) {
      return
    }

    if (agentInfo.accessMode === 'team' && !agentInfo.authorized) {
      welcomeShownRef.current = false
      if (messages.length > 0) {
        setMessages([])
      }
      setLastResponseId(null)
      setChatSummary(null)
      return
    }

    if (agentInfo.authorized && messages.length === 0 && !welcomeShownRef.current) {
      setMessages([createWelcomeMessage()])
      setLastResponseId(null)
      setChatSummary(null)
      welcomeShownRef.current = true
    }
  }, [agentInfo, createWelcomeMessage, messages.length])

  // Update welcome message when widget settings change
  useEffect(() => {
    if (!widgetSettings || !welcomeShownRef.current) return

    setMessages(prev => {
      if (prev.length > 0 && prev[0].role === 'assistant' && prev[0].id.startsWith('welcome-')) {
        const updatedMessage = {
          ...prev[0],
          content: getMultiLangText(widgetSettings.initialMessage, 'How can I help you today?')
        }
        return [updatedMessage, ...prev.slice(1)]
      }
      return prev
    })
  }, [widgetSettings])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Save conversation to LocalStorage
  //
  // ⏱️ **debounce + flush** (codex R13 #4 → R14 #4)
  const persistSnapshotRef = useRef<{ key: string; data: any; revision: number } | null>(null)
  const persistRevisionRef = useRef(0)
  const lastWrittenRevisionRef = useRef(-1)
  const persistWriterId = useMemo(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, [])

  const flushConversationPersist = useCallback(() => {
    const snapshot = persistSnapshotRef.current
    if (!snapshot || typeof window === 'undefined') return
    if (snapshot.revision === lastWrittenRevisionRef.current) return
    try {
      const existingRaw = localStorage.getItem(snapshot.key)
      let existing: PersistedConversationMeta | null = null
      if (existingRaw) {
        try { existing = JSON.parse(existingRaw) } catch { }
      }
      if (!shouldOverwritePersistedConversation(existing, {
        writerId: persistWriterId,
        revision: snapshot.revision,
        lastUpdated: snapshot.data?.lastUpdated,
      })) return
      localStorage.setItem(snapshot.key, JSON.stringify({
        ...snapshot.data,
        writerId: persistWriterId,
        writerRevision: snapshot.revision,
      }))
      lastWrittenRevisionRef.current = snapshot.revision
    } catch (e) {
      console.warn('[Chat Widget] failed to persist conversation:', (e as Error)?.message)
    }
  }, [persistWriterId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!agentInfo) return
    if (messages.length === 0) return

    // Team mode: always save to localStorage but never to DB
    // Public mode: save to both localStorage and DB
    persistSnapshotRef.current = {
      key: `aitalk-conversation-${agentId}`,
      data: {
        messages: messages.map(msg => ({
          ...msg,
          timestamp: msg.timestamp.toISOString()
        })),
        conversationId, // OpenAI response ID
        myConversationId,
        chatSummary,
        clientId,
        agentId,
        lastUpdated: new Date().toISOString()
      },
      revision: ++persistRevisionRef.current,
    }

    const timer = setTimeout(flushConversationPersist, 250)
    return () => clearTimeout(timer)
  }, [messages, conversationId, myConversationId, chatSummary, clientId, agentId, agentInfo, flushConversationPersist])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onHide = () => flushConversationPersist()
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushConversationPersist() }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      flushConversationPersist()
    }
  }, [flushConversationPersist])

  // Rate limit checking and countdown
  useEffect(() => {
    if (!agentInfo?.rateLimitSettings || !clientId) {
      setIsRateLimited(false)
      setRateLimitMessage(null)
      setRateLimitCountdown(0)
      return
    }

    const checkAndUpdateRateLimit = () => {
      const result = checkRateLimit()

      if (!result.allowed && result.remainingMs && result.remainingMs > 0) {
        setIsRateLimited(true)
        setRateLimitMessage(result.message || null)
        setRateLimitCountdown(Math.ceil(result.remainingMs / 1000))
      } else {
        setIsRateLimited(false)
        setRateLimitMessage(null)
        setRateLimitCountdown(0)
      }
    }

    checkAndUpdateRateLimit()

    const interval = setInterval(checkAndUpdateRateLimit, 1000)

    return () => clearInterval(interval)
  }, [agentInfo, clientId, checkRateLimit])

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    if (uploadedFiles.length >= 1) {
      alert('파일은 1개만 업로드 가능합니다.')
      return
    }

    const file = files[0]

    if (file.size > 25 * 1024 * 1024) {
      const msgs: Record<string, string> = {
        ko: `"${file.name}" 파일이 최대 크기 25MB를 초과합니다.`,
        en: `File "${file.name}" exceeds the maximum size of 25MB.`,
        de: `Datei „${file.name}" überschreitet die maximale Größe von 25 MB.`,
        fr: `Le fichier « ${file.name} » dépasse la taille maximale de 25 Mo.`,
        es: `El archivo "${file.name}" supera el tamaño máximo de 25 MB.`,
      }
      const browserLang = (typeof navigator !== 'undefined' ? navigator.language?.substring(0, 2) : 'en') || 'en'
      alert(msgs[browserLang] || msgs.en)
      return
    }

    setIsUploading(true)

    try {
      if (isPdfFile(file)) {
        console.log('[PDF] Converting PDF to image on client side...')
        const images = await convertPdfToImages(file, { scale: 2, maxPages: 1 })

        if (images.length === 0) {
          throw new Error('PDF 변환에 실패했습니다.')
        }

        const firstPage = images[0]
        const base64Data = `data:image/jpeg;base64,${firstPage.base64}`

        const newFile = {
          id: uuidv4(),
          name: file.name,
          type: 'pdf' as const,
          base64: base64Data,
          size: file.size
        }

        setUploadedFiles([newFile])
        console.log('[PDF] Conversion complete')
        return
      }

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/api/chat/${agentId}/upload-image`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      }

      const data = await response.json()

      const newFile: any = {
        id: uuidv4(),
        name: file.name,
        size: file.size
      }

      if (data.data.type === 'csv') {
        newFile.type = 'csv'
        newFile.text = data.data.text
      } else {
        newFile.type = 'image'
        newFile.base64 = data.data.base64
      }

      setUploadedFiles([newFile])
    } catch (error) {
      console.error('File upload error:', error)
      alert('파일 업로드 중 오류가 발생했습니다.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles(uploadedFiles.filter(f => f.id !== fileId))
  }

  const handleSend = async () => {
    if ((!input.trim() && uploadedFiles.length === 0) || isLoading || sendingRef.current) return
    if (infoLoading) return

    if (!agentInfo) {
      setAuthError({ key: 'chat_widget.errors.info_load_failed' })
      return
    }

    if (agentInfo.accessMode === 'team' && !agentInfo.authorized) {
      setAuthError({ key: 'chat_widget.errors.team_login_required' })
      return
    }

    const rateLimitResult = checkRateLimit()
    if (!rateLimitResult.allowed) {
      setAuthError({ message: rateLimitResult.message || 'Rate limit exceeded' })
      return
    }

    const continuousLimitResult = checkContinuousAnswerLimit()
    if (!continuousLimitResult.allowed) {
      if (continuousLimitResult.shouldResetConversation) {
        resetConversationContext()
        setContinuousCount(0)

        const resetMessage: Message = {
          id: Date.now().toString(),
          role: 'system',
          content: continuousLimitResult.message || t('chat_widget.continuous_answer.new_conversation_started'),
          timestamp: new Date()
        }
        setMessages(prev => [...prev, resetMessage])
      }
      return
    }

    sendingRef.current = true

    const filesToSend = [...uploadedFiles]

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    }

    const history = [...messages, userMessage]
    setMessages(history)
    setInput('')
    setUploadedFiles([])
    autoResize()

    addMessageTimestamp()
    setIsLoading(true)
    setStreamingContent('')
    setAuthError(null)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept-Language': currentLanguage,
    }
    const activeToken = memberToken || (typeof window !== 'undefined' ? sessionStorage.getItem(tokenStorageKey) : null)
    if (activeToken) {
      headers['Authorization'] = `Bearer ${activeToken}`
    }

    const generation = requestGenerationRef.current
    const controller = new AbortController()
    inflightAbortRef.current = controller
    const isStale = () => requestGenerationRef.current !== generation
    const isNewContextTurn = !lastResponseId

    try {
      const apiUrl = workflowId
        ? `/api/chat?workflowId=${encodeURIComponent(workflowId)}`
        : '/api/chat'

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          message: userMessage.content,
          agentId,
          source: 'widget',
          previousResponseId: lastResponseId || undefined,
          conversationId: myConversationId || undefined,
          ...buildManagedHistoryPayload(),
          clientId,
          images: filesToSend.length > 0 ? filesToSend : undefined,
          pageContext: pageContext || undefined,
        }),
      })

      //
      if (response.status === 401) {
        await response.json().catch(() => null)
        const currentToken = typeof window !== 'undefined'
          ? sessionStorage.getItem(tokenStorageKey)
          : null
        const sameToken = !!activeToken && activeToken === currentToken
        if (sameToken) {
          setMemberToken(null)
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem(tokenStorageKey)
          }
          setAgentInfo(prev => prev ? { ...prev, authorized: false } : prev)
          setAuthError({ key: 'chat_widget.errors.team_login_required' })
          loadAgentInfo(null)
        }
        if (isStale()) return
        setIsLoading(false)
        return
      }

      if (response.status === 429) {
        const errorData = await response.json().catch(() => null)
        if (isStale()) return
        const rateLimitMessage = errorData?.error || 'You have reached your message limit. Please try again later.'
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'error',
          content: rateLimitMessage,
          timestamp: new Date()
        }
        setMessages(prev => [...prev, errorMessage])
        setStreamingContent('')
        setIsLoading(false)
        return
      }

      if (!response.ok || !response.body) {
        const errorData = await response.json().catch(() => null)
        if (isStale()) return
        if (errorData?.code === 'HISTORY_TOO_LARGE') {
          resetConversationContext()
        }
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'error',
          content: errorData?.error || t('chat_widget.errors.send_message_failed'),
          timestamp: new Date()
        }
        setMessages(prev => [...prev, errorMessage])
        setStreamingContent('')
        setIsLoading(false)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedContent = ''
      let receivedResponseId: string | null = null
      let receivedModel: string | null = null
      let receivedApiKey: string | null = null
      let receivedInputTokens: number | null = null
      let receivedOutputTokens: number | null = null

      let sseBuffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuffer += decoder.decode(value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') {
            continue
          }

          try {
            const parsed = JSON.parse(data)
            if (isStale()) continue
            if (parsed.content) {
              accumulatedContent += parsed.content
              setStreamingContent(accumulatedContent)
            } else if (parsed.type === 'completed') {
              receivedResponseId = parsed.responseId
              receivedModel = parsed.model
              receivedApiKey = parsed.apiKey || null
              receivedInputTokens = parsed.inputTokens || null
              receivedOutputTokens = parsed.outputTokens || null
            } else if (parsed.type === 'summary-update') {
              applySummaryUpdate(parsed.summary, parsed.foldedCount)
            } else if (parsed.error) {
              // Handle error in stream
              const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'error',
                content: parsed.error,
                timestamp: new Date()
              }
              setMessages(prev => [...prev, errorMessage])
              setStreamingContent('')
              break
            }
          } catch (e) {
            // Ignore malformed stream chunk
          }
        }
      }

      if (isStale()) return

      if (receivedResponseId) {
        setLastResponseId(receivedResponseId)
        setConversationId(receivedResponseId)
      }

      if (accumulatedContent) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: accumulatedContent,
          timestamp: new Date()
        }
        setMessages(prev => [...prev, assistantMessage])

        const newContinuousCount = continuousCount + 1
        setContinuousCount(newContinuousCount)

        if (agentInfo?.rateLimitSettings?.continuousAnswerLimit && agentInfo.rateLimitSettings.continuousAnswerLimit > 0) {
          const limit = agentInfo.rateLimitSettings.continuousAnswerLimit
          if (newContinuousCount === limit - 1) {
            const warningMessage: Message = {
              id: `warning-${Date.now()}`,
              role: 'system',
              content: t('chat_widget.continuous_answer.warning_last_answer')
                .replace('{0}', (newContinuousCount + 1).toString())
                .replace('{1}', limit.toString()),
              timestamp: new Date()
            }
            setTimeout(() => {
              setMessages(prev => [...prev, warningMessage])
            }, 500)
          }
        }

      }

      setStreamingContent('')
    } catch (error) {
      if ((error as any)?.name === 'AbortError' || isStale()) return
      console.error('Error sending message:', error)
      // Only show error if not already handled
      if (!messages.find(m => m.id === (Date.now() + 1).toString())) {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'error',
          content: t('chat_widget.errors.general_error'),
          timestamp: new Date()
        }
        setMessages(prev => [...prev, errorMessage])
      }
      setStreamingContent('')
      setLastResponseId(null)
    } finally {
      if (inflightAbortRef.current === controller) {
        sendingRef.current = false
      }
      if (!isStale()) {
        setIsLoading(false)
        if (inflightAbortRef.current === controller) inflightAbortRef.current = null
      }
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleGoogleLogin = useCallback(async () => {
    if (typeof window === 'undefined') return
    setAuthError(null)
    setIsGoogleLoggingIn(true)

    try {
      const currentUrl = window.location.href
      const previewPath = `/chat/${agentId}/preview`
      const callbackUrl = currentUrl.includes(previewPath)
        ? currentUrl
        : `${window.location.origin}/chat/${agentId}`

      if (isEmbedded) {
        const signInUrl = `/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`
        try {
          if (window.top && window.top !== window.self) {
            window.top.location.href = signInUrl
          } else {
            window.location.href = signInUrl
          }
        } catch {
          window.location.href = signInUrl
        }
        return
      }

      await signIn('google', { callbackUrl })
    } catch (error) {
      console.error('Google login error:', error)
      setAuthError({ key: 'chat_widget.errors.google_login_failed' })
      setIsGoogleLoggingIn(false)
    } finally {
      if (isEmbedded) {
        setIsGoogleLoggingIn(false)
      }
    }
  }, [agentId, isEmbedded])

  const handleTeamLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!loginEmail.trim() || !loginPassword) {
      setAuthError({ key: 'chat_widget.errors.missing_credentials' })
      return
    }

    setIsLoggingIn(true)
    setAuthError(null)

    try {
      const response = await fetch(`/api/chat/${agentId}/team/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
        })
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.token) {
        setAuthError(data?.error ? { message: data.error } : { key: 'chat_widget.errors.login_failed' })
        return
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem(tokenStorageKey, data.token)
      }

      setMemberToken(data.token)
      setLoginPassword('')
      if (data.member?.email) {
        setLoginEmail(data.member.email)
      }
      welcomeShownRef.current = false
      invalidateInflightRequest()
      setMessages([])
      setLastResponseId(null)
      setChatSummary(null)
      await loadAgentInfo(data.token)
    } catch (error) {
      console.error('Team member login error:', error)
      setAuthError({ key: 'chat_widget.errors.login_retry' })
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleTeamLogout = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(tokenStorageKey)
    }
    setMemberToken(null)
    welcomeShownRef.current = false
    invalidateInflightRequest()
    setMessages([])
    setLastResponseId(null)
    setChatSummary(null)
    setAgentInfo(prev => prev ? { ...prev, authorized: false, member: undefined } : prev)
    setAuthError({ key: 'chat_widget.errors.team_login_required' })
    loadAgentInfo(null)
  }

  const startNewConversation = () => {
    if (confirm(t('chat_widget.new_chat_confirm'))) {
      // Clear only namespace-specific keys from LocalStorage
      const CONVERSATION_KEY = `aitalk-conversation-${agentId}`
      const MY_CONVERSATION_KEY = `aitalk-my-conversation-id-${agentId}`
      localStorage.removeItem(CONVERSATION_KEY)

      // Generate new conversation ID
      const newMyConversationId = uuidv4()
      localStorage.setItem(MY_CONVERSATION_KEY, newMyConversationId)
      setMyConversationId(newMyConversationId)

      invalidateInflightRequest()
      setIsLoading(false)
      setMessages([{
        id: 'welcome-new',
        role: 'assistant',
        content: getMultiLangText(widgetSettings?.initialMessage, t('chat_widget.default_initial_message')),
        timestamp: new Date()
      }])
      setStreamingContent('')
      setLastResponseId(null)
      setChatSummary(null)
      setConversationId(null)
      setContinuousCount(0)
    }
  }


  const rootHeightStyle = useMemo(() => ({
    height: viewportHeight,
    minHeight: viewportHeight,
  }), [viewportHeight])

  // Show loading screen while widget settings are loading
  if (widgetSettingsLoading) {
    return (
      <div
        className="flex flex-col overflow-hidden"
        style={rootHeightStyle}
      >
        <div className="flex items-center justify-center flex-1 bg-gray-100">
          <div className="text-center">
            <div className="flex gap-1 justify-center mb-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }}></span>
            </div>
            <p className="text-sm text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  const finalWidgetSettings = widgetSettings || mergeWidgetSettings()
  const expandIconKey: 'maximize' | 'minimize' = isExpanded ? 'minimize' : 'maximize'
  const expandIconColor = finalWidgetSettings.headerIconColors[expandIconKey]
  const isDesktopUserAgent = typeof navigator === 'undefined'
    ? true
    : !/iphone|ipad|ipod|android|windows phone/i.test(navigator.userAgent)
  const containerBorderRadius = (isDesktop || isDesktopUserAgent) ? '12px' : '0px'
  const containerBackgroundColor =
    containerBorderRadius === '0px'
      ? finalWidgetSettings.chatWindowBackgroundColor
      : finalWidgetSettings.headerBackgroundColor

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        ...rootHeightStyle,
        borderRadius: containerBorderRadius,
        backgroundColor: containerBackgroundColor,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3"
        style={{
          backgroundColor: finalWidgetSettings.headerBackgroundColor,
          color: finalWidgetSettings.headerTextColor,
          borderTopLeftRadius: containerBorderRadius,
          borderTopRightRadius: containerBorderRadius,
        }}
      >
        <div className="flex items-center space-x-2">
          <img
            src={finalWidgetSettings.customIconData || brandAssets(edition).widgetIcon}
            alt="AITalk"
            className="h-8"
          />
          <div>
            <h3 className="font-bold text-sm">
              {finalWidgetSettings.headerTitle || agentInfo?.title || 'AI Talk'}
            </h3>
            {agentInfo?.accessMode === 'team' && agentInfo.authorized && agentInfo.member && (
              <p className="text-xs opacity-70">
                {agentInfo.member.displayName || agentInfo.member.email}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agentInfo?.accessMode === 'team' && agentInfo.authorized && !agentInfo.ownerAuthorized && typeof window !== 'undefined' && window.parent === window && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTeamLogout}
              className="h-8 px-3"
              style={{
                color: finalWidgetSettings.headerTextColor,
                backgroundColor: 'transparent',
              }}
              title={t('chat_widget.logout')}
            >
              {t('chat_widget.logout')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsExpanded(!isExpanded)
              if (window.parent !== window) {
                window.parent.postMessage({ type: 'EXPAND_WIDGET' }, '*')
              }
            }}
            className="h-8 w-8 p-0"
            style={{
              color: expandIconColor,
              backgroundColor: 'transparent',
            }}
            title={isExpanded ? t('chat_widget.minimize') : t('chat_widget.expand')}
          >
            {React.createElement(
              getIconComponent(expandIconKey, finalWidgetSettings.headerIcons[expandIconKey]),
              { className: "h-4 w-4" }
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={startNewConversation}
            disabled={isTeamLocked || infoLoading}
            className="h-8 w-8 p-0"
            style={{
              color: finalWidgetSettings.headerIconColors.newConversation,
              backgroundColor: 'transparent',
            }}
            title={t('chat_widget.new_chat')}
          >
            {React.createElement(getIconComponent('newConversation', finalWidgetSettings.headerIcons.newConversation), { className: "h-4 w-4" })}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.parent !== window) {
                window.parent.postMessage({ type: 'CLOSE_WIDGET' }, '*')
              }
            }}
            className="h-8 w-8 p-0"
            style={{
              color: finalWidgetSettings.headerIconColors.close,
              backgroundColor: 'transparent',
            }}
            title={t('chat_widget.close')}
          >
            {React.createElement(getIconComponent('close', finalWidgetSettings.headerIcons.close), { className: "h-4 w-4" })}
          </Button>
        </div>
      </div>

      {webVoiceEnabled && (
        <div
          className="flex border-b"
          style={{
            backgroundColor: finalWidgetSettings.headerBackgroundColor,
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
              activeTab === 'chat'
                ? 'border-b-2 border-teal-400 text-teal-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Chat
          </button>
          <button
            onClick={() => setActiveTab('voice')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
              activeTab === 'voice'
                ? 'border-b-2 border-teal-400 text-teal-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            Voice
          </button>
        </div>
      )}

      {activeTab === 'voice' && webVoiceEnabled && (
        <div
          className="flex-1 flex flex-col min-h-0"
          style={{ backgroundColor: '#111827' }}
        >
          <VoiceCallView
            agentId={agentId}
            workflowId={webVoiceWorkflowId || workflowId || undefined}
            agentTitle={agentInfo?.title}
            timeLimitMin={webVoiceTimeLimitMin}
            mode="live"
            inline={true}
          />
        </div>
      )}

      <div
        className="flex-1 flex flex-col min-h-0"
        style={{
          backgroundColor: finalWidgetSettings.chatWindowBackgroundColor,
          display: activeTab === 'chat' ? 'flex' : 'none',
        }}
      >
        {(() => {
          const thumb = safeColorValue(finalWidgetSettings.scrollbarThumbColor, '#C7C7C7')
          const track = safeColorValue(finalWidgetSettings.scrollbarTrackColor, '#dbdbdb')
          return (
            <style>{`
              .chat-widget-messages::-webkit-scrollbar { width: 8px; }
              .chat-widget-messages::-webkit-scrollbar-thumb { background-color: ${thumb}; border-radius: 999px; }
              .chat-widget-messages::-webkit-scrollbar-track { background-color: ${track}; }
            `}</style>
          )
        })()}
        {/* Messages */}
        <div
          className="chat-widget-messages flex-1 min-h-0 overflow-y-auto overscroll-contain p-4"
          style={{
            backgroundColor: finalWidgetSettings.chatWindowBackgroundColor,
            scrollbarColor: `${safeColorValue(finalWidgetSettings.scrollbarThumbColor, '#C7C7C7')} ${safeColorValue(finalWidgetSettings.scrollbarTrackColor, '#dbdbdb')}`,
          }}
        >
          <div className="space-y-4 max-w-4xl mx-0 md:mx-auto">
          {infoLoading ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-gray-600">
              {t('chat_widget.loading')}
            </div>
          ) : isTeamLocked ? (
            <div className="flex min-h-[320px] w-full items-center justify-center py-4">
              <div className="text-center space-y-4 p-6 max-w-sm">
                <div className="text-5xl mb-4">🔒</div>
                <h2 className="text-xl font-semibold" style={{ color: finalWidgetSettings.initialMessageTextColor }}>
                  {t('chat_widget.team_only_title')}
                </h2>
                <p className="text-sm" style={{ color: finalWidgetSettings.initialMessageTextColor, opacity: 0.7 }}>
                  {t('chat_widget.team_only_message')}
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === 'user'
                      ? 'justify-end'
                      : message.role === 'system'
                        ? 'justify-center'
                        : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                      message.role === 'user'
                        ? 'rounded-br-none'
                        : message.role === 'error'
                        ? 'bg-red-100 text-red-800 rounded-bl-none'
                        : message.role === 'system'
                        ? 'bg-blue-50 text-blue-800 text-center text-xs'
                        : 'rounded-bl-none'
                    }`}
                    style={{
                      backgroundColor: message.role === 'user'
                        ? finalWidgetSettings.userMessageBackgroundColor
                        : message.role === 'error'
                        ? '#fee2e2'
                        : message.role === 'system'
                        ? '#eff6ff'
                        : finalWidgetSettings.initialMessageBackgroundColor,
                      color: message.role === 'user'
                        ? finalWidgetSettings.userMessageTextColor
                        : message.role === 'error'
                        ? '#dc2626'
                        : message.role === 'system'
                        ? '#1e40af'
                        : finalWidgetSettings.initialMessageTextColor,
                    }}
                  >
                    <div className="text-sm leading-relaxed">
                      <MessageContent
                        content={message.content}
                        role={message.role}
                        theme="light"
                        size="sm"
                        enableJsonTable={false}
                      />
                    </div>
                    <p
                      className="text-xs mt-1 opacity-70"
                      style={{
                        color: message.role === 'user'
                          ? finalWidgetSettings.userMessageTimeColor
                          : finalWidgetSettings.aiMessageTimeColor
                      }}
                    >
                      {formatTimeOnlyWithUserSettings(message.timestamp)}
                    </p>
                  </div>
                </div>
              ))}

              {streamingContent && (
                <div className="flex justify-start">
                  <div
                    className="max-w-[90%] rounded-lg rounded-bl-none px-3 py-2 text-sm"
                    style={{
                      backgroundColor: finalWidgetSettings.initialMessageBackgroundColor,
                      color: finalWidgetSettings.initialMessageTextColor,
                    }}
                  >
                    <div className="text-sm leading-relaxed">
                      <MessageContent
                        content={streamingContent}
                        role="assistant"
                        theme="light"
                        size="sm"
                        isStreaming={true}
                        enableJsonTable={false}
                      />
                    </div>
                  </div>
                </div>
              )}

              {isLoading && !streamingContent && (
                <div className="flex justify-start">
                  <div className="bg-transparent rounded-lg px-3 py-2 text-sm">
                    <div className="flex gap-2 items-center">
                      <div className="flex gap-1">
                        <span
                          className="w-2 h-2 rounded-full animate-bounce"
                          style={{
                            animationDelay: '0ms',
                            backgroundColor: finalWidgetSettings.loadingIconColor,
                          }}
                        ></span>
                        <span
                          className="w-2 h-2 rounded-full animate-bounce"
                          style={{
                            animationDelay: '200ms',
                            backgroundColor: finalWidgetSettings.loadingIconColor,
                          }}
                        ></span>
                        <span
                          className="w-2 h-2 rounded-full animate-bounce"
                          style={{
                            animationDelay: '400ms',
                            backgroundColor: finalWidgetSettings.loadingIconColor,
                          }}
                        ></span>
                      </div>
                      <span
                        className="italic text-xs"
                        style={{ color: finalWidgetSettings.loadingTextColor }}
                      >
                        {t('chat_widget.initializing')}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Recommended Questions - Only show in new conversation (welcome message only) */}
      {(() => {
        const questions = (finalWidgetSettings.recommendedQuestions || [])
          .map(q => getMultiLangText(q))
          .filter(q => q.trim())

        return questions.length > 0 && messages.length <= 1 && (
          <div
            className="border-t px-4 py-3"
            style={{
              borderColor: finalWidgetSettings.chatWindowBackgroundColor,
              backgroundColor: finalWidgetSettings.chatWindowBackgroundColor,
            }}
          >
            <div className="max-w-4xl mx-auto flex flex-wrap gap-2 justify-end">
              {questions.map((question, index) => (
                <button
                  key={index}
                  onClick={() => {
                    if (!isLoading && !sendingRef.current && !isTeamLocked && !infoLoading) {
                      const rateLimitResult = checkRateLimit()
                      if (!rateLimitResult.allowed) {
                        setAuthError({ message: rateLimitResult.message || 'Rate limit exceeded' })
                        return
                      }

                      sendingRef.current = true
                      setInput(question)
                      // Auto-send the message after setting input
                      setTimeout(() => {
                        autoResize()
                        // Auto-send the question
                        const userMessage: Message = {
                          id: Date.now().toString(),
                          role: 'user',
                          content: question.trim(),
                          timestamp: new Date()
                        }

                        const history = [...messages, userMessage]
                        setMessages(history)
                        setInput('')
                        autoResize()

                        addMessageTimestamp()
                        setIsLoading(true)
                        setStreamingContent('')
                        setAuthError(null)

                        const headers: Record<string, string> = {
                          'Content-Type': 'application/json',
                          'Accept-Language': currentLanguage,
                        }
                        const activeToken = memberToken || (typeof window !== 'undefined' ? sessionStorage.getItem(tokenStorageKey) : null)
                        if (activeToken) {
                          headers['Authorization'] = `Bearer ${activeToken}`
                        }

                        const generation = requestGenerationRef.current
                        const controller = new AbortController()
                        inflightAbortRef.current = controller
                        const isStale = () => requestGenerationRef.current !== generation
                        const isNewContextTurn = !lastResponseId

                        // Send the message
                        const apiUrl = workflowId
                          ? `/api/chat?workflowId=${encodeURIComponent(workflowId)}`
                          : '/api/chat'

                        fetch(apiUrl, {
                          method: 'POST',
                          headers,
                          signal: controller.signal,
                          body: JSON.stringify({
                            message: userMessage.content,
                            agentId,
                            source: 'widget',
                            previousResponseId: lastResponseId || undefined,
                            conversationId: myConversationId || undefined,
                            ...buildManagedHistoryPayload(),
                            clientId,
                            pageContext: pageContext || undefined,
                          }),
                        })
                        .then(async (response) => {
                          if (response.status === 401) {
                            await response.json().catch(() => null)
                            const currentToken = typeof window !== 'undefined'
                              ? sessionStorage.getItem(tokenStorageKey)
                              : null
                            if (activeToken && activeToken === currentToken) {
                              setMemberToken(null)
                              if (typeof window !== 'undefined') {
                                sessionStorage.removeItem(tokenStorageKey)
                              }
                              setAgentInfo(prev => prev ? { ...prev, authorized: false } : prev)
                              setAuthError({ key: 'chat_widget.errors.team_login_required' })
                              loadAgentInfo(null)
                            }
                            if (isStale()) return
                            setIsLoading(false)
                            return
                          }

                          if (response.status === 429) {
                            const errorData = await response.json().catch(() => null)
                            if (isStale()) return
                            const rateLimitMessage = errorData?.error || 'You have reached your message limit. Please try again later.'
                            const errorMessage: Message = {
                              id: (Date.now() + 1).toString(),
                              role: 'error',
                              content: rateLimitMessage,
                              timestamp: new Date()
                            }
                            setMessages(prev => [...prev, errorMessage])
                            setStreamingContent('')
                            setIsLoading(false)
                            return
                          }

                          if (!response.ok || !response.body) {
                            const errorData = await response.json().catch(() => null)
                            if (isStale()) return
                            if (errorData?.code === 'HISTORY_TOO_LARGE') {
                              resetConversationContext()
                            }
                            const errorMessage: Message = {
                              id: (Date.now() + 1).toString(),
                              role: 'error',
                              content: errorData?.error || t('chat_widget.errors.send_message_failed'),
                              timestamp: new Date()
                            }
                            setMessages(prev => [...prev, errorMessage])
                            setStreamingContent('')
                            setIsLoading(false)
                            return
                          }

                          const reader = response.body.getReader()
                          const decoder = new TextDecoder()
                          let accumulatedContent = ''
                          let receivedResponseId: string | null = null
                          let receivedModel: string | null = null
                          let receivedApiKey: string | null = null
                          let receivedInputTokens: number | null = null
                          let receivedOutputTokens: number | null = null

                          let sseBuffer = ''
                          while (true) {
                            const { done, value } = await reader.read()
                            if (done) break

                            sseBuffer += decoder.decode(value, { stream: true })
                            const lines = sseBuffer.split('\n')
                            sseBuffer = lines.pop() ?? ''

                            for (const line of lines) {
                              if (!line.startsWith('data: ')) continue
                              const data = line.slice(6)
                              if (data === '[DONE]') {
                                continue
                              }

                              try {
                                const parsed = JSON.parse(data)
                                if (isStale()) continue
                                if (parsed.content) {
                                  accumulatedContent += parsed.content
                                  setStreamingContent(accumulatedContent)
                                } else if (parsed.type === 'completed') {
                                                      receivedResponseId = parsed.responseId
                                  receivedModel = parsed.model
                                  receivedApiKey = parsed.apiKey || null
                                  receivedInputTokens = parsed.inputTokens || null
                                  receivedOutputTokens = parsed.outputTokens || null
                                } else if (parsed.type === 'summary-update') {
                                  applySummaryUpdate(parsed.summary, parsed.foldedCount)
                                } else if (parsed.error) {
                                  const errorMessage: Message = {
                                    id: (Date.now() + 1).toString(),
                                    role: 'error',
                                    content: parsed.error,
                                    timestamp: new Date()
                                  }
                                  setMessages(prev => [...prev, errorMessage])
                                  setStreamingContent('')
                                  break
                                }
                              } catch (e) {
                                // Ignore malformed stream chunk
                              }
                            }
                          }

                          if (isStale()) return

                          if (receivedResponseId) {
                            setLastResponseId(receivedResponseId)
                            setConversationId(receivedResponseId)
                          }

                          if (accumulatedContent) {
                            const assistantMessage: Message = {
                              id: (Date.now() + 1).toString(),
                              role: 'assistant',
                              content: accumulatedContent,
                              timestamp: new Date()
                            }
                            setMessages(prev => [...prev, assistantMessage])

                          }

                          setStreamingContent('')
                        })
                        .catch(error => {
                          if ((error as any)?.name === 'AbortError' || isStale()) return
                          console.error('Error sending message:', error)
                          const errorMessage: Message = {
                            id: (Date.now() + 1).toString(),
                            role: 'error',
                            content: t('chat_widget.errors.general_error'),
                            timestamp: new Date()
                          }
                          setMessages(prev => [...prev, errorMessage])
                          setStreamingContent('')
                          setLastResponseId(null)
                        })
                        .finally(() => {
                          if (inflightAbortRef.current === controller) {
                            sendingRef.current = false
                          }
                          if (!isStale()) {
                            setIsLoading(false)
                            if (inflightAbortRef.current === controller) inflightAbortRef.current = null
                          }
                        })
                      }, 0)
                    }
                  }}
                  disabled={isLoading || isTeamLocked || infoLoading || isRateLimited}
                  className="rounded-full px-3 py-1.5 text-xs font-medium shadow-sm border transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: finalWidgetSettings.recommendedQuestionsBackgroundColor,
                    color: finalWidgetSettings.recommendedQuestionsTextColor,
                    borderColor: finalWidgetSettings.borderColor,
                  }}
                >
                  {question}
                </button>
              ))}
          </div>
        </div>
        )
      })()}

      {/* Privacy Policy - Only show in new conversation (welcome message only) */}
      {messages.length <= 1 && (
        <div
          className="border-t px-4 py-3 text-xs"
          style={{
            borderColor: finalWidgetSettings.chatWindowBackgroundColor,
            backgroundColor: finalWidgetSettings.privacyPolicy.backgroundColor,
            color: finalWidgetSettings.privacyPolicy.textColor,
          }}
        >
        <div className="max-w-4xl mx-auto text-center">
          {getMultiLangText(finalWidgetSettings.privacyPolicy.text, 'By using this chat, you agree to our')}{' '}
          <a
            href={finalWidgetSettings.privacyPolicy.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: finalWidgetSettings.privacyPolicy.linkColor }}
          >
            {getMultiLangText(finalWidgetSettings.privacyPolicy.linkText, 'Privacy Policy')}
          </a>
        </div>
        </div>
      )}

      {/* File Upload Section - Workflow Mode only */}
      {shouldShowFileUpload && uploadedFiles.length > 0 && (
        <div
          className="border-t px-4 py-3"
          style={{
            borderColor: finalWidgetSettings.chatWindowBackgroundColor,
            backgroundColor: finalWidgetSettings.chatWindowBackgroundColor,
          }}
        >
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-wrap gap-2">
              {uploadedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs"
                  style={{
                    backgroundColor: finalWidgetSettings.inputBackgroundColor,
                    borderColor: finalWidgetSettings.inputBorderColor,
                    color: finalWidgetSettings.inputTextColor,
                  }}
                >
                  <span className="truncate max-w-[150px]">{file.name}</span>
                  <button
                    onClick={() => handleRemoveFile(file.id)}
                    className="hover:opacity-70"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div
        className="border-t pt-0 pb-1 px-3"
        style={{
          borderColor: finalWidgetSettings.chatWindowBackgroundColor,
          backgroundColor: finalWidgetSettings.chatWindowBackgroundColor,
        }}
      >
        <style>{`
          .chat-input-container {
            border: 1px solid ${finalWidgetSettings.inputBorderColor};
            border-radius: 0.75rem !important;
            transition: border-color 0.2s ease;
            overflow: hidden;
          }
          .chat-input-container:focus-within {
            border: 1px solid ${finalWidgetSettings.inputFocusBorderColor} !important;
            border-radius: 0.75rem !important;
            box-shadow: none !important;
            filter: none !important;
            backdrop-filter: none !important;
            transform: none !important;
            outline: none !important;
          }
          .chat-input::placeholder {
            color: ${finalWidgetSettings.inputTextColor === '#ffffff' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} !important;
          }
          .chat-input:focus {
            outline: none !important;
            border: none !important;
            box-shadow: none !important;
          }
        `}</style>
        <div className="max-w-4xl mx-0 md:mx-auto">
          {/* Rate limit countdown message */}
          {isRateLimited && rateLimitCountdown > 0 && (
            <div className="mb-2 text-center">
              <div className="inline-block px-3 py-1.5 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
                {rateLimitMessage && (
                  <div className="font-medium mb-1">{rateLimitMessage}</div>
                )}
                <div className="text-xs">
                  {t('chat_widget.rate_limit.countdown_seconds').replace('{0}', rateLimitCountdown.toString())}
                </div>
              </div>
            </div>
          )}

          <div
            className="chat-input-container flex items-center rounded-xl shadow-sm"
            style={{
              backgroundColor: finalWidgetSettings.inputBackgroundColor,
              borderColor: finalWidgetSettings.inputBorderColor,
            }}
          >
            <Textarea
              ref={textareaRef}
              placeholder={getMultiLangText(finalWidgetSettings.inputPlaceholder, t('chat_widget.message_placeholder'))}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                autoResize()
              }}
              onKeyDown={handleKeyPress}
              disabled={(streamingContent && !isDesktop) || isTeamLocked || infoLoading || isRateLimited}
              className="chat-input flex-1 min-h-[42px] max-h-[150px] border-none resize-none px-4 py-2.5 text-sm focus:outline-none focus:ring-0"
              style={{
                height: '42px',
                color: finalWidgetSettings.inputTextColor,
                backgroundColor: finalWidgetSettings.inputBackgroundColor,
              }}
            />

            {/* File Upload Button - Workflow Mode only */}
            {shouldShowFileUpload && (
              <label className="mr-1 flex h-8 w-8 items-center justify-center cursor-pointer hover:opacity-70">
                <input
                  type="file"
                  accept={allowedFileTypes}
                  onChange={handleFileUpload}
                  disabled={isUploading || uploadedFiles.length >= 1}
                  className="hidden"
                />
                <Paperclip
                  className="h-4 w-4"
                  style={{ color: finalWidgetSettings.sendIconColor }}
                />
              </label>
            )}

            {/* Send Button */}
            <div
              className="mr-1 flex h-8 w-16 items-center justify-center cursor-pointer bg-transparent"
              onClick={() => {
                if (!((!input.trim() && uploadedFiles.length === 0) || isLoading || streamingContent || isTeamLocked || infoLoading || isRateLimited)) {
                  handleSend()
                }
              }}
              style={{
                backgroundColor: 'transparent',
                opacity: (isLoading || streamingContent || isTeamLocked || infoLoading || isRateLimited) ? 0.3 : 1,
                pointerEvents: ((!input.trim() && uploadedFiles.length === 0) || isLoading || streamingContent || isTeamLocked || infoLoading || isRateLimited) ? 'none' : 'auto'
              }}
            >
              <span
                className="flex h-6 w-6 items-center justify-center"
                style={{ color: finalWidgetSettings.sendIconColor }}
              >
                {React.createElement(getIconComponent('send', finalWidgetSettings.sendIcon), {
                  className: finalWidgetSettings.sendIcon === 'send-b.svg' ? "h-4 w-4 translate-x-0.5 translate-y-0.5" : "h-4 w-4"
                })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      {!(isKeyboardOpen && !isDesktop) && finalWidgetSettings.poweredByImage !== 'none' && (
        <div
          className="px-5 py-2 flex justify-center items-center border-t"
          style={{
            backgroundColor: finalWidgetSettings.chatWindowBackgroundColor,
            borderColor: finalWidgetSettings.chatWindowBackgroundColor,
          }}
        >
        <a
          href="https://www.aitalk.ch"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs no-underline"
        >
          <span style={{ color: finalWidgetSettings.poweredByTextColor }}>Powered by</span>
          <img
            src={finalWidgetSettings.poweredByImage === 'AITalk02_w.png'
              ? brandAssets(edition).poweredByWhite
              : brandAssets(edition).poweredByBlack
            }
            alt="AITalk"
            className="h-3.5 relative top-0.5"
          />
        </a>
        </div>
      )}
      </div>
    </div>
  )
}
