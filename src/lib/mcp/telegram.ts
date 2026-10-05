
import { PrismaClient } from '@prisma/client'
import { decryptData } from '@/lib/encryption'
import { agentScopedWhere } from '@/lib/connection-scope'

// ========================================
// ========================================

export interface OrderItem {
  name: string
  quantity: number
  price: number
}

export interface SendMessageArgs {
  message: string
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  chatId?: string
}

export interface SendOrderNotificationArgs {
  customerName: string
  items: OrderItem[]
  totalAmount: number
  specialRequest?: string
  chatId?: string
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
}

export interface McpToolCallResult {
  content: Array<{
    type: string
    text?: string
  }>
  isError?: boolean
}

// ========================================
// ========================================

export const TELEGRAM_TOOLS: McpToolDefinition[] = [
  {
    name: 'send_message',
    description: 'Send a message via Telegram. Default Chat ID is pre-configured, so just provide the message content. Do not ask the user for Chat ID.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Message content to send'
        },
        parseMode: {
          type: 'string',
          enum: ['HTML', 'Markdown', 'MarkdownV2'],
          description: 'Message format (default: HTML, optional)'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'send_order_notification',
    description: 'Send order details via Telegram. Default Chat ID is pre-configured. Only call this when a customer confirms an order.',
    inputSchema: {
      type: 'object',
      properties: {
        customerName: {
          type: 'string',
          description: 'Customer name (e.g., "Table 5")'
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Menu item name' },
              quantity: { type: 'number', description: 'Quantity' },
              price: { type: 'number', description: 'Unit price' }
            },
            required: ['name', 'quantity', 'price']
          },
          description: 'List of ordered items'
        },
        totalAmount: {
          type: 'number',
          description: 'Total amount'
        },
        specialRequest: {
          type: 'string',
          description: 'Special request (optional)'
        }
      },
      required: ['customerName', 'items', 'totalAmount']
    }
  }
]

// ========================================
// ========================================

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: string = 'HTML'
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true
        })
      }
    )

    const result = await response.json()

    if (!result.ok) {
      return {
        success: false,
        error: result.description || 'Telegram API error'
      }
    }

    return {
      success: true,
      messageId: result.result.message_id
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to send message'
    }
  }
}

// ========================================
// ========================================

function formatOrderNotification(args: SendOrderNotificationArgs): string {
  const { customerName, items, totalAmount, specialRequest } = args

  const now = new Date()
  const timestamp = now.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  let message = `🍽️ <b>새 주문이 접수되었습니다!</b>\n\n`
  message += `👤 <b>고객:</b> ${customerName}\n`
  message += `📋 <b>주문 내역:</b>\n`

  for (const item of items) {
    const itemTotal = item.quantity * item.price
    message += `  • ${item.name} x ${item.quantity} - CHF ${itemTotal.toLocaleString()}\n`
  }

  message += `\n💰 <b>총 금액:</b> CHF ${totalAmount.toLocaleString()}`

  if (specialRequest) {
    message += `\n📝 <b>요청사항:</b> ${specialRequest}`
  }

  message += `\n\n⏰ <b>접수 시간:</b> ${timestamp}`

  return message
}

function formatSimpleMessage(text: string): string {
  const now = new Date()
  const timestamp = now.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  return `📢 <b>알림</b>\n\n${text}\n\n⏰ ${timestamp}`
}

// ========================================
// ========================================

export class TelegramMcpClient {
  private botToken: string | null = null
  private defaultChatId: string = ''
  private connectionId: string
  private initialized: boolean = false

  constructor(connectionId: string) {
    this.connectionId = connectionId
  }

  async initialize(
    prisma: PrismaClient,
    scope: { agentId?: string; userId?: string }
  ): Promise<{ name: string; version: string }> {
    const connection = await prisma.workflowConnection.findFirst({
      where: {
        id: this.connectionId,
        ...agentScopedWhere(scope, 'Telegram MCP'),
        provider: 'telegram_mcp',
        status: 'active'
      }
    })

    if (!connection) {
      throw new Error('Telegram MCP connection not found or inactive')
    }

    if (!connection.encryptedToken) {
      throw new Error('Bot token not configured')
    }

    try {
      this.botToken = await decryptData(connection.encryptedToken)
    } catch {
      throw new Error('Failed to decrypt bot token')
    }

    if (connection.serviceConfig) {
      try {
        const config = typeof connection.serviceConfig === 'string'
          ? JSON.parse(connection.serviceConfig)
          : connection.serviceConfig
        this.defaultChatId = config.chatId || ''
      } catch {
      }
    }

    this.initialized = true

    return {
      name: 'telegram-mcp',
      version: '1.0.0'
    }
  }

  listTools(): McpToolDefinition[] {
    return TELEGRAM_TOOLS
  }

  async callTool(name: string, args: Record<string, any> = {}): Promise<McpToolCallResult> {
    if (!this.initialized || !this.botToken) {
      return {
        content: [{ type: 'text', text: 'Error: Client not initialized' }],
        isError: true
      }
    }

    const chatId = (args.chatId && args.chatId !== 'default') ? args.chatId : this.defaultChatId

    if (!chatId) {
      return {
        content: [{ type: 'text', text: 'Error: Chat ID not configured' }],
        isError: true
      }
    }

    let result: { success: boolean; messageId?: number; error?: string }

    switch (name) {
      case 'send_message': {
        const messageArgs = args as SendMessageArgs
        const formattedMessage = formatSimpleMessage(messageArgs.message)
        result = await sendTelegramMessage(
          this.botToken,
          chatId,
          formattedMessage,
          messageArgs.parseMode || 'HTML'
        )
        break
      }

      case 'send_order_notification': {
        const orderArgs = args as SendOrderNotificationArgs
        const formattedMessage = formatOrderNotification(orderArgs)
        result = await sendTelegramMessage(this.botToken, chatId, formattedMessage, 'HTML')
        break
      }

      default:
        return {
          content: [{ type: 'text', text: `Error: Unknown tool '${name}'` }],
          isError: true
        }
    }

    if (result.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Message sent successfully. message_id: ${result.messageId}`
          }
        ]
      }
    } else {
      return {
        content: [{ type: 'text', text: `Error: ${result.error}` }],
        isError: true
      }
    }
  }

  async close(): Promise<void> {
    // Nothing to do
  }
}
