'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Eye, EyeOff, MessageSquare, ArrowLeft, Mail, KeyRound } from 'lucide-react'
import { signIn } from 'next-auth/react'
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import type { TeamMemberInfo } from '../hooks/useTeamAuth'
import { getTeamTranslation } from '@/lib/translations/team'
import { useGoogleLoginEnabled } from '@/components/EditionProvider'

type LoginStep = 'email' | 'password' | 'oauth' | 'passkey' | 'forgot-password'
type TeamLanguage = 'en' | 'ko' | 'de' | 'fr' | 'es'

interface LoginModalProps {
  agentId: string
  agentTitle?: string
  lang?: TeamLanguage
  onLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  onPasskeyLogin?: (token: string, expiresAt: number, member: TeamMemberInfo) => void
  isOAuthLoading?: boolean
  oauthError?: string
}

export const LoginModal: React.FC<LoginModalProps> = ({
  agentId,
  agentTitle,
  lang = 'en',
  onLogin,
  onPasskeyLogin,
  isOAuthLoading,
  oauthError
}) => {
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)
  const [step, setStep] = useState<LoginStep>('email')
  const googleLogin = useGoogleLoginEnabled()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingMember, setIsCheckingMember] = useState(false)
  const [error, setError] = useState('')
  const [memberAuthMethod, setMemberAuthMethod] = useState<string | null>(null)
  const [memberHasPasskey, setMemberHasPasskey] = useState(false)
  const [displayTitle, setDisplayTitle] = useState(agentTitle || '')
  const [isResetEmailSent, setIsResetEmailSent] = useState(false)
  const [isSendingResetEmail, setIsSendingResetEmail] = useState(false)
  const [isPasskeySupported, setIsPasskeySupported] = useState(true)
  const [isPasskeyAuthenticating, setIsPasskeyAuthenticating] = useState(false)

  useEffect(() => {
    setIsPasskeySupported(browserSupportsWebAuthn())
  }, [])

  const [passkeyAutoStarted, setPasskeyAutoStarted] = useState(false)

  useEffect(() => {
    if (step === 'passkey' && isPasskeySupported && !passkeyAutoStarted && !isPasskeyAuthenticating) {
      setPasskeyAutoStarted(true)
      handlePasskeyAuthenticate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isPasskeySupported, passkeyAutoStarted, isPasskeyAuthenticating])

  const handlePasskeyAuthenticate = useCallback(async () => {
    if (!isPasskeySupported) {
      setError(t('team_passkey_not_supported'))
      return
    }

    setIsPasskeyAuthenticating(true)
    setError('')

    try {
      const optionsResponse = await fetch(
        `/api/chat/${agentId}/team/passkey/authenticate?email=${encodeURIComponent(email.trim())}`
      )

      if (!optionsResponse.ok) {
        const data = await optionsResponse.json()
        throw new Error(data.error || t('team_passkey_options_error'))
      }

      const options = await optionsResponse.json()
      const { tempId, ...authOptions } = options

      const authResponse = await startAuthentication({ optionsJSON: authOptions })

      const verifyResponse = await fetch(`/api/chat/${agentId}/team/passkey/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: authResponse, tempId })
      })

      if (!verifyResponse.ok) {
        const data = await verifyResponse.json()
        throw new Error(data.error || t('team_passkey_failed'))
      }

      const data = await verifyResponse.json()

      if (onPasskeyLogin) {
        onPasskeyLogin(data.token, data.expiresAt, data.member)
      }
    } catch (err) {
      console.error('Passkey authentication error:', err)
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError(t('team_passkey_cancelled'))
        } else {
          setError(err.message || t('team_passkey_failed'))
        }
      } else {
        setError(t('team_passkey_failed'))
      }
    } finally {
      setIsPasskeyAuthenticating(false)
    }
  }, [agentId, email, isPasskeySupported, onPasskeyLogin, t])

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email.trim()) {
      setError(t('team_login_error_email_required'))
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      setError(t('team_login_error_email_invalid'))
      return
    }

    setIsCheckingMember(true)
    setError('')

    try {
      const response = await fetch(`/api/chat/${agentId}/team/check-member?email=${encodeURIComponent(email.trim())}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || t('team_login_error_server'))
        setIsCheckingMember(false)
        return
      }

      if (data.agentTitle) {
        setDisplayTitle(data.agentTitle)
      }

      if (!data.exists) {
        if (data.suspended) {
          setError(t('team_login_error_suspended'))
        } else {
          setError(t('team_login_error_not_member'))
        }
        setIsCheckingMember(false)
        return
      }

      setMemberAuthMethod(data.authMethod)
      setMemberHasPasskey(data.hasPasskey || false)

      if (data.hasPasskey) {
        setStep('passkey')
      } else if (data.authMethod === 'oauth') {
        setStep('oauth')
      } else {
        setStep('password')
      }
    } catch (err) {
      setError(t('team_login_error_connection'))
    } finally {
      setIsCheckingMember(false)
    }
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!password) {
      setError(t('team_login_error_password_required'))
      return
    }

    setIsLoading(true)
    setError('')

    const result = await onLogin(email.trim(), password)

    if (!result.success) {
      setError(result.error || t('team_login_error_login_failed'))
    }

    setIsLoading(false)
  }

  const handleGoogleSignIn = async () => {
    await signIn('google', {
      callbackUrl: window.location.href
    })
  }

  const handleBack = () => {
    setStep('email')
    setPassword('')
    setError('')
    setMemberAuthMethod(null)
    setMemberHasPasskey(false)
    setIsResetEmailSent(false)
    setPasskeyAutoStarted(false)
  }

  const handleSendResetEmail = async () => {
    setIsSendingResetEmail(true)
    setError('')

    try {
      const response = await fetch(`/api/chat/${agentId}/team/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })

      const data = await response.json()

      if (response.ok) {
        setIsResetEmailSent(true)
      } else {
        setError(data.error || '이메일 발송에 실패했습니다.')
      }
    } catch {
      setError('서버 연결에 실패했습니다.')
    } finally {
      setIsSendingResetEmail(false)
    }
  }

  const renderEmailStep = () => (
    <form onSubmit={handleEmailSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email" className="text-gray-300">
          {t('team_login_email')}
        </Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="bg-[#1E1E1E] border-[#3A3A3A] text-white placeholder:text-gray-500 focus:border-[#E07B53] focus:ring-[#E07B53]"
          disabled={isCheckingMember}
          autoComplete="email"
          autoFocus
        />
      </div>

      {error && (
        <div className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800 rounded-md py-2 px-3">
          {error}
        </div>
      )}

      <Button
        type="submit"
        className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
        disabled={isCheckingMember}
      >
        {isCheckingMember ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('team_login_checking')}
          </>
        ) : (
          t('team_login_continue')
        )}
      </Button>
    </form>
  )

  const renderPasswordStep = () => (
    <form onSubmit={handlePasswordSubmit} className="space-y-4">
      <div className="flex items-center gap-2 p-3 bg-[#1E1E1E] border border-[#3A3A3A] rounded-md">
        <Mail className="h-4 w-4 text-gray-400" />
        <span className="text-white text-sm flex-1">{email}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="text-gray-400 hover:text-white hover:bg-transparent p-0 h-auto"
        >
          {t('team_change')}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="text-gray-300">
          {t('team_login_password')}
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('team_login_password_placeholder')}
            className="bg-[#1E1E1E] border-[#3A3A3A] text-white placeholder:text-gray-500 focus:border-[#E07B53] focus:ring-[#E07B53] pr-10"
            disabled={isLoading}
            autoComplete="current-password"
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

      {(error || oauthError) && (
        <div className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800 rounded-md py-2 px-3">
          {error || oauthError}
        </div>
      )}

      <Button
        type="submit"
        className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
        disabled={isLoading || isOAuthLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('team_login_signing_in')}
          </>
        ) : (
          t('team_login_submit')
        )}
      </Button>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          className="text-gray-400 hover:text-white p-0 h-auto"
          onClick={handleBack}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t('team_back')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-gray-400 hover:text-[#E07B53] p-0 h-auto text-sm"
          onClick={() => {
            setError('')
            setStep('forgot-password')
          }}
        >
          {t('team_login_forgot_password')}
        </Button>
      </div>
    </form>
  )

  const renderForgotPasswordStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 bg-[#1E1E1E] border border-[#3A3A3A] rounded-md">
        <Mail className="h-4 w-4 text-gray-400" />
        <span className="text-white text-sm flex-1">{email}</span>
      </div>

      {isResetEmailSent ? (
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/20 mb-3">
            <Mail className="w-6 h-6 text-green-400" />
          </div>
          <p className="text-white font-medium mb-2">{t('team_login_email_sent')}</p>
          <p className="text-gray-400 text-sm">
            {t('team_login_reset_link_sent')}
          </p>
        </div>
      ) : (
        <>
          <div className="text-center text-gray-400 text-sm py-2">
            {t('team_login_reset_link_hint')}
          </div>

          {error && (
            <div className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800 rounded-md py-2 px-3">
              {error}
            </div>
          )}

          <Button
            type="button"
            className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
            onClick={handleSendResetEmail}
            disabled={isSendingResetEmail}
          >
            {isSendingResetEmail ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('team_login_sending')}
              </>
            ) : (
              t('team_login_send_reset_link')
            )}
          </Button>
        </>
      )}

      <Button
        type="button"
        variant="ghost"
        className="w-full text-gray-400 hover:text-white"
        onClick={() => {
          setError('')
          setIsResetEmailSent(false)
          setStep('password')
        }}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t('team_login_back_to_login')}
      </Button>
    </div>
  )

  const renderOAuthStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 bg-[#1E1E1E] border border-[#3A3A3A] rounded-md">
        <Mail className="h-4 w-4 text-gray-400" />
        <span className="text-white text-sm flex-1">{email}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="text-gray-400 hover:text-white hover:bg-transparent p-0 h-auto"
        >
          {t('team_change')}
        </Button>
      </div>

      <div className="text-center text-gray-400 text-sm py-2">
        {t('team_login_google_required')}
      </div>

      {(error || oauthError) && (
        <div className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800 rounded-md py-2 px-3">
          {error || oauthError}
        </div>
      )}

      <Button
        type="button"
        className="w-full bg-white hover:bg-gray-100 text-gray-900"
        onClick={handleGoogleSignIn}
        disabled={isOAuthLoading}
      >
        {isOAuthLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('team_login_google_loading')}
          </>
        ) : (
          <>
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {t('team_login_google')}
          </>
        )}
      </Button>

      <Button
        type="button"
        variant="ghost"
        className="w-full text-gray-400 hover:text-white"
        onClick={handleBack}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t('team_back')}
      </Button>
    </div>
  )

  const renderPasskeyStep = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-3 bg-[#1E1E1E] border border-[#3A3A3A] rounded-md">
          <Mail className="h-4 w-4 text-gray-400" />
          <span className="text-white text-sm flex-1">{email}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="text-gray-400 hover:text-white hover:bg-transparent p-0 h-auto"
            disabled={isPasskeyAuthenticating}
          >
            {t('team_change')}
          </Button>
        </div>

        <div className="text-center py-8">
          {isPasskeyAuthenticating ? (
            <>
              <Loader2 className="h-12 w-12 text-[#E07B53] mx-auto mb-3 animate-spin" />
              <p className="text-gray-400 text-sm">{t('team_passkey_signing_in')}</p>
            </>
          ) : (
            <>
              <KeyRound className="h-12 w-12 text-[#E07B53] mx-auto mb-3" />
              <p className="text-gray-400 text-sm">{t('team_passkey_sign_in_message')}</p>
            </>
          )}
        </div>

        {!isPasskeySupported && (
          <div className="text-yellow-400 text-sm text-center bg-yellow-900/20 border border-yellow-800 rounded-md py-2 px-3">
            {t('team_passkey_not_supported')}
          </div>
        )}

        {error && (
          <>
            <div className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800 rounded-md py-2 px-3">
              {error}
            </div>
            <Button
              type="button"
              className="w-full bg-[#E07B53] hover:bg-[#c96a45] text-white"
              disabled={isPasskeyAuthenticating || !isPasskeySupported}
              onClick={() => {
                setError('')
                setPasskeyAutoStarted(false)
              }}
            >
              <KeyRound className="mr-2 h-4 w-4" />
              {t('team_retry')}
            </Button>
          </>
        )}

        <Button
          type="button"
          variant="ghost"
          className="w-full text-gray-400 hover:text-white"
          onClick={handleBack}
          disabled={isPasskeyAuthenticating}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('team_back')}
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1E1E]">
      <div className="w-full max-w-md mx-4">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#2A2A2A] mb-4">
            <MessageSquare className="w-8 h-8 text-[#E07B53]" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {displayTitle || t('team_login_title')}
          </h1>
          <p className="text-gray-400 mt-2">
            {step === 'email' ? t('team_login_subtitle') :
             step === 'password' ? t('team_login_subtitle_password') :
             step === 'oauth' ? t('team_login_subtitle_google') :
             t('team_login_subtitle_passkey')}
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-[#2A2A2A] rounded-lg p-6 shadow-xl">
          {step === 'email' && renderEmailStep()}
          {step === 'password' && renderPasswordStep()}
          {step === 'forgot-password' && renderForgotPasswordStep()}
          {step === 'oauth' && renderOAuthStep()}
          {step === 'passkey' && renderPasskeyStep()}

          {step === 'email' && googleLogin && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-[#3A3A3A]" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[#2A2A2A] px-2 text-gray-500">{t('team_or')}</span>
                </div>
              </div>

              {/* Google Login */}
              <Button
                type="button"
                variant="outline"
                className="w-full border-[#3A3A3A] bg-[#1E1E1E] text-white hover:bg-[#3A3A3A] hover:text-white"
                onClick={handleGoogleSignIn}
                disabled={isCheckingMember || isOAuthLoading}
              >
                {isOAuthLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('team_login_google_loading')}
                  </>
                ) : (
                  <>
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {t('team_login_google')}
                  </>
                )}
              </Button>
            </>
          )}

          <div className="mt-6 pt-4 border-t border-[#3A3A3A]">
            <p className="text-xs text-gray-500 text-center">
              {t('team_login_invite_hint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
