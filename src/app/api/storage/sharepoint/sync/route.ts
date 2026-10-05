import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { googleDriveQueue } from '@/lib/googleDriveQueue'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { getLanguageFromHeaders, getErrorMessage } from '@/lib/translations/dashboard'
import { resolveRagSpaceId, RagSpaceError } from '@/lib/rag-space'
import { describeCaughtError, describeUpstreamError, readUpstreamJson } from '@/lib/log-mask'

const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]

async function getAccessToken(userId: string) {
  const microsoftAccount = await prisma.account.findFirst({
    where: {
      userId: userId,
      provider: 'microsoft'
    }
  })

  if (!microsoftAccount || !microsoftAccount.access_token) {
    throw new Error('SharePoint not connected')
  }

  const now = Math.floor(Date.now() / 1000)
  let currentAccessToken = microsoftAccount.access_token

  if (microsoftAccount.expires_at && microsoftAccount.expires_at <= now) {
    if (!microsoftAccount.refresh_token) {
      throw new Error('Token expired and no refresh token available')
    }

    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        refresh_token: microsoftAccount.refresh_token,
        grant_type: 'refresh_token',
      }),
    })

    if (!tokenResponse.ok) {
      throw new Error('Failed to refresh token')
    }

    const tokenData = await readUpstreamJson(tokenResponse)
    currentAccessToken = tokenData.access_token

    await prisma.account.update({
      where: {
        provider_providerAccountId: {
          provider: 'microsoft',
          providerAccountId: microsoftAccount.providerAccountId
        }
      },
      data: {
        access_token: tokenData.access_token,
        expires_at: tokenData.expires_in ? Math.floor(Date.now() / 1000) + tokenData.expires_in : null,
        refresh_token: tokenData.refresh_token || microsoftAccount.refresh_token,
      }
    })
  }

  return currentAccessToken
}

