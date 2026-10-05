import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { googleDriveQueue } from '@/lib/googleDriveQueue'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { getLanguageFromHeaders, getErrorMessage } from '@/lib/translations/dashboard'
import { resolveRagSpaceId, RagSpaceError } from '@/lib/rag-space'

const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/x-tex',
  'text/x-tex',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]

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
    const { agentId, selectedFiles, ragProvider = 'openai_vector_store' as RAGProviderType, ragSpaceId: ragSpaceIdInput } = body

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
          error: 'Vector Store not configured. Please upload at least one file to create a Vector Store before syncing from Google Drive.'
        },
        { status: 400 }
      )
    }

    let googleAccount = null

    if (agent.googleAccountId) {
      googleAccount = await prisma.account.findUnique({
        where: {
          id: agent.googleAccountId
        }
      })
    } else if (!agent.googleDriveDisconnected) {
      googleAccount = await prisma.account.findFirst({
        where: {
          userId: agent.userId,
          provider: 'google'
        }
      })

      if (googleAccount) {
        await prisma.agent.update({
          where: { agentId },
          data: {
            googleAccountId: googleAccount.id
          }
        })
      }
    }

    if (!googleAccount || !googleAccount.access_token) {
      return NextResponse.json(
        { success: false, error: 'Google Drive not connected' },
        { status: 401 }
      )
    }

    const scopes = googleAccount.scope?.split(' ') || []
    const hasDriveFileScope = scopes.includes('https://www.googleapis.com/auth/drive.file')

    if (!hasDriveFileScope) {
      return NextResponse.json(
        {
          success: false,
          error: 'Drive scope missing. Please reconnect Google Drive with proper permissions.',
          needsReauth: true,
          currentScopes: googleAccount.scope
        },
        { status: 403 }
      )
    }


    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/storage/google-drive/callback`
    )

    const now = Math.floor(Date.now() / 1000)
    let currentAccessToken = googleAccount.access_token
    
    if (googleAccount.expires_at && googleAccount.expires_at <= now) {
      if (!googleAccount.refresh_token) {
        return NextResponse.json(
          { success: false, error: 'Token expired and no refresh token available' },
          { status: 401 }
        )
      }

      try {
        oauth2Client.setCredentials({
          refresh_token: googleAccount.refresh_token,
        })

        const { credentials } = await oauth2Client.refreshAccessToken()
        currentAccessToken = credentials.access_token!

        await prisma.account.update({
          where: {
            provider_providerAccountId: {
              provider: 'google',
              providerAccountId: googleAccount.providerAccountId
            }
          },
          data: {
            access_token: credentials.access_token,
            expires_at: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : null,
          }
        })
      } catch (refreshError) {
        return NextResponse.json(
          { success: false, error: 'Failed to refresh token' },
          { status: 401 }
        )
      }
    }

    oauth2Client.setCredentials({
      access_token: currentAccessToken,
      refresh_token: googleAccount.refresh_token,
    })

    const drive = google.drive({ version: 'v3', auth: oauth2Client })


    const supportedFiles: any[] = []
    const selectionErrors: string[] = []

    const fileSelections = selectedFiles.map((file: any) => {
      if (typeof file === 'string') {
        return { id: file }
      }

      return {
        id: file.id,
        resourceKey: file.resourceKey,
      }
    })

    for (const selection of fileSelections) {
      try {
        const getFileOptions: any = {
          fileId: selection.id,
          fields: 'id, name, mimeType, modifiedTime, size, webViewLink, resourceKey',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }

        const requestOptions: any = {}
        if (selection.resourceKey) {
          requestOptions.headers = {
            'X-Goog-Drive-Resource-Keys': `${selection.id}/${selection.resourceKey}`
          }
        }

        const fileResponse = await drive.files.get(getFileOptions, requestOptions)

        const file = {
          ...fileResponse.data,
          resourceKey: fileResponse.data.resourceKey ?? selection.resourceKey,
        }

        if (file.mimeType && SUPPORTED_MIME_TYPES.includes(file.mimeType)) {
          supportedFiles.push(file)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error)
        selectionErrors.push(`Failed to access ${selection.id}: ${message}`)
      }
    }


    let syncedCount = 0
    const syncErrors: string[] = []
    for (const file of supportedFiles) {
      try {
        let content: string | Buffer = ''
        let uploadMimeType = file.mimeType || 'application/octet-stream'
        const resourceKey = file.resourceKey as string | undefined
        
        try {
          if (file.mimeType?.startsWith('application/vnd.google-apps')) {
            const exportMimeType = 'application/pdf'
            const exportOptions: any = {
              fileId: file.id!,
              mimeType: exportMimeType,
              supportsAllDrives: true,
            }

            const exportRequestOptions: any = {
              responseType: 'arraybuffer'
            }
            if (resourceKey) {
              exportRequestOptions.headers = {
                'X-Goog-Drive-Resource-Keys': `${file.id}/${resourceKey}`
              }
            }

            const exportResponse = await drive.files.export(exportOptions, exportRequestOptions)

            if (exportResponse.data instanceof ArrayBuffer) {
              content = Buffer.from(exportResponse.data)
              uploadMimeType = exportMimeType
            } else if (Buffer.isBuffer(exportResponse.data)) {
              content = exportResponse.data
              uploadMimeType = exportMimeType
            } else if (typeof exportResponse.data === 'string') {
              content = exportResponse.data
              uploadMimeType = 'text/plain'
            } else if (exportResponse.data && typeof exportResponse.data === 'object' && 'arrayBuffer' in exportResponse.data) {
              const arrayBuffer = await (exportResponse.data as Blob).arrayBuffer()
              content = Buffer.from(arrayBuffer)
              uploadMimeType = exportMimeType
            } else {
              content = JSON.stringify(exportResponse.data)
              uploadMimeType = 'application/json'
            }
          } else {
            const downloadOptions: any = {
              fileId: file.id!,
              alt: 'media',
              supportsAllDrives: true,
            }

            const downloadRequestOptions: any = {
              responseType: 'arraybuffer'
            }
            if (resourceKey) {
              downloadRequestOptions.headers = {
                'X-Goog-Drive-Resource-Keys': `${file.id}/${resourceKey}`
              }
            }

            const fileResponse = await drive.files.get(downloadOptions, downloadRequestOptions)

            if (fileResponse.data instanceof ArrayBuffer) {
              content = Buffer.from(fileResponse.data)
            } else if (Buffer.isBuffer(fileResponse.data)) {
              content = fileResponse.data
            } else if (typeof fileResponse.data === 'string') {
              content = fileResponse.data
              uploadMimeType = 'text/plain'
            } else if (fileResponse.data && typeof fileResponse.data === 'object' && 'arrayBuffer' in fileResponse.data) {
              const arrayBuffer = await (fileResponse.data as unknown as Blob).arrayBuffer()
              content = Buffer.from(arrayBuffer)
            } else {
              content = JSON.stringify(fileResponse.data)
              uploadMimeType = 'application/json'
            }
          }

          const byteLength = typeof content === 'string'
            ? Buffer.byteLength(content, 'utf-8')
            : content instanceof Buffer
              ? content.byteLength
              : 0


        } catch (downloadError) {
          content = `Failed to download content: ${downloadError instanceof Error ? downloadError.message : 'Unknown error'}`
          uploadMimeType = 'text/plain'
        }

        const existingFile = await prisma.storage.findFirst({
          where: {
            agentId,
            sourceUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
            type: 'google_drive',
            ...(ragSpaceId != null ? { ragSpaceId } : {}),
          }
        })

        if (!existingFile) {
          let displayTitle = file.name || 'Untitled'
          if (file.mimeType?.startsWith('application/vnd.google-apps')) {
            displayTitle = displayTitle.replace(/\.pdf$/i, '') + '.pdf'
          }

          const storageItem = await prisma.storage.create({
            data: {
              agentId,
              type: 'google_drive',
              status: 'processing',
              title: displayTitle,
              content: null,
              sourceUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
              mimeType: file.mimeType,
              fileSizeBytes: parseInt(file.size || '0'),
              ragSpaceId,
              processingLog: JSON.stringify({
                startTime: new Date().toISOString(),
                status: 'queued',
                ragProvider: effectiveRagProvider,
              }),
            },
          })

          const jobFileName = file.mimeType?.startsWith('application/vnd.google-apps')
            ? (file.name || 'Untitled').replace(/\.pdf$/i, '') + '.pdf'
            : file.name || 'Untitled'

          await googleDriveQueue.addJob({
            storageId: storageItem.id,
            fileName: jobFileName,
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
        const message = error instanceof Error ? error.message : JSON.stringify(error)
        syncErrors.push(`Failed to sync ${file.name}: ${message}`)
      }
    }

    if (syncedCount === 0) {
      const combinedErrors = [...selectionErrors, ...syncErrors]
      const errorMessage = combinedErrors.length > 0
        ? combinedErrors.join('\n')
        : 'No files were queued. Please ensure the files are shared with this app via Google Picker.'

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          syncedCount,
          totalSelected: selectedFiles.length,
        },
        { status: 400 }
      )
    }

    /*
    await prisma.googleDriveIntegration.update({
      where: { agentId },
      data: {
        lastSyncAt: new Date(),
      },
    })
    */

    return NextResponse.json({
      success: true,
      message: `Successfully queued ${syncedCount} files for processing`,
      syncedCount,
      totalSelected: selectedFiles.length,
      supportedFiles: supportedFiles.length
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Sync failed' },
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
        type: 'google_drive',
      },
    })

    /*
    const integration = await prisma.googleDriveIntegration.findUnique({
      where: { agentId },
      select: { lastSyncAt: true }
    })
    */

    return NextResponse.json({
      success: true,
      data: {
        syncedFiles: count,
        lastSyncAt: null, // integration?.lastSyncAt
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to get sync status' },
      { status: 500 }
    )
  }
}
