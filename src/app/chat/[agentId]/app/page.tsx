'use client'

import React, { use, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Loader2 } from 'lucide-react'
import { LoginModal } from '../team/components/LoginModal'
import { useTeamAuth } from '../team/hooks/useTeamAuth'
import { parseWorkLang, workT } from '@/lib/translations/work'
import { WorkApp } from './components/WorkApp'
import { AppList } from './components/AppList'

export default function WorkAppPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const search = useSearchParams()
  const lang = parseWorkLang(search.get('lang'))
  const workflowId = search.get('workflowId')
  const archiveProjectId = search.get('project')
  const { token, member, isLoading, isAuthenticated, isOwner, isOAuthLoading, oauthError, sessionStatus, login, logout, loginWithOAuth, updateProfile } = useTeamAuth(agentId)
  const onAuthError = useCallback(() => logout(), [logout])
  const ownerLogout = useCallback(() => { void signOut({ redirect: false }).then(() => logout()) }, [logout])

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] bg-[#1E1E1E] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#E07B53]" aria-label={workT(lang, 'loading')} />
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

  const who = { token: isOwner ? null : token, memberName: member?.displayName || member?.email || '', isOwner, onLogout: isOwner ? ownerLogout : logout, onAuthError, ...(isOwner ? {} : { displayName: member?.displayName ?? null, jobTitle: member?.jobTitle ?? null, onSaveProfile: updateProfile }) }
  if (archiveProjectId) {
    return isOwner
      ? <WorkApp key={`archive:${archiveProjectId}`} agentId={agentId} workflowId="archive" archiveProjectId={archiveProjectId} lang={lang} {...who} />
      : <AppList agentId={agentId} lang={lang} {...who} />
  }
  return workflowId
    ? <WorkApp key={workflowId} agentId={agentId} workflowId={workflowId} lang={lang} {...who} />
    : <AppList agentId={agentId} lang={lang} {...who} />
}
