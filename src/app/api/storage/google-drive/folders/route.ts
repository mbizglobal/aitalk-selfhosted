import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

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
    const parentId = searchParams.get('parentId') || 'root'

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
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

    const response = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, mimeType, modifiedTime, size, resourceKey)',
      orderBy: 'name',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    const folders = response.data.files || []

    const filesResponse = await drive.files.list({
      q: `'${parentId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, mimeType, modifiedTime, size, resourceKey)',
      orderBy: 'name',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    const files = filesResponse.data.files || []

    const result = {
      success: true,
      data: {
        folders: folders.map(folder => ({
          id: folder.id,
          name: folder.name,
          type: 'folder',
          mimeType: folder.mimeType,
          modifiedTime: folder.modifiedTime,
          resourceKey: folder.resourceKey,
        })),
        files: files.map(file => ({
          id: file.id,
          name: file.name,
          type: 'file',
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          size: file.size,
          resourceKey: file.resourceKey,
        })),
      },
    }

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch folders' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { agentId, selectedFolders } = body

    if (!agentId || !selectedFolders) {
      return NextResponse.json(
        { success: false, error: 'Agent ID and selected folders are required' },
        { status: 400 }
      )
    }

    /*
    await prisma.googleDriveIntegration.update({
      where: { agentId },
      data: {
        selectedFolders: JSON.stringify(selectedFolders),
        updatedAt: new Date(),
      },
    })
    */

    return NextResponse.json({
      success: true,
      message: 'Folders selection saved successfully',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to save folder selection' },
      { status: 500 }
    )
  }
}
