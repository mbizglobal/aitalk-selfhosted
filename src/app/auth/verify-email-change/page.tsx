'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/hooks/useLanguage'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  CheckCircle,
  XCircle,
  Loader2,
  ArrowLeft
} from 'lucide-react'

interface VerificationResponse {
  success: boolean
  error?: string
  message?: string
  newEmail?: string
}

function VerifyEmailChangeContent() {
  const { t, currentLanguage, setLanguage } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [verificationState, setVerificationState] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [newEmail, setNewEmail] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const hasCalledRef = useRef(false)
  // Refs to avoid unnecessary effect re-runs from language/translation changes
  const tRef = useRef(t)
  const langRef = useRef(currentLanguage)

  // Keep refs up-to-date
  useEffect(() => {
    tRef.current = t
    langRef.current = currentLanguage
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const langParam = searchParams.get('lang')
    if (langParam && ['en', 'de', 'fr', 'es', 'ko'].includes(langParam)) {
      setLanguage(langParam as 'en' | 'de' | 'fr' | 'es' | 'ko')
    }
  }, [searchParams, setLanguage])

  useEffect(() => {
    // Prevent duplicate API calls (React Strict Mode / re-renders)
    if (hasCalledRef.current) return

    const verifyEmailChange = async () => {
      const token = searchParams.get('token')
      const lang = searchParams.get('lang') || langRef.current

      if (!token) {
        setVerificationState('error')
        setMessage(tRef.current('verify_email_change_error_invalid'))
        return
      }

      hasCalledRef.current = true

      try {
        const cached = localStorage.getItem(`email-verified-${token.substring(0, 16)}`)
        if (cached) {
          const result = JSON.parse(cached)
          setVerificationState('success')
          setMessage(result.message || tRef.current('verify_email_change_success_message'))
          if (result.newEmail) setNewEmail(result.newEmail)
          setTimeout(async () => {
            await signOut({ redirect: false })
            window.location.href = `/auth?lang=${lang}`
          }, 3000)
          return
        }
      } catch {
      }

      try {
        const response = await fetch(`/api/auth/verify-email-change?token=${encodeURIComponent(token)}&lang=${lang}`)
        const data: VerificationResponse = await response.json()

        if (data.success) {
          setVerificationState('success')
          setMessage(data.message || tRef.current('verify_email_change_success_message'))
          if (data.newEmail) {
            setNewEmail(data.newEmail)
          }

          try {
            localStorage.setItem(`email-verified-${token.substring(0, 16)}`, JSON.stringify({
              message: data.message,
              newEmail: data.newEmail
            }))
            setTimeout(() => {
              try { localStorage.removeItem(`email-verified-${token.substring(0, 16)}`) } catch {}
            }, 60 * 60 * 1000)
          } catch {
          }

          setTimeout(async () => {
            await signOut({ redirect: false })
            window.location.href = `/auth?lang=${lang}`
          }, 3000)
        } else {
          setVerificationState('error')

          switch (data.error) {
            case 'MISSING_TOKEN':
            case 'INVALID_TOKEN':
              setMessage(tRef.current('verify_email_change_error_invalid'))
              break
            case 'EXPIRED_TOKEN':
              setMessage(tRef.current('verify_email_change_error_expired'))
              break
            case 'EMAIL_TAKEN':
              setMessage(tRef.current('verify_email_change_error_email_taken'))
              break
            default:
              setMessage(tRef.current('verify_email_change_error_generic'))
          }
        }
      } catch (error) {
        console.error('Email change verification error:', error)
        setVerificationState('error')
        setMessage(tRef.current('verify_email_change_error_generic'))
      }
    }

    verifyEmailChange()
  }, [searchParams])

  const handleGoToSettings = () => {
    router.push(`/app/settings?tab=profile&lang=${currentLanguage}`)
  }

  const handleGoToLogin = () => {
    router.push(`/auth?lang=${currentLanguage}`)
  }

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center mb-4">
              <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center">
                <span className="text-xl font-bold text-primary-foreground">AI</span>
              </div>
            </div>
            <CardTitle className="text-2xl text-center">Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center">
              <span className="text-xl font-bold text-primary-foreground">AI</span>
            </div>
          </div>
          <CardTitle className="text-2xl text-center">
            {t('verify_email_change_title')}
          </CardTitle>
          <CardDescription className="text-center">
            {verificationState === 'loading' && t('verify_email_change_verifying')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {verificationState === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {verificationState === 'success' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-4">
                <CheckCircle className="h-16 w-16 text-green-500" />
              </div>

              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold text-green-700 dark:text-green-400">
                  {t('verify_email_change_success_title')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {message}
                </p>
                {newEmail && (
                  <p className="text-sm font-medium">
                    {newEmail}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-4">
                  Redirecting to login page...
                </p>
              </div>

              <Button onClick={handleGoToLogin} className="w-full">
                {t('verify_email_change_success_button')}
              </Button>
            </div>
          )}

          {verificationState === 'error' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-4">
                <XCircle className="h-16 w-16 text-red-500" />
              </div>

              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-2">
                    <div className="font-semibold">
                      {t('verify_email_change_error_title')}
                    </div>
                    <div>
                      {message}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Button onClick={handleGoToSettings} variant="outline" className="w-full">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('verify_email_change_back_button')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function VerifyEmailChangePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center mb-4">
              <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center">
                <span className="text-xl font-bold text-primary-foreground">AI</span>
              </div>
            </div>
            <CardTitle className="text-2xl text-center">Loading...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    }>
      <VerifyEmailChangeContent />
    </Suspense>
  )
}
