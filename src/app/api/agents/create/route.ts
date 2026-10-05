import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { createAdditionalAgent } from '@/lib/agent'
import { getApiTranslation } from '@/lib/translations'
import { decrypt, decryptDataKey, decryptDataKeyWithLegacy } from '@/lib/encryption'
import OpenAI from 'openai'
import { isSelfHosted } from '@/lib/edition'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function POST(request: NextRequest) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const userId = session.user.id

    const currentAgentCount = await prisma.agent.count({
      where: { userId: userId }
    })

    const selfHosted = isSelfHosted()
    const subscription = selfHosted ? null : await prisma.subscription.findUnique({
      where: { id: userId },
      select: { num_assistant: true, serviceVariant: true }
    })

    const limit = selfHosted ? SELF_HOSTED_POLICY.agentLimit : (subscription?.num_assistant || 1)
    const isManaged = subscription?.serviceVariant === 'managed'

    if (currentAgentCount >= limit) {
      return NextResponse.json({
        error: 'Agent creation limit reached',
        limit,
        current: currentAgentCount
      }, { status: 403 })
    }

    if ((isManaged || selfHosted) && currentAgentCount >= 1) {
      const settings = await prisma.settings.findUnique({
        where: { id: userId },
        select: { locale: true }
      })
      const locale = settings?.locale || 'en-US'
      const languageMap: Record<string, 'en' | 'de' | 'fr' | 'es' | 'ko'> = {
        'en-US': 'en', 'de-DE': 'de', 'fr-FR': 'fr', 'es-ES': 'es', 'ko-KR': 'ko'
      }
      const language = languageMap[locale] || 'en'

      const agent = await createAdditionalAgent(userId, language, prisma)

      return NextResponse.json({
        success: true,
        agent: {
          id: agent.id,
          agentId: agent.agentId,
          title: agent.title,
          accessMode: agent.accessMode,
          vectorStoreId: null,
          vectorStoreName: null,
          createdAt: agent.createdAt
        }
      })
    }

    if (currentAgentCount >= 1) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { aiProviders: true, zki: true }
      })

      if (!user?.encryptedDataKey || !user?.aiProviders?.providers) {
        return NextResponse.json({
          error: t('api_error_api_key_required') || 'OpenAI API Key is required to create additional agents'
        }, { status: 400 })
      }

      let apiKey: string
      try {
        const providersConfig = JSON.parse(user.aiProviders.providers)
        if (!providersConfig.openai?.apiKey) {
          return NextResponse.json({
            error: t('api_error_api_key_required') || 'OpenAI API Key is required to create additional agents'
          }, { status: 400 })
        }
        let dek: Buffer
        if (user.zkiId && user.zki?.masterKey) {
          dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
        } else {
          dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
        }
        apiKey = decrypt(Buffer.from(providersConfig.openai.apiKey, "base64"), dek)
      } catch (error) {
        return NextResponse.json({
          error: t('api_error_api_key_invalid') || 'Failed to decrypt API Key'
        }, { status: 500 })
      }

      const openai = new OpenAI({ apiKey })

      const settings = await prisma.settings.findUnique({
        where: { id: userId },
        select: { locale: true }
      })

      const locale = settings?.locale || 'en-US'
      const languageMap: Record<string, 'en' | 'de' | 'fr' | 'es' | 'ko'> = {
        'en-US': 'en',
        'de-DE': 'de',
        'fr-FR': 'fr',
        'es-ES': 'es',
        'ko-KR': 'ko'
      }
      const language = languageMap[locale] || 'en'

      const agent = await createAdditionalAgent(userId, language, prisma)

      try {
        const existingVectorStores = await prisma.agent.count({
          where: {
            userId: userId,
            vectorStoreId: { not: null }
          }
        })

        const vectorStoreCounter = existingVectorStores + 1
        const vectorStoreName = `AITalk_${String(vectorStoreCounter).padStart(2, '0')}_${agent.agentId}`

        let vectorStore
        try {
          vectorStore = await openai.vectorStores.create({
            name: vectorStoreName
          })
        } catch (apiError) {
          // Fallback to direct API call
          const response = await fetch('https://api.openai.com/v1/vector_stores', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
              name: vectorStoreName
            })
          })

          if (!response.ok) {
            throw new Error(`Failed to create Vector Store: ${response.status}`)
          }

          vectorStore = await response.json()
        }

        await prisma.agent.update({
          where: { agentId: agent.agentId },
          data: {
            vectorStoreId: vectorStore.id,
            vectorStoreName: vectorStore.name,
            updatedAt: new Date()
          }
        })

        return NextResponse.json({
          success: true,
          agent: {
            id: agent.id,
            agentId: agent.agentId,
            title: agent.title,
            accessMode: agent.accessMode,
            vectorStoreId: vectorStore.id,
            vectorStoreName: vectorStore.name,
            createdAt: agent.createdAt
          }
        })

      } catch (error) {
        await prisma.agent.delete({
          where: { agentId: agent.agentId }
        })

        return NextResponse.json({
          error: t('api_error_vector_store_failed') || 'Failed to create Vector Store for new agent'
        }, { status: 500 })
      }

    } else {
      return NextResponse.json({
        error: 'This API is only for creating additional agents. First agent is created during signup.'
      }, { status: 400 })
    }

  } catch (error) {
    const t = getApiTranslation(request)
    return NextResponse.json(
      { error: t('api_error_failed_to_create_agent') || 'Failed to create agent' },
      { status: 500 }
    )
  }
}
