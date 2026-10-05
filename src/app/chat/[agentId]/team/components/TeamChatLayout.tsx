'use client'

import React, { useEffect, useCallback, useState } from 'react'
import { TeamSidebar, type WorkflowInfo } from './TeamSidebar'
import { TeamChatHeader } from './TeamChatHeader'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SafariWarningBanner } from './SafariWarningBanner'
import { useFileUpload } from '../hooks/useFileUpload'
import { useTeamChat } from '../hooks/useTeamChat'
import { useTeamUIState } from '../hooks/useTeamUIState'
import { useTeamChatDB } from '../hooks/useTeamChatDB'
import { getGreetingMessage } from '../constants'
import type { TeamMemberInfo } from '../hooks/useTeamAuth'
import type { Message, ConversationItem } from '../types'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface TeamChatLayoutProps {
  agentId: string
  token: string | null
  member: TeamMemberInfo | null
  isOwner: boolean
  authMethod?: string
  lang?: SupportedLang
  onLogout: () => void
  onUpdateDisplayName: (name: string) => Promise<boolean>
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  onRequestEmailChange: (newEmail: string) => Promise<{ success: boolean; error?: string }>
  onAuthError: () => void
}

export const TeamChatLayout: React.FC<TeamChatLayoutProps> = ({
  agentId,
  token,
  member,
  isOwner,
  authMethod,
  lang,
  onLogout,
  onUpdateDisplayName,
  onChangePassword,
  onRequestEmailChange,
  onAuthError
}) => {
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)

  useEffect(() => {
    const originalStyle = document.body.style.cssText
    document.body.style.overscrollBehavior = 'none'
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    document.body.style.height = '100%'

    return () => {
      document.body.style.cssText = originalStyle
    }
  }, [])

  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [workflowReady, setWorkflowReady] = useState(false)

  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([])

  const getWelcomeMessage = useCallback((wfId?: string | null) => {
    const targetId = wfId || workflowId
    const wf = workflows.find(w => w.workflowId === targetId)
    return wf?.teamWelcomeMessage || getGreetingMessage(lang)
  }, [workflows, workflowId, lang])

  const [sessionId] = useState(() =>
    `team-${agentId}-${Date.now()}-${Math.random().toString(36).substring(7)}`
  )

  const memberId = member?.id?.toString() || member?.email || 'anonymous'

  const {
    conversations: dbConversations,
    currentConversationId,
    isLoading: isDBLoading,
    createConversation,
    deleteConversation,
    selectConversation,
    loadMessages,
    saveMessage,
    showSafariWarning,
    dismissSafariWarning
  } = useTeamChatDB({ agentId, memberId, workflowId, workflowReady })

  const conversationItems: ConversationItem[] = dbConversations.map(conv => ({
    id: conv.id,
    title: conv.title,
    timestamp: conv.createdAt,
    updatedAt: conv.updatedAt
  }))

  const {
    isMobile,
    sidebarOpen,
    setSidebarOpen,
    userMenuOpen,
    setUserMenuOpen,
    input,
    setInput,
    textareaRef,
    autoResize,
    focusInput,
    handleRemovePdf
  } = useTeamUIState()

  const {
    uploadedFiles,
    isUploading,
    fileError,
    setFileError,
    handleFileSelect,
    removeFile,
    clearFiles,
    setUploadedFiles
  } = useFileUpload()

  const handleSaveMessage = useCallback(async (message: Message, conversationId: string) => {
    await saveMessage(conversationId, message)
  }, [saveMessage])

  const {
    messages,
    isLoading,
    streamingContent,
    sendMessage,
    clearSummaryFor,
    reconcileSummaryOnLoad,
    setMessages
  } = useTeamChat({
    agentId,
    workflowId,
    sessionId,
    token,
    conversationId: currentConversationId,
    onAuthError,
    onSaveMessage: handleSaveMessage
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    setWorkflowReady(false)

    const urlParams = new URLSearchParams(window.location.search)
    const wfId = urlParams.get('workflowId')
    setWorkflowId(wfId)

    const loadWorkflows = async () => {
      let confirmedWfId: string | null = null
      try {
        const headers: Record<string, string> = {}
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        const response = await fetch(`/api/chat/${agentId}/team/workflows`, {
          headers
        })

        if (response.ok) {
          const data = await response.json()
          if (cancelled) return
          if (data.workflows) {
            let allWorkflows = data.workflows

            if (wfId && !allWorkflows.find((w: any) => w.workflowId === wfId)) {
              try {
                const wfResponse = await fetch(`/api/chat/${agentId}/team/workflows?workflowId=${wfId}`, { headers })
                if (wfResponse.ok) {
                  const wfData = await wfResponse.json()
                  if (wfData.workflow) {
                    allWorkflows = [...allWorkflows, wfData.workflow]
                  }
                }
              } catch {}
            }
            if (cancelled) return

            setWorkflows(allWorkflows)

            const resolvedWfId = allWorkflows.find((w: any) => w.workflowId === wfId)
              ? wfId
              : (allWorkflows.length > 0 ? allWorkflows[0].workflowId : null)
            confirmedWfId = resolvedWfId

            if (resolvedWfId && resolvedWfId !== wfId) {
              setWorkflowId(resolvedWfId)
              const url = new URL(window.location.href)
              url.searchParams.set('workflowId', resolvedWfId)
              window.history.replaceState({}, '', url.toString())
            } else if (!wfId && resolvedWfId) {
              setWorkflowId(resolvedWfId)
            }

            if (resolvedWfId && !currentConversationId) {
              const wf = allWorkflows.find((w: any) => w.workflowId === resolvedWfId)
              if (wf?.teamWelcomeMessage) {
                setMessages([{
                  id: 'welcome',
                  role: 'assistant',
                  content: wf.teamWelcomeMessage,
                  timestamp: new Date()
                }])
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to load workflows:', error)
      } finally {
        if (!cancelled) {
          if (!confirmedWfId) { setWorkflowId(null); setWorkflows([]) }
          setWorkflowReady(true)
        }
      }
    }

    loadWorkflows()
    return () => { cancelled = true }
  }, [agentId, token])

  const handleSelectWorkflow = useCallback((selectedWorkflowId: string) => {
    setWorkflowId(selectedWorkflowId)

    const url = new URL(window.location.href)
    url.searchParams.set('workflowId', selectedWorkflowId)
    window.history.pushState({}, '', url.toString())

    selectConversation(null)
    setMessages([{
      id: 'welcome-workflow-change',
      role: 'assistant',
      content: getWelcomeMessage(selectedWorkflowId),
      timestamp: new Date()
    }])
  }, [selectConversation, setMessages, getWelcomeMessage])

  //
  const [isConversationLoading, setIsConversationLoading] = useState(false)
  const [conversationLoadFailed, setConversationLoadFailed] = useState(false)
  const [loadNonce, setLoadNonce] = useState(0)

  useEffect(() => {
    let cancelled = false

    if (!currentConversationId) {
      setIsConversationLoading(false)
      setConversationLoadFailed(false)
      return
    }

    const loadConversationMessages = async () => {
      setIsConversationLoading(true)
      setConversationLoadFailed(false)
      try {
        const loadedMessages = await loadMessages(currentConversationId)
        if (cancelled) return
        reconcileSummaryOnLoad(currentConversationId, loadedMessages)
        if (loadedMessages.length > 0) {
          setMessages(loadedMessages)
        } else {
          setMessages([{
            id: 'welcome',
            role: 'assistant',
            content: getWelcomeMessage(),
            timestamp: new Date()
          }])
        }
      } catch (e) {
        console.warn('[TeamChat] failed to load conversation messages:', (e as Error)?.message)
        if (!cancelled) {
          setConversationLoadFailed(true)
          setMessages([{
            id: 'load-error',
            role: 'error',
            content: lang === 'ko'
              ? '대화를 불러오지 못했습니다. 사이드바에서 이 대화를 다시 선택해 재시도하세요.'
              : lang === 'de'
                ? 'Unterhaltung konnte nicht geladen werden. Wählen Sie sie in der Seitenleiste erneut aus.'
                : lang === 'fr'
                  ? 'Échec du chargement de la conversation. Resélectionnez-la dans la barre latérale.'
                  : 'Failed to load this conversation. Select it again in the sidebar to retry.',
            timestamp: new Date()
          }])
        }
      } finally {
        if (!cancelled) setIsConversationLoading(false)
      }
    }

    loadConversationMessages()
    return () => { cancelled = true }
  }, [currentConversationId, loadNonce, loadMessages, setMessages, reconcileSummaryOnLoad, lang])

  useEffect(() => {
    if (!isDBLoading && !currentConversationId) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: getWelcomeMessage(),
        timestamp: new Date()
      }])
    }
  }, [isDBLoading, currentConversationId, setMessages, getWelcomeMessage])

  useEffect(() => {
    if (!isLoading) {
      focusInput()
    }
  }, [isLoading, focusInput])

  const handleNewConversation = useCallback(async () => {
    if (!workflowReady || !workflowId || isDBLoading) return
    await createConversation()
    setMessages([{
      id: 'welcome-new',
      role: 'assistant',
      content: getWelcomeMessage(),
      timestamp: new Date()
    }])
  }, [workflowReady, workflowId, isDBLoading, createConversation, setMessages, getWelcomeMessage])

  //
  const handleSelectConversation = useCallback((conversationId: string) => {
    if (conversationId === currentConversationId) {
      if (conversationLoadFailed) setLoadNonce(n => n + 1)
      return
    }
    setMessages([])
    selectConversation(conversationId)
  }, [currentConversationId, conversationLoadFailed, selectConversation, setMessages])

  const handleDeleteConversation = useCallback(async (conversationId: string) => {
    await deleteConversation(conversationId)
    clearSummaryFor(conversationId)
  }, [deleteConversation, clearSummaryFor])

  const handleSend = useCallback(async () => {
    if ((!input.trim() && uploadedFiles.length === 0) || isLoading || isConversationLoading) return
    if (!workflowReady || isDBLoading) return
    if (!workflowId) {
      setMessages([{
        id: 'no-team-workflow',
        role: 'error',
        content: lang === 'ko'
          ? '팀 채팅에서 사용할 수 있는 워크플로가 없습니다. 관리자에게 시작 노드를 「Chat → Team」으로 설정한 워크플로를 배포해 달라고 요청하세요.'
          : lang === 'de'
            ? 'Für den Team-Chat ist kein Workflow verfügbar. Bitten Sie den Administrator, einen Workflow mit Startknoten «Chat → Team» bereitzustellen.'
            : lang === 'fr'
              ? 'Aucun workflow n’est disponible pour le chat d’équipe. Demandez à l’administrateur de déployer un workflow dont le nœud de départ est « Chat → Team ».'
              : 'No workflow is available for team chat. Ask your administrator to deploy a workflow whose start node is set to "Chat → Team".',
        timestamp: new Date()
      }])
      return
    }
    if (conversationLoadFailed) {
      console.warn('[TeamChat] send blocked — conversation failed to load; reselect the conversation')
      return
    }

    let convId = currentConversationId
    if (!convId) {
      convId = await createConversation()
    }

    await sendMessage(input, uploadedFiles, convId)
    setInput('')
    clearFiles()
    autoResize()
  }, [input, uploadedFiles, isLoading, isConversationLoading, conversationLoadFailed, workflowReady, workflowId, isDBLoading, currentConversationId, createConversation, sendMessage, setInput, clearFiles, autoResize, setMessages, lang])

  const onRemovePdf = useCallback((fileName: string) => {
    handleRemovePdf(fileName, setUploadedFiles)
  }, [handleRemovePdf, setUploadedFiles])

  return (
    <div className="flex h-[100dvh] bg-[#1E1E1E] text-white">
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <TeamSidebar
        isMobile={isMobile}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        userMenuOpen={userMenuOpen}
        setUserMenuOpen={setUserMenuOpen}
        conversations={conversationItems}
        currentConversationId={currentConversationId}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        isStreaming={isLoading}
        agentId={agentId}
        token={token}
        member={member}
        isOwner={isOwner}
        authMethod={authMethod}
        lang={lang}
        onLogout={onLogout}
        onUpdateDisplayName={onUpdateDisplayName}
        onChangePassword={onChangePassword}
        onRequestEmailChange={onRequestEmailChange}
        workflows={workflows}
        currentWorkflowId={workflowId}
        onSelectWorkflow={handleSelectWorkflow}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {showSafariWarning && (
          <SafariWarningBanner lang={lang} onDismiss={dismissSafariWarning} />
        )}

        <TeamChatHeader
          isMobile={isMobile}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <MessageList
          isMobile={isMobile}
          messages={messages}
          streamingContent={streamingContent}
          isLoading={isLoading}
          lang={lang}
          memberName={member?.displayName || member?.email?.split('@')[0]}
          welcomeMessage={workflows.find(w => w.workflowId === workflowId)?.teamWelcomeMessage}
        />

        <ChatInput
          isMobile={isMobile}
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          isUploading={isUploading}
          uploadedFiles={uploadedFiles}
          lang={lang}
          onSend={handleSend}
          onFileSelect={(files) => handleFileSelect(files, t('team_chat_file_too_large'))}
          onRemoveFile={removeFile}
          onRemovePdf={onRemovePdf}
          autoResize={autoResize}
          fileInputConfig={workflows.find(wf => wf.workflowId === workflowId)?.fileInputConfig}
          fileError={fileError}
          onClearFileError={() => setFileError(null)}
        />
      </main>
    </div>
  )
}
