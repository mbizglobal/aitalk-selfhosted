
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import {
  encrypt,
  decrypt,
  decryptDataKey,
  decryptDataKeyWithLegacy,
  maskApiKey
} from '@/lib/encryption'
import { ensureUserDataKey } from '@/lib/user-data-key'
import {
  LLM_PROVIDER_REGISTRY,
  LLMProviderType,
  providerRegistry,
} from '@/lib/ai-providers'
import { prisma } from '@/lib/prisma'
import { decryptData } from '@/lib/encryption'

interface ProviderStatus {
  id: LLMProviderType
  name: string
  hasApiKey: boolean
  maskedApiKey?: string
  isImplemented: boolean
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { aiProviders: true, zki: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const settings = await prisma.settings.findUnique({
      where: { id: userId },
      select: { vaultEnabled: true, vaultUrl: true, vaultAuthToken: true }
    })
    const isVaultEnabled = settings?.vaultEnabled && settings?.vaultUrl && settings?.vaultAuthToken

    let vaultKeys: Set<string> | null = null
    if (isVaultEnabled) {
      try {
        const token = await decryptData(settings!.vaultAuthToken!)
        const res = await fetch(settings!.vaultUrl!, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list' }),
        })
        if (res.ok) {
          const data = await res.json()
          vaultKeys = new Set(data.keys || [])
        }
      } catch {
      }
    }

    const providerStatuses: ProviderStatus[] = []

    let providersConfig: Record<string, any> = {}
    if (user.aiProviders?.providers) {
      try {
        providersConfig = JSON.parse(user.aiProviders.providers)
      } catch (e) {
      }
    }

    for (const [providerId, providerDef] of Object.entries(LLM_PROVIDER_REGISTRY)) {
      const typedProviderId = providerId as LLMProviderType
      const status: ProviderStatus = {
        id: typedProviderId,
        name: providerDef.name,
        hasApiKey: false,
        isImplemented: true
      }

      if (isVaultEnabled && vaultKeys) {
        const vaultKeyName = `ai_provider_${typedProviderId}_api_key`
        status.hasApiKey = vaultKeys.has(vaultKeyName)
        if (status.hasApiKey) {
          status.maskedApiKey = '(Secret Vault)'
        }
      } else {
        const config = providersConfig[typedProviderId]
        if (config?.apiKey && user.encryptedDataKey) {
          status.hasApiKey = true
          try {
            let dek: Buffer
            if (user.zkiId && user.zki?.masterKey) {
              dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
            } else {
              dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
            }
            const apiKey = decrypt(Buffer.from(config.apiKey, 'base64'), dek)
            status.maskedApiKey = maskApiKey(apiKey)
          } catch (e) {
            status.maskedApiKey = '************'
          }
        }
      }

      providerStatuses.push(status)
    }

