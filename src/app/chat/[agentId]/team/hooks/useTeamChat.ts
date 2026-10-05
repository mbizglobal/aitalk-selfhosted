import { useState, useCallback, useEffect, useRef } from 'react'
import type { Message, UploadedFile } from '../types'

interface UseTeamChatProps {
  agentId: string
  workflowId: string | null
  sessionId: string
  token: string | null
  conversationId: string | null
  onAuthError?: () => void
  onSaveMessage?: (message: Message, conversationId: string) => Promise<void>
}

export const useTeamChat = ({
  agentId,
  workflowId,
  sessionId,
  token,
  conversationId,
  onAuthError,
  onSaveMessage
}: UseTeamChatProps) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [lastResponseId, setLastResponseId] = useState<string | null>(null)
  const [summaryByConversation, setSummaryByConversation] = useState<
    Record<string, {
      summary: string
      coveredCount: number
      boundaryMessageId: string | null
    }>
  >({})
  const sendingRef = useRef(false)
  const inflightRef = useRef<{ conversationId: string | null; controller: AbortController } | null>(null)

  useEffect(() => {
    const inflight = inflightRef.current
    if (inflight && inflight.conversationId !== conversationId) {
      inflight.controller.abort()
      inflightRef.current = null
      setStreamingContent('')
      setIsLoading(false)
      sendingRef.current = false
    }
    setLastResponseId(null)
  }, [conversationId])

  const clearSummaryFor = useCallback((conversationId: string) => {
    setSummaryByConversation(prev => {
      if (!(conversationId in prev)) return prev
      const next = { ...prev }
      delete next[conversationId]
      return next
    })
  }, [])

  const coverAllFor = useCallback((conversationId: string, billableCount: number, boundaryId: string | null) => {
    setSummaryByConversation(prev => ({
      ...prev,
      [conversationId]: { summary: '', coveredCount: billableCount, boundaryMessageId: boundaryId },
    }))
  }, [])

  const reconcileSummaryOnLoad = useCallback((conversationId: string, loadedMessages: Message[]) => {
    setSummaryByConversation(prev => {
      const entry = prev[conversationId]
      if (!entry) return prev
      const billable = loadedMessages.filter(
        m => (m.role === 'user' || m.role === 'assistant') && !m.id.startsWith('welcome')
      )
      const discard = (reason: string) => {
        console.warn(`[TeamChat] summary boundary discarded — ${reason}`)
        const next = { ...prev }
        delete next[conversationId]
        return next
      }
      if (billable.length < entry.coveredCount) {
        return discard(`loaded ${billable.length} billable < covered ${entry.coveredCount}`)
      }
      if (entry.boundaryMessageId && entry.coveredCount > 0) {
        const loadedBoundaryId = billable[entry.coveredCount - 1]?.id
        if (loadedBoundaryId !== entry.boundaryMessageId) {
          return discard(
            `boundary id mismatch at ${entry.coveredCount} (expected ${entry.boundaryMessageId}, got ${loadedBoundaryId})`
          )
        }
      }
      return prev
    })
  }, [])

  const sendMessage = useCallback(async (
    input: string,
    uploadedFiles: UploadedFile[],
    overrideConversationId?: string
  ) => {
    if ((!input.trim() && uploadedFiles.length === 0) || isLoading || sendingRef.current) return
    sendingRef.current = true

    const activeConversationId = overrideConversationId || conversationId

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
      attachments: uploadedFiles.map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        previewUrl: f.previewUrl
      }))
    }

    setMessages(prev => [...prev, userMessage])

    const controller = new AbortController()
    inflightRef.current = { conversationId: activeConversationId, controller }
    const isStale = () => inflightRef.current?.controller !== controller

    if (onSaveMessage && activeConversationId) {
      try {
        await onSaveMessage(userMessage, activeConversationId)
      } catch (e) {
        console.warn('[TeamChat] failed to persist user message:', (e as Error)?.message)
      }
    }
    if (isStale()) {
      if (inflightRef.current?.controller === controller) sendingRef.current = false
      return
    }

    setIsLoading(true)
    setStreamingContent('')

    try {
      const apiUrl = workflowId
        ? `/api/chat?workflowId=${encodeURIComponent(workflowId)}`
        : '/api/chat'

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const billableMessages = messages
        .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.id.startsWith('welcome'))
      const billableHistory = billableMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))

      const activeSummary = activeConversationId
        ? summaryByConversation[activeConversationId] || null
        : null
      const conversationHistory = billableHistory.slice(activeSummary?.coveredCount || 0)

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          message: userMessage.content,
          agentId,
          source: 'team',
          uploadedFiles,
          clientId: sessionId,
          summaryProtocol: 1,
          conversationHistory,
          conversationSummary: activeSummary?.summary || undefined,
          previousResponseId: lastResponseId || undefined,
        }),
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          onAuthError?.()
          return
        }

        const errorData = await response.json().catch(() => null)
        console.warn('[Chat API] Error response:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        })

        if (isStale()) return
        if (errorData?.code === 'HISTORY_TOO_LARGE' && activeConversationId) {
          coverAllFor(
            activeConversationId,
            billableMessages.length,
            billableMessages[billableMessages.length - 1]?.id ?? null
          )
        }
        const errorText = errorData?.error || `서버 오류 (${response.status})`
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'error',
          content: errorText,
          timestamp: new Date()
        }
        setMessages(prev => [...prev, errorMessage])
        return
      }

      if (!response.body) {
        throw new Error('응답 본문이 없습니다')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedContent = ''

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
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            if (isStale()) continue
            if (parsed.content) {
              accumulatedContent += parsed.content
              setStreamingContent(accumulatedContent)
            }
            if (parsed.type === 'summary-update' && activeConversationId) {
              setSummaryByConversation(prev => {
                const nextCovered =
                  (prev[activeConversationId]?.coveredCount || 0) + (parsed.foldedCount || 0)
                return {
                  ...prev,
                  [activeConversationId]: {
                    summary: parsed.summary,
                    coveredCount: nextCovered,
                    boundaryMessageId: billableMessages[nextCovered - 1]?.id ?? null,
                  },
                }
              })
            }
            if (parsed.responseId) {
              setLastResponseId(parsed.responseId)
            }
          } catch (e) {
          }
        }
      }

      if (accumulatedContent) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: accumulatedContent,
          timestamp: new Date()
        }
        if (!isStale()) {
          setMessages(prev => [...prev, assistantMessage])
        }

        if (onSaveMessage && activeConversationId) {
          try {
            await onSaveMessage(assistantMessage, activeConversationId)
          } catch (e) {
            console.warn('[TeamChat] failed to persist assistant message:', (e as Error)?.message)
          }
        }
      }

      if (!isStale()) setStreamingContent('')
    } catch (error) {
      //
      if ((error as any)?.name === 'AbortError' || isStale()) {
        return
      }
      console.error('Error:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'error',
        content: '오류가 발생했습니다. 다시 시도해주세요.',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
      setStreamingContent('')
    } finally {
      if (inflightRef.current?.controller === controller) {
        setIsLoading(false)
        inflightRef.current = null
        sendingRef.current = false
      }
    }
  }, [agentId, workflowId, sessionId, token, conversationId, onAuthError, onSaveMessage, isLoading, messages, lastResponseId, summaryByConversation, clearSummaryFor, coverAllFor])

  const startNewConversation = useCallback(() => {
    setMessages([{
      id: 'welcome-new',
      role: 'assistant',
      content: '무엇을 도와드릴까요?',
      timestamp: new Date()
    }])
    setStreamingContent('')
    setLastResponseId(null)
  }, [])

  return {
    messages,
    isLoading,
    streamingContent,
    sendMessage,
    startNewConversation,
    clearSummaryFor,
    reconcileSummaryOnLoad,
    setMessages
  }
}
