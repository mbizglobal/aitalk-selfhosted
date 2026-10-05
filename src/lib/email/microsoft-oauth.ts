
import { PrismaClient } from '@prisma/client'
import { encryptData, decryptData } from '@/lib/encryption'
import { describeUpstreamError, readUpstreamJson } from '@/lib/log-mask'

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || ''
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || ''

const isDev = process.env.NODE_ENV === 'development'

export type MicrosoftEmailConnectType = 'imap' | 'smtp' | 'both'

export function parseMicrosoftEmailConnectType(raw: unknown): MicrosoftEmailConnectType | null {
  return raw === 'imap' || raw === 'smtp' || raw === 'both' ? raw : null
}

export async function getValidAccessToken(
  connection: {
    id: string
    encryptedToken: string | null
    refreshToken: string | null
    tokenExpiresAt: Date | null
  },
  prisma: PrismaClient
): Promise<string> {
  if (!connection.encryptedToken) {
    throw new Error('No access token stored')
  }

  const accessToken = await decryptData(connection.encryptedToken)

  const now = new Date()
  const bufferMs = 5 * 60 * 1000
  const expiresAt = connection.tokenExpiresAt

  if (expiresAt && expiresAt.getTime() > now.getTime() + bufferMs) {
    return accessToken
  }

  if (isDev) {
    console.log('[Microsoft OAuth] Token expired or expiring soon, refreshing...')
  }

  if (!connection.refreshToken) {
    throw new Error('No refresh token available. Please reconnect your Microsoft account.')
  }

  const refreshToken = await decryptData(connection.refreshToken)
  const newTokens = await refreshMicrosoftToken(refreshToken)

  const encryptedAccessToken = await encryptData(newTokens.access_token)
  const encryptedRefreshToken = newTokens.refresh_token
    ? await encryptData(newTokens.refresh_token)
    : connection.refreshToken
  const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000)

  await prisma.workflowConnection.update({
    where: { id: connection.id },
    data: {
      encryptedToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: newExpiresAt,
      status: 'active',
      errorMessage: null
    }
  })

  if (isDev) {
    console.log('[Microsoft OAuth] Token refreshed successfully')
  }

  return newTokens.access_token
}

async function refreshMicrosoftToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token?: string
  expires_in: number
}> {
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
    throw new Error('Microsoft OAuth credentials not configured')
  }

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Microsoft OAuth] Token refresh failed:', describeUpstreamError(response.status, errorText))

    let upstreamError: unknown
    try {
      upstreamError = JSON.parse(errorText)?.error
    } catch {
    }

    if (upstreamError === 'invalid_grant') {
      throw new Error('Microsoft session expired. Please reconnect your account.')
    }

    throw new Error('Failed to refresh Microsoft token')
  }

  return readUpstreamJson(response)
}

export function isMicrosoftHost(host: string): boolean {
  return host.includes('office365.com') ||
         host.includes('outlook.com') ||
         host.includes('microsoft.com')
}
