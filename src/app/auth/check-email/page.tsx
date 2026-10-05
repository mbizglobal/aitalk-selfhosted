'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/hooks/useLanguage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Mail,
  CheckCircle,
  ArrowLeft,
  RefreshCw
} from 'lucide-react'

function CheckEmailContent() {
  const { t, currentLanguage, setLanguage } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isResending, setIsResending] = useState(false)
  const [resendMessage, setResendMessage] = useState('')
  const unverified = searchParams.get('reason') === 'unverified'

  useEffect(() => {
    const langParam = searchParams.get('lang')
    const emailParam = searchParams.get('email')
    
    if (langParam && ['en', 'de', 'fr'].includes(langParam)) {
      setLanguage(langParam as 'en' | 'de' | 'fr')
    }
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    }
  }, [searchParams, setLanguage])

  const handleResendEmail = async () => {
    if (!email) return
    
    setIsResending(true)
    setResendMessage('')

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          language: currentLanguage
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setResendMessage(t('check_email_resend_success'))
      } else {
        if (data.error === 'RATE_LIMIT_EXCEEDED') {
          setResendMessage(t('check_email_resend_limit'))
        } else {
          setResendMessage(t('check_email_resend_failed'))
        }
      }
    } catch (error) {
      console.error('Resend error:', error)
      setResendMessage(t('check_email_resend_failed'))
    } finally {
      setIsResending(false)
      // Clear message after 5 seconds
      setTimeout(() => setResendMessage(''), 5000)
    }
  }

  const handleBackToLogin = () => {
    router.push('/auth')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="h-16 w-16 bg-blue-500 rounded-full flex items-center justify-center">
              <Mail className="h-8 w-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center">
            {t('check_email_title')}
          </CardTitle>
          <CardDescription className="text-center">
            {t('check_email_description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center space-y-4">
            {unverified ? (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {t('check_email_not_verified_title')}
                </p>
                {email && (
                  <p className="text-sm text-amber-800 dark:text-amber-200 mt-2">
                    <strong>{email}</strong>
                  </p>
                )}
                <p className="text-sm text-amber-800 dark:text-amber-200 mt-2">
                  {t('check_email_not_verified_hint')}
                </p>
              </div>
            ) : (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-center justify-center space-x-2 mb-3">
                  <CheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <span className="font-medium text-blue-900 dark:text-blue-100">
                    {t('check_email_success_title')}
                  </span>
                </div>
                {email && (
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {t('check_email_sent_to')} <strong>{email}</strong>
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                {t('check_email_instruction1')}
              </p>
              <p>
                {t('check_email_instruction2')}
              </p>
            </div>

            {resendMessage && (
              <Alert className={resendMessage.includes('Failed') ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}>
                <AlertDescription>
                  {resendMessage}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <Button 
                onClick={handleResendEmail}
                disabled={isResending}
                variant="outline" 
                className="w-full"
              >
                {isResending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {t('check_email_resending')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t('check_email_resend_button')}
                  </>
                )}
              </Button>

              <Button 
                onClick={handleBackToLogin}
                variant="ghost" 
                className="w-full"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('check_email_back_button')}
              </Button>
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              {t('check_email_help_text')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function CheckEmailPage() {
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
      <CheckEmailContent />
    </Suspense>
  )
}
