
import { NextRequest } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { GitBookImporter } from '@/lib/integrations/gitbook'
import { createRAGClient } from '@/lib/rag-providers/factory'
import { RAGProviderType, RAGDocument } from '@/lib/rag-providers/types'
import { PineconeClient } from '@/lib/rag-providers/clients/pinecone'
import { getProviderApiKey } from '@/lib/secret-vault'
import {
  decrypt,
  decryptDataKey,
  decryptDataKeyWithLegacy,
} from '@/lib/encryption'
import { getLanguageFromHeaders, getErrorMessage } from '@/lib/translations/dashboard'
import { resolveRagSpaceId, RagSpaceError } from '@/lib/rag-space'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

interface ImportRequestBody {
  agentId: string
  pagePaths: string[]
  ragProvider?: string
  ragSpaceId?: number | string | null
}

interface ImportedPage {
  path: string
  title: string
  importedAt: string
  noData?: boolean
}

type StreamEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; current: number; total: number; title: string; path: string; phase?: 'collecting' | 'uploading' }
  | { type: 'complete'; imported: number; errors: string[] }
  | { type: 'stopped'; imported: number; errors: string[] }
  | { type: 'error'; message: string }

interface CollectedDocument {
  title: string
  path: string
  content: string
  metadata: any
}

export const maxDuration = 300

function sendEvent(controller: ReadableStreamDefaultController, event: StreamEvent) {
  try {
    const data = `data: ${JSON.stringify(event)}\n\n`
    controller.enqueue(new TextEncoder().encode(data))
  } catch (err) {
    console.error('sendEvent failed:', describeCaughtError(err))
  }
}

