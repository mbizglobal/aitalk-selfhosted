import { useState, useEffect, useCallback } from 'react'
import { useSession, signOut } from 'next-auth/react'

export interface TeamMemberInfo {
  id: number | string
  email: string
  displayName: string | null
  isOwner?: boolean
  authMethod?: string  // password | oauth
}

interface StoredAuth {
  token: string
  expiresAt: number
  member: TeamMemberInfo
  agentId: string
}

const STORAGE_KEY_PREFIX = 'team_auth_'

function getStorageKey(agentId: string) {
  return `${STORAGE_KEY_PREFIX}${agentId}`
}

export const useTeamAuth = (agentId: string) => {
  const [token, setToken] = useState<string | null>(null)
  const [member, setMember] = useState<TeamMemberInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isOwner, setIsOwner] = useState(false)

  const [isOAuthLoading, setIsOAuthLoading] = useState(false)
  const [oauthError, setOauthError] = useState('')
  const [oauthAttempted, setOauthAttempted] = useState(false)

  const { data: session, status: sessionStatus } = useSession()

  useEffect(() => {
    if (!agentId) return

    const loadAuth = async () => {
      try {
        const ownerResponse = await fetch(`/api/chat/${agentId}/team/check-owner`)
        if (ownerResponse.ok) {
          const ownerData = await ownerResponse.json()
          if (ownerData.isOwner && ownerData.owner) {
            setMember({
              id: ownerData.owner.id,
              email: ownerData.owner.email,
              displayName: ownerData.owner.name,
              isOwner: true
            })
            setIsOwner(true)
            setIsAuthenticated(true)
            setIsLoading(false)
            return
          }
        }

        const stored = localStorage.getItem(getStorageKey(agentId))
        if (!stored) {
          setIsLoading(false)
          return
        }

        const auth: StoredAuth = JSON.parse(stored)

        if (auth.expiresAt * 1000 < Date.now()) {
          localStorage.removeItem(getStorageKey(agentId))
          setIsLoading(false)
          return
        }

        if (auth.agentId !== agentId) {
          localStorage.removeItem(getStorageKey(agentId))
          setIsLoading(false)
          return
        }

        setToken(auth.token)
        setMember(auth.member)
        setIsAuthenticated(true)
      } catch (error) {
        console.error('Failed to load auth:', error)
        localStorage.removeItem(getStorageKey(agentId))
      } finally {
        setIsLoading(false)
      }
    }

    loadAuth()
  }, [agentId])

  useEffect(() => {
    const tryOAuthLogin = async () => {
      if (
        sessionStatus === 'authenticated' &&
        session?.user?.email &&
        !isAuthenticated &&
        !oauthAttempted &&
        !isLoading
      ) {
        setOauthAttempted(true)
        setIsOAuthLoading(true)
        setOauthError('')

        try {
          const response = await fetch(`/api/chat/${agentId}/team/oauth-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })

          const data = await response.json()

          if (response.ok) {
            loginWithOAuth(data.token, data.expiresAt, data.member)
          } else if (data.usePassword) {
            setOauthError('이 계정은 비밀번호로 로그인해야 합니다.')
            await signOut({ redirect: false })
          } else {
            setOauthError(data.error || 'OAuth 로그인에 실패했습니다.')
            await signOut({ redirect: false })
          }
        } catch (error) {
          setOauthError('서버 오류가 발생했습니다.')
          await signOut({ redirect: false })
        } finally {
          setIsOAuthLoading(false)
        }
      }
    }

    tryOAuthLogin()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, session, agentId, isAuthenticated, oauthAttempted, isLoading])

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`/api/chat/${agentId}/team/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const data = await response.json()

      if (!response.ok) {
        return { success: false, error: data.error || '로그인에 실패했습니다.' }
      }

      const auth: StoredAuth = {
        token: data.token,
        expiresAt: data.expiresAt,
        member: data.member,
        agentId
      }

      localStorage.setItem(getStorageKey(agentId), JSON.stringify(auth))
      setToken(data.token)
      setMember(data.member)
      setIsAuthenticated(true)

      return { success: true }
    } catch (error) {
      console.error('Login error:', error)
      return { success: false, error: '서버 오류가 발생했습니다.' }
    }
  }, [agentId])

  const logout = useCallback(() => {
    localStorage.removeItem(getStorageKey(agentId))
    setToken(null)
    setMember(null)
    setIsAuthenticated(false)
    setIsOwner(false)
    setOauthAttempted(false)
  }, [agentId])

  const loginWithOAuth = useCallback((newToken: string, expiresAt: number, memberInfo: TeamMemberInfo) => {
    const auth: StoredAuth = {
      token: newToken,
      expiresAt,
      member: memberInfo,
      agentId
    }
    localStorage.setItem(getStorageKey(agentId), JSON.stringify(auth))
    setToken(newToken)
    setMember(memberInfo)
    setIsAuthenticated(true)
  }, [agentId])

  const updateDisplayName = useCallback(async (newDisplayName: string): Promise<boolean> => {
    if (!token) return false

    try {
      const response = await fetch(`/api/chat/${agentId}/team/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ displayName: newDisplayName })
      })

      if (!response.ok) {
        console.error('Failed to update display name')
        return false
      }

      const data = await response.json()

      if (data.member) {
        setMember(data.member)

        const stored = localStorage.getItem(getStorageKey(agentId))
        if (stored) {
          const auth: StoredAuth = JSON.parse(stored)
          auth.member = data.member
          localStorage.setItem(getStorageKey(agentId), JSON.stringify(auth))
        }
      }

      return true
    } catch (error) {
      console.error('Update display name error:', error)
      return false
    }
  }, [agentId, token])

  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!token) {
      return { success: false, error: '인증이 필요합니다.' }
    }

    try {
      const response = await fetch(`/api/chat/${agentId}/team/profile/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      })

      const data = await response.json()

      if (!response.ok) {
        return { success: false, error: data.error || '비밀번호 변경에 실패했습니다.' }
      }

      return { success: true }
    } catch (error) {
      console.error('Change password error:', error)
      return { success: false, error: '서버 오류가 발생했습니다.' }
    }
  }, [agentId, token])

  const requestEmailChange = useCallback(async (
    newEmail: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!token) {
      return { success: false, error: '인증이 필요합니다.' }
    }

    try {
      const response = await fetch(`/api/chat/${agentId}/team/profile/email/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newEmail })
      })

      const data = await response.json()

      if (!response.ok) {
        return { success: false, error: data.error || '이메일 변경 요청에 실패했습니다.' }
      }

      return { success: true }
    } catch (error) {
      console.error('Request email change error:', error)
      return { success: false, error: '서버 오류가 발생했습니다.' }
    }
  }, [agentId, token])

  useEffect(() => {
    if (!token) return

    const checkExpiry = () => {
      try {
        const stored = localStorage.getItem(getStorageKey(agentId))
        if (!stored) {
          logout()
          return
        }

        const auth: StoredAuth = JSON.parse(stored)
        if (auth.expiresAt * 1000 < Date.now()) {
          logout()
        }
      } catch {
        logout()
      }
    }

    const interval = setInterval(checkExpiry, 60000)
    return () => clearInterval(interval)
  }, [token, agentId, logout])

  const authMethod = member?.authMethod || (() => {
    try {
      const stored = localStorage.getItem(getStorageKey(agentId))
      if (stored) {
        const auth: StoredAuth = JSON.parse(stored)
        return auth.member?.authMethod
      }
    } catch {
      return undefined
    }
    return undefined
  })()

  return {
    token,
    member,
    isLoading,
    isAuthenticated,
    isOwner,
    authMethod,
    isOAuthLoading,
    oauthError,
    sessionStatus,
    login,
    logout,
    loginWithOAuth,
    updateDisplayName,
    changePassword,
    requestEmailChange
  }
}
