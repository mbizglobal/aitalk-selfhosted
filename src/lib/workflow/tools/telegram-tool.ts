
import { AIToolClient, ToolDefinition } from './types'
import { PrismaClient } from '@prisma/client'
import { getConnectionSecret } from '@/lib/secret-vault'
import { agentScopedWhere } from '@/lib/connection-scope'

export class TelegramToolClient implements AIToolClient {
  private botToken: string = ''
  private defaultChatId: string = ''

  async initialize(prisma: PrismaClient, connectionId: string, overrides?: { chatId?: string; agentId?: string }, userId?: string): Promise<void> {
    const connection = await prisma.workflowConnection.findFirst({
      where: {
        id: connectionId,
        ...agentScopedWhere({ agentId: overrides?.agentId, userId }, 'Telegram Tool'),
        provider: 'telegram',
        status: 'active',
      },
      select: { id: true, encryptedToken: true, serviceConfig: true }
    })

    if (!connection?.encryptedToken) {
      throw new Error('Telegram connection not found or no credentials')
    }

    this.botToken = userId
      ? await getConnectionSecret(prisma, userId, connection.id, connection.encryptedToken)
      : await getConnectionSecret(prisma, '', connection.id, connection.encryptedToken)

    if (connection.serviceConfig) {
      try {
        const config = JSON.parse(connection.serviceConfig)
        this.defaultChatId = config.chatId || ''
      } catch {
        // ignore
      }
    }

    if (overrides?.chatId && !this.defaultChatId) this.defaultChatId = overrides.chatId
  }

  listTools(): ToolDefinition[] {
    const properties: Record<string, any> = {
      text: { type: 'string', description: 'Message text' },
    }
    if (!this.defaultChatId) {
      properties.chat_id = { type: 'string', description: 'Telegram chat ID' }
    }

    return [{
      name: 'send_telegram_message',
      description: this.defaultChatId
        ? 'Send a Telegram message to the configured recipient. The recipient is already configured. Just provide the message text. Use when the user asks to send a Telegram message or contact someone via Telegram.'
        : 'Send a Telegram message. Use when the user asks to send a Telegram message.',
      parameters: {
        type: 'object',
        properties,
        required: ['text']
      }
    }]
  }

  async callTool(name: string, args: Record<string, any>): Promise<string> {
    if (name !== 'send_telegram_message') {
      return `Unknown tool: ${name}`
    }

    const { text, chat_id } = args
    const chatId = this.defaultChatId || (chat_id && chat_id !== 'default' ? chat_id : '')

    if (!text) {
      return 'Error: Missing required field (text)'
    }

    if (!chatId) {
      return 'Error: No chat_id provided and no default chat ID configured'
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_notification: false
        })
      })

      const responseData = await response.json()

      if (response.ok && responseData.ok) {
        const messageId = responseData.result?.message_id
        return JSON.stringify({ success: true, messageId, chatId })
      } else {
        const errorMessage = responseData.description || `Telegram API returned status ${response.status}`
        return JSON.stringify({ success: false, error: errorMessage })
      }
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message })
    }
  }
}
