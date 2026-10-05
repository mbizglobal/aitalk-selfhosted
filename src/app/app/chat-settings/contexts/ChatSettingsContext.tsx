'use client'

import { createContext, useContext, ReactNode } from 'react'
import type { WidgetSettings } from '@/lib/widget-settings'
import type { EditableField, TranslationFn } from '../types'

interface ChatSettingsContextValue {
  // Settings state
  settings: WidgetSettings
  initialSettings: WidgetSettings
  loading: boolean
  saving: boolean
  isDirty: boolean

  // Agent info
  agentId: string
  agentTitle: string
  userPlan: string
  planLoading: boolean

  // Tab state
  activeTab: string
  handleTabChange: (tab: string) => void

  // Settings handlers
  handleUpdate: (path: string, value: unknown) => void
  handleSave: () => Promise<void>
  handleReset: () => void
  handleDiscard: () => void

  // Multi-language modal
  openMultiLangModal: (field: EditableField) => void

  // Translations
  t: TranslationFn
  currentLanguage: string
}

const ChatSettingsContext = createContext<ChatSettingsContextValue | null>(null)

export function ChatSettingsProvider({
  children,
  value,
}: {
  children: ReactNode
  value: ChatSettingsContextValue
}) {
  return (
    <ChatSettingsContext.Provider value={value}>
      {children}
    </ChatSettingsContext.Provider>
  )
}

export function useChatSettings() {
  const context = useContext(ChatSettingsContext)
  if (!context) {
    throw new Error('useChatSettings must be used within ChatSettingsProvider')
  }
  return context
}
