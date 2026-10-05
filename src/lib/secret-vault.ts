
import { PrismaClient } from '@prisma/client'
import { decryptData } from '@/lib/encryption'
import { getApiKeyFromUser } from '@/lib/ai-providers/get-api-key'
import { LLMProviderType } from '@/lib/ai-providers/core/types'

interface VaultConfig {
  vaultEnabled: boolean
  vaultUrl: string | null
  vaultAuthToken: string | null
}

async function getVaultConfig(prisma: PrismaClient, userId: string): Promise<VaultConfig> {
  const settings = await prisma.settings.findUnique({
    where: { id: userId },
    select: {
      vaultEnabled: true,
      vaultUrl: true,
      vaultAuthToken: true,
    },
  })

  return {
    vaultEnabled: settings?.vaultEnabled ?? false,
    vaultUrl: settings?.vaultUrl ?? null,
    vaultAuthToken: settings?.vaultAuthToken ?? null,
  }
}

async function fetchFromVault(vaultUrl: string, authToken: string, keyName: string): Promise<string> {
  const token = await decryptData(authToken)

  const url = new URL(vaultUrl)
  url.searchParams.set('key', keyName)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`Vault returned ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    if (!data.value) {
      throw new Error(`Key "${keyName}" not found in Vault`)
    }

    return data.value
  } finally {
    clearTimeout(timeout)
  }
}

export async function testVaultConnection(vaultUrl: string, authToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    try {
      const response = await fetch(vaultUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'test' }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        return { success: false, error: `HTTP ${response.status}: ${errorText}` }
      }

      const data = await response.json()
      return { success: data.status === 'ok', error: data.status !== 'ok' ? 'Unexpected response' : undefined }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Connection timed out (10s)' }
    }
    return { success: false, error: error.message || 'Connection failed' }
  }
}

export async function getProviderApiKey(
  prisma: PrismaClient,
  userId: string,
  provider: LLMProviderType = 'openai',
  user?: any
): Promise<string | null> {
  const vault = await getVaultConfig(prisma, userId)

  if (vault.vaultEnabled && vault.vaultUrl && vault.vaultAuthToken) {
    try {
      const keyName = `ai_provider_${provider}_api_key`
      return await fetchFromVault(vault.vaultUrl, vault.vaultAuthToken, keyName)
    } catch (error: any) {
      console.warn(`[SecretVault] ${provider} key not found in Vault: ${error.message}`)
      throw new Error(`[Secret Vault] Could not retrieve "${provider}" API key from your Lambda. Please check that the key "ai_provider_${provider}_api_key" exists in your Lambda environment variables. (Settings > Security)`)
    }
  }

  if (user) {
    return getApiKeyFromUser(user, provider)
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      encryptedDataKey: true,
      zkiId: true,
      zki: { select: { masterKey: true } },
      aiProviders: { select: { id: true, providers: true, defaultProvider: true } },
    },
  })

  if (!dbUser) return null
  return getApiKeyFromUser(dbUser as any, provider)
}

export async function getConnectionSecret(
  prisma: PrismaClient,
  userId: string,
  connectionId: string,
  encryptedValue: string,
  authType?: string | null
): Promise<string> {
  if (authType === 'oauth') {
    return decryptData(encryptedValue)
  }

  const vault = await getVaultConfig(prisma, userId)

  if (vault.vaultEnabled && vault.vaultUrl && vault.vaultAuthToken) {
    try {
      const keyName = `wf_conn_${connectionId}_token`
      return await fetchFromVault(vault.vaultUrl, vault.vaultAuthToken, keyName)
    } catch (error: any) {
      console.warn(`[SecretVault] Connection ${connectionId} not found in Vault: ${error.message}`)
      throw new Error(`[Secret Vault] Could not retrieve connection token from your Lambda. Please check that the key "wf_conn_${connectionId}_token" exists in your Lambda environment variables. (Settings > Security)`)
    }
  }

  return decryptData(encryptedValue)
}

export async function getBotChannelSecret(
  prisma: PrismaClient,
  userId: string,
  channelId: string,
  secretType: 'token' | 'slack_signing_secret' | 'slack_client_secret' | 'slack_bot_token',
  encryptedValue: string
): Promise<string> {
  const vault = await getVaultConfig(prisma, userId)

  if (vault.vaultEnabled && vault.vaultUrl && vault.vaultAuthToken) {
    try {
      const keyName = `bot_channel_${channelId}_${secretType}`
      return await fetchFromVault(vault.vaultUrl, vault.vaultAuthToken, keyName)
    } catch (error: any) {
      console.warn(`[SecretVault] Bot channel ${channelId}/${secretType} not found in Vault: ${error.message}`)
      throw new Error(`[Secret Vault] Could not retrieve bot channel token from your Lambda. Please check that the key "bot_channel_${channelId}_${secretType}" exists in your Lambda environment variables. (Settings > Security)`)
    }
  }

  return decryptData(encryptedValue)
}
