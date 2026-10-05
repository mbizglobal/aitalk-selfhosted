
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { hasAnyApiKey, hasApiKey, getConfiguredProviders, LLMProviderType } from '@/lib/ai-providers'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const RAG_TO_LLM_PROVIDER: Record<string, LLMProviderType> = {
  openai_vector_store: 'openai',
  gemini_file_search: 'gemini',
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider') as LLMProviderType | null
    const ragProvider = searchParams.get('ragProvider')

    // Get user with aiProviders
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        encryptedDataKey: true,
        aiProviders: {
          select: {
            id: true,
            providers: true,
            defaultProvider: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ hasApiKey: false, configuredProviders: [] })
    }

    const configuredProviders = getConfiguredProviders(user as any)

    if (ragProvider) {
      const llmProvider = RAG_TO_LLM_PROVIDER[ragProvider]
      if (llmProvider) {
        const hasProviderKey = hasApiKey(user as any, llmProvider)
        return NextResponse.json({
          hasApiKey: hasProviderKey,
          provider: llmProvider,
          ragProvider,
          configuredProviders
        })
      }
      return NextResponse.json({
        hasApiKey: false,
        ragProvider,
        configuredProviders
      })
    }

    if (provider) {
      const hasProviderKey = hasApiKey(user as any, provider)
      return NextResponse.json({
        hasApiKey: hasProviderKey,
        provider,
        configuredProviders
      })
    }

    const hasKey = hasAnyApiKey(user as any)

    return NextResponse.json({
      hasApiKey: hasKey,
      configuredProviders
    })
  } catch (error) {
    console.error('Failed to check API key:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
