
import { AIToolClient, ToolDefinition } from './types'
import { PrismaClient } from '@prisma/client'
import { getConnectionSecret } from '@/lib/secret-vault'
import { agentScopedWhere } from '@/lib/connection-scope'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkHtml from 'remark-html'

export class SendGridToolClient implements AIToolClient {
  private apiKey: string = ''
  private fromEmail: string = ''
  private fromName: string = ''
  private defaultToEmail: string = ''

  async initialize(
    prisma: PrismaClient,
    connectionId: string,
    overrides?: { fromEmail?: string; fromName?: string; toEmail?: string; agentId?: string },
    userId?: string
  ): Promise<void> {
    const connection = await prisma.workflowConnection.findFirst({
      where: {
        id: connectionId,
        ...agentScopedWhere({ agentId: overrides?.agentId, userId }, 'SendGrid Tool'),
        provider: 'sendgrid',
        status: 'active',
      },
      select: { id: true, encryptedToken: true, serviceConfig: true }
    })

    if (!connection?.encryptedToken) {
      throw new Error('SendGrid connection not found or no credentials')
    }

    this.apiKey = await getConnectionSecret(prisma, userId || '', connection.id, connection.encryptedToken)

    if (connection.serviceConfig) {
      try {
        const config = JSON.parse(connection.serviceConfig)
        this.fromEmail = config.fromEmail || ''
        this.fromName = config.fromName || ''
      } catch {
        // ignore
      }
    }

    if (overrides?.fromEmail && !this.fromEmail) this.fromEmail = overrides.fromEmail
    if (overrides?.fromName && !this.fromName) this.fromName = overrides.fromName
    if (overrides?.toEmail) this.defaultToEmail = overrides.toEmail
  }

  listTools(): ToolDefinition[] {
    if (this.defaultToEmail) {
      return [{
        name: 'send_email_sendgrid',
        description: 'Send a notification email to the business owner. The recipient is already configured. Use when the user wants to send an email, contact someone, or leave a message. Compose the email body including the contact person\'s name, email, and their message.',
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
      name: 'send_email_sendgrid',
      description: 'Send an email via SendGrid. Use when the user asks to send an email.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (supports Markdown)' },
          from_name: { type: 'string', description: 'Sender display name (optional)' },
        },
        required: ['to', 'subject', 'body']
      }
    }]
  }

  async callTool(name: string, args: Record<string, any>): Promise<string> {
    if (name !== 'send_email_sendgrid') {
      return `Unknown tool: ${name}`
    }

    const { to, subject, body, from_name } = args

    const recipientEmail = this.defaultToEmail || to

    if (!recipientEmail || !subject || !body) {
      return 'Error: Missing required fields (to, subject, body)'
    }

    if (!this.fromEmail) {
      return 'Error: SendGrid fromEmail not configured. Set it in the connection settings.'
    }

    try {
      const htmlBody = await this.convertMarkdownToHtml(body)

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: recipientEmail }],
            subject
          }],
          from: {
            email: this.fromEmail,
            name: from_name || this.fromName || undefined
          },
          content: [
            { type: 'text/plain', value: body },
            { type: 'text/html', value: htmlBody }
          ]
        })
      })

      if (response.status === 202) {
        const messageId = response.headers.get('X-Message-Id') || `sg-${Date.now()}`
        return JSON.stringify({ success: true, messageId, to: recipientEmail })
      } else {
        let errorMessage = `SendGrid API returned status ${response.status}`
        try {
          const errorData = await response.json()
          if (errorData.errors?.length > 0) {
            errorMessage = errorData.errors.map((e: any) => e.message).join(', ')
          }
        } catch {
          // ignore
        }
        return JSON.stringify({ success: false, error: errorMessage })
      }
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
