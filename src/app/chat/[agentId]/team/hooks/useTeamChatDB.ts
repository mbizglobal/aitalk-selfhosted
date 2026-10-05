'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Dexie, { Table } from 'dexie'
import type { Message } from '../types'

export interface StoredConversation {
  id: string
  agentId: string
  memberId: string
  workflowId?: string
  title: string
  createdAt: Date
  updatedAt: Date
}

export interface StoredMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'error' | 'system'
  content: string
  timestamp: Date
  attachments?: Array<{
    id: string
    name: string
    type: 'image' | 'pdf' | 'csv'
    previewUrl?: string
  }>
}

class TeamChatDB extends Dexie {
  conversations!: Table<StoredConversation>
  messages!: Table<StoredMessage>

  constructor() {
    super('TeamChatDB')
    this.version(1).stores({
      conversations: 'id, agentId, memberId, updatedAt',
      messages: 'id, conversationId, timestamp'
    })
  }
}

let db: TeamChatDB | null = null

function getDB(): TeamChatDB {
  if (!db) {
    db = new TeamChatDB()
  }
  return db
}

export function isSafari(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  return /Safari/.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua)
}

export function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream
}

export function isPWA(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches ||
         (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

interface UseTeamChatDBProps {
  agentId: string
  memberId: string
  workflowId: string | null
  workflowReady: boolean
}

export const useTeamChatDB = ({ agentId, memberId, workflowId, workflowReady }: UseTeamChatDBProps) => {
  const ownerKey = `${agentId}\u0000${memberId}`
  const [loaded, setLoaded] = useState<{ key: string | null; convs: StoredConversation[] }>({ key: null, convs: [] })
  const allConversations = useMemo(() => (loaded.key === ownerKey ? loaded.convs : []), [loaded, ownerKey])
  const isLoading = loaded.key !== ownerKey
  const setAllConversations = useCallback((update: (prev: StoredConversation[]) => StoredConversation[]) => {
    setLoaded(prev => (prev.key === ownerKey ? { key: prev.key, convs: update(prev.convs) } : prev))
  }, [ownerKey])
  const [selectedConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [showSafariWarning, setShowSafariWarning] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const shouldWarn = (isSafari() || isIOS()) && !isPWA()

    const warningDismissed = localStorage.getItem('teamchat_safari_warning_dismissed')

    if (shouldWarn && !warningDismissed) {
      setShowSafariWarning(true)
    }
  }, [])

  const dismissSafariWarning = useCallback(() => {
    setShowSafariWarning(false)
    localStorage.setItem('teamchat_safari_warning_dismissed', 'true')
  }, [])

  useEffect(() => {
    if (!agentId || !memberId) return
    let cancelled = false
    const key = ownerKey
    ;(async () => {
      let convs: StoredConversation[] = []
      try {
        const db = getDB()
        convs = await db.conversations
          .where({ agentId, memberId })
          .reverse()
          .sortBy('updatedAt')
      } catch (error) {
        console.error('Failed to load conversations:', error)
      }
      if (!cancelled) setLoaded({ key, convs })
    })()
    return () => { cancelled = true }
  }, [agentId, memberId, ownerKey])

  const conversations = useMemo(
    () => (workflowReady && workflowId ? allConversations.filter(conv => conv.workflowId === workflowId) : []),
    [allConversations, workflowId, workflowReady]
  )

  const currentConversationId = useMemo(() => {
    if (!selectedConversationId || !workflowReady || !workflowId) return null
    const open = allConversations.find(conv => conv.id === selectedConversationId)
    return open && open.workflowId === workflowId ? selectedConversationId : null
  }, [selectedConversationId, allConversations, workflowId, workflowReady])

  useEffect(() => {
    if (!selectedConversationId || !workflowReady || currentConversationId) return
    const stale = selectedConversationId
    setCurrentConversationId(prev => (prev === stale ? null : prev))
  }, [selectedConversationId, currentConversationId, workflowReady])

  const autoSelectedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (autoSelectedForRef.current === ownerKey || isLoading || !workflowReady || !workflowId) return
    autoSelectedForRef.current = ownerKey
    if (conversations.length > 0) setCurrentConversationId(conversations[0].id)
  }, [ownerKey, isLoading, workflowReady, workflowId, conversations])

  const createConversation = useCallback(async (title?: string): Promise<string> => {
    const db = getDB()
    const id = `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const now = new Date()

    const conversation: StoredConversation = {
      id,
      agentId,
      memberId,
      ...(workflowId ? { workflowId } : {}),
      title: title || '새 대화',
      createdAt: now,
      updatedAt: now
    }

    await db.conversations.add(conversation)
    setAllConversations(prev => [conversation, ...prev])
    setCurrentConversationId(id)

    return id
  }, [agentId, memberId, workflowId, setAllConversations])

  const updateConversationTitle = useCallback(async (conversationId: string, title: string) => {
    const db = getDB()
    await db.conversations.update(conversationId, {
      title,
      updatedAt: new Date()
    })

    setAllConversations(prev => prev.map(conv =>
      conv.id === conversationId
        ? { ...conv, title, updatedAt: new Date() }
        : conv
    ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
  }, [setAllConversations])

  const deleteConversation = useCallback(async (conversationId: string) => {
    const db = getDB()

    await db.messages.where({ conversationId }).delete()
    await db.conversations.delete(conversationId)

    setAllConversations(prev => prev.filter(conv => conv.id !== conversationId))

    setCurrentConversationId(prev => (prev === conversationId ? null : prev))
  }, [setAllConversations])

  const selectConversation = useCallback((conversationId: string | null) => {
    setCurrentConversationId(conversationId)
  }, [])

  const loadMessages = useCallback(async (conversationId: string): Promise<Message[]> => {
    const db = getDB()
    const storedMessages = await db.messages
      .where({ conversationId })
      .sortBy('timestamp')

    return storedMessages.map(msg => ({
      ...msg,
      timestamp: new Date(msg.timestamp)
    }))
  }, [])

  const saveMessage = useCallback(async (conversationId: string, message: Message) => {
    const db = getDB()

    const storedMessage: StoredMessage = {
      id: message.id,
      conversationId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      attachments: message.attachments
    }

    await db.messages.put(storedMessage)

    if (message.role === 'user') {
      const conv = await db.conversations.get(conversationId)
      if (conv && conv.title === '새 대화') {
        const title = message.content.substring(0, 30) + (message.content.length > 30 ? '...' : '')
        await updateConversationTitle(conversationId, title)
      } else {
        await db.conversations.update(conversationId, { updatedAt: new Date() })
      }
    }
  }, [updateConversationTitle])

  const saveMessages = useCallback(async (conversationId: string, messages: Message[]) => {
    const db = getDB()

    const storedMessages: StoredMessage[] = messages.map(msg => ({
      id: msg.id,
      conversationId,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      attachments: msg.attachments
    }))

    await db.messages.bulkPut(storedMessages)
    await db.conversations.update(conversationId, { updatedAt: new Date() })
  }, [])

  const clearAllConversations = useCallback(async () => {
    const db = getDB()

    const convIds = (await db.conversations.where({ agentId, memberId }).toArray()).map(conv => conv.id)

    for (const convId of convIds) {
      await db.messages.where({ conversationId: convId }).delete()
    }

    await db.conversations.where({ agentId, memberId }).delete()

    setAllConversations(() => [])
    setCurrentConversationId(null)
  }, [agentId, memberId, setAllConversations])

  return {
    conversations,
    currentConversationId,
    isLoading,
    createConversation,
    updateConversationTitle,
    deleteConversation,
    selectConversation,
    clearAllConversations,

    loadMessages,
    saveMessage,
    saveMessages,

    showSafariWarning,
    dismissSafariWarning,
    isSafariBrowser: useMemo(() => isSafari() || isIOS(), [])
  }
}
