
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { getConnectionSecret } from '@/lib/secret-vault'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkHtml from 'remark-html'
import { canReadTemplatePath } from '../template-scope'

interface SendGridNodeData {
  toEmail: string
  fromEmail: string
  fromName?: string
  subject: string
  bodyTemplate: string
}

interface SendGridResult {
  success: boolean
  messageId?: string
  toEmail?: string
  error?: string
}

export class SendGridNodeExecutor extends BaseNodeExecutor {
  private isDev = process.env.NODE_ENV === 'development'

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const nodeData = node.data as SendGridNodeData
    const { toEmail, fromEmail, fromName, subject, bodyTemplate } = nodeData

    if (!toEmail || !fromEmail || !subject || !bodyTemplate) {
      const error = 'Missing required fields: toEmail, fromEmail, subject, bodyTemplate'
      console.error(`[SendGrid] Error: ${error}`)
      return this.createErrorResult(context, error, nodeData)
    }

    try {
      const resolvedToEmail = this.substituteVariables(toEmail, context)
      const resolvedSubject = this.substituteVariables(subject, context)
      const resolvedBody = this.substituteVariables(bodyTemplate, context)

      const htmlBody = await this.convertMarkdownToHtml(resolvedBody)

      if (this.isDev) {
        console.log('[SendGrid] Sending email...')
      }

      const connection = await prisma.workflowConnection.findFirst({
        where: {
          agentId: context.agentId,
          provider: 'sendgrid'
        },
        select: {
          id: true,
          encryptedToken: true
        }
      })

      if (!connection?.encryptedToken) {
        const error = 'SendGrid API Key not configured for this agent'
        console.error(`[SendGrid] Error: ${error}`)
        return this.createErrorResult(context, error, nodeData)
      }

      const apiKey = await getConnectionSecret(prisma, context.userId, connection.id, connection.encryptedToken)

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: resolvedToEmail }],
              subject: resolvedSubject
            }
          ],
          from: {
            email: fromEmail,
            name: fromName || undefined
          },
          content: [
            {
              type: 'text/plain',
              value: resolvedBody
            },
            {
              type: 'text/html',
              value: htmlBody
            }
          ]
        })
      })

      if (response.status === 202) {
        const messageId = response.headers.get('X-Message-Id') || `sg-${Date.now()}`

        const result: SendGridResult = {
          success: true,
          messageId,
          toEmail: resolvedToEmail
        }

        if (this.isDev) {
          console.log('[SendGrid] Email sent successfully')
        }

        const updatedContext = {
          ...context,
          sendGridResult: result
        }

        return this.createSuccessResult(updatedContext, {
          input: {
            toEmail: resolvedToEmail,
            fromEmail,
            subject: resolvedSubject
          },
          output: result
        })
      } else {
        let errorMessage = `SendGrid API returned status ${response.status}`
        try {
          const errorData = await response.json()
          if (errorData.errors && errorData.errors.length > 0) {
            errorMessage = errorData.errors.map((e: any) => e.message).join(', ')
          }
        } catch {
        }

        console.error(`[SendGrid] Error: ${errorMessage}`)

        const result: SendGridResult = {
          success: false,
          error: errorMessage,
          toEmail: resolvedToEmail
        }

        const updatedContext = {
          ...context,
          sendGridResult: result
        }

        return this.createErrorResult(updatedContext, errorMessage, {
          toEmail: resolvedToEmail,
          fromEmail,
          subject: resolvedSubject
        })
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error sending email'
      console.error(`[SendGrid] Exception: ${errorMessage}`)

      const result: SendGridResult = {
        success: false,
        error: errorMessage
      }

      const updatedContext = {
        ...context,
        sendGridResult: result
      }

      return this.createErrorResult(updatedContext, errorMessage, nodeData)
    }
  }

  private substituteVariables(template: string, context: WorkflowContext): string {
    if (!template) return ''

    let result = template

    result = result.replace(/\{\{context\.([^}]+)\}\}/g, (match, path) => {
      if (!canReadTemplatePath(context, path)) return ''
      const value = this.getValueFromPath(context, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    result = result.replace(/\{\{message\}\}/g, context.message || '')

    result = result.replace(/\{\{aiResponse\}\}/g, context.aiResponse || '')

    result = result.replace(/\{\{jsonData\.([^}]+)\}\}/g, (match, path) => {
      if (!context.jsonData) return ''
      const value = this.getValueFromPath(context.jsonData, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    return result
  }

  private getValueFromPath(obj: any, path: string): any {
    if (!obj || !path) return undefined
    const parts = path.split('.')
    let current = obj
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = current[part]
    }
    return current
  }

  private async convertMarkdownToHtml(markdown: string): Promise<string> {
    try {
      const result = await remark()
        .use(remarkGfm)
        .use(remarkHtml, { sanitize: false })
        .process(markdown)

      const htmlContent = String(result)
      return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1, h2, h3 { color: #1a1a1a; margin-top: 24px; margin-bottom: 12px; }
    h1 { font-size: 24px; border-bottom: 2px solid #eee; padding-bottom: 8px; }
    h2 { font-size: 20px; }
    h3 { font-size: 16px; }
    ul, ol { padding-left: 24px; margin: 12px 0; }
    li { margin: 6px 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Monaco, monospace; font-size: 14px; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #ddd; margin: 12px 0; padding-left: 16px; color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f4f4f4; font-weight: 600; }
    hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    p { margin: 12px 0; }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>`
    } catch (error) {
      console.error('[SendGrid] Markdown conversion failed:', error)
      return `<html><body><pre style="white-space: pre-wrap; font-family: sans-serif;">${this.escapeHtml(markdown)}</pre></body></html>`
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
}
