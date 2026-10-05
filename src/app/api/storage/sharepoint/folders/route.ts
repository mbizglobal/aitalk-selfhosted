import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { describeCaughtError, describeUpstreamError, readUpstreamJson } from '@/lib/log-mask'

function getSupportedMimeTypes(ragProvider?: string): string[] {
  switch (ragProvider) {
    case 'azure_ai_search':
      return [
        'text/plain',
        'text/markdown',
        'application/json',
        'application/x-tex', 'text/x-tex',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg', 'image/png',
      ]
    case 'gemini_file_search':
      return [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/markdown',
        'application/json',
        'text/csv',
        'text/html',
        'text/xml', 'application/xml',
      ]
    case 'pinecone':
      return [
        'text/plain',
        'text/markdown',
        'application/json',
      ]
    case 'openai_vector_store':
    default:
      return [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/markdown',
        'application/json',
        'application/x-tex', 'text/x-tex',
      ]
  }
}

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

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')
    const siteId = searchParams.get('siteId')
    const driveId = searchParams.get('driveId')
    const parentId = searchParams.get('parentId') || 'root'
    const ragProvider = searchParams.get('ragProvider') || undefined

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { user: true }
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found or unauthorized' }, { status: 404 })
    }

    const accessToken = await getAccessToken(agent.userId)

    let apiUrl: string

    if (siteId && driveId) {
      if (siteId === 'onedrive') {
        if (parentId === 'root') {
          apiUrl = `https://graph.microsoft.com/v1.0/me/drive/root/children`
        } else {
          apiUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`
        }
      } else {
        if (parentId === 'root') {
          apiUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/root/children`
        } else {
          apiUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${parentId}/children`
        }
      }
    } else if (siteId) {
      if (siteId === 'onedrive') {
        const driveResponse = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        })

        if (!driveResponse.ok) {
          console.error('Failed to fetch OneDrive:', describeUpstreamError(driveResponse.status, await driveResponse.text()))
          return NextResponse.json(
            { error: 'Failed to fetch OneDrive' },
            { status: 500 }
          )
        }

        const driveData = await readUpstreamJson(driveResponse)
        const drives = [{
          id: driveData.id,
          name: 'OneDrive',
          description: 'Personal OneDrive storage',
          driveType: 'personal',
          webUrl: driveData.webUrl
        }]

        return NextResponse.json({
          success: true,
          data: {
            drives
          }
        })
      } else {
        apiUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`
      }
    } else {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
    }

    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      console.error('Failed to fetch SharePoint items:', describeUpstreamError(response.status, await response.text()))
      return NextResponse.json(
        { error: 'Failed to fetch SharePoint items' },
        { status: 500 }
      )
    }

    const data = await readUpstreamJson(response)

    if (!siteId || !driveId) {
      const drives = data.value.map((drive: any) => ({
        id: drive.id,
        name: drive.name,
        description: drive.description,
        driveType: drive.driveType,
        webUrl: drive.webUrl
      }))

      return NextResponse.json({
        success: true,
        data: {
          drives
        }
      })
    } else {
      const folders: any[] = []
      const files: any[] = []

      data.value?.forEach((item: any) => {
        const commonData = {
          id: item.id,
          name: item.name,
          webUrl: item.webUrl,
          createdDateTime: item.createdDateTime,
          lastModifiedDateTime: item.lastModifiedDateTime,
          size: item.size
        }

        if (item.folder) {
          folders.push({
            ...commonData,
            type: 'folder',
            childCount: item.folder.childCount
          })
        } else if (item.file) {
          const supportedMimeTypes = getSupportedMimeTypes(ragProvider)
          const isSupported = item.file.mimeType && supportedMimeTypes.includes(item.file.mimeType)
          files.push({
            ...commonData,
            type: 'file',
            mimeType: item.file.mimeType,
            supported: isSupported
          })
        }
      })


      return NextResponse.json({
        success: true,
        data: {
          folders,
          files
        }
      })
    }

  } catch (error) {
    console.error('Failed to fetch SharePoint folders/files:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to fetch SharePoint items' },
      { status: 500 }
    )
  }
}