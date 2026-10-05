
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { createRAGClient } from '@/lib/rag-providers/factory'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { PineconeClient } from '@/lib/rag-providers/clients/pinecone'
import { tryGetKnowledgeStore } from '@/lib/knowledge'
import { getProviderApiKey } from '@/lib/secret-vault'

interface StorageItemForDelete {
  id: number
  ragProvider: string | null
  ragStatus: string | null
  vectorStoreFileId: string | null
  openaiFileId: string | null
  blobPath: string | null
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'agentId is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id,
      },
      select: {
        id: true,
        vectorStoreId: true,
        gitbookImportedPages: true,
        gitbookSpaceId: true,
      },
    })

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        aiProviders: { select: { providers: true } },
        ragProviders: { select: { defaultProvider: true, providers: true } },
        subscription: { select: { serviceVariant: true, managedRegion: true } },
      },
    })

    const deleteAll = searchParams.get('all') === 'true'

    if (deleteAll) {
      const itemsToDelete = await prisma.storage.findMany({
        where: {
          agentId,
          type: 'gitbook',
        },
        select: {
          id: true,
          ragProvider: true,
          ragStatus: true,
          vectorStoreFileId: true,
          openaiFileId: true,
          blobPath: true,
        },
      })

      if (itemsToDelete.length > 0) {
        await deleteFromRAG(itemsToDelete, user, agent.gitbookSpaceId, agent.vectorStoreId, agentId)
      }

      const result = await prisma.storage.deleteMany({
        where: {
          agentId,
          type: 'gitbook',
        },
      })

      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          gitbookImportedPages: '[]',
        },
      })

      return NextResponse.json({
        success: true,
        deletedAll: result.count,
        message: `${result.count}개의 GitBook 아이템이 삭제되었습니다.`,
      })
    }

    const itemsToDelete = await prisma.storage.findMany({
      where: {
        agentId,
        type: 'gitbook',
        OR: [
          { status: 'processing' },
          { ragStatus: { contains: 'processing' } },
          { ragStatus: { contains: 'status_processing' } },
        ],
      },
      select: {
        id: true,
        ragProvider: true,
        ragStatus: true,
        vectorStoreFileId: true,
        openaiFileId: true,
      },
    })

    const pathsToRemove: string[] = []
    for (const item of itemsToDelete) {
      if (item.ragStatus) {
        try {
          const ragStatusObj = JSON.parse(item.ragStatus)
          if (ragStatusObj.gitbook?.pagePath) {
            pathsToRemove.push(ragStatusObj.gitbook.pagePath)
          }
        } catch (e) {
        }
      }
    }

    if (itemsToDelete.length > 0) {
      await deleteFromRAG(itemsToDelete, user, agent.gitbookSpaceId, agent.vectorStoreId, agentId)
    }

    const deletedItems = await prisma.storage.deleteMany({
      where: {
        id: { in: itemsToDelete.map((item) => item.id) },
      },
    })

    if (pathsToRemove.length > 0 && agent.gitbookImportedPages) {
      try {
        const importedPages = JSON.parse(agent.gitbookImportedPages)
        const updatedPages = importedPages.filter(
          (page: { path: string }) => !pathsToRemove.includes(page.path)
        )
        await prisma.agent.update({
          where: { id: agent.id },
          data: {
            gitbookImportedPages: JSON.stringify(updatedPages),
          },
        })
      } catch (e) {
        console.error('Failed to update gitbookImportedPages:', describeCaughtError(e))
      }
    }

    return NextResponse.json({
      success: true,
      deletedProcessing: deletedItems.count,
      message: `${deletedItems.count}개의 진행 중인 Import가 취소되었습니다.`,
    })
  } catch (error) {
    console.error('Cancel GitBook import error:', describeCaughtError(error))
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function deleteFromRAG(
  items: StorageItemForDelete[],
  user: any,
  spaceId: string | null,
  agentVectorStoreId: string | null,
  agentId: string
) {
  try {
    let ragProvidersJson: any = {}
    if (user?.ragProviders?.providers) {
      try {
        ragProvidersJson =
          typeof user.ragProviders.providers === 'string'
            ? JSON.parse(user.ragProviders.providers)
            : user.ragProviders.providers
      } catch (e) {
        console.error('Failed to parse ragProviders.providers:', describeCaughtError(e))
      }
    }

    const pineconeItems: StorageItemForDelete[] = []
    const openaiItems: StorageItemForDelete[] = []
    const geminiItems: StorageItemForDelete[] = []
    const azureItems: StorageItemForDelete[] = []

    for (const item of items) {
      if (item.ragProvider === 'pinecone') {
        pineconeItems.push(item)
      } else if (item.ragProvider === 'openai_vector_store') {
        openaiItems.push(item)
      } else if (item.ragProvider === 'gemini_file_search') {
        geminiItems.push(item)
      } else if (item.ragProvider === 'azure_ai_search') {
        azureItems.push(item)
      }
    }

    if (pineconeItems.length > 0) {
      await deletePineconeVectors(pineconeItems, ragProvidersJson, user, spaceId)
    }

    if (openaiItems.length > 0) {
      await deleteOpenAIFiles(openaiItems, user, agentVectorStoreId)
    }

    if (geminiItems.length > 0) {
      await deleteGeminiFiles(geminiItems, user)
    }

    if (azureItems.length > 0) {
      await deleteAzureAISearchChunks(azureItems, user, agentId)
    }
  } catch (error) {
    console.error('Failed to delete from RAG:', describeCaughtError(error))
  }
}

async function deletePineconeVectors(
  items: StorageItemForDelete[],
  ragProvidersJson: any,
  user: any,
  spaceId: string | null
) {
  try {
    const pineconeConfig = ragProvidersJson.pinecone
    if (!pineconeConfig?.apiKey || !pineconeConfig?.indexName) {
      console.warn('Pinecone config not found, skipping vector deletion')
      return
    }

    let embeddingApiKey: string | undefined
    if (pineconeConfig.embeddingModel && !pineconeConfig.embeddingModel.includes('llama')) {
      embeddingApiKey = await getProviderApiKey(prisma, session.user.id, 'openai', user) || undefined
    }

    const pineconeClient = createRAGClient('pinecone', pineconeConfig.apiKey, {
      indexName: pineconeConfig.indexName,
      namespace: pineconeConfig.namespace,
      embeddingModel: pineconeConfig.embeddingModel,
      dimension: pineconeConfig.dimension,
      embeddingApiKey,
    }) as PineconeClient

    for (const item of items) {
      if (item.ragStatus) {
        try {
          const ragStatusObj = JSON.parse(item.ragStatus)

          const idPrefix = ragStatusObj.pinecone?.idPrefix
          const vectorCount = ragStatusObj.pinecone?.vectorCount

          if (idPrefix && vectorCount > 0) {
            const idsToDelete = Array.from(
              { length: vectorCount },
              (_, i) => `${idPrefix}-chunk-${i}`
            )

            try {
              await pineconeClient.deleteDocuments('gitbook', idsToDelete)
              console.log(`Deleted Pinecone vectors for combined file: ${idPrefix} (${vectorCount} vectors)`)
            } catch (deleteError) {
              console.warn(`Failed to delete vectors for ${idPrefix}:`, deleteError)
            }
            continue
          }

          const pagePath = ragStatusObj.gitbook?.pagePath
          const itemSpaceId = ragStatusObj.gitbook?.spaceId || spaceId

          if (pagePath && itemSpaceId) {
            const safePath = pagePath.replace(/[^a-zA-Z0-9-]/g, '-')
            const oldIdPrefix = `gitbook-${itemSpaceId}-${safePath}`

            const idsToDelete: string[] = []
            for (let i = 0; i < 100; i++) {
              idsToDelete.push(`${oldIdPrefix}-chunk-${i}`)
            }

            try {
              await pineconeClient.deleteDocuments('gitbook', idsToDelete)
              console.log(`Deleted Pinecone vectors for: ${oldIdPrefix}`)
            } catch (deleteError) {
              console.warn(`Failed to delete some vectors for ${oldIdPrefix}:`, deleteError)
            }
          }
        } catch (e) {
          console.error('Failed to parse ragStatus for Pinecone deletion:', e)
        }
      }
    }
  } catch (error) {
    console.error('Pinecone deletion error:', error)
  }
}

async function deleteOpenAIFiles(
  items: StorageItemForDelete[],
  user: any,
  agentVectorStoreId: string | null
) {
  try {
    const openaiApiKey = await getProviderApiKey(prisma, session.user.id, 'openai', user)
    if (!openaiApiKey) {
      console.warn('OpenAI API key not found, skipping file deletion')
      return
    }

    if (!agentVectorStoreId) {
      console.warn('Agent Vector Store ID not found, skipping file deletion')
      return
    }

    const openaiClient = createRAGClient('openai_vector_store', openaiApiKey)

    for (const item of items) {
      const fileId = item.vectorStoreFileId || item.openaiFileId

      let ragFileId: string | null = null
      if (!fileId && item.ragStatus) {
        try {
          const ragStatusObj = JSON.parse(item.ragStatus)
          ragFileId = ragStatusObj.openai_vector_store?.fileId
        } catch (e) {
        }
      }

      const targetFileId = fileId || ragFileId
      if (targetFileId) {
        try {
          await openaiClient.deleteFile(agentVectorStoreId, targetFileId)
          console.log(`Deleted OpenAI file: ${targetFileId}`)
        } catch (deleteError) {
          console.warn(`Failed to delete OpenAI file ${targetFileId}:`, deleteError)
        }
      }
    }
  } catch (error) {
    console.error('OpenAI deletion error:', error)
  }
}

async function deleteGeminiFiles(
  items: StorageItemForDelete[],
  user: any
) {
  try {
    const geminiApiKey = await getProviderApiKey(prisma, session.user.id, 'gemini', user)
    if (!geminiApiKey) {
      console.warn('Gemini API key not found, skipping file deletion')
      return
    }

    const geminiClient = createRAGClient('gemini_file_search', geminiApiKey)

    for (const item of items) {
      if (item.ragStatus) {
        try {
          const ragStatusObj = JSON.parse(item.ragStatus)
          const geminiFileId = ragStatusObj.gemini_file_search?.fileId ||
            ragStatusObj.gemini?.fileId

          if (geminiFileId) {
            try {
              await geminiClient.deleteFile('', geminiFileId)
              console.log(`Deleted Gemini file: ${geminiFileId}`)
            } catch (deleteError) {
              console.warn(`Failed to delete Gemini file ${geminiFileId}:`, deleteError)
            }
          }
        } catch (e) {
          console.error('Failed to parse ragStatus for Gemini deletion:', e)
        }
      }
    }
  } catch (error) {
    console.error('Gemini deletion error:', error)
  }
}

async function deleteAzureAISearchChunks(
  items: StorageItemForDelete[],
  user: any,
  agentId: string
) {
  try {
    const region = user?.subscription?.managedRegion
    if (user?.subscription?.serviceVariant !== 'managed' || !region) {
      console.warn('[GitBook Cancel] Not a managed user, skipping Azure AI Search deletion')
      return
    }

    const store = await tryGetKnowledgeStore({ regionId: region }, 'GitBook Cancel')
    if (!store) return

    const deletedStorageIds = new Set<string>()
    for (const item of items) {
      const storageIdStr = String(item.id)
      try {
        await store.deleteDoc({ agentId }, storageIdStr)
        deletedStorageIds.add(storageIdStr)
        console.log(`[GitBook Cancel] Azure AI Search chunks deleted for storage=${storageIdStr}`)
      } catch (error) {
        console.warn(`[GitBook Cancel] Failed to delete Azure AI Search chunks for storage=${storageIdStr}:`, describeCaughtError(error))
      }
    }

    if (!deletedStorageIds.has('0')) {
      try {
        await store.deleteDoc({ agentId }, '0')
        console.log(`[GitBook Cancel] Azure AI Search orphan chunks (storageId=0) deleted for agent=${agentId}`)
      } catch (error) {
        console.warn(`[GitBook Cancel] Failed to delete orphan chunks (storageId=0) for agent=${agentId}:`, describeCaughtError(error))
      }
    }

    const blobPaths = items
      .map(item => item.blobPath)
      .filter((p): p is string => !!p && p.length > 0)

    if (blobPaths.length > 0) {
      try {
        const { deleteFromBlob } = await import('@/lib/managed/blob-storage')
        for (const blobPath of blobPaths) {
          try {
            await deleteFromBlob(region, blobPath)
            console.log('[GitBook Cancel] Blob file deleted')
          } catch (error) {
            console.warn('[GitBook Cancel] Failed to delete Blob file:', describeCaughtError(error))
          }
        }
      } catch (error) {
        console.warn('[GitBook Cancel] Failed to import blob-storage module:', describeCaughtError(error))
      }
    }
  } catch (error) {
    console.error('[GitBook Cancel] Azure AI Search deletion error:', describeCaughtError(error))
  }
}
