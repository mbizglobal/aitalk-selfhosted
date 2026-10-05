import { useState, useRef, useCallback, useEffect } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import type { ConversationItem, UploadedFile } from '../types'

interface UseTeamUIStateReturn {
  // Mobile detection
  isMobile: boolean

  // Sidebar state
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  userMenuOpen: boolean
  setUserMenuOpen: (open: boolean) => void
  conversations: ConversationItem[]
  setConversations: (conversations: ConversationItem[]) => void

  // Input state
  input: string
  setInput: (input: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  autoResize: () => void
  focusInput: () => void

  // File handlers
  handleRemovePdf: (fileName: string, setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>) => void
}

export const useTeamUIState = (): UseTeamUIStateReturn => {
  // Mobile detection
  const isMobile = useIsMobile()

  const [sidebarInitialized, setSidebarInitialized] = useState(false)

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [conversations, setConversations] = useState<ConversationItem[]>([])

  useEffect(() => {
    if (!sidebarInitialized && typeof window !== 'undefined') {
      const isDesktop = window.innerWidth >= 768
      if (isDesktop) {
        setSidebarOpen(true)
      }
      setSidebarInitialized(true)
    }
  }, [sidebarInitialized])

  // Input state
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto resize textarea
  const autoResize = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '0'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [])

  // Focus input
  const focusInput = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  const handleRemovePdf = useCallback((
    fileName: string,
    setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>
  ) => {
    setUploadedFiles(prev =>
      prev.filter(f => !f.name.startsWith(fileName))
    )
  }, [])

  return {
    // Mobile
    isMobile,

    // Sidebar
    sidebarOpen,
    setSidebarOpen,
    userMenuOpen,
    setUserMenuOpen,
    conversations,
    setConversations,

    // Input
    input,
    setInput,
    textareaRef,
    autoResize,
    focusInput,

    // File handlers
    handleRemovePdf
  }
}
