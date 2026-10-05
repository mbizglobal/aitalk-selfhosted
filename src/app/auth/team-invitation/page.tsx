'use client'

import { useState, useEffect, Suspense, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { formatDateWithUserSettings } from '@/lib/format-date-with-user-settings'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface InvitationInfo {
  agentTitle: string
  inviterName: string
  email: string
  expiresAt: string
  status: string
  locale?: string
}

function TeamInvitationContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [lang, setLang] = useState<SupportedLang>('en')

  const t = useCallback((key: Parameters<typeof getTeamTranslation>[1]) => {
    return getTeamTranslation(lang, key)
  }, [lang])

  const verifyInvitation = useCallback(async (inviteToken: string) => {
    try {
      const response = await fetch(`/api/auth/team-invitation/verify?token=${inviteToken}`)
      const data = await response.json()

      if (response.ok) {
        setInvitation(data.invitation)
        setDisplayName(data.invitation.email.split('@')[0])
        if (data.invitation.locale) {
          setLang(data.invitation.locale as SupportedLang)
        }
      } else {
        setError(data.error || getTeamTranslation(lang, 'team_invitation_error_invalid'))
      }
    } catch {
      setError(getTeamTranslation(lang, 'team_invitation_error_server'))
    } finally {
      setVerifying(false)
    }
  }, [lang])

  useEffect(() => {
    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      setToken(tokenParam)
      verifyInvitation(tokenParam)
    } else {
      setError(getTeamTranslation(lang, 'team_invitation_error_no_token'))
      setVerifying(false)
    }
  }, [searchParams, verifyInvitation, lang])

  const handleAcceptInvitation = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!token) return

    if (password !== confirmPassword) {
      setError(t('team_invitation_error_password_mismatch'))
      return
    }

    if (password.length < 8) {
      setError(t('team_invitation_error_password_length'))
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/auth/team-invitation/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          password,
          displayName: displayName.trim() || undefined
        })
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(true)
        setTimeout(() => {
          const teamUrl = `/chat/${data.agentId}/team${data.workflowId ? `?workflowId=${data.workflowId}` : ''}`
          router.push(teamUrl)
        }, 3000)
      } else {
        setError(data.error || t('team_invitation_error_accept_failed'))
      }
    } catch {
      setError(t('team_invitation_error_server'))
    } finally {
      setLoading(false)
    }
  }

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>{t('team_invitation_verifying')}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <XCircle className="h-16 w-16 text-red-500" />
            </div>
            <CardTitle className="text-red-600 dark:text-red-400">{t('team_invitation_error_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-gray-600 dark:text-gray-400">{error}</p>
          </CardContent>
          <CardFooter>
            <Link href="/" className="w-full">
              <Button variant="outline" className="w-full">
                {t('team_invitation_go_home')}
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <CheckCircle className="h-16 w-16 text-green-500" />
            </div>
            <CardTitle className="text-green-600 dark:text-green-400">{t('team_invitation_success_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-gray-600 dark:text-gray-400">
              {t('team_invitation_success_message')}<br />
              {t('team_invitation_success_redirect')}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const getDescription = () => {
    return t('team_invitation_description')
      .replace('{inviterName}', invitation?.inviterName || '')
      .replace('{agentTitle}', invitation?.agentTitle || '')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('team_invitation_title')}</CardTitle>
          <CardDescription>
            {getDescription()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAcceptInvitation} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('team_invitation_email')}</Label>
              <Input
                id="email"
                type="email"
                value={invitation?.email || ''}
                disabled
                className="bg-gray-50 dark:bg-gray-800"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">{t('team_invitation_display_name')}</Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('team_invitation_display_name_placeholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('team_invitation_password')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('team_invitation_password_placeholder')}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('team_invitation_confirm_password')}</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('team_invitation_confirm_password_placeholder')}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {error && (
              <div className="text-red-500 text-sm text-center">{error}</div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('team_invitation_processing')}
                </>
              ) : (
                t('team_invitation_accept')
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('team_invitation_expires')}: {invitation?.expiresAt ? formatDateWithUserSettings(invitation.expiresAt, 'MM-DD-YYYY HH:mm') : ''}
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}

export default function TeamInvitationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Loading...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    }>
      <TeamInvitationContent />
    </Suspense>
  )
}