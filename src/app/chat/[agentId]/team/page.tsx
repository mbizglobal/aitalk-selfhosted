'use client'

import React, { use, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { TeamChatLayout } from './components/TeamChatLayout'
import { LoginModal } from './components/LoginModal'
import { useTeamAuth } from './hooks/useTeamAuth'
import { getTeamTranslation } from '@/lib/translations/team'

interface ChatPageProps {
  params: Promise<{
    agentId: string
  }>
}

type TeamLanguage = 'en' | 'ko' | 'de' | 'fr' | 'es'

export default function TeamChatPage({ params }: ChatPageProps) {
  const { agentId } = use(params)
  const searchParams = useSearchParams()

  const langParam = searchParams.get('lang')
  const lang: TeamLanguage = ['en', 'ko', 'de', 'fr', 'es'].includes(langParam || '')
    ? (langParam as TeamLanguage)
    : 'en'

  const {
    token,
    member,
    isLoading: isAuthLoading,
    isAuthenticated,
    isOwner,
    authMethod,
    isOAuthLoading,
    oauthError,
    sessionStatus,
    login,
    logout,
    loginWithOAuth,
    updateDisplayName,
    changePassword,
    requestEmailChange
  } = useTeamAuth(agentId)

  const handleAuthError = useCallback(() => {
    logout()
  }, [logout])

  if (isAuthLoading) {
    return (
      <div className="flex h-screen bg-[#1E1E1E] items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#E07B53] mx-auto mb-4" />
          <p className="text-gray-400">{getTeamTranslation(lang, 'team_loading')}</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <LoginModal
        agentId={agentId}
        agentTitle=""
        lang={lang}
        onLogin={login}
        onPasskeyLogin={loginWithOAuth}
        isOAuthLoading={isOAuthLoading || sessionStatus === 'loading'}
        oauthError={oauthError}
      />
    )
  }

  return (
    <TeamChatLayout
      agentId={agentId}
      token={token}
      member={member}
      isOwner={isOwner}
      authMethod={authMethod}
      lang={lang}
      onLogout={logout}
      onUpdateDisplayName={updateDisplayName}
      onChangePassword={changePassword}
      onRequestEmailChange={requestEmailChange}
      onAuthError={handleAuthError}
    />
  )
}
