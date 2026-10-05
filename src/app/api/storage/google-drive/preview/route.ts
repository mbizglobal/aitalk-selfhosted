import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { Buffer } from 'buffer'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import mammoth from 'mammoth'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')
    const fileId = searchParams.get('fileId')
    const resourceKey = searchParams.get('resourceKey') || undefined

    if (!agentId || !fileId) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { user: true }
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      )
    }

    const googleAccount = await prisma.account.findFirst({
      where: {
        userId: agent.userId,
        provider: 'google'
      }
    })

    if (!googleAccount || !googleAccount.access_token) {
      return NextResponse.json(
        { success: false, error: 'Google Drive not connected' },
        { status: 401 }
      )
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/storage/google-drive/callback`
    )

    oauth2Client.setCredentials({
      access_token: googleAccount.access_token,
      refresh_token: googleAccount.refresh_token,
    })

    const drive = google.drive({ version: 'v3', auth: oauth2Client })

    const fileMetadata = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, exportLinks, resourceKey',
      supportsAllDrives: true,
      ...(resourceKey ? { resourceKey } : {}),
    })

    const file = fileMetadata.data
    let content = ''
    let previewType = 'text'

    if (file.mimeType?.startsWith('application/vnd.google-apps.')) {
      let exportMimeType = 'text/plain'
      
      switch (file.mimeType) {
        case 'application/vnd.google-apps.document':
          exportMimeType = 'text/plain'
          break
        case 'application/vnd.google-apps.spreadsheet':
          exportMimeType = 'text/csv'
          break
        case 'application/vnd.google-apps.presentation':
          exportMimeType = 'text/plain'
          break
        default:
          return NextResponse.json({
            success: true,
            data: {
              name: file.name,
              mimeType: file.mimeType,
              content: 'This Google Apps file cannot be previewed directly.',
              previewType: 'text',
              webViewLink: file.webViewLink
            }
          })
      }

      const exportResponse = await drive.files.export({
        fileId: fileId,
        mimeType: exportMimeType,
        supportsAllDrives: true,
        ...(resourceKey ? { resourceKey } : {}),
      }, { responseType: 'stream' })

      const chunks: any[] = []
      let totalSize = 0
      const maxSize = 1024 * 1024

      for await (const chunk of exportResponse.data) {
        chunks.push(chunk)
        totalSize += chunk.length
        if (totalSize > maxSize) {
          break
        }
      }
      content = Buffer.concat(chunks).toString('utf-8')
      
      if (content.length > 5000) {
        content = content.substring(0, 5000) + '\n\n... [Content truncated for preview]'
      }

    } else {
      const response = await drive.files.get({
        fileId: fileId,
        alt: 'media',
        supportsAllDrives: true,
        ...(resourceKey ? { resourceKey } : {}),
      }, { responseType: 'stream' })

      const chunks: any[] = []
      let totalSize = 0
      const maxSize = 1024 * 1024

      for await (const chunk of response.data) {
        chunks.push(chunk)
        totalSize += chunk.length
        if (totalSize > maxSize) {
          break
        }
      }

      const buffer = Buffer.concat(chunks)

      if (file.mimeType?.startsWith('text/') || 
          file.mimeType === 'application/json' ||
          file.mimeType === 'application/javascript') {
        content = buffer.toString('utf-8')
        if (content.length > 5000) {
          content = content.substring(0, 5000) + '\n\n... [Content truncated for preview]'
        }
      } else if (file.mimeType === 'application/msword') {
        content = 'Preview not supported for .doc files'
        previewType = 'binary'
      } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        try {
          const result = await mammoth.extractRawText({ buffer })
          content = result.value
          if (content.length > 5000) {
            content = content.substring(0, 5000) + '\n\n... [Content truncated for preview]'
          }
        } catch (error) {
          content = 'Failed to extract text from Word document'
          previewType = 'binary'
        }
      } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
        try {
          const exportResponse = await drive.files.export({
            fileId: fileId,
            mimeType: 'text/plain',
            supportsAllDrives: true,
            ...(resourceKey ? { resourceKey } : {}),
          }, { responseType: 'stream' })

          const chunks: any[] = []
          for await (const chunk of exportResponse.data) {
            chunks.push(chunk)
          }
          content = Buffer.concat(chunks).toString('utf-8')

          if (content.length > 5000) {
            content = content.substring(0, 5000) + '\n\n... [Content truncated for preview]'
          }
        } catch (exportError) {
          content = 'Preview not available for this file type. PowerPoint files may require specialized processing.'
          previewType = 'binary'
        }
      } else if (file.mimeType === 'application/pdf') {
        content = buffer.toString('base64')
        previewType = 'pdf'
      } else if (file.mimeType?.startsWith('image/')) {
        content = buffer.toString('base64')
        previewType = 'image'
      } else {
        content = 'Binary file preview not available'
        previewType = 'binary'
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        modifiedTime: file.modifiedTime,
        content: content,
        previewType: previewType,
        webViewLink: file.webViewLink
      }
    })

  } catch (error: any) {
    if (error.code === 401) {
      return NextResponse.json(
        { success: false, error: 'Google Drive authentication expired' },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Failed to preview file' },
      { status: 500 }
    )
  }
}
