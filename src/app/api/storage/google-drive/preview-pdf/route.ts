import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

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

    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true,
      ...(resourceKey ? { resourceKey } : {}),
    }, { responseType: 'stream' })

    const chunks: any[] = []
    let totalSize = 0
    const maxSize = 25 * 1024 * 1024 // 25MB
    let tooLarge = false

    for await (const chunk of response.data) {
      totalSize += chunk.length
      if (totalSize > maxSize) {
        tooLarge = true
        break
      }
      chunks.push(chunk)
    }

    if (tooLarge) {
      return NextResponse.json(
        { success: false, error: 'File too large to preview' },
        { status: 413 }
      )
    }

    const buffer = Buffer.concat(chunks)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
      },
    })

  } catch (error: any) {
    if (error.code === 401) {
      return NextResponse.json(
        { success: false, error: 'Google Drive authentication expired' },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Failed to stream PDF' },
      { status: 500 }
    )
  }
}