    return NextResponse.json({
      providers: providerStatuses,
      defaultProvider: user.aiProviders?.defaultProvider || 'openai',
      vaultEnabled: !!isVaultEnabled
    })

  } catch (error) {
    console.error('[AI Providers] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const { provider, apiKey, setAsDefault } = body as {
      provider: LLMProviderType
      apiKey: string
      setAsDefault?: boolean
    }

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 })
    }

    const providerDef = providerRegistry.get(provider)
    if (!providerDef) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { aiProviders: true, zki: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    let providersConfig: Record<string, any> = {}
    if (user.aiProviders?.providers) {
      try {
        providersConfig = JSON.parse(user.aiProviders.providers)
      } catch (e) {
      }
    }

    if (!apiKey?.trim()) {
      if (!providersConfig[provider]?.apiKey) {
        return NextResponse.json({ error: 'API key is required' }, { status: 400 })
      }

      if (setAsDefault) {
        await prisma.aiProviders.update({
          where: { id: userId },
          data: { defaultProvider: provider }
        })
        return NextResponse.json({
          success: true,
          message: `${providerDef.name} set as default provider`
        })
      }

      return NextResponse.json({ error: 'No changes to save' }, { status: 400 })
    }

    const isValid = await validateProviderApiKey(provider, apiKey)
    if (!isValid) {
      return NextResponse.json({ error: `Invalid ${providerDef.name} API key` }, { status: 400 })
    }

    const dataKey = await ensureUserDataKey(prisma, userId)

    const encryptedApiKey = encrypt(apiKey, dataKey).toString('base64')

    providersConfig[provider] = {
      apiKey: encryptedApiKey,
      updatedAt: new Date().toISOString()
    }

    const updateData: any = {
      providers: JSON.stringify(providersConfig)
    }

    if (setAsDefault) {
      updateData.defaultProvider = provider
    }

    await prisma.aiProviders.upsert({
      where: { id: userId },
      update: updateData,
      create: {
        id: userId,
        providers: JSON.stringify(providersConfig),
        defaultProvider: setAsDefault ? provider : 'openai'
      }
    })

    if (provider === 'openai') {
      try {
        const OpenAI = (await import('openai')).default
        const openai = new OpenAI({ apiKey })

        const agents = await prisma.agent.findMany({
          where: { userId }
        })

        const existingVectorStores = await prisma.agent.count({
          where: {
            userId,
            vectorStoreId: { not: null }
          }
        })

        let vectorStoreCounter = existingVectorStores + 1
        const createdVectorStores: any[] = []

        for (const agent of agents) {
          if (!agent.vectorStoreId || !agent.vectorStoreName) {
            try {
              const vectorStoreName = `AITalk_${String(vectorStoreCounter).padStart(2, '0')}_${agent.agentId}`

              const vectorStore = await openai.vectorStores.create({
                name: vectorStoreName
              })

              await prisma.agent.update({
                where: { agentId: agent.agentId },
                data: {
                  vectorStoreId: vectorStore.id,
                  vectorStoreName: vectorStore.name,
                  updatedAt: new Date()
                }
              })

              createdVectorStores.push({
                agentId: agent.agentId,
                vectorStoreId: vectorStore.id,
                vectorStoreName: vectorStore.name
              })

              vectorStoreCounter++
            } catch (vsError) {
            }
          }
        }

        if (createdVectorStores.length > 0) {
          return NextResponse.json({
            success: true,
            message: `${providerDef.name} API key saved successfully`,
            createdVectorStores
          })
        }
      } catch (vsError) {
      }
    }

    return NextResponse.json({
      success: true,
      message: `${providerDef.name} API key saved successfully`
    })

  } catch (error) {
    console.error('[AI Providers] POST error:', error)
    return NextResponse.json({ error: 'Failed to save API key' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider') as LLMProviderType

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 })
    }

    const providerDef = providerRegistry.get(provider)

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { aiProviders: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (!user.aiProviders?.providers) {
      return NextResponse.json({
        success: true,
        message: `${providerDef?.name || provider} API key deleted`
      })
    }

    let providersConfig: Record<string, any>
    try {
      providersConfig = JSON.parse(user.aiProviders.providers)
    } catch (e) {
      console.error('[AI Providers] Failed to parse providers JSON:', e)
      return NextResponse.json({ error: 'Failed to parse provider config' }, { status: 500 })
    }

    delete providersConfig[provider]

    let newDefaultProvider = user.aiProviders.defaultProvider
    if (newDefaultProvider === provider) {
      const remainingProviders = Object.keys(providersConfig)
      newDefaultProvider = remainingProviders[0] || ''
    }

    await prisma.aiProviders.update({
      where: { id: userId },
      data: {
        providers: JSON.stringify(providersConfig),
        defaultProvider: newDefaultProvider
      }
    })

    return NextResponse.json({
      success: true,
      message: `${providerDef?.name || provider} API key deleted`
    })

  } catch (error) {
    console.error('[AI Providers] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 })
  }
}

async function validateProviderApiKey(provider: LLMProviderType, apiKey: string): Promise<boolean> {
  try {
    switch (provider) {
      case 'openai': {
        const OpenAI = (await import('openai')).default
        const client = new OpenAI({ apiKey })
        await client.models.list()
        return true
      }

      case 'gemini': {
        const { GoogleGenAI } = await import('@google/genai')
        const client = new GoogleGenAI({ apiKey })
        await client.models.list()
        return true
      }

      case 'claude': {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }]
          })
        })
        return response.status !== 401 && response.status !== 403
      }

      case 'deepseek': {
        const response = await fetch('https://api.deepseek.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        })
        return response.ok
      }

      case 'grok': {
        const response = await fetch('https://api.x.ai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        })
        return response.ok
      }

      case 'mistral': {
        const response = await fetch('https://api.mistral.ai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        })
        return response.ok
      }

      default: {
        const providerDef = providerRegistry.get(provider)
        if (providerDef?.connection?.baseUrl) {
          try {
            const response = await fetch(`${providerDef.connection.baseUrl}/models`, {
              headers: { 'Authorization': `Bearer ${apiKey}` }
            })
            return response.ok
          } catch {
            return true
          }
        }
        return false
      }
    }
  } catch (error) {
    console.error(`[AI Providers] Validation failed for ${provider}:`, error)
    return false
  }
}
