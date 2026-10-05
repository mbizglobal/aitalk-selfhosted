'use client'

import { useState, useEffect, Suspense, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  CheckCircle,
  MessageSquare,
  ArrowLeft
} from 'lucide-react'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface ResetPasswordContentProps {
  agentId: string
}

function ResetPasswordContent({ agentId }: ResetPasswordContentProps) {
  const searchParams = useSearchParams()
  const router = useRouter()

  const langParam = searchParams.get('lang')
  const lang: SupportedLang = (['en', 'ko', 'de', 'fr', 'es'] as const).includes(langParam as SupportedLang)
    ? (langParam as SupportedLang)
    : 'en'
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isValidating, setIsValidating] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [token, setToken] = useState('')
  const [tokenValid, setTokenValid] = useState(false)

  useEffect(() => {
    const tokenParam = searchParams.get('token')

    if (tokenParam) {
      setToken(tokenParam)
      if (tokenParam.length >= 32) {
        setTokenValid(true)
      } else {
        setError(t('team_password_reset_invalid_link'))
      }
    } else {
      setError(t('team_password_reset_invalid_link'))
    }
    setIsValidating(false)
  }, [searchParams, t])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    if (!password || !confirmPassword) {
      setError(t('team_login_error_password_required'))
      setIsLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError(t('team_password_reset_mismatch'))
      setIsLoading(false)
      return
    }

    if (password.length < 8) {
      setError(t('team_password_reset_min_length'))
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/chat/${agentId}/team/password-reset/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          newPassword: password,
        }),
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess(true)
        setTimeout(() => {
          router.push(`/chat/${agentId}/team`)
        }, 3000)
      } else {
        if (result.error?.includes('expired') || result.error?.includes('만료')) {
          setError(t('team_password_reset_expired'))
        } else if (result.error?.includes('invalid') || result.error?.includes('유효')) {
          setError(t('team_password_reset_invalid_link'))
        } else {
          setError(result.error || t('team_password_reset_error'))
        }
      }
    } catch {
      setError(t('team_error_server'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoToLogin = () => {
    router.push(`/chat/${agentId}/team`)
  }

  if (isValidating) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 text-[#E07B53] animate-spin mx-auto mb-4" />
          <p className="text-gray-400">{t('team_password_reset_verifying')}</p>
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
              {t('team_password_reset_success')}
            </h1>
            <p className="text-gray-400 mt-2">
              {t('team_password_reset_success_redirect')}
            </p>
          </div>

          <div className="bg-[#2A2A2A] rounded-lg p-6 shadow-xl">
            <Button
              onClick={handleGoToLogin}
              className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
            >
              {t('team_password_reset_go_to_login')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!tokenValid && error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
        <div className="w-full max-w-md mx-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/20 mb-4">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">
              {t('team_password_reset_link_error')}
            </h1>
            <p className="text-gray-400 mt-2">
              {error}
            </p>
          </div>

          <div className="bg-[#2A2A2A] rounded-lg p-6 shadow-xl">
            <Button
              onClick={handleGoToLogin}
              className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('team_login_back_to_login')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
      <div className="w-full max-w-md mx-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#2A2A2A] mb-4">
            <MessageSquare className="w-8 h-8 text-[#E07B53]" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {t('team_password_reset_title')}
          </h1>
          <p className="text-gray-400 mt-2">
            {t('team_password_reset_description')}
          </p>
        </div>

        {/* Form */}
        <div className="bg-[#2A2A2A] rounded-lg p-6 shadow-xl">
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">
                {t('team_password_reset_new_password')}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('team_password_reset_placeholder')}
                  className="bg-[#1E1E1E] border-[#3A3A3A] text-white placeholder:text-gray-500 focus:border-[#E07B53] focus:ring-[#E07B53] pl-10 pr-10"
                  disabled={isLoading}
                  autoComplete="new-password"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-gray-300">
                {t('team_password_reset_confirm_password')}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('team_password_reset_confirm_placeholder')}
                  className={`bg-[#1E1E1E] border-[#3A3A3A] text-white placeholder:text-gray-500 pl-10 pr-10 ${
                    confirmPassword && password !== confirmPassword
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'focus:border-[#E07B53] focus:ring-[#E07B53]'
                  }`}
                  disabled={isLoading}
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-transparent"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-400">{t('team_password_reset_mismatch')}</p>
              )}
            </div>

            {error && (
              <div className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800 rounded-md py-2 px-3">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
              disabled={isLoading || !password || !confirmPassword || password !== confirmPassword}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('team_password_reset_changing')}
                </>
              ) : (
                t('team_password_reset_submit')
              )}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-[#3A3A3A] text-center">
            <Button
              variant="ghost"
              className="text-gray-400 hover:text-white"
              onClick={handleGoToLogin}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('team_login_back_to_login')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TeamResetPasswordPage({
  params
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = use(params)

  return (
    <Suspense fallback={
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 text-[#E07B53] animate-spin mx-auto mb-4" />
          <p className="text-gray-400">{getTeamTranslation(undefined, 'team_loading')}</p>
        </div>
      </div>
    }>
      <ResetPasswordContent agentId={agentId} />
    </Suspense>
  )
}
