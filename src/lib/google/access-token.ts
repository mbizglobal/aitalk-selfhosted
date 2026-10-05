
import { PrismaClient } from '@prisma/client'
import { encryptData, decryptData } from '@/lib/encryption'
import { describeUpstreamError, readUpstreamJson } from '@/lib/log-mask'

function authError(message: string): Error {
  return Object.assign(new Error(message), { code: 'reconnect_required' })
}


const EXPIRY_BUFFER_MS = 60_000

const accountTokenInFlight = new Map<string, Promise<string>>()

interface RefreshResult {
  accessToken: string
  expiresAt: Date
}

export async function getGoogleAccessToken(
  prisma: PrismaClient,
  connectionId: string
): Promise<string> {
  const connection = await prisma.workflowConnection.findFirst({
    where: { id: connectionId, status: 'active' },
    select: {
      id: true,
      encryptedToken: true,
      refreshToken: true,
      tokenExpiresAt: true,
      oauthClientId: true,
      oauthClientSecret: true,
    },
  })

  if (!connection?.encryptedToken) {
    throw authError('Google connection not found or missing access token')
  }

  const now = Date.now()
  const notExpired =
    connection.tokenExpiresAt &&
    connection.tokenExpiresAt.getTime() - EXPIRY_BUFFER_MS > now

  if (notExpired) {
    return decryptData(connection.encryptedToken)
  }

  if (!connection.refreshToken) {
    throw authError('Google access token expired and no refresh token available')
  }
  if (!connection.oauthClientId || !connection.oauthClientSecret) {
    throw authError('Google OAuth connection is missing BYO client credentials')
  }

  const clientId = await decryptData(connection.oauthClientId)
  const clientSecret = await decryptData(connection.oauthClientSecret)
  const refreshToken = await decryptData(connection.refreshToken)
  const refreshed = await refreshGoogleToken(refreshToken, clientId, clientSecret)

  await prisma.workflowConnection.update({
    where: { id: connection.id },
    data: {
      encryptedToken: await encryptData(refreshed.accessToken),
      tokenExpiresAt: refreshed.expiresAt,
      lastUsedAt: new Date(),
    },
  })

  return refreshed.accessToken
}

export async function getCalendarAccountAccessToken(
  prisma: PrismaClient,
  accountId: string
): Promise<string> {
  const existing = accountTokenInFlight.get(accountId)
  if (existing) return existing

  const promise = (async () => {
    const account = await prisma.workflowCalendarAccount.findFirst({
      where: { id: accountId, status: 'active' },
      select: {
        id: true,
        encryptedToken: true,
        refreshToken: true,
        tokenExpiresAt: true,
        connection: {
          select: { oauthClientId: true, oauthClientSecret: true },
        },
      },
    })

    if (!account?.encryptedToken) {
      throw authError('Calendar account not found or missing access token')
    }

    const now = Date.now()
    const notExpired =
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() - EXPIRY_BUFFER_MS > now

    if (notExpired) {
      return decryptData(account.encryptedToken)
    }

    if (!account.refreshToken) {
      throw authError('Calendar account access token expired and no refresh token available')
    }
    if (!account.connection?.oauthClientId || !account.connection?.oauthClientSecret) {
      throw authError('Calendar account connection is missing BYO client credentials')
    }

    const clientId = await decryptData(account.connection.oauthClientId)
    const clientSecret = await decryptData(account.connection.oauthClientSecret)
    const refreshToken = await decryptData(account.refreshToken)
    const refreshed = await refreshGoogleToken(refreshToken, clientId, clientSecret)

    await prisma.workflowCalendarAccount.update({
      where: { id: account.id },
      data: {
        encryptedToken: await encryptData(refreshed.accessToken),
        tokenExpiresAt: refreshed.expiresAt,
        lastUsedAt: new Date(),
      },
    })

    return refreshed.accessToken
  })().finally(() => {
    accountTokenInFlight.delete(accountId)
  })

  accountTokenInFlight.set(accountId, promise)
  return promise
}

export async function refreshGoogleToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<RefreshResult> {
  if (!clientId || !clientSecret) {
    throw authError('Google OAuth client credentials required')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const summary = describeUpstreamError(response.status, await response.text())
    const message = `Google token refresh failed — ${summary}`
    throw /(^|, )code=invalid_grant(,|$)/.test(summary) ? authError(message) : new Error(message)
  }

  const data = await readUpstreamJson(response)

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return {
    accessToken: data.access_token as string,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  }
}
