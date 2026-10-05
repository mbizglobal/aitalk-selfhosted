
import { PrismaClient } from '@prisma/client'
import { encryptData, decryptData } from '@/lib/encryption'
import { getSharedMicrosoftApp } from './shared-oauth'
import { describeUpstreamError, readUpstreamJson } from '@/lib/log-mask'

function authError(message: string): Error {
  return Object.assign(new Error(message), { code: 'reconnect_required' })
}


const EXPIRY_BUFFER_MS = 60_000
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

// per-account in-flight Mutex
const accountTokenInFlight = new Map<string, Promise<string>>()

interface RefreshResult {
  accessToken: string
  refreshToken?: string
  expiresAt: Date
}

async function resolveClientCredentials(
  prisma: PrismaClient,
  conn: {
    oauthMode: string | null
    oauthClientId: string | null
    oauthClientSecret: string | null
  }
): Promise<{ clientId: string; clientSecret: string }> {
  if (conn.oauthMode === 'shared') {
    const shared = await getSharedMicrosoftApp(prisma)
    if (!shared) {
      throw new Error('Shared Microsoft OAuth app is not configured')
    }
    return shared
  }
  if (!conn.oauthClientId || !conn.oauthClientSecret) {
    throw authError('Microsoft OAuth connection is missing BYO client credentials')
  }
  return {
    clientId: await decryptData(conn.oauthClientId),
    clientSecret: await decryptData(conn.oauthClientSecret),
  }
}

export async function getMicrosoftAccessToken(
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
      oauthMode: true,
      oauthClientId: true,
      oauthClientSecret: true,
    },
  })

  if (!connection?.encryptedToken) {
    throw authError('Microsoft connection not found or missing access token')
  }

  const now = Date.now()
  const notExpired =
    connection.tokenExpiresAt &&
    connection.tokenExpiresAt.getTime() - EXPIRY_BUFFER_MS > now

  if (notExpired) {
    return decryptData(connection.encryptedToken)
  }

  if (!connection.refreshToken) {
    throw authError('Microsoft access token expired and no refresh token available')
  }

  const { clientId, clientSecret } = await resolveClientCredentials(prisma, connection)
  const refreshToken = await decryptData(connection.refreshToken)
  const refreshed = await refreshMicrosoftToken(refreshToken, clientId, clientSecret)

  await prisma.workflowConnection.update({
    where: { id: connection.id },
    data: {
      encryptedToken: await encryptData(refreshed.accessToken),
      refreshToken: refreshed.refreshToken
        ? await encryptData(refreshed.refreshToken)
        : connection.refreshToken,
      tokenExpiresAt: refreshed.expiresAt,
      lastUsedAt: new Date(),
    },
  })

  return refreshed.accessToken
}

export async function getMicrosoftCalendarAccountAccessToken(
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
          select: { oauthMode: true, oauthClientId: true, oauthClientSecret: true },
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
    if (!account.connection) {
      throw authError('Calendar account connection not found')
    }

    const { clientId, clientSecret } = await resolveClientCredentials(prisma, account.connection)
    const refreshToken = await decryptData(account.refreshToken)
    const refreshed = await refreshMicrosoftToken(refreshToken, clientId, clientSecret)

    await prisma.workflowCalendarAccount.update({
      where: { id: account.id },
      data: {
        encryptedToken: await encryptData(refreshed.accessToken),
        refreshToken: refreshed.refreshToken
          ? await encryptData(refreshed.refreshToken)
          : account.refreshToken,
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

export async function refreshMicrosoftToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<RefreshResult> {
  if (!clientId || !clientSecret) {
    throw authError('Microsoft OAuth client credentials required')
  }

  const response = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'Calendars.ReadWrite offline_access',
    }),
  })

  if (!response.ok) {
    const summary = describeUpstreamError(response.status, await response.text())
    const message = `Microsoft token refresh failed — ${summary}`
    throw /(^|, )code=invalid_grant(,|$)/.test(summary) ? authError(message) : new Error(message)
  }

  const data = await readUpstreamJson(response)

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return {
    accessToken: data.access_token as string,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  }
}
