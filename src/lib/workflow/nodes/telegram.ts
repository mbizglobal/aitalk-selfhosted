
import { maskId } from '@/lib/log-mask'
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { getConnectionSecret } from '@/lib/secret-vault'
import { canReadTemplatePath } from '../template-scope'

interface TelegramNodeData {
  chatId: string
  message: string
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  disableNotification?: boolean
}

interface TelegramResult {
  success: boolean
  messageId?: number
  chatId?: string
  error?: string
}

export class TelegramNodeExecutor extends BaseNodeExecutor {
  private isDev = process.env.NODE_ENV === 'development'

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const nodeData = node.data as TelegramNodeData
    const { chatId, message, parseMode, disableNotification } = nodeData

    if (!chatId || !message) {
      const error = 'Missing required fields: chatId, message'
      console.error(`[Telegram] Error: ${error}`)
      return this.createErrorResult(context, error, nodeData)
    }

    try {
      const resolvedChatId = this.substituteVariables(chatId, context)
      const resolvedMessage = this.substituteVariables(message, context)

      if (this.isDev) {
        console.log('[Telegram] Sending message...')
        console.log('[Telegram] Chat ID:', maskId(resolvedChatId))
      }

      const connection = await prisma.workflowConnection.findFirst({
        where: {
          agentId: context.agentId,
          provider: 'telegram'
        },
        select: {
          id: true,
          encryptedToken: true
        }
      })

      if (!connection?.encryptedToken) {
        const error = 'Telegram Bot Token not configured for this agent'
        console.error(`[Telegram] Error: ${error}`)
        return this.createErrorResult(context, error, nodeData)
      }

      const botToken = await getConnectionSecret(prisma, context.userId, connection.id, connection.encryptedToken)

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: resolvedChatId,
          text: resolvedMessage,
          ...(parseMode && { parse_mode: parseMode }),
          disable_notification: disableNotification || false
        })
      })

      const responseData = await response.json()

      if (response.ok && responseData.ok) {
        const messageId = responseData.result?.message_id

        const result: TelegramResult = {
          success: true,
          messageId,
          chatId: resolvedChatId
        }

        if (this.isDev) {
          console.log('[Telegram] Message sent successfully, message_id:', messageId)
        }

        const updatedContext = {
          ...context,
          telegramResult: result
        }

        return this.createSuccessResult(updatedContext, {
          input: {
            chatId: resolvedChatId,
            message: resolvedMessage.substring(0, 100) + (resolvedMessage.length > 100 ? '...' : ''),
            parseMode: parseMode || 'None'
          },
          output: result
        })
      } else {
        const errorMessage = responseData.description || `Telegram API returned status ${response.status}`
        console.error(`[Telegram] Error: ${errorMessage}`)

        const result: TelegramResult = {
          success: false,
          error: errorMessage,
          chatId: resolvedChatId
        }

        const updatedContext = {
          ...context,
          telegramResult: result
        }

        return this.createErrorResult(updatedContext, errorMessage, {
          chatId: resolvedChatId,
          message: resolvedMessage.substring(0, 100) + (resolvedMessage.length > 100 ? '...' : '')
        })
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error sending message'
      console.error(`[Telegram] Exception: ${errorMessage}`)

      const result: TelegramResult = {
        success: false,
        error: errorMessage
      }

      const updatedContext = {
        ...context,
        telegramResult: result
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
}
