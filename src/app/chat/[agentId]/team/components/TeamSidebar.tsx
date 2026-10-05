import React, { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Menu, Plus, Settings, LogOut, ChevronDown, Edit2, Check, X, Shield, KeyRound, Trash2, FolderOpen,
  Globe, Users, MoreHorizontal, Workflow as WorkflowIcon, Languages, ChevronRight
} from 'lucide-react'
import type { ConversationItem } from '../types'
import type { TeamMemberInfo } from '../hooks/useTeamAuth'
import { ProfileSettingsModal } from './ProfileSettingsModal'
import { WorkflowListModal } from './WorkflowListModal'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

export interface FileInputConfig {
  imageInput: boolean
  pdfInput: boolean
  csvInput: boolean
}

export interface WorkflowInfo {
  workflowId: string
  name: string
  description?: string | null
  accessMode: 'public' | 'team'
  fileInputConfig?: FileInputConfig
  teamWelcomeMessage?: string
}

interface TeamSidebarProps {
  isMobile: boolean
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  userMenuOpen: boolean
  setUserMenuOpen: (open: boolean) => void
  conversations: ConversationItem[]
  currentConversationId: string | null
  onNewConversation: () => void
  onSelectConversation: (conversationId: string) => void
  onDeleteConversation: (conversationId: string) => void
  isStreaming?: boolean
  agentId: string
  token: string | null
  member: TeamMemberInfo | null
  isOwner?: boolean
  authMethod?: string
  lang?: SupportedLang
  onLogout: () => void
  onUpdateDisplayName?: (newName: string) => Promise<boolean>
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  onRequestEmailChange?: (newEmail: string) => Promise<{ success: boolean; error?: string }>
  workflows: WorkflowInfo[]
  currentWorkflowId: string | null
  onSelectWorkflow: (workflowId: string) => void
}

