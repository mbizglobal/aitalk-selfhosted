import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getErrorMessage, getLanguageFromHeaders, getTranslations } from '@/lib/translations/dashboard'
import OpenAI from 'openai'
import { decrypt, decryptDataKey, decryptDataKeyWithLegacy } from '@/lib/encryption'
import { getKnowledgeStore, SELFHOSTED_REGION } from '@/lib/knowledge'
import { isSelfHosted } from '@/lib/edition'
import { describeCaughtError } from '@/lib/log-mask'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    const language = getLanguageFromHeaders(request.headers)
    const t = getTranslations(language)

    if (!session || !session.user?.id) {
      return NextResponse.json(
        { ok: false, message: getErrorMessage('api_error_unauthorized', language) },
        { status: 401 }
      )
    }

    const userId = session.user.id

    const body = await request.json()
    const { agentId } = body

    if (!agentId) {
      return NextResponse.json(
        { ok: false, message: getErrorMessage('api_error_agent_id_required', language) },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId: agentId,
        userId: userId
      },
      include: {
        storage: true
      }
    })

    if (!agent) {
      return NextResponse.json(
        { ok: false, message: getErrorMessage('api_error_agent_not_found_or_unauthorized', language) },
        { status: 403 }
      )
    }

    const conversationCount = await prisma.conversation.count({
      where: { agentId: agentId }
    })

    if (conversationCount > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: t.delete_agent_error_conversations_exist.replace('{count}', conversationCount.toString())
        },
        { status: 400 }
      )
    }

    const usageLogCount = await prisma.cpaUsageLog.count({
      where: { agentId: agentId }
    })

    if (usageLogCount > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: t.delete_agent_error_usage_logs_exist.replace('{count}', usageLogCount.toString())
        },
        { status: 400 }
      )
    }

    const userWithKeys = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        aiProviders: true,
        zki: true,
        subscription: { select: { serviceVariant: true, managedRegion: true } }
      }
    })

    let openai: OpenAI | null = null
    if (userWithKeys?.aiProviders?.providers && userWithKeys.encryptedDataKey) {
      try {
        const providersConfig = JSON.parse(userWithKeys.aiProviders.providers)
        if (providersConfig.openai?.apiKey) {
          let dek: Buffer
          if (userWithKeys.zkiId && userWithKeys.zki?.masterKey) {
            dek = decryptDataKeyWithLegacy(Buffer.from(userWithKeys.encryptedDataKey), userWithKeys.zki.masterKey)
          } else {
            dek = await decryptDataKey(Buffer.from(userWithKeys.encryptedDataKey))
          }
          const decryptedKey = decrypt(Buffer.from(providersConfig.openai.apiKey, 'base64'), dek)

          if (decryptedKey === 'Decryption failed' || !decryptedKey.startsWith('sk-')) {
            console.warn('API key decryption returned invalid value, skipping OpenAI resource deletion')
            openai = null
          } else {
            openai = new OpenAI({ apiKey: decryptedKey })
          }
        }
      } catch (error) {
        console.error('Failed to decrypt API key:', error)
        openai = null
      }
    }

    const openaiDeletionWarnings: string[] = []
    const openaiDeletionErrors: string[] = []

    const isAlreadyDeletedError = (error: any): boolean => {
      const status = error?.status ?? error?.response?.status
      return status === 404
    }

    const formatOpenAIError = (error: any): string => {
      const status = error?.status ?? error?.response?.status
      const message =
        error?.response?.data?.error?.message ??
        error?.error?.message ??
        error?.message ??
        String(error)
      return status ? `[${status}] ${message}` : message
    }

    if (openai && agent.storage && agent.storage.length > 0) {
      for (const storageItem of agent.storage) {
        if (storageItem.vectorStoreFileId && agent.vectorStoreId) {
          try {
            await openai.vectorStores.files.delete(storageItem.vectorStoreFileId, {
              vector_store_id: agent.vectorStoreId
            })
          } catch (error: any) {
            if (isAlreadyDeletedError(error)) {
              const warnMsg = `Vector Store 파일이 이미 삭제됨 (fileId: ${storageItem.vectorStoreFileId})`
              console.warn(warnMsg)
              openaiDeletionWarnings.push(warnMsg)
            } else {
              const errorMsg = `Vector Store 파일 삭제 실패 (fileId: ${storageItem.vectorStoreFileId}): ${formatOpenAIError(error)}`
              console.error(errorMsg)
              openaiDeletionErrors.push(errorMsg)
            }
          }
        }
      }

      for (const storageItem of agent.storage) {
        if (storageItem.openaiFileId) {
          try {
            await openai.files.delete(storageItem.openaiFileId)
          } catch (error: any) {
            if (isAlreadyDeletedError(error)) {
              const warnMsg = `OpenAI 파일이 이미 삭제됨 (fileId: ${storageItem.openaiFileId})`
              console.warn(warnMsg)
              openaiDeletionWarnings.push(warnMsg)
            } else {
              const errorMsg = `OpenAI 파일 삭제 실패 (fileId: ${storageItem.openaiFileId}): ${formatOpenAIError(error)}`
              console.error(errorMsg)
              openaiDeletionErrors.push(errorMsg)
            }
          }
        }
      }
    }

    if (openai && agent.vectorStoreId) {
      try {
        await openai.vectorStores.delete(agent.vectorStoreId)
      } catch (error: any) {
        if (isAlreadyDeletedError(error)) {
          const warnMsg = `Vector Store가 이미 삭제됨 (vectorStoreId: ${agent.vectorStoreId})`
          console.warn(warnMsg)
          openaiDeletionWarnings.push(warnMsg)
        } else {
          const errorMsg = `Vector Store 삭제 실패 (vectorStoreId: ${agent.vectorStoreId}): ${formatOpenAIError(error)}`
          console.error(errorMsg)
          openaiDeletionErrors.push(errorMsg)
        }
      }
    }

    if (openaiDeletionErrors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: t.delete_agent_openai_deletion_failed,
          errors: openaiDeletionErrors,
          warnings: openaiDeletionWarnings.length > 0 ? openaiDeletionWarnings : undefined
        },
        { status: 500 }
      )
    }

    const isManaged = userWithKeys?.subscription?.serviceVariant === 'managed'
    const managedRegion = userWithKeys?.subscription?.managedRegion
    const cleanupExternal = isManaged || isSelfHosted()
    const cleanupRegion = isSelfHosted() ? SELFHOSTED_REGION : managedRegion
    if (cleanupExternal) {
      const cleanupErrors: string[] = []

      try {
        if (!cleanupRegion) {
          throw new Error('managedRegion is not set for this managed account')
        }
        const store = await getKnowledgeStore({ regionId: cleanupRegion, allowSelfHosted: true })
        await store.deleteAgent(agentId)
        console.log(`[DeleteAgent] Azure AI Search chunks deleted for agent=${agentId}`)
      } catch (error) {
        console.error('[DeleteAgent] Azure AI Search cleanup failed — DB 삭제 중단:', describeCaughtError(error))
        cleanupErrors.push(`Azure AI Search cleanup failed: ${describeCaughtError(error)}`)
      }

      try {
        if (!cleanupRegion) {
          throw new Error('managedRegion is not set for this managed account')
        }
        const { deleteAgentBlobs } = await import('@/lib/managed/blob-storage')
        await deleteAgentBlobs(cleanupRegion, userId, agentId)
        console.log(`[DeleteAgent] Blob files deleted for agent=${agentId}`)
      } catch (error) {
        console.error('[DeleteAgent] Blob cleanup failed — DB 삭제 중단:', describeCaughtError(error))
        cleanupErrors.push(`Blob cleanup failed: ${describeCaughtError(error)}`)
      }

      if (cleanupErrors.length > 0) {
        return NextResponse.json(
          { ok: false, message: t.delete_agent_cleanup_failed, code: 'CLEANUP_FAILED' },
          { status: 500 }
        )
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.storage.deleteMany({
        where: {
          agentId: agentId,
          agent: {
            userId: userId
          }
        }
      })

      await tx.agentMemberInvitation.deleteMany({
        where: { agentAgentId: agentId }
      })

      await tx.agentMemberPasswordResetToken.deleteMany({
        where: { agentAgentId: agentId }
      })

      await tx.agentMemberEmailChangeToken.deleteMany({
        where: { agentAgentId: agentId }
      })

      const members = await tx.agentMember.findMany({
        where: { agentAgentId: agentId },
        select: { id: true }
      })
      if (members.length > 0) {
        const memberIds = members.map(m => m.id)
        await tx.agentMemberPasskey.deleteMany({
          where: { memberId: { in: memberIds } }
        })
      }

      await tx.agentMember.deleteMany({
        where: { agentAgentId: agentId }
      })

      await tx.agent.delete({
        where: { agentId: agentId }
      })
    })

    const hasApiKey = !!openai
    const successMessage = hasApiKey
      ? t.delete_agent_success.replace('{name}', agent.title)
      : t.delete_agent_success_no_api_key.replace('{name}', agent.title)

    return NextResponse.json(
      {
        ok: true,
        message: successMessage,
        hasApiKey,
        warnings: openaiDeletionWarnings.length > 0 ? openaiDeletionWarnings : undefined
      },
      { status: 200 }
    )

  } catch (error) {
    console.error('Error deleting agent:', error)
    const language = getLanguageFromHeaders(request.headers)
    const t = getTranslations(language)
    return NextResponse.json(
      { ok: false, message: t.delete_agent_error },
      { status: 500 }
    )
  }
}