export async function POST(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  const abortSignal = request.signal

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const session = (await getServerSession(authOptions as any)) as any
        if (!session?.user?.id) {
          sendEvent(controller, { type: 'error', message: 'Unauthorized' })
          controller.close()
          return
        }

        const body: ImportRequestBody = await request.json()
        const { agentId, pagePaths, ragProvider, ragSpaceId: ragSpaceIdInput } = body

        if (!agentId) {
          sendEvent(controller, { type: 'error', message: 'agentId is required' })
          controller.close()
          return
        }

        if (!pagePaths || pagePaths.length === 0) {
          sendEvent(controller, { type: 'error', message: '페이지를 선택해주세요.' })
          controller.close()
          return
        }

        const user = await prisma.user.findUnique({
          where: { id: session.user.id },
          select: {
            id: true,
            encryptedDataKey: true,
            zkiId: true,
            zki: { select: { masterKey: true } },
            aiProviders: { select: { providers: true } },
            ragProviders: { select: { defaultProvider: true, providers: true } },
            subscription: { select: { serviceVariant: true, managedRegion: true, storagePerAgent: true } },
          },
        })

        const isManaged = user?.subscription?.serviceVariant === 'managed'

        if (!isManaged && (!user?.ragProviders?.defaultProvider || user.ragProviders.defaultProvider === 'none')) {
          sendEvent(controller, { type: 'error', message: 'RAG Provider가 설정되지 않았습니다.' })
          controller.close()
          return
        }

        const agent = await prisma.agent.findFirst({
          where: { agentId, userId: session.user.id },
          select: {
            id: true,
            userId: true,
            vectorStoreId: true,
            gitbookAccessToken: true,
            gitbookSpaceId: true,
            gitbookPublishedUrl: true,
            gitbookImportedPages: true,
          },
        })

        if (!agent) {
          sendEvent(controller, { type: 'error', message: 'Agent를 찾을 수 없습니다.' })
          controller.close()
          return
        }

        if (!agent.gitbookSpaceId) {
          sendEvent(controller, { type: 'error', message: 'GitBook Space ID가 설정되지 않았습니다.' })
          controller.close()
          return
        }

        if (user?.subscription?.storagePerAgent !== null && user?.subscription?.storagePerAgent !== undefined) {
          const currentUsage = await prisma.storage.aggregate({
            where: { agentId, status: 'completed' },
            _sum: { fileSizeBytes: true }
          })
          if ((currentUsage._sum.fileSizeBytes || 0) >= user.subscription.storagePerAgent) {
            sendEvent(controller, { type: 'error', message: getErrorMessage('api_error_storage_limit_exceeded', language) })
            controller.close()
            return
          }
        }

        let gitbookAccessToken: string | null = null

        if (agent.gitbookAccessToken) {
          if (!user.encryptedDataKey) {
            sendEvent(controller, { type: 'error', message: '암호화 키를 찾을 수 없습니다.' })
            controller.close()
            return
          }

          let dataKey: Buffer
          if (user.zkiId && user.zki?.masterKey) {
            dataKey = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
          } else {
            dataKey = await decryptDataKey(Buffer.from(user.encryptedDataKey))
          }

          gitbookAccessToken = decrypt(Buffer.from(agent.gitbookAccessToken, 'base64'), dataKey)
        }

        if (!gitbookAccessToken) {
          sendEvent(controller, { type: 'error', message: 'GitBook Access Token이 필요합니다.' })
          controller.close()
          return
        }

        let ragProvidersJson: any = {}
        if (user.ragProviders?.providers) {
          try {
            ragProvidersJson =
              typeof user.ragProviders.providers === 'string'
                ? JSON.parse(user.ragProviders.providers)
                : user.ragProviders.providers
          } catch (e) {
            console.error('Failed to parse ragProviders.providers:', describeCaughtError(e))
          }
        }

        const importer = new GitBookImporter({
          accessToken: gitbookAccessToken,
          publishedBaseUrl: agent.gitbookPublishedUrl || undefined,
        })

        const isConnected = await importer.validateConnectionWithSpace(agent.gitbookSpaceId)
        if (!isConnected) {
          sendEvent(controller, { type: 'error', message: 'GitBook 연결 실패.' })
          controller.close()
          return
        }

        const defaultProvider = isManaged
          ? 'azure_ai_search' as RAGProviderType
          : (ragProvider || user.ragProviders?.defaultProvider) as RAGProviderType

        let ragSpaceId: number | null = null
        if (isManaged && user?.subscription?.managedRegion) {
          try {
            ragSpaceId = await resolveRagSpaceId(agentId, ragSpaceIdInput)
          } catch (e) {
            if (e instanceof RagSpaceError) { sendEvent(controller, { type: 'error', message: e.message }); controller.close(); return }
            throw e
          }
        }

        let ragClient: any
        let knowledgeStore: import('@/lib/knowledge').KnowledgeStore<import('@/lib/knowledge').AzureKnowledgeRef> | null = null
        let uploadedContentHash: string | undefined
        if (defaultProvider === 'pinecone') {
          const pineconeConfig = ragProvidersJson.pinecone
          if (!pineconeConfig?.apiKey || !pineconeConfig?.indexName) {
            sendEvent(controller, { type: 'error', message: 'Pinecone 설정이 완료되지 않았습니다.' })
            controller.close()
            return
          }

          let embeddingApiKey: string | undefined
          if (pineconeConfig.embeddingModel && !pineconeConfig.embeddingModel.includes('llama')) {
            embeddingApiKey = await getProviderApiKey(prisma, session.user.id, 'openai', user) || undefined
          }

          ragClient = createRAGClient(defaultProvider, pineconeConfig.apiKey, {
            indexName: pineconeConfig.indexName,
            namespace: pineconeConfig.namespace,
            embeddingModel: pineconeConfig.embeddingModel,
            dimension: pineconeConfig.dimension,
            embeddingApiKey,
          })
        } else if (defaultProvider === 'openai_vector_store') {
          const openaiApiKey = await getProviderApiKey(prisma, session.user.id, 'openai', user)
          if (!openaiApiKey) {
            sendEvent(controller, { type: 'error', message: 'OpenAI API Key가 설정되지 않았습니다.' })
            controller.close()
            return
          }
          ragClient = createRAGClient(defaultProvider, openaiApiKey)
        } else if (defaultProvider === 'gemini_file_search') {
          const geminiApiKey = await getProviderApiKey(prisma, session.user.id, 'gemini', user)
          if (!geminiApiKey) {
            sendEvent(controller, { type: 'error', message: 'Gemini API Key가 설정되지 않았습니다.' })
            controller.close()
            return
          }
          ragClient = createRAGClient(defaultProvider, geminiApiKey)
        } else if (defaultProvider === 'azure_ai_search') {
          const { getKnowledgeStore, KnowledgeStoreUnavailable } = await import('@/lib/knowledge')

          const managedRegion = user?.subscription?.managedRegion
          if (!managedRegion) {
            sendEvent(controller, { type: 'error', message: 'Managed 리전이 설정되지 않았습니다.' })
            controller.close()
            return
          }

          try {
            knowledgeStore = await getKnowledgeStore({ regionId: managedRegion, docIntelligence: true })
          } catch (e) {
            if (!(e instanceof KnowledgeStoreUnavailable)) throw e
            sendEvent(controller, { type: 'error', message: 'Azure AI Search가 설정되지 않았습니다.' })
            controller.close()
            return
          }
        } else {
          sendEvent(controller, { type: 'error', message: `지원하지 않는 RAG Provider: ${defaultProvider}` })
          controller.close()
          return
        }

        let importedPages: ImportedPage[] = []
        if (agent.gitbookImportedPages) {
          try {
            importedPages = JSON.parse(agent.gitbookImportedPages)
          } catch (e) {
            console.error('Failed to parse gitbookImportedPages:', describeCaughtError(e))
          }
        }

        const errors: string[] = []
        const newImportedPages: ImportedPage[] = []
        const collectedDocuments: CollectedDocument[] = []

        sendEvent(controller, { type: 'start', total: pagePaths.length })
        const importContext = await importer.prepareContext(agent.gitbookSpaceId)

        for (let i = 0; i < pagePaths.length; i++) {
          if (abortSignal.aborted) {
            sendEvent(controller, { type: 'stopped', imported: 0, errors })
            controller.close()
            return
          }

          const pagePath = pagePaths[i]

          try {
            const doc = await importer.importSinglePage(
              agent.gitbookSpaceId,
              pagePath,
              importContext,
            )

            if (!doc) {
              sendEvent(controller, {
                type: 'progress',
                current: i + 1,
                total: pagePaths.length,
                title: `(skipped) ${pagePath}`,
                path: pagePath,
                phase: 'collecting',
              })

              newImportedPages.push({
                path: pagePath,
                title: pagePath.split('/').pop() || pagePath,
                importedAt: new Date().toISOString(),
                noData: true,
              })

              continue
            }

            sendEvent(controller, {
              type: 'progress',
              current: i + 1,
              total: pagePaths.length,
              title: doc.metadata.pageTitle,
              path: doc.metadata.pagePath,
              phase: 'collecting',
            })

            collectedDocuments.push({
              title: doc.metadata.pageTitle,
              path: doc.metadata.pagePath,
              content: doc.content,
              metadata: doc.metadata,
            })

            newImportedPages.push({
              path: doc.metadata.pagePath,
              title: doc.metadata.pageTitle,
              importedAt: new Date().toISOString(),
            })

            await new Promise(resolve => setTimeout(resolve, 200))

          } catch (err: any) {
            console.error(`Failed to collect page #${i + 1}/${pagePaths.length}:`, describeCaughtError(err))
            errors.push(`${pagePath}: 페이지를 읽지 못했습니다`)
          }
        }

        if (collectedDocuments.length === 0) {
          const existingPaths = new Set(importedPages.map(p => p.path))
          for (const newPage of newImportedPages) {
            if (!existingPaths.has(newPage.path)) {
              importedPages.push(newPage)
            }
          }
          await prisma.agent.update({
            where: { id: agent.id },
            data: { gitbookImportedPages: JSON.stringify(importedPages) },
          })

          sendEvent(controller, { type: 'complete', imported: 0, errors })
          controller.close()
          return
        }

        sendEvent(controller, {
          type: 'progress',
          current: pagePaths.length,
          total: pagePaths.length,
          title: 'Uploading combined file...',
          path: '',
          phase: 'uploading',
        })

        const timestamp = new Date().toISOString()

        const combinedMarkdown = [
          `---`,
          `source: gitbook`,
          `spaceId: ${agent.gitbookSpaceId}`,
          `pageCount: ${collectedDocuments.length}`,
          `importedAt: ${timestamp}`,
          `---`,
          '',
          ...collectedDocuments.flatMap((doc) => [
            `# ${doc.title}`,
            '',
            doc.content,
            '',
            '---',
            '',
          ]),
        ].join('\n')

        const fileName = collectedDocuments.length === 1
          ? `${collectedDocuments[0].path.replace(/\//g, '-')}.md`
          : `gitbook-${agent.gitbookSpaceId}-${Date.now()}.md`

        const noDataCount = newImportedPages.filter(p => p.noData).length
        const storageTitle = collectedDocuments.length === 1
          ? collectedDocuments[0].title
          : noDataCount > 0
            ? `GitBook Import (${collectedDocuments.length} pages, ${noDataCount} skipped - No data)`
            : `GitBook Import (${collectedDocuments.length} pages)`

        const sourceUrl = collectedDocuments.length === 1
          ? collectedDocuments[0].metadata.pageUrl
          : agent.gitbookPublishedUrl || `https://app.gitbook.com/s/${agent.gitbookSpaceId}`

        let uploadedFileId: string | null = null
        let pineconeVectorCount = 0
        const pineconeIdPrefix = `gitbook-${agent.gitbookSpaceId}-${Date.now()}`

        const storageRecord = await prisma.storage.create({
          data: {
            agentId,
            type: 'gitbook',
            status: 'processing',
            title: storageTitle,
            content: combinedMarkdown,
            fileSizeBytes: Buffer.byteLength(combinedMarkdown, 'utf-8'),
            sourceUrl,
            ragProvider: defaultProvider,
            ragSpaceId,
          },
        })

        try {
          if (defaultProvider === 'pinecone') {
            const combinedDoc = {
              id: pineconeIdPrefix,
              content: combinedMarkdown,
              metadata: {
                spaceId: agent.gitbookSpaceId,
                pageCount: collectedDocuments.length,
                pagePaths: collectedDocuments.map(d => d.path),
              },
            }
            const chunks = importer.chunkContent(combinedDoc, 1000, 200)
            pineconeVectorCount = chunks.length
            const ragDocs: RAGDocument[] = chunks.map((chunk) => ({
              id: chunk.id,
              content: chunk.content,
              metadata: chunk.metadata,
            }))
            await (ragClient as PineconeClient).upsertDocuments('gitbook', ragDocs)
          } else if (defaultProvider === 'openai_vector_store') {
            if (!agent.vectorStoreId) {
              errors.push('Vector Store ID가 설정되지 않았습니다.')
              await prisma.storage.delete({ where: { id: storageRecord.id } })
              sendEvent(controller, { type: 'complete', imported: 0, errors })
              controller.close()
              return
            }
            const fileBuffer = Buffer.from(combinedMarkdown, 'utf-8')
            const uploadResult = await ragClient.uploadFile(agent.vectorStoreId, fileBuffer, fileName, 'text/markdown')

            if (uploadResult.status === 'failed') {
              errors.push(uploadResult.error || '파일 업로드 실패')
              await prisma.storage.delete({ where: { id: storageRecord.id } })
              sendEvent(controller, { type: 'complete', imported: 0, errors })
              controller.close()
              return
            }
            uploadedFileId = uploadResult.fileId
          } else if (defaultProvider === 'azure_ai_search') {
            const fileBuffer = Buffer.from(combinedMarkdown, 'utf-8')
            const uploadResult = await knowledgeStore!.ingest({ agentId }, {
              userId: agent.userId,
              storageId: storageRecord.id,
              fileName,
              file: fileBuffer,
              mimeType: 'text/markdown',
              ragSpace: ragSpaceId != null ? String(ragSpaceId) : '',
            })
            uploadedFileId = uploadResult.providerRef.fileId
            uploadedContentHash = uploadResult.providerRef.contentHash
          } else {
            const fileBuffer = Buffer.from(combinedMarkdown, 'utf-8')
            const uploadResult = await ragClient.uploadFile('gitbook', fileBuffer, fileName, 'text/markdown')
            uploadedFileId = uploadResult.fileId
          }
        } catch (err: any) {
          console.error('Failed to upload combined file:', describeCaughtError(err))
          errors.push('RAG 업로드 실패')
          await prisma.storage.update({
            where: { id: storageRecord.id },
            data: { status: 'failed', errorMessage: err.message },
          })
          sendEvent(controller, { type: 'complete', imported: 0, errors })
          controller.close()
          return
        }

        await prisma.storage.update({
          where: { id: storageRecord.id },
          data: {
            status: 'completed',
            ...(defaultProvider === 'openai_vector_store' && uploadedFileId ? {
              openaiFileId: uploadedFileId,
              vectorStoreFileId: uploadedFileId,
            } : {}),
            ragStatus: JSON.stringify({
              [defaultProvider]: {
                status: 'completed',
                fileId: uploadedFileId,
                ...(uploadedContentHash ? { contentHash: uploadedContentHash } : {}),
                ...(defaultProvider === 'pinecone' ? {
                  idPrefix: pineconeIdPrefix,
                  vectorCount: pineconeVectorCount,
                } : {}),
              },
              gitbook: {
                spaceId: agent.gitbookSpaceId,
                pageCount: collectedDocuments.length,
                pages: collectedDocuments.map(d => ({
                  path: d.path,
                  title: d.title,
                })),
              },
            }),
          },
        })

        const existingPaths = new Set(importedPages.map(p => p.path))
        for (const newPage of newImportedPages) {
          if (!existingPaths.has(newPage.path)) {
            importedPages.push(newPage)
          }
        }

        await prisma.agent.update({
          where: { id: agent.id },
          data: {
            gitbookImportedPages: JSON.stringify(importedPages),
          },
        })

        sendEvent(controller, { type: 'complete', imported: collectedDocuments.length, errors })
        controller.close()

      } catch (error: any) {
        console.error('GitBook Import failed:', describeCaughtError(error))
        sendEvent(controller, { type: 'error', message: 'Import 실패' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    },
  })
}