export const TeamSidebar: React.FC<TeamSidebarProps> = ({
  isMobile,
  sidebarOpen,
  setSidebarOpen,
  userMenuOpen,
  setUserMenuOpen,
  conversations,
  currentConversationId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  isStreaming = false,
  agentId,
  token,
  member,
  isOwner = false,
  authMethod,
  lang,
  onLogout,
  onUpdateDisplayName,
  onChangePassword,
  onRequestEmailChange,
  workflows,
  currentWorkflowId,
  onSelectWorkflow
}) => {
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false)
  const [hoveredConversationId, setHoveredConversationId] = useState<string | null>(null)
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false)
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false)

  const languages: { code: SupportedLang; label: string }[] = [
    { code: 'en', label: t('team_language_en') },
    { code: 'ko', label: t('team_language_ko') },
    { code: 'de', label: t('team_language_de') },
    { code: 'fr', label: t('team_language_fr') },
    { code: 'es', label: t('team_language_es') },
  ]

  const handleLanguageChange = (newLang: SupportedLang) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('lang', newLang)
    router.push(`?${params.toString()}`)
    setIsLanguageMenuOpen(false)
    setUserMenuOpen(false)
  }

  const displayName = member?.displayName || member?.email?.split('@')[0] || t('team_sidebar_user')
  const email = member?.email || ''

  const currentWorkflow = workflows.find(wf => wf.workflowId === currentWorkflowId) || workflows[0]

  const displayWorkflows = workflows.slice(0, 3)
  const hasMore = workflows.length > 3

  const handleStartEdit = () => {
    setEditName(member?.displayName || '')
    setIsEditingName(true)
    setUserMenuOpen(false)
  }

  const handleSaveName = async () => {
    if (!onUpdateDisplayName || !editName.trim()) {
      setIsEditingName(false)
      return
    }

    setIsSaving(true)
    const success = await onUpdateDisplayName(editName.trim())
    setIsSaving(false)

    if (success) {
      setIsEditingName(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditingName(false)
    setEditName('')
  }

  const handleDeleteConversation = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation()
    if (confirm(t('team_chat_delete_confirm'))) {
      onDeleteConversation(conversationId)
    }
  }

  const handleWorkflowSelect = (workflowId: string) => {
    if (isStreaming) return
    onSelectWorkflow(workflowId)
    setIsWorkflowModalOpen(false)
  }

  const mobileClass = isMobile
    ? `fixed left-0 top-0 h-full z-50 w-[85vw] max-w-[320px] transform transition-transform duration-300 ease-in-out ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`
    : `${sidebarOpen ? 'w-[280px]' : 'w-0'} transition-all duration-300`

  return (
    <aside className={`${mobileClass} bg-[#171717] border-r border-gray-800 flex flex-col overflow-hidden`}>
      <div className="p-3 flex items-center justify-between border-b border-gray-800">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="text-gray-400 hover:text-white p-2"
        >
          {isMobile && sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      <div className="p-3">
        <Button
          onClick={onNewConversation}
          disabled={isStreaming}
          className="w-full bg-[#E07B53] hover:bg-[#D06A42] text-white flex items-center gap-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          {t('team_chat_new_conversation')}
        </Button>
      </div>

      <div className="px-3 mb-2">
        <h3 className="text-xs text-gray-500 mb-2 flex items-center gap-1">
          <WorkflowIcon className="h-3 w-3" />
          {t('team_sidebar_workflow')}
        </h3>

        {currentWorkflow && (
          <div className="mb-2">
            <div className="bg-[#2A2A2A] rounded-lg p-2.5 border border-[#E07B53]/50">
              <div className="flex items-center gap-2">
                <AccessModeBadge mode={currentWorkflow.accessMode} />
                <span className="text-sm text-white font-medium truncate flex-1">
                  {currentWorkflow.name}
                </span>
              </div>
            </div>
          </div>
        )}

        {workflows.length > 1 && (
          <div className="space-y-1">
            {displayWorkflows
              .filter(wf => wf.workflowId !== currentWorkflowId)
              .map(wf => (
                <div
                  key={wf.workflowId}
                  onClick={() => handleWorkflowSelect(wf.workflowId)}
                  className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                    isStreaming
                      ? 'cursor-not-allowed opacity-40 text-gray-400'
                      : 'cursor-pointer text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <AccessModeBadge mode={wf.accessMode} />
                  <span className="text-sm truncate flex-1">{wf.name}</span>
                </div>
              ))}

            {hasMore && (
              <div
                onClick={() => { if (!isStreaming) setIsWorkflowModalOpen(true) }}
                className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                  isStreaming
                    ? 'cursor-not-allowed opacity-40 text-gray-500'
                    : 'cursor-pointer text-gray-500 hover:text-white hover:bg-gray-800'
                }`}
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="text-sm">더 보기...</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 mt-2">
        <h3 className="text-xs text-gray-500 mb-2">{t('team_chat_recent_items')}</h3>
        {conversations.length === 0 ? (
          <p className="text-sm text-gray-600 py-2">{t('team_chat_no_conversations')}</p>
        ) : (
          <div className="space-y-1">
            {conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => { if (!isStreaming) onSelectConversation(conv.id) }}
                onMouseEnter={() => setHoveredConversationId(conv.id)}
                onMouseLeave={() => setHoveredConversationId(null)}
                className={`
                  relative group text-sm rounded p-2 truncate flex items-center justify-between
                  ${isStreaming ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
                  ${currentConversationId === conv.id
                    ? 'bg-gray-800 text-white'
                    : isStreaming ? 'text-gray-400' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }
                `}
              >
                <span className="truncate flex-1 pr-2">{conv.title}</span>
                {hoveredConversationId === conv.id && !isStreaming && (
                  <button
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                    className="flex-shrink-0 p-1 text-gray-500 hover:text-red-400 rounded"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <a
        href={`/chat/${agentId}/app?lang=${lang === 'es' || !lang ? 'en' : lang}`}
        className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-[#2A2A2A] hover:text-white"
      >
        <FolderOpen className="h-4 w-4 text-[#E07B53]" />
        {t('team_sidebar_projects')}
      </a>

      <div className="p-3 border-t border-gray-800 relative">
        {isEditingName ? (
          <div className="flex items-center gap-2 p-2 bg-[#2A2A2A] rounded-lg">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={t('team_sidebar_enter_name')}
              className="flex-1 bg-transparent border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#E07B53]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName()
                if (e.key === 'Escape') handleCancelEdit()
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSaveName}
              disabled={isSaving}
              className="p-1 text-green-500 hover:text-green-400 hover:bg-transparent"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelEdit}
              disabled={isSaving}
              className="p-1 text-gray-400 hover:text-white hover:bg-transparent"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="w-full justify-between text-gray-300 hover:text-white hover:bg-gray-800"
          >
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full ${isOwner ? 'bg-amber-500' : 'bg-blue-500'} flex items-center justify-center text-white font-medium text-sm`}>
                {isOwner ? <Shield className="h-4 w-4" /> : displayName.charAt(0).toUpperCase()}
              </div>
              <div className="text-left">
                <div className="flex items-center gap-1">
                  <span className="text-sm truncate max-w-[120px]">{displayName}</span>
                  {isOwner && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-amber-500/20 text-amber-400 border-amber-500/50">
                      Owner
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <ChevronDown className="h-4 w-4" />
          </Button>
        )}

        {userMenuOpen && !isEditingName && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-[#2A2A2A] border border-gray-700 rounded-lg shadow-lg overflow-hidden z-50">
            <div className="p-2 border-b border-gray-700 text-sm text-gray-400 truncate">
              {email}
              {isOwner && <span className="ml-2 text-amber-400">(Owner)</span>}
            </div>
            {!isOwner && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleStartEdit}
                  className="w-full justify-start text-gray-300 hover:text-white hover:bg-gray-700"
                >
                  <Edit2 className="h-4 w-4 mr-2" />
                  {t('team_sidebar_edit_profile')}
                </Button>
                {(authMethod === 'password' || onRequestEmailChange) && onChangePassword && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setUserMenuOpen(false)
                      setIsProfileSettingsOpen(true)
                    }}
                    className="w-full justify-start text-gray-300 hover:text-white hover:bg-gray-700"
                  >
                    <KeyRound className="h-4 w-4 mr-2" />
                    {t('team_sidebar_account_settings')}
                  </Button>
                )}
              </>
            )}
            <div className="relative">
              <Button
                variant="ghost"
                onClick={() => setIsLanguageMenuOpen(!isLanguageMenuOpen)}
                className="w-full justify-between text-gray-300 hover:text-white hover:bg-gray-700"
              >
                <div className="flex items-center">
                  <Globe className="h-4 w-4 mr-2" />
                  {t('team_sidebar_language')}
                </div>
                <div className="flex items-center gap-1 text-gray-500">
                  <span className="text-xs">{languages.find(l => l.code === (lang || 'en'))?.label}</span>
                  <ChevronRight className={`h-3 w-3 transition-transform ${isLanguageMenuOpen ? 'rotate-90' : ''}`} />
                </div>
              </Button>
              {isLanguageMenuOpen && (
                <div className="bg-[#1E1E1E] border border-gray-700 rounded-lg mt-1 overflow-hidden">
                  {languages.map((language) => (
                    <button
                      key={language.code}
                      onClick={() => handleLanguageChange(language.code)}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors ${
                        (lang || 'en') === language.code
                          ? 'text-[#E07B53] bg-gray-800'
                          : 'text-gray-300'
                      }`}
                    >
                      {language.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isOwner ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setUserMenuOpen(false)
                  window.location.href = '/app'
                }}
                className="w-full justify-start text-gray-300 hover:text-white hover:bg-gray-700"
              >
                <Settings className="h-4 w-4 mr-2" />
                {t('team_sidebar_go_to_dashboard')}
              </Button>
            ) : (
              <div className="border-t border-gray-700">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setUserMenuOpen(false)
                    onLogout()
                  }}
                  className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-gray-700"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  {t('team_sidebar_logout')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {onChangePassword && (
        <ProfileSettingsModal
          open={isProfileSettingsOpen}
          onOpenChange={setIsProfileSettingsOpen}
          agentId={agentId}
          token={token}
          member={member ? { ...member, authMethod } : null}
          lang={lang}
          onChangePassword={onChangePassword}
          onRequestEmailChange={onRequestEmailChange}
        />
      )}

      <WorkflowListModal
        open={isWorkflowModalOpen}
        onOpenChange={setIsWorkflowModalOpen}
        workflows={workflows}
        currentWorkflowId={currentWorkflowId}
        lang={lang}
        onSelect={handleWorkflowSelect}
      />
    </aside>
  )
}

const AccessModeBadge: React.FC<{ mode: 'public' | 'team' }> = ({ mode }) => {
  if (mode === 'public') {
    return (
      <div className="flex-shrink-0 w-5 h-5 rounded bg-green-500/20 flex items-center justify-center" title="Public">
        <Globe className="h-3 w-3 text-green-400" />
      </div>
    )
  }
  return (
    <div className="flex-shrink-0 w-5 h-5 rounded bg-blue-500/20 flex items-center justify-center" title="Team">
      <Users className="h-3 w-3 text-blue-400" />
    </div>
  )
}
