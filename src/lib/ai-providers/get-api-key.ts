
import { PrismaClient } from '@prisma/client'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { getProviderApiKey } from '@/lib/secret-vault'
import { LLMProviderType } from './core/types'

interface UserWithAiProviders {
  id: string
  encryptedDataKey: Buffer | null
  zkiId?: number | null
  zki?: {
    masterKey: string
  } | null
  aiProviders?: {
    id: string
    providers: string | null
    defaultProvider: string
  } | null
}

export async function getApiKeyFromUser(
  user: UserWithAiProviders,
  provider: LLMProviderType = 'openai'
): Promise<string | null> {
  if (!user.encryptedDataKey || !user.aiProviders?.providers) {
    return null
  }

  try {
    let dek: Buffer
    if (user.zkiId && user.zki?.masterKey) {
      dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
    } else {
      dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
    }

    const providersConfig = JSON.parse(user.aiProviders.providers)
    const providerConfig = providersConfig[provider]

    if (!providerConfig?.apiKey) {
      return null
    }

    return decrypt(Buffer.from(providerConfig.apiKey, 'base64'), dek)
  } catch (error) {
    console.error(`[getApiKeyFromUser] Failed to get ${provider} API key:`, error)
    return null
  }
}

export async function getApiKeyByUserId(
  prisma: PrismaClient,
  userId: string,
  provider: LLMProviderType = 'openai'
): Promise<string | null> {
  return getProviderApiKey(prisma, userId, provider)
}

export function hasApiKey(
  user: UserWithAiProviders,
  provider: LLMProviderType = 'openai'
): boolean {
  if (!user.aiProviders?.providers) {
    return false
  }

  try {
    const providersConfig = JSON.parse(user.aiProviders.providers)
    return !!providersConfig[provider]?.apiKey
  } catch {
    return false
  }
}

export function hasAnyApiKey(user: UserWithAiProviders): boolean {
  if (!user.aiProviders?.providers) {
    return false
  }

  try {
    const providersConfig = JSON.parse(user.aiProviders.providers)
    for (const [, config] of Object.entries(providersConfig)) {
      if ((config as any)?.apiKey) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

export function getConfiguredProviders(user: UserWithAiProviders): LLMProviderType[] {
  if (!user.aiProviders?.providers) {
    return []
  }

  try {
    const providersConfig = JSON.parse(user.aiProviders.providers)
    const configured: LLMProviderType[] = []

    for (const [provider, config] of Object.entries(providersConfig)) {
      if ((config as any)?.apiKey) {
        configured.push(provider as LLMProviderType)
      }
    }

    return configured
  } catch {
    return []
  }
}

export function getDefaultProvider(user: UserWithAiProviders): LLMProviderType {
  return (user.aiProviders?.defaultProvider as LLMProviderType) || 'openai'
}