export async function POST(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { agentId, selectedFiles, siteId, driveId, ragProvider = 'openai_vector_store' as RAGProviderType, ragSpaceId: ragSpaceIdInput } = body

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    if (!selectedFiles || selectedFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No files selected' },
        { status: 400 }
      )
    }

    if (!Array.isArray(selectedFiles) || !selectedFiles.every(
      (id: unknown) => typeof id === 'string' && /^[A-Za-z0-9!._~%-]{1,256}$/.test(id)
    )) {
      return NextResponse.json(
        { success: false, error: 'Invalid file id' },
        { status: 400 }
      )
    }

    if (!siteId || !driveId) {
      return NextResponse.json(
        { success: false, error: 'Site ID and Drive ID are required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { user: { include: { subscription: { select: { serviceVariant: true, managedRegion: true, storagePerAgent: true, docPagesPerMonth: true, docPagesUsed: true, docPagesMonth: true } } } } }
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      )
    }

    if (agent.user.subscription?.storagePerAgent !== null && agent.user.subscription?.storagePerAgent !== undefined) {
      const currentUsage = await prisma.storage.aggregate({
        where: { agentId, status: 'completed' },
        _sum: { fileSizeBytes: true }
      })
      if ((currentUsage._sum.fileSizeBytes || 0) >= agent.user.subscription.storagePerAgent) {
        return NextResponse.json({
          success: false,
          error: getErrorMessage('api_error_storage_limit_exceeded', language),
          code: 'STORAGE_LIMIT_EXCEEDED'
        }, { status: 400 })
      }
    }

    const sub = agent.user.subscription
    if (sub?.docPagesPerMonth !== null && sub?.docPagesPerMonth !== undefined) {
      const currentMonth = new Date().getMonth() + 1
      const usedPages = sub.docPagesMonth === currentMonth ? sub.docPagesUsed : 0
      if (usedPages >= sub.docPagesPerMonth) {
        return NextResponse.json({
          success: false,
          error: getErrorMessage('api_error_doc_pages_limit_exceeded', language),
          code: 'DOC_PAGES_LIMIT_EXCEEDED'
        }, { status: 400 })
      }
    }

    const isManaged = agent.user.subscription?.serviceVariant === 'managed'
    if (isManaged && !agent.user.subscription?.managedRegion) {
      return NextResponse.json({ success: false, error: 'Managed region not configured', code: 'MANAGED_REGION_UNCONFIGURED' }, { status: 400 })
    }
    const effectiveRagProvider = isManaged ? 'azure_ai_search' as RAGProviderType : ragProvider

    let ragSpaceId: number | null = null
    if (isManaged && agent.user.subscription?.managedRegion) {
      try {
        ragSpaceId = await resolveRagSpaceId(agentId, ragSpaceIdInput)
      } catch (e) {
        if (e instanceof RagSpaceError) return NextResponse.json({ success: false, error: e.message, code: e.code }, { status: 400 })
        throw e
      }
    }

    if (effectiveRagProvider === 'openai_vector_store' && !agent.vectorStoreId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Vector Store not configured. Please upload at least one file to create a Vector Store before syncing from SharePoint.'
        },
        { status: 400 }
      )
    }

    const accessToken = await getAccessToken(agent.userId)


    const supportedFiles = []

    for (const sharepointFileId of selectedFiles) {
      try {
        const fileUrl = siteId === 'onedrive'
          ? `https://graph.microsoft.com/v1.0/me/drive/items/${sharepointFileId}`
          : `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${sharepointFileId}`

        const fileResponse = await fetch(fileUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        })

        if (!fileResponse.ok) {
          //
          console.error(`[SHAREPOINT] Failed to get file ${sharepointFileId}:`, describeUpstreamError(fileResponse.status, await fileResponse.text()))
          continue
        }

        const file = await readUpstreamJson(fileResponse)

        if (file.file && file.file.mimeType && SUPPORTED_MIME_TYPES.includes(file.file.mimeType)) {
          supportedFiles.push({
            ...file,
            siteId,
            driveId
          })
        } else {
          console.warn(`[SHAREPOINT] File not supported: id=${file.id} (${file.file?.mimeType})`)
        }
      } catch (error) {
        console.error(`[SHAREPOINT] Failed to get file ${sharepointFileId}:`, describeCaughtError(error))
        continue
      }
    }


    let syncedCount = 0
    for (const file of supportedFiles) {
      try {
        let content: string | Buffer = ''
        const originalMimeType = file.file?.mimeType || 'application/octet-stream'
        let uploadMimeType = originalMimeType

        try {
          const downloadUrl = siteId === 'onedrive'
            ? `https://graph.microsoft.com/v1.0/me/drive/items/${file.id}/content`
            : `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${file.id}/content`

          const downloadResponse = await fetch(downloadUrl, {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          })

          if (downloadResponse.ok) {
            const arrayBuffer = await downloadResponse.arrayBuffer()

            if (arrayBuffer.byteLength === 0) {
              console.warn(`[SHAREPOINT] File is empty, skipping: id=${file.id}`)
              continue
            }

            const buffer = Buffer.from(arrayBuffer)
            const firstBytes = buffer.slice(0, 4)

            const isZipBasedOffice = (
              originalMimeType.includes('openxmlformats') &&
              firstBytes[0] === 0x50 && firstBytes[1] === 0x4B
            )

            const isPDF = (
              originalMimeType === 'application/pdf' &&
              buffer.toString('utf-8', 0, 4) === '%PDF'
            )

            const isTextFile = (file.file?.mimeType || '').startsWith('text/') ||
              file.file?.mimeType === 'application/json' ||
              file.file?.mimeType === 'application/xml'

            if (!isTextFile && !isZipBasedOffice && !isPDF &&
                (originalMimeType.includes('openxmlformats') || originalMimeType === 'application/pdf')) {
              console.error(`[SHAREPOINT] File validation failed for id=${file.id}: magic_mismatch, expected=${originalMimeType}, bytes=${buffer.length}`)
              continue
            }

            if (isTextFile) {
              content = new TextDecoder('utf-8').decode(arrayBuffer)
              uploadMimeType = 'text/plain'
            } else {
              content = buffer
            }

            const byteLength = typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.byteLength

            if (originalMimeType.includes('openxmlformats') && Buffer.isBuffer(content)) {
              try {
                const AdmZip = require('adm-zip')
                const zip = new AdmZip(content)
                const zipEntries = zip.getEntries()

                const hasTrash = zipEntries.some((entry: any) => entry.entryName.startsWith('[trash]/'))

                if (hasTrash) {
                  const cleanZip = new AdmZip()

                  zipEntries.forEach((entry: any) => {
                    if (!entry.entryName.startsWith('[trash]/')) {
                      let entryName = entry.entryName

                      if (entryName === 'word/document2.xml') {
                        entryName = 'word/document.xml'
                      } else if (entryName === 'word/_rels/document2.xml.rels') {
                        entryName = 'word/_rels/document.xml.rels'
                      }

                      if (entryName === '[Content_Types].xml') {
                        let content = entry.getData().toString('utf-8')
                        content = content.replace(/document2\.xml/g, 'document.xml')
                        cleanZip.addFile(entryName, Buffer.from(content, 'utf-8'), entry.comment)
                      } else if (entry.isDirectory) {
                        cleanZip.addFile(entryName, Buffer.alloc(0), entry.comment)
                      } else {
                        cleanZip.addFile(entryName, entry.getData(), entry.comment)
                      }
                    }
                  })

                  content = cleanZip.toBuffer()
                }
              } catch (zipError) {
                console.error(`[SHAREPOINT] Failed to clean zip file:`, describeCaughtError(zipError))
              }
            }
          } else {
            console.error(
              `[SHAREPOINT] Failed to download id=${file.id}:`,
              describeUpstreamError(downloadResponse.status, await downloadResponse.text()),
            )
            continue
          }
        } catch (downloadError) {
          console.error(`[SHAREPOINT] Failed to download content for id=${file.id}:`, describeCaughtError(downloadError))
          continue
        }

        const existingFile = await prisma.storage.findFirst({
          where: {
            agentId,
            sourceUrl: file.webUrl,
            type: 'sharepoint',
            ...(ragSpaceId != null ? { ragSpaceId } : {}),
          }
        })

        if (!existingFile) {
          const metadata = {
            sharepointFileId: file.id,
            sharepointSiteId: siteId,
            sharepointDriveId: driveId,
            sharepointWebUrl: file.webUrl,
            lastModifiedDateTime: file.lastModifiedDateTime,
          }

          const storageItem = await prisma.storage.create({
            data: {
              agentId,
              type: 'sharepoint',
              status: 'processing',
              title: file.name,
              content: JSON.stringify({ ...metadata, originalMimeType }),
              sourceUrl: file.webUrl,
              mimeType: file.file.mimeType,
              fileSizeBytes: parseInt(file.size || '0'),
              ragSpaceId,
              processingLog: JSON.stringify({
                startTime: new Date().toISOString(),
                status: 'queued',
                siteId,
                driveId,
                ragProvider: effectiveRagProvider,
              }),
            },
          })

          await googleDriveQueue.addJob({
            storageId: storageItem.id,
            fileName: file.name,
            content,
            mimeType: uploadMimeType,
            agentId,
            vectorStoreId: effectiveRagProvider === 'openai_vector_store' ? agent.vectorStoreId! : null,
            userApiKey: '',
            ragProvider: effectiveRagProvider,
          })

          syncedCount++
        }
      } catch (error) {
        console.error(`[SHAREPOINT] Failed to sync file id=${file.id}:`, describeCaughtError(error))
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully queued ${syncedCount} files for processing`,
      syncedCount,
      totalSelected: selectedFiles.length,
      supportedFiles: supportedFiles.length
    })
  } catch (error) {
    console.error('SharePoint sync failed:', describeCaughtError(error))
    return NextResponse.json(
      { success: false, error: 'SharePoint sync failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { userId: true },
    })
    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      )
    }

    const count = await prisma.storage.count({
      where: {
        agentId,
        type: 'sharepoint',
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        syncedFiles: count,
        lastSyncAt: null,
      },
    })
  } catch (error) {
    console.error('Failed to get SharePoint sync status:', describeCaughtError(error))
    return NextResponse.json(
      { success: false, error: 'Failed to get sync status' },
      { status: 500 }
    )
  }
}
