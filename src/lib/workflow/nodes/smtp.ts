
import nodemailer from 'nodemailer'
import { maskEmail } from '@/lib/log-mask'
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { getConnectionSecret } from '@/lib/secret-vault'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkHtml from 'remark-html'
import { getValidAccessToken } from '@/lib/email/microsoft-oauth'
import { canReadTemplatePath } from '../template-scope'

interface SmtpNodeData {
  mode: 'forward' | 'send'
  connectionId?: string

  to: string

  addPrefix?: string
  includeOriginalHeaders?: boolean
  emailIndex?: number

  subject?: string
  body?: string
  fromName?: string
}

interface SmtpResult {
  success: boolean
  messageId?: string
  subject?: string
  to?: string
  error?: string
}

export class SmtpNodeExecutor extends BaseNodeExecutor {
  private isDev = process.env.NODE_ENV === 'development'

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const nodeData = node.data as SmtpNodeData
    const { mode, connectionId, to } = nodeData

    if (!mode) {
      const error = 'Missing required field: mode'
      console.error(`[SMTP] Error: ${error}`)
      return this.createErrorResult(context, error, nodeData)
    }

    if (!to) {
      const error = 'Missing required field: to (recipient)'
      console.error(`[SMTP] Error: ${error}`)
      return this.createErrorResult(context, error, nodeData)
    }

    try {
      if (!context.agentId) {
        const error = 'Missing agentId in workflow context — refusing an unscoped connection lookup'
        console.error(`[SMTP] Error: ${error}`)
        return this.createErrorResult(context, error, nodeData)
      }

      const connection = await prisma.workflowConnection.findFirst({
        where: connectionId
          ? { id: connectionId, agentId: context.agentId, provider: 'smtp' }
          : { agentId: context.agentId, provider: 'smtp' },
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
        const error = 'SMTP connection not configured for this agent'
        console.error(`[SMTP] Error: ${error}`)
        return this.createErrorResult(context, error, nodeData)
      }

      const config = JSON.parse(connection.serviceConfig) as {
        host: string
        port: number
        user: string
        email?: string
        secure?: boolean
      }

      let authCredentials: { user: string; pass?: string; accessToken?: string }

      if (connection.authType === 'oauth') {
        const accessToken = await getValidAccessToken(connection, prisma)
        authCredentials = {
          user: config.email || config.user,
          accessToken
        }
        if (this.isDev) {
          console.log(`[SMTP] Using OAuth2 for ${maskEmail(config.email || config.user)}`)
        }
      } else {
        const password = await getConnectionSecret(prisma, context.userId, connection.id, connection.encryptedToken, connection.authType)
        authCredentials = {
          user: config.user,
          pass: password
        }
      }

      const resolvedTo = this.substituteVariables(to, context)

      let result: SmtpResult

      switch (mode) {
        case 'forward':
          result = await this.executeForward(nodeData, config, authCredentials, context, resolvedTo)
          break
        case 'send':
          result = await this.executeSend(nodeData, config, authCredentials, context, resolvedTo)
          break
        default:
          throw new Error(`Unknown mode: ${mode}`)
      }

      const updatedContext = {
        ...context,
        smtpResult: result
      }

      if (this.isDev) {
        console.log(`[SMTP] Mode '${mode}' completed:`, result.success)
      }

      return this.createSuccessResult(updatedContext, {
        input: { ...nodeData, to: resolvedTo },
        output: result
      })
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown SMTP error'
      console.error(`[SMTP] Exception: ${errorMessage}`)

      const result: SmtpResult = {
        success: false,
        error: errorMessage
      }

      const updatedContext = {
        ...context,
        smtpResult: result
      }

      return this.createErrorResult(updatedContext, errorMessage, nodeData)
    }
  }

  private async executeForward(
    nodeData: SmtpNodeData,
    config: { host: string; port: number; user: string; email?: string; secure?: boolean },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    context: WorkflowContext,
    resolvedTo: string
  ): Promise<SmtpResult> {
    const { addPrefix = '[FWD]', includeOriginalHeaders = true, emailIndex = 0, fromName } = nodeData

    //
    //
    //
    const isImapEmail = (v: any) =>
      !!v && typeof v === 'object' && !Array.isArray(v) &&
      typeof v.uid === 'number' && Number.isFinite(v.uid) &&
      typeof v.subject === 'string' &&
      typeof v.from === 'string' && typeof v.to === 'string' &&
      typeof v.date === 'string' && typeof v.body === 'string'

    const inLoop = !!(context as any).forEachContext
    const named = (context as any).currentEmail
    const loopItem = (context as any).forEachContext?.currentItem
    const candidate = inLoop ? loopItem : named
    if (candidate !== undefined && candidate !== null) {
      if (!isImapEmail(candidate)) {
        throw new Error(
          inLoop
            ? `The current ForEach item is missing the fields a forward needs (uid, subject, from, to, date, body). ` +
              `Forwarding it would send an empty subject and body. Iterate an array of IMAP mails — imapResult.emails is the usual source, ` +
              `but any array of the same shape works.`
            : `context.currentEmail is missing the fields a forward needs (uid, subject, from, to, date, body). ` +
              `Forwarding it would send an empty subject and body.`
        )
      }
      if (this.isDev) {
        console.log(`[SMTP] Using ${inLoop ? 'current ForEach item' : 'context.currentEmail'}`)
      }
      return this.forwardEmail(candidate, config, authCredentials, resolvedTo, addPrefix, includeOriginalHeaders, fromName)
    }
    if (inLoop) {
      throw new Error(
        'Inside a ForEach loop but the current iteration item is missing. ' +
        'emailIndex is a standalone-only setting and would forward the same mail on every iteration.'
      )
    }

    const imapResult = (context as any).imapResult
    if (!imapResult?.emails || !Array.isArray(imapResult.emails)) {
      throw new Error('No IMAP result found in context. Run IMAP Read node first or use inside ForEach loop.')
    }

    const email = imapResult.emails[emailIndex]
    if (!email) {
      throw new Error(`Email at index ${emailIndex} not found. Available: ${imapResult.emails.length}`)
    }
    if (!isImapEmail(email)) {
      throw new Error(
        `imapResult.emails[${emailIndex}] is missing the fields a forward needs (uid, subject, from, to, date, body). ` +
        `Forwarding it would send an empty subject and body.`
      )
    }
    if (this.isDev) {
      console.log(`[SMTP] Using imapResult.emails[${emailIndex}]`)
    }

    return this.forwardEmail(email, config, authCredentials, resolvedTo, addPrefix, includeOriginalHeaders, fromName)
  }

