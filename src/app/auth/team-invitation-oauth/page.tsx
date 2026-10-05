'use client'

import { useState, useEffect, Suspense } from 'react'
import { useGoogleLoginEnabled } from '@/components/EditionProvider'
import { useSearchParams, useRouter } from 'next/navigation'
import { signIn, signOut, useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, CheckCircle, XCircle, LogIn } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'
import { formatDateWithUserSettings } from '@/lib/format-date-with-user-settings'

interface InvitationInfo {
  agentTitle: string
  inviterName: string
  email: string
  expiresAt: string
  status: string
}

function TeamInvitationOAuthContent() {
  const googleLogin = useGoogleLoginEnabled()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session, status } = useSession()
  const [token, setToken] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [userTimeFormat, setUserTimeFormat] = useState<string>('MM-DD-YYYY HH:mm')

  useEffect(() => {
    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      setToken(tokenParam)
      verifyInvitation(tokenParam)
    } else {
      setError('초대 토큰이 없습니다.')
      setVerifying(false)
    }
  }, [searchParams])

  useEffect(() => {
    const fetchUserInfo = async () => {
      if (session?.user) {
        try {
          const response = await fetch('/api/dashboard/user-info')
          const data = await response.json()
          if (data.success && data.data?.time_format) {
            setUserTimeFormat(data.data.time_format)
          }
        } catch (error) {
          console.error('Failed to fetch user info:', error)
        }
      }
    }
    fetchUserInfo()
  }, [session])

  useEffect(() => {
    if (session?.user && token && invitation && !success && !loading) {
      handleOAuthAcceptInvitation()
    }
  }, [session, token, invitation, success, loading])

  const verifyInvitation = async (inviteToken: string) => {
    try {
      const response = await fetch(`/api/auth/team-invitation/verify?token=${inviteToken}`)
      const data = await response.json()

      if (response.ok) {
        setInvitation(data.invitation)
      } else {
        setError(data.error || '초대 정보를 확인할 수 없습니다.')
      }
    } catch (err) {
      setError('서버 오류가 발생했습니다.')
    } finally {
      setVerifying(false)
    }
  }

  const handleOAuthAcceptInvitation = async () => {
    if (!token || !session?.user?.email) return

    if (session.user.email !== invitation?.email) {
      setError(`초대된 이메일(${invitation?.email})과 로그인된 이메일(${session.user.email})이 일치하지 않습니다.`)
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/auth/team-invitation/accept-oauth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          userEmail: session.user.email,
          displayName: session.user.name || session.user.email?.split('@')[0]
        })
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(true)
        setTimeout(() => {
          router.push(`/chat/${data.agentId}`)
        }, 3000)
      } else {
        setError(data.error || '초대 수락에 실패했습니다.')
      }
    } catch (err) {
      setError('서버 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    const currentUrl = new URL(window.location.href)
    await signIn('google', {
      callbackUrl: currentUrl.pathname + currentUrl.search
    })
  }

  const handleSignOut = async () => {
    await signOut({ redirect: false })
  }

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>초대 정보를 확인하는 중...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <XCircle className="h-16 w-16 text-red-500" />
            </div>
            <CardTitle className="text-red-600">초대 오류</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-gray-600">{error}</p>
          </CardContent>
          <CardFooter>
            <Link href="/" className="w-full">
              <Button variant="outline" className="w-full">
                홈으로 돌아가기
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <CheckCircle className="h-16 w-16 text-green-500" />
            </div>
            <CardTitle className="text-green-600">초대 수락 완료!</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-gray-600">
              팀에 성공적으로 가입되었습니다.<br />
              잠시 후 채팅방으로 이동합니다...
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading && session?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>초대를 처리하는 중...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>팀 초대 - OAuth 로그인</CardTitle>
          <CardDescription>
            {invitation?.inviterName}님이 "{invitation?.agentTitle}" 에이전트에 초대했습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">초대 정보</h4>
            <div className="space-y-1 text-sm text-blue-800">
              <p><strong>초대된 이메일:</strong> {invitation?.email}</p>
              <p><strong>에이전트:</strong> {invitation?.agentTitle}</p>
              <p><strong>초대자:</strong> {invitation?.inviterName}</p>
              <p><strong>만료일:</strong> {invitation?.expiresAt ? formatDateWithUserSettings(invitation.expiresAt, userTimeFormat) : ''}</p>
            </div>
          </div>

          {status === 'loading' ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>로그인 상태 확인 중...</span>
            </div>
          ) : session?.user ? (
            <div className="space-y-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <h4 className="font-medium text-green-900 mb-2">로그인된 계정</h4>
                <div className="space-y-1 text-sm text-green-800">
                  <p><strong>이름:</strong> {session.user.name}</p>
                  <p><strong>이메일:</strong> {session.user.email}</p>
                </div>
              </div>

              {session.user.email === invitation?.email ? (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    이메일이 일치합니다. 자동으로 초대를 처리합니다...
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    로그인된 이메일({session.user.email})이 초대된 이메일({invitation?.email})과 일치하지 않습니다.
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={handleSignOut}
                disabled={loading}
              >
                다른 계정으로 로그인
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 text-center">
                초대를 수락하려면 <strong>{invitation?.email}</strong> 계정으로 로그인해주세요.
              </p>

              {googleLogin && (
              <Button
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <LogIn className="mr-2 h-4 w-4" />
                Google로 로그인
              </Button>
              )}

              <div className="text-center">
                <Link
                  href={`/auth/team-invitation?token=${token}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  이메일/비밀번호로 로그인하기
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function TeamInvitationOAuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>로딩 중...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    }>
      <TeamInvitationOAuthContent />
    </Suspense>
  )
}