
import { prisma } from '@/lib/prisma'
import { OpenAI } from 'openai'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { PineconeClient, PineconeConnectionConfig } from '@/lib/rag-providers/clients/pinecone'
import { getKnowledgeStore, knowledgeTargetFor } from '@/lib/knowledge'
import { crawlQueue } from '@/lib/crawlQueue'
import { describeCaughtError } from '@/lib/log-mask'
import { isSelfHosted } from '@/lib/edition'

export type DeleteStorageItemResult =
  | { ok: true }
  | { ok: false; code: 'AGENT_NOT_FOUND' | 'ITEM_NOT_FOUND' | 'CLEANUP_FAILED'; message: string }

export async function deleteStorageItem(params: {
  userId: string
  agentId: string
  storageId: number
}): Promise<DeleteStorageItemResult> {
  const { userId, agentId, storageId } = params

  const agent = await prisma.agent.findUnique({
    where: { agentId },
  })

  if (!agent || agent.userId !== userId) {
    return { ok: false, code: 'AGENT_NOT_FOUND', message: 'Agent not found or unauthorized' }
  }

  const storageItem = await prisma.storage.findUnique({
    where: {
      id: storageId,
      agentId,
    },
  })

  if (!storageItem) {
    return { ok: false, code: 'ITEM_NOT_FOUND', message: 'Storage item not found' }
  }

  if (storageItem.type === 'website' && storageItem.status === 'processing') {
    crawlQueue.cancelJob(storageId)
  }

  const claimed = await prisma.storage.updateMany({
    where: { id: storageId, agentId },
    data: { status: 'deleting' },
  })
  if (claimed.count === 0) {
    return { ok: false, code: 'ITEM_NOT_FOUND', message: 'Storage item not found' }
  }

  const deletePromises: Promise<any>[] = []

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { aiProviders: true, ragProviders: true, zki: true, subscription: isSelfHosted() ? false : { select: { serviceVariant: true, managedRegion: true } } }
  })

  if (storageItem.type === 'miniapp_image' && storageItem.blobPath && user?.subscription?.managedRegion) {
    const deleteMiniAppBlob = async () => {
      try {
        const { deleteFromBlob, blobRef } = await import('@/lib/managed/blob-storage')
        await deleteFromBlob(user.subscription!.managedRegion!, storageItem.blobPath!)
        console.log(`[DELETE] Mini App image blob deleted: ${blobRef(storageItem.blobPath!)}`)
      } catch (error) {
        console.warn('[DELETE] Failed to delete Mini App image blob:', describeCaughtError(error))
      }
    }
    deletePromises.push(deleteMiniAppBlob())
  }

  //
  let azureCleanupError: string | null = null
  const knowledgeTarget = knowledgeTargetFor(user?.subscription)
  if (knowledgeTarget && storageItem.ragProvider === knowledgeTarget.provider) {
    let azureStep: 'config' | 'key-lookup' | 'chunks-by-key' | 'chunks-by-filter' | 'blob' = 'config'
    const deleteAzureResources = async () => {
      const region = knowledgeTarget.regionId
      const store = await getKnowledgeStore({ regionId: region, allowSelfHosted: true })

      azureStep = 'key-lookup'
      const fresh = await prisma.storage.findUnique({
        where: { id: storageId }, select: { ragStatus: true },
      })
      let key: { fileId: string; chunkCount: number } | null = null
      try {
        const az = fresh?.ragStatus ? JSON.parse(fresh.ragStatus as string)?.azure_ai_search : null
        if (az?.fileId && az?.chunkCount > 0) key = { fileId: az.fileId, chunkCount: az.chunkCount }
      } catch {
        console.warn(`[DELETE] ragStatus parse 실패 storage=${storageId} — filter 삭제로만 정리`)
      }

      await store.deleteDoc({ agentId }, String(storageId), key, { onStep: (step) => { azureStep = step } })
      console.log(`[DELETE] Azure AI Search chunks deleted for storage=${storageId}`)

      if (storageItem.blobPath) {
        azureStep = 'blob'
        const { deleteFromBlob, blobRef } = await import('@/lib/managed/blob-storage')
        await deleteFromBlob(region, storageItem.blobPath)
        console.log(`[DELETE] Blob file deleted: ${blobRef(storageItem.blobPath)}`)
      }
    }
    deletePromises.push(
      deleteAzureResources().catch(error => {
        azureCleanupError = `step=${azureStep} ${describeCaughtError(error)}`
        console.error(`[DELETE] Azure cleanup failed for storage=${storageId} — DB 행 보존:`, azureCleanupError)
      })
    )
  }

  if (storageItem.ragProvider === 'gemini_file_search') {
    try {
      const ragStatus = storageItem.ragStatus
        ? JSON.parse(storageItem.ragStatus as string)
        : null
      const geminiFileId = ragStatus?.gemini_file_search?.fileId || storageItem.openaiFileId

      if (geminiFileId && user?.aiProviders?.providers) {
        const providersConfig = JSON.parse(user.aiProviders.providers)
        if (providersConfig.gemini?.apiKey && user.encryptedDataKey) {
          let dek: Buffer
          if (user.zkiId && user.zki?.masterKey) {
            dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
          } else {
            dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
          }
          const geminiApiKey = decrypt(Buffer.from(providersConfig.gemini.apiKey, "base64"), dek)

          if (geminiApiKey && geminiApiKey !== "Decryption failed") {
            const deleteGeminiFile = async () => {
              try {
                const res = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/${geminiFileId}?key=${geminiApiKey}`,
                  { method: 'DELETE' }
                )
                if (res.ok) {
                  console.log(`[DELETE] Gemini file deleted: ${geminiFileId}`)
                }
              } catch (error) {
                console.warn('[DELETE] Failed to delete Gemini file:', error)
              }
            }
            deletePromises.push(deleteGeminiFile())
          }
        }
      }
    } catch (error) {
      console.warn('[DELETE] Failed to process Gemini deletion:', error)
    }
  }

  if (storageItem.ragProvider === 'pinecone' && user?.ragProviders?.providers) {
    try {
      const ragStatus = storageItem.ragStatus
        ? JSON.parse(storageItem.ragStatus as string)
        : null
      const vectorCount = ragStatus?.pinecone?.vectorCount || 0
      const idPrefix = ragStatus?.pinecone?.idPrefix

      if (vectorCount > 0) {
        const ragProvidersConfig = typeof user.ragProviders.providers === 'string'
          ? JSON.parse(user.ragProviders.providers)
          : user.ragProviders.providers

        if (ragProvidersConfig?.pinecone?.apiKey && ragProvidersConfig?.pinecone?.indexName) {
          const storedApiKey = ragProvidersConfig.pinecone.apiKey
          let pineconeApiKey: string

          if (storedApiKey.startsWith('pcsk_')) {
            pineconeApiKey = storedApiKey
          } else {
            let dek: Buffer
            if (user.zkiId && user.zki?.masterKey) {
              dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey!), user.zki.masterKey)
            } else {
              dek = await decryptDataKey(Buffer.from(user.encryptedDataKey!))
            }
            pineconeApiKey = decrypt(Buffer.from(storedApiKey, "base64"), dek)
          }

          if (pineconeApiKey && pineconeApiKey !== "Decryption failed") {
            const pineconeConfig: PineconeConnectionConfig = {
              host: ragProvidersConfig.pinecone.host || undefined,
              indexName: ragProvidersConfig.pinecone.indexName,
              namespace: ragProvidersConfig.pinecone.namespace || undefined,
              embeddingModel: ragProvidersConfig.pinecone.embeddingModel || 'text-embedding-3-small',
              dimension: ragProvidersConfig.pinecone.dimension || 1536,
            }

            const deletePineconeVectors = async () => {
              try {
                const pineconeClient = new PineconeClient(pineconeApiKey, pineconeConfig)
                const storedVectorIds = ragStatus?.pinecone?.vectorIds as string[] | undefined
                const vectorIds = storedVectorIds && storedVectorIds.length > 0
                  ? storedVectorIds
                  : idPrefix
                    ? Array.from({ length: vectorCount }, (_, i) => `${idPrefix}-chunk-${i}`)
                    : Array.from({ length: vectorCount }, (_, i) => `${storageId}-${i}`)
                await pineconeClient.deleteDocuments(pineconeConfig.indexName, vectorIds)
                console.log(`[DELETE] Pinecone vectors deleted: ${vectorIds.length} vectors`)
              } catch (error) {
                console.error('[DELETE] Failed to delete Pinecone vectors:', error)
              }
            }

            deletePromises.push(deletePineconeVectors())
          }
        }
      }
    } catch (error) {
      console.warn('[DELETE] Failed to process Pinecone deletion:', error)
    }
  }

  if ((storageItem.vectorStoreFileId && agent.vectorStoreId) || storageItem.openaiFileId) {
    if (user && user.encryptedDataKey && user.aiProviders?.providers) {
      try {
        const providersConfig = JSON.parse(user.aiProviders.providers)
        if (!providersConfig.openai?.apiKey) {
          throw new Error('OpenAI API key not configured')
        }
        let dek: Buffer
        if (user.zkiId && user.zki?.masterKey) {
          dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
        } else {
          dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
        }
        const userApiKey = decrypt(Buffer.from(providersConfig.openai.apiKey, "base64"), dek)

        const openai = new OpenAI({
          apiKey: userApiKey,
        })

        const vectorStoreFileId = storageItem.vectorStoreFileId
        const currentVectorStoreId = agent.vectorStoreId

        if (vectorStoreFileId && currentVectorStoreId) {
          const deleteVectorStoreFile = async () => {
            try {

              const response = await fetch(`https://api.openai.com/v1/vector_stores/${currentVectorStoreId}/files/${vectorStoreFileId}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${userApiKey}`,
                  'OpenAI-Beta': 'assistants=v2'
                }
              })

              if (!response.ok) {
                const errorText = await response.text()
                console.error(`[DELETE] HTTP API failed: ${response.status} - ${errorText}`)
                throw new Error(`HTTP ${response.status}: ${errorText}`)
              }

              await response.json()

            } catch (httpError) {
              console.warn('HTTP API failed, trying SDK methods:', httpError)

              try {
                if (openai.vectorStores?.files) {
                  await openai.vectorStores.files.delete(vectorStoreFileId, {
                    vector_store_id: currentVectorStoreId,
                  })
                } else {
                  throw new Error('Vector store file deletion API is not available in the SDK')
                }
              } catch (sdkError) {
                console.error('All vector store deletion methods failed:', sdkError)
              }
            }
          }

          deletePromises.push(deleteVectorStoreFile())
        }

        const openaiFileIdValue = storageItem.openaiFileId

        if (openaiFileIdValue) {
          const deleteOpenAIFile = async () => {
            try {

              const response = await fetch(`https://api.openai.com/v1/files/${openaiFileIdValue}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${userApiKey}`
                }
              })

              if (!response.ok) {
                const errorText = await response.text()
                console.error(`[DELETE] OpenAI file deletion HTTP API failed: ${response.status} - ${errorText}`)
                throw new Error(`HTTP ${response.status}: ${errorText}`)
              }

              await response.json()

            } catch (httpError) {
              console.warn('HTTP API failed for OpenAI file deletion, trying SDK methods:', httpError)

              try {
                if (openai.files.delete) {
                  await openai.files.delete(openaiFileIdValue)
                } else {
                  throw new Error('No available SDK method for file deletion')
                }
              } catch (sdkError) {
                console.error('All OpenAI file deletion methods failed:', sdkError)
              }
            }
          }

          deletePromises.push(deleteOpenAIFile())
        }
      } catch (error) {
        console.warn('Failed to decrypt API key for file deletion:', error)
      }
    }
  }

  if (deletePromises.length > 0) {
    await Promise.allSettled(deletePromises)
  }

  if (storageItem.type === 'gitbook') {
    try {
      const ragStatus = storageItem.ragStatus
        ? JSON.parse(storageItem.ragStatus as string)
        : null
      const pagesToRemove = ragStatus?.gitbook?.pages?.map((p: any) => p.path) || []

      const singlePagePath = ragStatus?.gitbook?.pagePath
      if (singlePagePath) {
        pagesToRemove.push(singlePagePath)
      }

      if (pagesToRemove.length > 0 && agent.gitbookImportedPages) {
        const importedPages = JSON.parse(agent.gitbookImportedPages as string || '[]')
        const pathsToRemoveSet = new Set(pagesToRemove)
        const updatedPages = importedPages.filter(
          (page: { path: string }) => !pathsToRemoveSet.has(page.path)
        )

        await prisma.agent.update({
          where: { agentId },
          data: {
            gitbookImportedPages: JSON.stringify(updatedPages),
          },
        })
      }
    } catch (e) {
      console.error('Failed to update gitbookImportedPages:', describeCaughtError(e))
    }
  }

  if (user?.subscription?.managedRegion) {
    const late = await prisma.storage.findUnique({ where: { id: storageId }, select: { blobPath: true } })
    if (late?.blobPath && late.blobPath !== storageItem.blobPath) {
      try {
        const { deleteFromBlob, blobRef } = await import('@/lib/managed/blob-storage')
        await deleteFromBlob(user.subscription.managedRegion, late.blobPath)
        console.log(`[DELETE] late blob deleted: ${blobRef(late.blobPath)}`)
      } catch (error) {
        azureCleanupError = `step=late-blob ${describeCaughtError(error)}`
        console.error('[DELETE] Failed to delete late blob — DB 행 보존:', azureCleanupError)
      }
    }
  }

  if (azureCleanupError) {
    return {
      ok: false,
      code: 'CLEANUP_FAILED',
      message: `Failed to clean up indexed data for this file (${azureCleanupError}). The file was kept so the deletion can be retried.`,
    }
  }

  await prisma.storage.deleteMany({
    where: { id: storageId, agentId },
  })

  return { ok: true }
}
