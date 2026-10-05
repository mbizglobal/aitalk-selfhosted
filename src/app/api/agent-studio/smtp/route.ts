import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData } from '@/lib/encryption'
import nodemailer from 'nodemailer'
import { getProviderById } from '@/lib/email/providers'

interface SmtpConfig {
  host: string
  port: number
  user: string
  secure?: boolean
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
        provider: 'smtp'
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

    const config: (SmtpConfig & { email?: string }) | null = connection.serviceConfig
      ? JSON.parse(connection.serviceConfig)
      : null

    return NextResponse.json({
      hasConnection: true,
      connectionId: connection.id,
      config: config ? {
        host: config.host,
        port: config.port,
        user: config.user,
        email: config.email,
        secure: config.secure,
        providerId: config.providerId,
        authType: connection.authType
      } : null,
      status: connection.status
    })
  } catch (error) {
    console.error('SMTP GET error:', error)
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
    const { agentId, host, port, user, password, secure, testOnly, providerId } = body

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

    const testResult = await testSmtpConnection(host, Number(port), user, password, secure)

    if (!testResult.success) {
      return NextResponse.json({
        success: false,
        error: testResult.error
      }, { status: 400 })
    }

    if (testOnly) {
      return NextResponse.json({
        success: true,
        message: 'Connection test successful'
      })
    }

    const encryptedToken = await encryptData(password)

    const serviceConfig = JSON.stringify({
      host,
      port: Number(port),
      user,
      secure: secure ?? (Number(port) === 465),
      providerId: providerId || 'custom'
    })

    const existingSmtp = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: 'smtp'
      }
    })

    let smtpConnectionId: string
    if (existingSmtp) {
      smtpConnectionId = existingSmtp.id
      await prisma.workflowConnection.update({
        where: { id: existingSmtp.id },
        data: {
          encryptedToken,
          serviceConfig,
          status: 'active',
          updatedAt: new Date()
        }
      })
    } else {
      const created = await prisma.workflowConnection.create({
        data: {
          userId,
          agentId,
          provider: 'smtp',
          label: 'SMTP',
          authType: 'api_key',
          encryptedToken,
          serviceConfig,
          status: 'active'
        }
      })
      smtpConnectionId = created.id
    }

    let imapCreated = false
    if (providerId && providerId !== 'custom') {
      const provider = getProviderById(providerId)
      if (provider) {
        const imapConfig = JSON.stringify({
          host: provider.imap.host,
          port: provider.imap.port,
          user,
          providerId
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
              serviceConfig: imapConfig,
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
              serviceConfig: imapConfig,
              status: 'active'
            }
          })
        }
        imapCreated = true
        console.log(`[SMTP] Auto-created IMAP connection for ${provider.name}`)
      }
    }

    return NextResponse.json({
      success: true,
      message: imapCreated
        ? 'SMTP and IMAP connections saved successfully'
        : 'SMTP connection saved successfully',
      imapCreated,
      connectionId: smtpConnectionId
    })
  } catch (error) {
    console.error('SMTP POST error:', error)
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

    const existingSmtp = await prisma.workflowConnection.findFirst({
      where: { agentId, userId, provider: 'smtp' },
      select: { authType: true, serviceConfig: true }
    })

    let deleteImapToo = false
    if (existingSmtp) {
      if (existingSmtp.authType === 'oauth') {
        deleteImapToo = true
      } else if (existingSmtp.serviceConfig) {
        try {
          const config = JSON.parse(existingSmtp.serviceConfig)
          if (config.providerId && config.providerId !== 'custom') {
            deleteImapToo = true
          }
        } catch { /* ignore */ }
      }
    }

    await prisma.workflowConnection.deleteMany({
      where: { agentId, userId, provider: 'smtp' }
    })

    let imapDeleted = false
    if (deleteImapToo) {
      await prisma.workflowConnection.deleteMany({
        where: { agentId, userId, provider: 'imap' }
      })
      imapDeleted = true
      console.log(`[SMTP] Also deleted IMAP connection for agent ${agentId}`)
    }

    return NextResponse.json({ success: true, imapDeleted })
  } catch (error) {
    console.error('SMTP DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function testSmtpConnection(
  host: string,
  port: number,
  user: string,
  password: string,
  secure?: boolean
): Promise<{ success: boolean; error?: string }> {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: secure ?? (port === 465),
    auth: {
      user,
      pass: password
    }
  })

  try {
    await transporter.verify()

    return { success: true }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to connect to SMTP server'
    }
  }
}