  private async forwardEmail(
    email: any,
    config: { host: string; port: number; user: string; email?: string; secure?: boolean },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    resolvedTo: string,
    addPrefix: string,
    includeOriginalHeaders: boolean,
    fromName?: string
  ): Promise<SmtpResult> {
    const subject = `${addPrefix} ${email.subject}`.trim()

    let body = ''
    if (includeOriginalHeaders) {
      body += `---------- Forwarded message ----------\n`
      body += `From: ${email.from}\n`
      body += `Date: ${email.date}\n`
      body += `Subject: ${email.subject}\n`
      body += `To: ${email.to}\n\n`
    }
    body += email.body || ''

    let htmlBody = ''
    if (includeOriginalHeaders) {
      htmlBody += `<div style="padding: 10px; margin-bottom: 15px; border-left: 3px solid #ccc; color: #666;">`
      htmlBody += `<b>---------- Forwarded message ----------</b><br/>`
      htmlBody += `<b>From:</b> ${this.escapeHtml(email.from)}<br/>`
      htmlBody += `<b>Date:</b> ${this.escapeHtml(email.date)}<br/>`
      htmlBody += `<b>Subject:</b> ${this.escapeHtml(email.subject)}<br/>`
      htmlBody += `<b>To:</b> ${this.escapeHtml(email.to)}<br/>`
      htmlBody += `</div>`
    }
    htmlBody += email.bodyHtml || `<pre>${this.escapeHtml(email.body || '')}</pre>`

    const fromEmail = config.email || config.user
    return this.sendEmail(config, authCredentials, {
      from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
      to: resolvedTo,
      subject,
      text: body,
      html: htmlBody
    })
  }

  private async executeSend(
    nodeData: SmtpNodeData,
    config: { host: string; port: number; user: string; email?: string; secure?: boolean },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    context: WorkflowContext,
    resolvedTo: string
  ): Promise<SmtpResult> {
    const { subject, body, fromName } = nodeData

    if (!subject || !body) {
      throw new Error('Missing required fields: subject, body')
    }

    const resolvedSubject = this.substituteVariables(subject, context)
    const resolvedBody = this.substituteVariables(body, context)

    const htmlBody = await this.convertMarkdownToHtml(resolvedBody)

    const fromEmail = config.email || config.user
    return this.sendEmail(config, authCredentials, {
      from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
      to: resolvedTo,
      subject: resolvedSubject,
      text: resolvedBody,
      html: htmlBody
    })
  }

  private async sendEmail(
    config: { host: string; port: number; user: string; email?: string; secure?: boolean },
    authCredentials: { user: string; pass?: string; accessToken?: string },
    mailOptions: {
      from: string
      to: string
      subject: string
      text: string
      html: string
    }
  ): Promise<SmtpResult> {
    let transportConfig: any

    if (authCredentials.accessToken) {
      transportConfig = {
        host: config.host,
        port: config.port,
        secure: config.secure ?? (config.port === 465),
        auth: {
          type: 'OAuth2',
          user: authCredentials.user,
          accessToken: authCredentials.accessToken
        }
      }
    } else {
      transportConfig = {
        host: config.host,
        port: config.port,
        secure: config.secure ?? (config.port === 465),
        auth: {
          user: authCredentials.user,
          pass: authCredentials.pass
        }
      }
    }

    const transporter = nodemailer.createTransport(transportConfig)
    const info = await transporter.sendMail(mailOptions)

    if (this.isDev) {
      console.log(`[SMTP] Email sent: ${info.messageId}`)
    }

    return {
      success: true,
      messageId: info.messageId,
      subject: mailOptions.subject,
      to: mailOptions.to
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

    result = result.replace(/\{\{imapResult\.([^}]+)\}\}/g, (match, path) => {
      const imapResult = (context as any).imapResult
      if (!imapResult) return ''
      const value = this.getValueFromPath(imapResult, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

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

      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/)
      if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch
        const index = parseInt(indexStr, 10)
        current = current[arrayName]
        if (!Array.isArray(current)) return undefined
        current = current[index]
      } else {
        current = current[part]
      }
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
      console.error('[SMTP] Markdown conversion failed:', error)
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
