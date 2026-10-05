import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData } from '@/lib/encryption'
import { ImapFlow } from 'imapflow'
import { getProviderById } from '@/lib/email/providers'

interface ImapConfig {
  host: string
  port: number
  user: string
  providerId?: string
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const connection = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: 'imap'
      },
      select: {
        id: true,
        authType: true,
        serviceConfig: true,
        status: true
      }
    })

    if (!connection) {
      return NextResponse.json({
        hasConnection: false,
        config: null
      })
    }

    const config: (ImapConfig & { email?: string }) | null = connection.serviceConfig
      ? JSON.parse(connection.serviceConfig)
      : null

    return NextResponse.json({
      hasConnection: true,
      config: config ? {
        host: config.host,
        port: config.port,
        user: config.user,
        email: config.email,
        providerId: config.providerId,
        authType: connection.authType
      } : null,
      status: connection.status
    })
  } catch (error) {
    console.error('IMAP GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const { agentId, host, port, user, password, testOnly, providerId } = body

    if (!agentId || !host || !port || !user || !password) {
      return NextResponse.json(
        { error: 'agentId, host, port, user, password are required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const testResult = await testImapConnection(host, port, user, password)

    if (!testResult.success) {
      return NextResponse.json({
        success: false,
        error: testResult.error
      }, { status: 400 })
    }

    if (testOnly) {
      return NextResponse.json({
        success: true,
        message: 'Connection test successful',
        folders: testResult.folders
      })
    }

    const encryptedToken = await encryptData(password)

    const serviceConfig = JSON.stringify({
      host,
      port: Number(port),
      user,
      providerId: providerId || 'custom'
    })

    const existingImap = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: 'imap'
      }
    })

    if (existingImap) {
      await prisma.workflowConnection.update({
        where: { id: existingImap.id },
        data: {
          encryptedToken,
          serviceConfig,
          status: 'active',
          updatedAt: new Date()
        }
      })
    } else {
      await prisma.workflowConnection.create({
        data: {
          userId,
          agentId,
          provider: 'imap',
          label: 'IMAP',
          authType: 'api_key',
          encryptedToken,
          serviceConfig,
          status: 'active'
        }
      })
    }

    let smtpCreated = false
    if (providerId && providerId !== 'custom') {
      const provider = getProviderById(providerId)
      if (provider) {
        const smtpConfig = JSON.stringify({
          host: provider.smtp.host,
          port: provider.smtp.port,
          secure: provider.smtp.secure,
          user,
          providerId
        })

        const existingSmtp = await prisma.workflowConnection.findFirst({
          where: {
            agentId,
            userId,
            provider: 'smtp'
          }
        })

        if (existingSmtp) {
          await prisma.workflowConnection.update({
            where: { id: existingSmtp.id },
            data: {
              encryptedToken,
              serviceConfig: smtpConfig,
              status: 'active',
              updatedAt: new Date()
            }
          })
        } else {
          await prisma.workflowConnection.create({
            data: {
              userId,
              agentId,
              provider: 'smtp',
              label: 'SMTP',
              authType: 'api_key',
              encryptedToken,
              serviceConfig: smtpConfig,
              status: 'active'
            }
          })
        }
        smtpCreated = true
        console.log(`[IMAP] Auto-created SMTP connection for ${provider.name}`)
      }
    }

    return NextResponse.json({
      success: true,
      message: smtpCreated
        ? 'IMAP and SMTP connections saved successfully'
        : 'IMAP connection saved successfully',
      folders: testResult.folders,
      smtpCreated
    })
  } catch (error) {
    console.error('IMAP POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const existingImap = await prisma.workflowConnection.findFirst({
      where: { agentId, userId, provider: 'imap' },
      select: { authType: true, serviceConfig: true }
    })

    let deleteSmtpToo = false
    if (existingImap) {
      if (existingImap.authType === 'oauth') {
        deleteSmtpToo = true
      } else if (existingImap.serviceConfig) {
        try {
          const config = JSON.parse(existingImap.serviceConfig)
          if (config.providerId && config.providerId !== 'custom') {
            deleteSmtpToo = true
          }
        } catch { /* ignore */ }
      }
    }

    await prisma.workflowConnection.deleteMany({
      where: { agentId, userId, provider: 'imap' }
    })

    let smtpDeleted = false
    if (deleteSmtpToo) {
      await prisma.workflowConnection.deleteMany({
        where: { agentId, userId, provider: 'smtp' }
      })
      smtpDeleted = true
      console.log(`[IMAP] Also deleted SMTP connection for agent ${agentId}`)
    }

    return NextResponse.json({ success: true, smtpDeleted })
  } catch (error) {
    console.error('IMAP DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function testImapConnection(
  host: string,
  port: number,
  user: string,
  password: string
): Promise<{ success: boolean; error?: string; folders?: string[] }> {
  const client = new ImapFlow({
    host,
    port: Number(port),
    secure: Number(port) === 993,
    auth: {
      user,
      pass: password
    },
    logger: false
  })

  try {
    await client.connect()

    const mailboxList = await client.list()
    const folders = mailboxList.map((mailbox) => mailbox.path)

    await client.logout()

    return {
      success: true,
      folders
    }
  } catch (error: any) {
    try { await client.logout() } catch { /* ignore */ }
    return {
      success: false,
      error: error.message || 'Failed to connect to IMAP server'
    }
  }
}
