'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getTranslations } from '@/lib/translations/dashboard'
import { useLanguage } from '@/hooks/useLanguage'
import { toSafeUrl, SAFE_LINK_PROTOCOLS, SAFE_IMAGE_PROTOCOLS } from '@/lib/chat/safe-url'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertCircle, Loader2, Phone, Mic, BookOpen, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type ConversationSource = 'text' | 'voice-pstn' | 'voice-web' | 'voice-web-test' | 'quiz'

interface VoiceMeta {
  duration: number | null
  voiceName: string | null
  language: string | null
  callerNumber?: string | null
  userIp?: string | null
  mode?: string | null
}

interface QuizMeta {
  title: string
  memberDisplayName: string
  durationSeconds: number
  questionsTotal: number
  questionsAnswered: number
  correctCount: number
}

interface QuizQuestionDetail {
  questionId: string
  question: string | null
  type: string | null
  choices: string[] | null
  answered: string | null
  correctAnswer: string | null
  explanation: string | null
  correct: boolean
}

interface QuizDetail {
  title: string
  memberDisplayName: string
  completedAt: string
  durationSeconds: number
  studyCompleted: boolean
  questionsTotal: number
  questionsAnswered: number
  correctCount: number
  questions: QuizQuestionDetail[]
}

interface ConversationListItem {
  conversationId: string
  createdAt: string
  userQuestion: string
  inputTokens: number | null
  outputTokens: number | null
  clientId: string | null
  no: number
  agentTitle: string
  userIP?: string | null
  source?: ConversationSource
  sessionId?: string | null
  voiceMeta?: VoiceMeta | null
  quizMeta?: QuizMeta | null
}

interface LocationCache {
  [ip: string]: {
    country?: string
    region?: string
    city?: string
  }
}

interface PageInfo {
  currentPage: number
  totalPages: number
  limit: number
  totalItems: number
}

interface MessageItem {
  role: string
  content: string
  createdAt: string
  inputTokens: number | null
  outputTokens: number | null
  lang?: string | null
  at?: number | null
  sessionId?: string | null
  source?: string | null
  boundary?: boolean
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const STORAGE_KEY_ROWS = 'historyRowsPerPage'
const DEFAULT_ROWS = '10'
const PAGE_GROUP_SIZE = 8
const MAX_LIMIT = 100

function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) {
    return '0'
  }
  return num.toLocaleString()
}

function formatLocation(country?: string | null, region?: string | null, city?: string | null): string {
  const parts = [country, region, city].filter(Boolean)
  if (parts.length === 0) return ''
  return parts.join(' > ')
}

function getLocationDisplay(ip: string | null | undefined, locationCache: LocationCache): string {
  if (!ip || !locationCache[ip]) return ''
  const location = locationCache[ip]
  const formatted = formatLocation(location.country, location.region, location.city)
  return formatted
}

function formatDateTime(value: string, timeFormat: string = 'DD.MM.YYYY HH:mm', timezone: string = 'UTC') {
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
  } catch {
    return value
  }
}

type DashboardTranslations = ReturnType<typeof getTranslations>

