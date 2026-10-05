
import nodemailer from 'nodemailer'
import { AIToolClient, ToolDefinition } from './types'
import { PrismaClient } from '@prisma/client'
import { getConnectionSecret } from '@/lib/secret-vault'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkHtml from 'remark-html'
import { getValidAccessToken } from '@/lib/email/microsoft-oauth'
import { agentScopedWhere } from '@/lib/connection-scope'

export class SmtpToolClient implements AIToolClient {
  private config: { host: string; port: number; user: string; email?: string; secure?: boolean } | null = null
  private authCredentials: { user: string; pass?: string; accessToken?: string } | null = null
  private defaultToEmail: string = ''

  async initialize(prisma: PrismaClient, connectionId: string, overrides?: { toEmail?: string; agentId?: string }, userId?: string): Promise<void> {
    const connection = await prisma.workflowConnection.findFirst({
      where: {
        id: connectionId,
        ...agentScopedWhere({ agentId: overrides?.agentId, userId }, 'SMTP Tool'),
        provider: 'smtp',
        status: 'active',
      },
      select: {
        id: true,
        authType: true,
        encryptedToken: true,
        refreshToken: true,
        tokenExpiresAt: true,
        serviceConfig: true
      }
    })

    if (!connection?.encryptedToken || !connection.serviceConfig) {
      throw new Error('SMTP connection not found or no credentials')
    }

    this.config = JSON.parse(connection.serviceConfig) as {
      host: string; port: number; user: string; email?: string; secure?: boolean
    }

    if (connection.authType === 'oauth') {
      const accessToken = await getValidAccessToken(connection, prisma)
      this.authCredentials = {
        user: this.config.email || this.config.user,
        accessToken
      }
    } else {
      const password = await getConnectionSecret(prisma, userId || '', connection.id, connection.encryptedToken, connection.authType)
      this.authCredentials = {
        user: this.config.user,
        pass: password
      }
    }

    if (overrides?.toEmail) this.defaultToEmail = overrides.toEmail
  }

  listTools(): ToolDefinition[] {
    if (this.defaultToEmail) {
      return [{
        name: 'send_email_smtp',
        description: 'Send a notification email to the business owner via SMTP. The recipient is already configured. Use when the user wants to send an email, contact someone, or leave a message. Compose the email body including the contact person\'s name, email, and their message.',
        parameters: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body in Markdown. MUST include: contact person\'s name, email address, and their message content.' },
          },
          required: ['subject', 'body']
        }
      }]
    }

    return [{
      name: 'send_email_smtp',
      description: 'Send an email via SMTP. Use when the user asks to send an email.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (supports Markdown, converted to HTML)' },
          cc: { type: 'string', description: 'CC recipients, comma-separated (optional)' },
          bcc: { type: 'string', description: 'BCC recipients, comma-separated (optional)' },
        },
        required: ['to', 'subject', 'body']
      }
    }]
  }

  async callTool(name: string, args: Record<string, any>): Promise<string> {
    if (name !== 'send_email_smtp') {
      return `Unknown tool: ${name}`
    }

    const { to, subject, body, cc, bcc } = args

    const recipientEmail = this.defaultToEmail || to

    if (!recipientEmail || !subject || !body) {
      return 'Error: Missing required fields (to, subject, body)'
    }

    if (!this.config || !this.authCredentials) {
      return 'Error: SMTP not initialized'
    }

    try {
      const htmlBody = await this.convertMarkdownToHtml(body)

      const fromEmail = this.config.email || this.config.user

      let transportConfig: any
      if (this.authCredentials.accessToken) {
        transportConfig = {
          host: this.config.host,
          port: this.config.port,
          secure: this.config.secure ?? (this.config.port === 465),
          auth: {
            type: 'OAuth2',
            user: this.authCredentials.user,
            accessToken: this.authCredentials.accessToken
          }
        }
      } else {
        transportConfig = {
          host: this.config.host,
          port: this.config.port,
          secure: this.config.secure ?? (this.config.port === 465),
          auth: {
            user: this.authCredentials.user,
            pass: this.authCredentials.pass
          }
        }
      }

      const transporter = nodemailer.createTransport(transportConfig)
      const mailOptions: any = {
        from: fromEmail,
        to: recipientEmail,
        subject,
        text: body,
        html: htmlBody
      }
      if (cc) mailOptions.cc = cc
      if (bcc) mailOptions.bcc = bcc

      const info = await transporter.sendMail(mailOptions)

      return JSON.stringify({
        success: true,
        messageId: info.messageId,
        to: recipientEmail,
        subject
      })
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message })
    }
  }

  private async convertMarkdownToHtml(markdown: string): Promise<string> {
    try {
      const result = await remark()
        .use(remarkGfm)
        .use(remarkHtml, { sanitize: false })
        .process(markdown)

      const htmlContent = String(result)
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
h1, h2, h3 { color: #1a1a1a; } a { color: #0066cc; } code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; } table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 8px 12px; } th { background: #f4f4f4; }
</style></head><body>${htmlContent}</body></html>`
    } catch {
      return `<html><body><pre style="white-space: pre-wrap;">${markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`
    }
  }
}
