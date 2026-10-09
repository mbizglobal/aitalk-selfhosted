'use client'

import { useState, useEffect, Suspense } from 'react'
import { useGoogleLoginEnabled } from '@/components/EditionProvider'
import { signIn, getSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/hooks/useLanguage'
import { useCookieConsent } from '@/hooks/useCookieConsent'
import { AuthLanguageSwitcher } from '@/components/AuthLanguageSwitcher'
import { useEdition } from '@/components/EditionProvider'
import { SelfHostedFooter } from '@/components/SelfHostedFooter'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  Fingerprint,
  ArrowLeft,
} from 'lucide-react'
import { startAuthentication } from '@simplewebauthn/browser'
import FingerprintJS from '@fingerprintjs/fingerprintjs'

type LoginStep = 'email' | 'password' | 'passkey'

function AuthContent() {
  const { t, currentLanguage, setLanguage } = useLanguage()
  const googleLogin = useGoogleLoginEnabled()
  const selfHosted = useEdition() === 'selfhosted'
  const [setupOpen, setSetupOpen] = useState(false)
  const { hasConsented, isLoaded } = useCookieConsent()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [isSignUp, setIsSignUp] = useState(false)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  const [loginStep, setLoginStep] = useState<LoginStep>('email')
  const [hasPasskey, setHasPasskey] = useState(false)
  const [isCheckingPasskey, setIsCheckingPasskey] = useState(false)

  const [visitorId, setVisitorId] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const loadFingerprint = async () => {
      try {
        const fp = await FingerprintJS.load()
        const result = await fp.get()
        setVisitorId(result.visitorId)
      } catch (error) {
        console.error('[Fingerprint Error]', error)
      }
    }
    loadFingerprint()
  }, [])

  const checkPasskeyStatus = async (emailToCheck: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/auth/passkey/check?email=${encodeURIComponent(emailToCheck)}`)
      if (response.ok) {
        const data = await response.json()
        return data.hasPasskey === true
      }
      return false
    } catch (error) {
      console.error('[Passkey Check Error]', error)
      return false
    }
  }

  const handleEmailNext = async () => {
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setError(t('auth_error_email_required'))
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(normalizedEmail)) {
      setError(t('auth_error_invalid_email') || 'Please enter a valid email address')
      return
    }

    if (googleLogin && !selfHosted && normalizedEmail.toLowerCase().endsWith('@gmail.com')) {
      setError(t('auth_error_gmail_detected'))

      setTimeout(async () => {
        try {
          await signIn('google', { callbackUrl: '/app' })
        } catch (error) {
          setError(t('auth_error_google_failed'))
        }
      }, 1000)

      return
    }

    setEmail(normalizedEmail)
    setIsCheckingPasskey(true)
    setError('')

    try {
      const userHasPasskey = await checkPasskeyStatus(normalizedEmail)
      setHasPasskey(userHasPasskey)

      if (userHasPasskey) {
        setLoginStep('passkey')
        await handlePasskeyAuth(normalizedEmail)
      } else {
        setLoginStep('password')
      }
    } catch (error) {
      console.error('[Email Check Error]', error)
      setLoginStep('password')
    } finally {
      setIsCheckingPasskey(false)
    }
  }

  const handlePasskeyAuth = async (emailForAuth?: string) => {
    const authEmail = emailForAuth || email

    if (!hasConsented) {
      setError(t('auth_error_cookie_consent_required'))
      return
    }

    setIsPasskeyLoading(true)
    setError('')

    try {
      const optionsRes = await fetch(`/api/auth/passkey/authenticate?email=${encodeURIComponent(authEmail)}`)
      if (!optionsRes.ok) {
        throw new Error('Failed to get authentication options')
      }
      const options = await optionsRes.json()

      const authResponse = await startAuthentication({ optionsJSON: options })

      const verifyRes = await fetch('/api/auth/passkey/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: authResponse,
          tempId: options.tempId,
        }),
      })

      const result = await verifyRes.json()

      if (!verifyRes.ok) {
        throw new Error(result.error || 'Authentication failed')
      }

      window.location.href = '/app'
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setLoginStep('password')
        setError(t('auth_passkey_cancelled') || 'Passkey authentication cancelled. Please enter your password.')
        return
      }

      console.error('[Passkey Auth Error]', err)
      if (err.name === 'InvalidStateError') {
        setError(t('auth_passkey_not_found') || 'No passkey found for this device')
      } else {
        setError(err.message || t('auth_passkey_failed') || 'Passkey authentication failed')
      }
      setLoginStep('password')
    } finally {
      setIsPasskeyLoading(false)
    }
  }

  const handleBackToEmail = () => {
    setLoginStep('email')
    setPassword('')
    setError('')
    setHasPasskey(false)
  }

  useEffect(() => {
    const langParam = searchParams.get('lang')
    if (langParam && ['en', 'de', 'fr', 'es', 'ko'].includes(langParam)) {
      setLanguage(langParam as 'en' | 'de' | 'fr' | 'es' | 'ko')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    if (!selfHosted && searchParams.get('mode') === 'signup') {
      setIsSignUp(true)
    }
  }, [searchParams, selfHosted])

  useEffect(() => {
    if (!selfHosted) return
    fetch('/api/auth/setup-status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { const open = d?.setupOpen === true; setSetupOpen(open); setIsSignUp(open) })
      .catch(() => {})
  }, [selfHosted])

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (!errorParam) return

    if (errorParam === 'USER_EXISTS_VERIFIED') {
      setError(t('auth_error_user_exists_verified'))
    } else if (errorParam === 'USER_EXISTS_UNVERIFIED') {
      setError(t('auth_error_user_exists_unverified'))
    } else if (errorParam === 'ANONYMIZED_USER') {
      setError(t('auth_error_anonymized_user'))
    } else if (errorParam === 'CredentialsSignin') {
      setError(t('auth_error_signup_failed'))
    } else if (errorParam === 'CookieConsentRequired') {
      setError('Cookie consent is required for authentication. Please accept cookies and try again.')
    } else if (errorParam.includes('DEVICE_SIGNUP_LIMIT_EXCEEDED')) {
      setError(t('auth_error_device_limit') || 'Too many accounts created from this device')
    } else if (errorParam.includes('IP_SIGNUP_LIMIT_EXCEEDED')) {
      setError(t('auth_error_ip_limit') || 'Too many accounts created from this IP address')
    } else if (errorParam.includes('SIGNUP_CLOSED')) {
      setError(t('auth_selfhosted_admin_only'))
    }
  }, [searchParams, t])

  useEffect(() => {
    const checkSession = async () => {
      const session = await getSession()
      if (session) {
        router.push('/app')
      }
    }
    checkSession()
  }, [router])

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    if (!hasConsented) {
      setError(t('auth_error_cookie_consent_required'))
      setIsLoading(false)
      return
    }

    if (!email || !password) {
      setError(t('auth_error_email_password'))
      setIsLoading(false)
      return
    }

    if (isSignUp && password !== confirmPassword) {
      setError(t('auth_error_password_mismatch'))
      setIsLoading(false)
      return
    }

    if (isSignUp && password.length < 8) {
      setError(t('auth_error_password_length'))
      setIsLoading(false)
      return
    }

    if (googleLogin && !selfHosted && email.trim().toLowerCase().endsWith('@gmail.com')) {
      setError(t('auth_error_gmail_detected'))

      setTimeout(async () => {
        try {
          await signIn('google', { callbackUrl: '/app' })
        } catch (error) {
          setError(t('auth_error_google_failed'))
          setIsLoading(false)
        }
      }, 1000)

      return
    }

    try {
      const result = await signIn('credentials', {
        email,
        password,
        action: isSignUp ? 'signup' : 'login',
        language: currentLanguage,
        fingerprint: visitorId || '',
        redirect: false,
        callbackUrl: '/app'
      })


      if (result?.error) {
        if (isSignUp && result.error.includes('SIGNUP_SUCCESS')) {
          router.push(`/auth/check-email?email=${encodeURIComponent(email)}&lang=${currentLanguage}`)
          return
        }

        if ((!isSignUp && result.error.includes('EMAIL_NOT_VERIFIED')) || (isSignUp && result.error.includes('USER_EXISTS_UNVERIFIED'))) {
          router.push(`/auth/check-email?email=${encodeURIComponent(email)}&lang=${currentLanguage}&reason=unverified`)
          return
        }

        if (result.error.includes('SIGNUP_CLOSED')) {
          setSetupOpen(false)
          setIsSignUp(false)
          setError(t('auth_selfhosted_admin_only'))
        } else if (isSignUp && result.error.includes('USER_EXISTS_VERIFIED')) {
          setError(t('auth_error_user_exists_verified'))
        } else if (result.error.includes('ANONYMIZED_USER')) {
          setError(t('auth_error_anonymized_user'))
        } else if (result.error.includes('DEVICE_SIGNUP_LIMIT_EXCEEDED')) {
          setError(t('auth_error_device_limit') || 'Too many accounts created from this device')
        } else if (result.error.includes('IP_SIGNUP_LIMIT_EXCEEDED')) {
          setError(t('auth_error_ip_limit') || 'Too many accounts created from this IP address')
        } else if (result.error.includes('INVALID_EMAIL')) {
          setError(t('auth_error_invalid_email'))
        } else if (result.error.includes('PASSWORD_TOO_SHORT')) {
          setError(t('auth_error_password_length'))
        } else {
          setError(isSignUp ? t('auth_error_signup_failed') : t('auth_error_login_failed'))
        }
      } else {
        router.push('/app')
      }
    } catch (error) {
      setError(t('auth_error_general'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')

    if (!email) {
      setError(t('auth_error_email_required'))
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          language: currentLanguage,
        }),
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess(t('auth_forgot_password_success'))
        setEmail('')
      } else {
        setError(result.error || t('auth_error_general'))
      }
    } catch (error) {
      setError(t('auth_error_general'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleAuth = async () => {
    if (!hasConsented) {
      setError(t('auth_error_cookie_consent_required'))
      return
    }

    setIsLoading(true)
    try {
      if (visitorId) {
        document.cookie = `signup-fingerprint=${visitorId}; path=/; max-age=300; SameSite=Lax`
      }

      await signIn('google', {
        callbackUrl: '/app'
      })
    } catch (error) {
      setError(t('auth_error_google_failed'))
      setIsLoading(false)
    }
  }

  const toggleMode = () => {
    setIsSignUp(!isSignUp)
    setIsForgotPassword(false)
    setError('')
    setSuccess('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setLoginStep('email')
    setHasPasskey(false)
  }

  const toggleForgotPassword = () => {
    setIsForgotPassword(!isForgotPassword)
    setIsSignUp(false)
    setError('')
    setSuccess('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setLoginStep('email')
    setHasPasskey(false)
  }

  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center mb-4">
              <div className="h-12 w-12 flex items-center justify-center">
                <img
                  src="/images/logo.png"
                  alt="Logo"
                  className="h-12 w-12 rounded-lg object-contain"
                />
              </div>
            </div>
            <CardTitle className="text-2xl text-center">Loading...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <AuthLanguageSwitcher />
      {selfHosted && (
        <div className="w-full max-w-md mb-4 text-center">
          <div className="text-2xl font-semibold tracking-tight">AI Talk</div>
          <div className="text-sm text-muted-foreground">{t('selfhosted_tagline')}</div>
        </div>
      )}
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="h-12 w-12 flex items-center justify-center">
              <img
                src="/images/logo.png"
                alt="Logo"
                className="h-12 w-12 rounded-lg object-contain"
              />
            </div>
          </div>
          <CardTitle className="text-2xl text-center">
            {isForgotPassword
              ? t('auth_title_forgot_password')
              : isSignUp
                ? (selfHosted && setupOpen ? t('auth_setup_title') : t('auth_title_signup'))
                : t('auth_title_login')
            }
          </CardTitle>
          <CardDescription className="text-center">
            {isForgotPassword
              ? t('auth_description_forgot_password')
              : isSignUp
                ? (selfHosted && setupOpen ? t('auth_setup_description') : t('auth_description_signup'))
                : t('auth_description_login')
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {googleLogin && !(selfHosted && isSignUp) && !isForgotPassword && (isSignUp || loginStep === 'email') && (
          <div className="relative">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogleAuth}
              disabled={isLoading || isPasskeyLoading || !hasConsented}
              title={!hasConsented ? "Cookie consent required for authentication" : ""}
            >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
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
            )}
            {t('auth_continue_google')}
          </Button>
          {!hasConsented && isLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-10 rounded-md">
              <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded shadow">
                Cookie consent required
              </span>
            </div>
          )}
        </div>
          )}

          {googleLogin && !(selfHosted && isSignUp) && !isForgotPassword && (isSignUp || loginStep === 'email') && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">{t('auth_or_continue')}</span>
            </div>
          </div>
          )}

          {!isSignUp && !isForgotPassword && loginStep !== 'email' && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackToEmail}
                className="p-1 h-auto"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 flex-1">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{email}</span>
              </div>
              {hasPasskey && (
                <Fingerprint className="h-4 w-4 text-green-600" />
              )}
            </div>
          )}

          {loginStep === 'passkey' && isPasskeyLoading && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <div className="relative">
                <Fingerprint className="h-16 w-16 text-primary animate-pulse" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {t('auth_passkey_authenticating') || 'Authenticating with Passkey...'}
              </p>
              <p className="text-xs text-muted-foreground text-center">
                {t('auth_passkey_follow_browser') || 'Please follow the instructions in your browser'}
              </p>
            </div>
          )}

          {/* Email/Password Form */}
          {loginStep !== 'passkey' && (
          <form onSubmit={isForgotPassword ? handleForgotPassword : (isSignUp || loginStep === 'password') ? handleEmailAuth : (e) => { e.preventDefault(); handleEmailNext(); }} className="space-y-4">
            {(isSignUp || isForgotPassword || loginStep === 'email') && (
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth_email_label')}</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder={t('auth_email_placeholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  disabled={isLoading || isCheckingPasskey}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isSignUp && !isForgotPassword && loginStep === 'email') {
                      e.preventDefault()
                      handleEmailNext()
                    }
                  }}
                />
              </div>
            </div>
            )}

            {!isForgotPassword && (isSignUp || loginStep === 'password') && (
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth_password_label')}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('auth_password_placeholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  disabled={isLoading}
                  autoFocus={loginStep === 'password'}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>
            )}

            {isSignUp && !isForgotPassword && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('auth_confirm_password_label')}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('auth_confirm_password_placeholder')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10"
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            <div className="relative">
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || isPasskeyLoading || isCheckingPasskey || !hasConsented}
              >
              {isLoading || isCheckingPasskey ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isForgotPassword
                    ? t('auth_sending_reset_email')
                    : isSignUp
                      ? t('auth_creating_account')
                      : isCheckingPasskey
                        ? (t('auth_checking') || 'Checking...')
                        : t('auth_signing_in')
                  }
                </>
              ) : (
                <>
                  {isForgotPassword
                    ? t('auth_send_reset_email')
                    : isSignUp
                      ? t('auth_create_account_button')
                      : loginStep === 'email'
                        ? (t('auth_continue_button') || 'Continue')
                        : t('auth_sign_in_button')
                  }
                </>
              )}
            </Button>
            {!hasConsented && isLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-10 rounded-md">
                <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded shadow">
                  Cookie consent required
                </span>
              </div>
            )}
          </div>
          </form>
          )}

          {loginStep === 'password' && hasPasskey && !isPasskeyLoading && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handlePasskeyAuth()}
              disabled={isLoading || isPasskeyLoading}
            >
              <Fingerprint className="mr-2 h-4 w-4" />
              {t('auth_retry_passkey') || 'Try Passkey again'}
            </Button>
          )}

          <div className="text-center space-y-2">
            {isForgotPassword ? (
              <Button
                variant="link"
                className="text-sm"
                onClick={toggleForgotPassword}
                disabled={isLoading}
              >
                {t('auth_back_to_login')}
              </Button>
            ) : (
              <>
                {!selfHosted && (
                  <Button
                    variant="link"
                    className="text-sm"
                    onClick={toggleMode}
                    disabled={isLoading}
                  >
                    {isSignUp
                      ? t('auth_toggle_login')
                      : t('auth_toggle_signup')
                    }
                  </Button>
                )}
                {selfHosted && !isSignUp && (
                  <p className="text-xs text-muted-foreground px-2">{t('auth_selfhosted_admin_only')}</p>
                )}
                {!isSignUp && loginStep === 'password' && (
                  <div>
                    <Button
                      variant="link"
                      className="text-sm text-muted-foreground"
                      onClick={toggleForgotPassword}
                      disabled={isLoading}
                    >
                      {t('auth_forgot_password')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
      <SelfHostedFooter className="mt-6 w-full max-w-md" />
      {!selfHosted && (
        <div className="mt-6 text-center">
          <Button
            variant="outline"
            className="text-sm"
            onClick={() => {
              window.location.href = window.location.origin
            }}
            disabled={isLoading}
          >
            {t('auth_back_to_home')}
          </Button>
        </div>
      )}
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center mb-4">
              <div className="h-12 w-12 flex items-center justify-center">
                <img
                  src="/images/logo.png"
                  alt="Logo"
                  className="h-12 w-12 rounded-lg object-contain"
                />
              </div>
            </div>
            <CardTitle className="text-2xl text-center">Loading...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    }>
      <AuthContent />
    </Suspense>
  )
}