function QuizResultDetail({
  quiz,
  t,
  formatDateTimeFn,
}: {
  quiz: QuizDetail
  t: DashboardTranslations
  formatDateTimeFn: (value: string) => string
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <span className="font-semibold text-foreground">{quiz.title}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{quiz.memberDisplayName}</span>
          <span>•</span>
          <span>{formatDateTimeFn(quiz.completedAt)}</span>
          <span>•</span>
          <span>{t.history_quiz_duration}: {formatDuration(quiz.durationSeconds)}</span>
          <span>•</span>
          <span className="font-medium text-foreground">
            {t.history_quiz_score
              .replace('{correct}', String(quiz.correctCount))
              .replace('{total}', String(quiz.questionsTotal))}
          </span>
        </div>
      </div>

      {quiz.questions.map((q, index) => (
        <div key={q.questionId} className="rounded-lg border p-4 shadow-sm">
          <div className="flex items-start gap-2">
            {q.correct ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium leading-relaxed text-foreground">
                {index + 1}. {q.question ?? t.history_quiz_question_unavailable}
              </p>
              <div className="space-y-1 text-xs">
                <p className={cn(q.correct ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                  {t.history_quiz_your_answer}: {q.answered ?? t.history_quiz_unanswered}
                </p>
                {!q.correct && q.correctAnswer && (
                  <p className="text-muted-foreground">
                    {t.history_quiz_correct_answer}: {q.correctAnswer}
                  </p>
                )}
                {q.explanation && (
                  <p className="text-muted-foreground">
                    {t.history_quiz_explanation}: {q.explanation}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ContentParser({ text, t }: { text: string; t: DashboardTranslations }) {
  if (!text) {
    return <p className="text-sm text-muted-foreground">{t.history_no_content}</p>
  }

  const combinedRegex = /(!?\[[\s\S]*?\]\([\s\S]*?\))|(https?:\/\/[^\s]+)|(\*\*[\s\S]*?\*\*)/g
  const segments = text.split(combinedRegex).filter(Boolean)

  if (segments.length === 0) {
    return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
  }

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {segments.map((segment, index) => {
        const markdownMatch = segment.match(/^(!?)\[([\s\S]*?)\]\(([\s\S]*?)\)$/)
        if (markdownMatch) {
          const isImage = markdownMatch[1] === '!'
          const alt = markdownMatch[2]
          const url = markdownMatch[3]
          const isImageUrl = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url.split('?')[0])
          const wantsImage = isImage || isImageUrl
          const safeUrl = toSafeUrl(url, wantsImage ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS)

          if (!safeUrl) {
            return (
              <p key={index} className="whitespace-pre-wrap break-words">
                {segment}
              </p>
            )
          }

          if (wantsImage) {
            return (
              <div key={index} className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={safeUrl}
                  alt={alt}
                  className="max-h-80 max-w-full rounded-md object-contain"
                />
              </div>
            )
          }

          return (
            <a
              key={index}
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words text-primary underline"
            >
              {alt || url}
            </a>
          )
        }

        const boldMatch = segment.match(/^\*\*([\s\S]*?)\*\*$/)
        if (boldMatch) {
          return (
            <strong key={index} className="font-semibold">
              {boldMatch[1]}
            </strong>
          )
        }

        const bareUrl = /^https?:\/\/[^\s<]+$/.test(segment) ? toSafeUrl(segment, SAFE_LINK_PROTOCOLS) : null
        if (bareUrl) {
          return (
            <a
              key={index}
              href={bareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words text-primary underline"
            >
              {segment}
            </a>
          )
        }

        const processedText = segment.split(/(\*\*[\s\S]*?\*\*)/).map((part, partIndex) => {
          const inlineBoldMatch = part.match(/^\*\*([\s\S]*?)\*\*$/)
          if (inlineBoldMatch) {
            return (
              <strong key={partIndex} className="font-semibold">
                {inlineBoldMatch[1]}
              </strong>
            )
          }
          return part
        })

        const lines = String(processedText).split('\n')
        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {processedText}
          </p>
        )
      })}
    </div>
  )
}

export default function HistoryPage() {
  const { currentLanguage } = useLanguage()
  const t = getTranslations(currentLanguage)
  const searchParams = useSearchParams()
  const urlConversationId = searchParams.get('conversationId')
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [pageInfo, setPageInfo] = useState<PageInfo>({
    currentPage: 1,
    totalPages: 1,
    limit: Number(DEFAULT_ROWS),
    totalItems: 0,
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS)
  const [pageGroup, setPageGroup] = useState(0)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [conversationsError, setConversationsError] = useState<keyof DashboardTranslations | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [quizDetail, setQuizDetail] = useState<QuizDetail | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messagesError, setMessagesError] = useState<keyof DashboardTranslations | null>(null)
  const [userTimeFormat, setUserTimeFormat] = useState<string>('DD.MM.YYYY HH:mm')
  const [userTimezone, setUserTimezone] = useState<string>('UTC')
  const [locationCache, setLocationCache] = useState<LocationCache>({})
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [agentTitle, setAgentTitle] = useState<string>('')
  const [sourceTab, setSourceTab] = useState<'all' | 'text' | 'voice' | 'quiz'>('all')

  const selectedConversationRef = useRef<string | null>(null)

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId
  }, [selectedConversationId])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storedRows = window.localStorage.getItem(STORAGE_KEY_ROWS)
    if (storedRows) {
      const parsedRows = Number.parseInt(storedRows, 10)
      if (!Number.isNaN(parsedRows) && parsedRows > 0 && parsedRows <= MAX_LIMIT) {
        setRowsPerPage(storedRows)
        setCurrentPage(1)
      }
    }

    window.localStorage.removeItem('locationCache')

    const storedAgentId = window.localStorage.getItem('activeAgentId')
    if (storedAgentId) {
      setActiveAgentId(storedAgentId)
      loadAgentTitle(storedAgentId)
    }

    loadUserSettings()
  }, [])

  const loadAgentTitle = async (agentId: string) => {
    try {
      const response = await fetch('/api/agents')
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.agents) {
          const agent = data.agents.find((a: any) => a.agentId === agentId)
          if (agent) {
            setAgentTitle(agent.title || '')
          }
        }
      }
    } catch (error) {
      console.error('Failed to load agent title:', error)
    }
  }

  const loadUserSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.settings) {
          setUserTimeFormat(data.settings.time_format || 'DD.MM.YYYY HH:mm')
          setUserTimezone(data.settings.timezone || 'UTC')
        }
      }
    } catch (error) {
    }
  }

  const loadLocationInfo = async (conversations: ConversationListItem[]) => {
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

    const ipv6Addresses = [
      '2a02:121e:7cd7:0:29fc:1c9e:2661:b1ae',
      '2a02:121e:7cd7:0:70a9:7f61:6eb3:7ea0',
      '2a02:1210:8210:3600:bd2c:673f:df0f:8b10'
    ]

    const uncachedIPs = uniqueIPs.filter(ip => {
      const cached = locationCache[ip]
      if (ipv6Addresses.includes(ip)) {
        return true
      }
      return !cached
    })

    if (uncachedIPs.length === 0) {
      return
    }

    try {
      const response = await fetch('/api/location', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
      } else {
      }
    } catch (error) {
    }
  }

  const fetchMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true)
    setMessagesError(null)
    setMessages([])
    setQuizDetail(null)

    try {
      const response = await fetch(`/api/history/messages?conversationId=${encodeURIComponent(conversationId)}`)
      if (!response.ok) {
        throw new Error(t.history_error_fetch_messages)
      }

      const data = await response.json()
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      setQuizDetail(data.quiz ?? null)
    } catch (error) {
      setMessagesError('history_error_load_messages')
      setMessages([])
      setQuizDetail(null)
    } finally {
      setLoadingMessages(false)
    }
  }, [t])

  const selectConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId)
    fetchMessages(conversationId)
  }, [fetchMessages])

  const fetchConversations = useCallback(async (page: number, limit: number, agentId?: string, source?: 'all' | 'text' | 'voice' | 'quiz') => {
    setLoadingConversations(true)
    setConversationsError(null)

    const safeLimit = Math.max(1, Math.min(limit, MAX_LIMIT))
    const params = new URLSearchParams({
      page: String(page),
      limit: String(safeLimit)
    })

    if (agentId) {
      params.append('agentId', agentId)
    }
    if (source && source !== 'all') {
      params.append('source', source)
    }

    try {
      const response = await fetch(`/api/history/conversations?${params}`)
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(t.history_error_fetch_conversations)
        }
        throw new Error(t.history_error_fetch_conversations)
      }

      const data = await response.json()

      if (data.success && Array.isArray(data.conversations) && data.conversations.length === 0) {
      }

      const receivedPageInfo: PageInfo = {
        currentPage: data.pageInfo?.currentPage ?? page,
        totalPages: Math.max(1, data.pageInfo?.totalPages ?? 1),
        limit: data.pageInfo?.limit ?? safeLimit,
        totalItems: data.pageInfo?.totalItems ?? (Array.isArray(data.conversations) ? data.conversations.length : 0),
      }

      if (page > receivedPageInfo.totalPages && receivedPageInfo.totalPages > 0) {
        setCurrentPage(receivedPageInfo.totalPages)
        return
      }

      const conversationList: ConversationListItem[] = Array.isArray(data.conversations)
        ? data.conversations.map((conversation: any) => ({
            ...conversation,
            userQuestion: conversation.userQuestion === 'No question available.'
              ? t.history_no_question_available
              : conversation.userQuestion === 'Error decrypting content.'
              ? t.history_error_decrypting_content
              : conversation.userQuestion
          }))
        : []

      setConversations(conversationList)
      setPageInfo(receivedPageInfo)
      setCurrentPage(receivedPageInfo.currentPage)

      if (conversationList.length > 0) {
        loadLocationInfo(conversationList)
      }

      if (conversationList.length === 0) {
        setSelectedConversationId(null)
        selectedConversationRef.current = null
        setMessages([])
        setQuizDetail(null)
        return
      }

      const currentSelected = selectedConversationRef.current
      const availableIds = new Set(conversationList.map((item) => item.conversationId))

      if (urlConversationId && availableIds.has(urlConversationId)) {
        selectConversation(urlConversationId)
      } else if (!currentSelected || !availableIds.has(currentSelected)) {
        selectConversation(conversationList[0].conversationId)
      }
    } catch (error) {

      if (error instanceof Error && error.message.includes('fetch')) {
        setConversationsError('history_error_load_conversations')
      } else {
      }

      setConversations([])
      setPageInfo((prev) => ({
        currentPage: 1,
        totalPages: 1,
        limit: prev.limit,
        totalItems: 0,
      }))
      setSelectedConversationId(null)
      selectedConversationRef.current = null
      setMessages([])
      setQuizDetail(null)
    } finally {
      setLoadingConversations(false)
    }
  }, [selectConversation, t, urlConversationId])

  useEffect(() => {
    if (!activeAgentId) return

    const limit = Number.parseInt(rowsPerPage, 10)
    fetchConversations(currentPage, Number.isNaN(limit) ? Number(DEFAULT_ROWS) : limit, activeAgentId, sourceTab)
  }, [currentPage, rowsPerPage, activeAgentId, sourceTab, fetchConversations])

  useEffect(() => {
    setPageGroup(Math.floor((currentPage - 1) / PAGE_GROUP_SIZE))
  }, [currentPage])

  const handleRowsPerPageChange = (value: string) => {
    setRowsPerPage(value)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY_ROWS, value)
    }
    setCurrentPage(1)
  }

  const handlePageChange = (page: number) => {
    if (page !== currentPage) {
      setCurrentPage(page)
    }
  }

  const handlePageGroupChange = (direction: 'previous' | 'next') => {
    const newGroup = direction === 'next' ? pageGroup + 1 : pageGroup - 1
    const firstPageInGroup = newGroup * PAGE_GROUP_SIZE + 1

    if (firstPageInGroup <= 0 || firstPageInGroup > pageInfo.totalPages) {
      return
    }

    setPageGroup(newGroup)
    setCurrentPage(firstPageInGroup)
  }

  const renderPageButtons = () => {
    if (pageInfo.totalPages <= 1) {
      return null
    }

    const startPage = pageGroup * PAGE_GROUP_SIZE + 1
    const endPage = Math.min(startPage + PAGE_GROUP_SIZE - 1, pageInfo.totalPages)
    const buttons = []

    for (let page = startPage; page <= endPage; page += 1) {
      buttons.push(
        <Button
          key={page}
          size="sm"
          variant={page === currentPage ? 'default' : 'outline'}
          onClick={() => handlePageChange(page)}
        >
          {page}
        </Button>
      )
    }

    return buttons
  }

  const rangeStart = conversations.length === 0
    ? 0
    : (pageInfo.currentPage - 1) * pageInfo.limit + 1
  const rangeEnd = conversations.length === 0
    ? 0
    : (pageInfo.currentPage - 1) * pageInfo.limit + conversations.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t.history_title}</h1>
        {agentTitle && (
          <p className="text-sm text-muted-foreground mt-1">
            {t.chat_settings_ai_assistant_label} <span className="font-medium text-foreground">{agentTitle}</span>
          </p>
        )}
      </div>

      <Tabs value={sourceTab} onValueChange={(v) => { setSourceTab(v as 'all' | 'text' | 'voice' | 'quiz'); setCurrentPage(1) }}>
        <TabsList>
          <TabsTrigger value="all">{t.history_tab_all}</TabsTrigger>
          <TabsTrigger value="text">{t.history_tab_text}</TabsTrigger>
          <TabsTrigger value="voice">{t.history_tab_voice}</TabsTrigger>
          <TabsTrigger value="quiz">{t.history_tab_quiz}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-full">
          <CardHeader className="flex justify-between gap-4">
            <CardTitle className="sr-only">{t.history_conversation_list}</CardTitle>
            <div className="ml-auto w-40">
              <Select value={rowsPerPage} onValueChange={handleRowsPerPageChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t.history_per_page} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5" className="md:hidden">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="50" className="hidden md:block">50</SelectItem>
                  <SelectItem value="100" className="hidden md:block">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {conversationsError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{conversationsError ? t[conversationsError] : null}</span>
              </div>
            )}

            {loadingConversations ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length > 0 ? (
              <div className="space-y-3">
                {conversations.map((conversation, index) => {
                  const isSelected = conversation.conversationId === selectedConversationId
                  const isVoice = conversation.source === 'voice-pstn' || conversation.source === 'voice-web' || conversation.source === 'voice-web-test'
                  const isPstn = conversation.source === 'voice-pstn'
                  const isTestCall = conversation.source === 'voice-web-test'
                  const isQuiz = conversation.source === 'quiz'
                  const preview = conversation.userQuestion?.trim() ||
                    (isVoice ? t.history_voice_no_preview : t.history_untitled_conversation)
                  const truncatedQuestion = preview.length > 50
                    ? preview.substring(0, 50) + '...'
                    : preview

                  const listNumber = conversations.length - index

                  return (
                    <button
                      key={`${conversation.conversationId}-${conversation.no}-${index}`}
                      type="button"
                      onClick={() => selectConversation(conversation.conversationId)}
                      className={cn(
                        'w-full text-left',
                        'rounded-lg border px-4 py-3 transition-colors',
                        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2">
                            {isVoice && (
                              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {isPstn ? <Phone className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                                {isPstn ? t.history_source_pstn : t.history_source_web}
                              </span>
                            )}
                            {isQuiz && (
                              <span className="inline-flex items-center gap-1 rounded bg-violet-100 dark:bg-violet-900/30 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:text-violet-300">
                                <BookOpen className="h-3 w-3" />
                                {t.history_source_quiz}
                              </span>
                            )}
                            {isTestCall && (
                              <span className="inline-flex items-center rounded bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">
                                {t.history_voice_test_badge}
                              </span>
                            )}
                            {conversation.voiceMeta?.language && (
                              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {conversation.voiceMeta.language}
                              </span>
                            )}
                          </div>
                          <p className="font-medium leading-tight text-foreground">
                            {truncatedQuestion}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatDateTime(conversation.createdAt, userTimeFormat, userTimezone)}</span>
                            {isVoice && conversation.voiceMeta?.duration !== null && conversation.voiceMeta?.duration !== undefined && (
                              <>
                                <span>•</span>
                                <span>{t.history_voice_duration}: {formatDuration(conversation.voiceMeta.duration)}</span>
                              </>
                            )}
                            {isQuiz && conversation.quizMeta && (
                              <>
                                <span>•</span>
                                <span>{conversation.quizMeta.memberDisplayName}</span>
                                <span>•</span>
                                <span>{t.history_quiz_duration}: {formatDuration(conversation.quizMeta.durationSeconds)}</span>
                                <span>•</span>
                                <span>
                                  {t.history_quiz_score
                                    .replace('{correct}', String(conversation.quizMeta.correctCount))
                                    .replace('{total}', String(conversation.quizMeta.questionsTotal))}
                                </span>
                              </>
                            )}
                            {isPstn && conversation.voiceMeta?.callerNumber && (
                              <>
                                <span>•</span>
                                <span>{t.history_voice_caller}: {conversation.voiceMeta.callerNumber}</span>
                              </>
                            )}
                            {!isPstn && isVoice && conversation.voiceMeta?.userIp && (
                              <>
                                <span>•</span>
                                <span>{t.history_voice_ip}: {conversation.voiceMeta.userIp}</span>
                              </>
                            )}
                            {!isVoice && !isQuiz && conversation.clientId && (
                              <>
                                <span>•</span>
                                <span>{t.history_client_label}: {conversation.clientId.slice(0, 8)}...</span>
                              </>
                            )}
                            {getLocationDisplay(conversation.userIP, locationCache) && (
                              <>
                                <span>•</span>
                                <span>{getLocationDisplay(conversation.userIP, locationCache)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">#{listNumber}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">{t.history_no_conversations}</p>
              </div>
            )}

            <div className="flex flex-col items-center gap-3 border-t pt-4 text-sm text-muted-foreground">
              <p>
                {t.history_showing_results
                  ? t.history_showing_results
                      .replace('{start}', rangeStart.toString())
                      .replace('{end}', rangeEnd.toString())
                      .replace('{total}', pageInfo.totalItems.toString())
                  : `${rangeStart} - ${rangeEnd} / ${pageInfo.totalItems}`}
              </p>
              {pageInfo.totalPages > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  {pageGroup > 0 && (
                    <Button variant="outline" size="sm" onClick={() => handlePageGroupChange('previous')}>
                      {t.history_previous}
                    </Button>
                  )}
                  {renderPageButtons()}
                  {(pageGroup + 1) * PAGE_GROUP_SIZE < pageInfo.totalPages && (
                    <Button variant="outline" size="sm" onClick={() => handlePageGroupChange('next')}>
                      {t.history_next}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t.history_conversation_details}</CardTitle>
            {(() => {
              const selected = conversations.find((c) => c.conversationId === selectedConversationId)
              if (!selected) return null
              const isVoice = selected.source === 'voice-pstn' || selected.source === 'voice-web' || selected.source === 'voice-web-test'
              const isPstn = selected.source === 'voice-pstn'
              if (!isVoice) return null
              const callerNumber = selected.voiceMeta?.callerNumber
              const userIp = selected.voiceMeta?.userIp
              if (isPstn && !callerNumber) return null
              if (!isPstn && !userIp) return null
              return (
                <p className="text-xs text-muted-foreground">
                  {isPstn
                    ? `${t.history_voice_caller}: ${callerNumber}`
                    : `${t.history_voice_ip}: ${userIp}`}
                </p>
              )
            })()}
          </CardHeader>
          <CardContent className="space-y-4">
            {messagesError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{messagesError ? t[messagesError] : null}</span>
              </div>
            )}

            {loadingMessages ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : quizDetail ? (
              <QuizResultDetail
                quiz={quizDetail}
                t={t}
                formatDateTimeFn={(value) => formatDateTime(value, userTimeFormat, userTimezone)}
              />
            ) : messages.length > 0 ? (
              <div className="space-y-4">
                {messages.map((message, index) => {
                  if (message.boundary && !message.content) {
                    return (
                      <div
                        key={`boundary-${index}-${message.createdAt}`}
                        className="flex items-center gap-3 py-2 text-xs text-muted-foreground"
                      >
                        <div className="h-px flex-1 bg-border" />
                        <span className="whitespace-nowrap">
                          {t.history_voice_boundary}: {formatDateTime(message.createdAt, userTimeFormat, userTimezone)}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )
                  }

                  return (
                    <div key={`${message.role}-${index}-${message.createdAt}`}>
                      {message.boundary && (
                        <div className="mb-3 flex items-center gap-3 py-2 text-xs text-muted-foreground">
                          <div className="h-px flex-1 bg-border" />
                          <span className="whitespace-nowrap">
                            {t.history_voice_boundary}: {formatDateTime(message.createdAt, userTimeFormat, userTimezone)}
                          </span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <div
                        className={cn(
                          'rounded-lg border p-4 shadow-sm transition-colors',
                          message.role === 'user'
                            ? 'bg-muted/70 ml-[10%]'
                            : 'bg-card mr-[10%]'
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold capitalize text-foreground">{message.role}</span>
                            {message.lang && (
                              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {message.lang}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt, userTimeFormat, userTimezone)}</span>
                        </div>
                        <div className="mt-2 text-sm text-foreground">
                          {message.role === 'assistant' ? (
                            <ContentParser text={message.content} t={t} />
                          ) : (
                            <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
                          )}
                        </div>
                        {message.role === 'user' && message.inputTokens !== null && (
                          <p className="mt-3 text-xs text-muted-foreground">
                            {t.history_tokens_in} {formatNumber(message.inputTokens)}
                          </p>
                        )}
                        {message.role === 'assistant' && message.outputTokens !== null && (
                          <p className="mt-3 text-xs text-muted-foreground">
                            {t.history_tokens_out} {formatNumber(message.outputTokens)}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : selectedConversationId ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">{t.history_no_messages}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">{t.history_select_conversation}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
