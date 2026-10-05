'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/hooks/useLanguage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  CheckCircle,
  XCircle,
  Loader2,
  Mail,
  ArrowLeft
} from 'lucide-react'

interface VerificationResponse {
  success: boolean
  error?: string
  message?: string
  user?: {
    email: string
    name: string
  }
  appCode?: string
}

function VerifyEmailContent() {
  const { t, currentLanguage, setLanguage } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [verificationState, setVerificationState] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [userInfo, setUserInfo] = useState<{ email: string; name: string } | null>(null)
  const [isAppSource, setIsAppSource] = useState(false)
  const verificationAttempted = useRef(false)

  useEffect(() => {
    const langParam = searchParams.get('lang')
    if (langParam && ['en', 'de', 'fr', 'es', 'ko'].includes(langParam)) {
      setLanguage(langParam as 'en' | 'de' | 'fr' | 'es' | 'ko')
    }
  }, [searchParams, setLanguage])

  useEffect(() => {
    if (verificationAttempted.current) return

    const verifyEmail = async () => {
      const token = searchParams.get('token')
      const lang = searchParams.get('lang') || currentLanguage
      const source = searchParams.get('source')

      if (!token) {
        setVerificationState('error')
        setMessage(t('verify_email_error_invalid'))
        return
      }

      verificationAttempted.current = true

      try {
        const sourceParam = source ? `&source=${encodeURIComponent(source)}` : ''
        const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}&lang=${lang}${sourceParam}`)
        const data: VerificationResponse = await response.json()

        if (data.success) {
          setVerificationState('success')
          setMessage(data.message || t('verify_email_success_message'))
          if (data.user) {
            setUserInfo(data.user)

            if (source === 'app') setIsAppSource(true)
            if (source === 'app' && data.appCode) {
              const deepLink = `aitalk://verified?code=${encodeURIComponent(data.appCode)}`
              window.location.href = deepLink
            } else {
              setTimeout(() => {
                window.location.href = `/auth?lang=${lang}`
              }, 2000)
            }
          }
        } else {
          setVerificationState('error')

          switch (data.error) {
            case 'MISSING_TOKEN':
            case 'INVALID_TOKEN':
              setMessage(t('verify_email_error_invalid'))
              break
            case 'EXPIRED_TOKEN':
              setMessage(t('verify_email_error_expired'))
              break
            case 'USER_NOT_FOUND':
              setMessage(t('verify_email_error_generic'))
              break
            case 'ALREADY_VERIFIED':
              setMessage(t('verify_email_error_already'))
              break
            default:
              setMessage(t('verify_email_error_generic'))
          }
        }
      } catch (error) {
        console.error('Email verification error:', error)
        setVerificationState('error')
        setMessage(t('verify_email_error_generic'))
      }
    }

    if (currentLanguage) {
      verifyEmail()
    }
  }, [searchParams, currentLanguage, t])

  const handleGoToDashboard = () => {
    if (verificationState === 'success') {
      window.location.href = '/app'
    } else {
      router.push(`/auth?lang=${currentLanguage}`)
    }
  }

  const handleResendEmail = () => {
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
            {t('verify_email_title')}
          </CardTitle>
          <CardDescription className="text-center">
            {verificationState === 'loading' && t('verify_email_verifying')}
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
                  {t('verify_email_success_title')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {message}
                </p>
                {userInfo && (
                  <p className="text-sm text-muted-foreground">
                    {userInfo.email}
                  </p>
                )}
              </div>

              {isAppSource ? (
                <div className="text-center space-y-3">
                  <p className="text-sm text-muted-foreground">
                    AiTalk.ch 앱이 자동으로 열립니다.<br />
                    앱이 열리지 않으면 앱으로 돌아가 로그인해주세요.
                  </p>
                  <Button onClick={handleGoToDashboard} variant="outline" className="w-full">
                    앱에서 로그인하기
                  </Button>
                </div>
              ) : (
                <Button onClick={handleGoToDashboard} className="w-full">
                  {t('verify_email_success_button')}
                </Button>
              )}
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
                      {t('verify_email_error_title')}
                    </div>
                    <div>
                      {message}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Button onClick={handleResendEmail} variant="outline" className="w-full">
                  <Mail className="mr-2 h-4 w-4" />
                  {t('verify_email_resend_button')}
                </Button>
                
                <Button onClick={handleGoToDashboard} variant="ghost" className="w-full">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('verify_email_back_button')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function VerifyEmailPage() {
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
      <VerifyEmailContent />
    </Suspense>
  )
}
