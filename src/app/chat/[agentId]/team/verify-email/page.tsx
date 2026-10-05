'use client'

import { useState, useEffect, Suspense, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Mail,
  AlertCircle,
  Loader2,
  CheckCircle,
  MessageSquare,
  ArrowLeft
} from 'lucide-react'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface VerifyEmailContentProps {
  agentId: string
}

function VerifyEmailContent({ agentId }: VerifyEmailContentProps) {
  const searchParams = useSearchParams()
  const router = useRouter()

  const langParam = searchParams.get('lang')
  const lang: SupportedLang = (['en', 'ko', 'de', 'fr', 'es'] as const).includes(langParam as SupportedLang)
    ? (langParam as SupportedLang)
    : 'en'
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)

  const [isVerifying, setIsVerifying] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [newEmail, setNewEmail] = useState('')

  useEffect(() => {
    const tokenParam = searchParams.get('token')

    if (!tokenParam) {
      setError(t('team_email_verify_invalid_link'))
      setIsVerifying(false)
      return
    }

    if (tokenParam.length < 32) {
      setError(t('team_email_verify_invalid_link'))
      setIsVerifying(false)
      return
    }

    const verifyEmail = async () => {
      try {
        const response = await fetch(`/api/chat/${agentId}/team/profile/email/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: tokenParam }),
        })

        const result = await response.json()

        if (response.ok) {
          setSuccess(true)
          setNewEmail(result.member?.email || '')

          if (result.newToken) {
            localStorage.setItem(`team_token_${agentId}`, result.newToken)
            if (result.expiresAt) {
              localStorage.setItem(`team_token_expires_${agentId}`, result.expiresAt.toString())
            }
          }

          setTimeout(() => {
            router.push(`/chat/${agentId}/team`)
          }, 3000)
        } else {
          if (result.error?.includes('expired') || result.error?.includes('만료')) {
            setError(t('team_email_verify_expired'))
          } else if (result.error?.includes('invalid') || result.error?.includes('유효')) {
            setError(t('team_email_verify_invalid_link'))
          } else if (result.error?.includes('already') || result.error?.includes('이미')) {
            setError(t('team_email_verify_already_used'))
          } else {
            setError(result.error || t('team_email_verify_failed'))
          }
        }
      } catch {
        setError(t('team_error_server'))
      } finally {
        setIsVerifying(false)
      }
    }

    verifyEmail()
  }, [searchParams, agentId, router, t])

  const handleGoToTeamChat = () => {
    router.push(`/chat/${agentId}/team`)
  }

  if (isVerifying) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
        <div className="w-full max-w-md mx-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#2A2A2A] mb-4">
              <Mail className="w-8 h-8 text-[#E07B53]" />
            </div>
            <h1 className="text-2xl font-bold text-white">
              {t('team_email_verify_verifying')}
            </h1>
            <p className="text-gray-400 mt-2">
              {t('team_email_verify_please_wait')}
            </p>
          </div>

          <div className="bg-[#2A2A2A] rounded-lg p-6 shadow-xl">
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 text-[#E07B53] animate-spin" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
        <div className="w-full max-w-md mx-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">
              {t('team_email_verify_success')}
            </h1>
            <p className="text-gray-400 mt-2">
              {newEmail && (
                <>
                  {t('team_email_verify_new_email')}: <span className="text-white">{newEmail}</span>
                  <br />
                </>
              )}
              {t('team_email_verify_success_redirect')}
            </p>
          </div>

          <div className="bg-[#2A2A2A] rounded-lg p-6 shadow-xl">
            <Button
              onClick={handleGoToTeamChat}
              className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
            >
              {t('team_email_verify_go_to_chat')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
      <div className="w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/20 mb-4">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {t('team_email_verify_failed')}
          </h1>
          <p className="text-gray-400 mt-2">
            {error}
          </p>
        </div>

        <div className="bg-[#2A2A2A] rounded-lg p-6 shadow-xl space-y-4">
          <p className="text-sm text-gray-400 text-center">
            {t('team_email_verify_request_hint')}
          </p>

          <Button
            onClick={handleGoToTeamChat}
            className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('team_email_verify_go_to_chat')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function TeamVerifyEmailPage({
  params
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = use(params)

  return (
    <Suspense fallback={
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
        <div className="w-full max-w-md mx-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#2A2A2A] mb-4">
              <MessageSquare className="w-8 h-8 text-[#E07B53]" />
            </div>
            <h1 className="text-2xl font-bold text-white">
              {getTeamTranslation(undefined, 'team_loading')}
            </h1>
          </div>

          <div className="bg-[#2A2A2A] rounded-lg p-6 shadow-xl">
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 text-[#E07B53] animate-spin" />
            </div>
          </div>
        </div>
      </div>
    }>
      <VerifyEmailContent agentId={agentId} />
    </Suspense>
  )
}
