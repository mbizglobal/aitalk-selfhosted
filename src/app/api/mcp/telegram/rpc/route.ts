
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { userScopedWhere } from '@/lib/connection-scope'
import { prisma } from '@/lib/prisma'
import { decryptData } from '@/lib/encryption'

// ========================================
// ========================================

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, any>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

interface OrderItem {
  name: string
  quantity: number
  price: number
}

interface SendMessageArgs {
  message: string
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  chatId?: string
}

interface SendOrderNotificationArgs {
  customerName: string
  items: OrderItem[]
  totalAmount: number
  specialRequest?: string
  chatId?: string
}

// ========================================
// ========================================

const TELEGRAM_TOOLS = [
  {
    name: 'send_message',
    description: 'Telegram으로 메시지를 전송합니다. 중요한 알림이나 확인이 필요할 때만 사용하세요. 단순 문의나 질문에는 호출하지 마세요.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '전송할 메시지 내용'
        },
        parseMode: {
          type: 'string',
          enum: ['HTML', 'Markdown', 'MarkdownV2'],
          description: '메시지 형식 (기본: HTML)'
        },
        chatId: {
          type: 'string',
          description: '수신자 Chat ID (생략 시 기본값 사용)'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'send_order_notification',
    description: '주문 내역을 Telegram으로 전송합니다. 고객이 주문을 확정했을 때만 호출하세요. 단순 메뉴 문의나 가격 질문에는 절대 호출하지 마세요.',
    inputSchema: {
      type: 'object',
      properties: {
        customerName: {
          type: 'string',
          description: '고객명'
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '메뉴명' },
              quantity: { type: 'number', description: '수량' },
              price: { type: 'number', description: '단가' }
            },
            required: ['name', 'quantity', 'price']
          },
          description: '주문 메뉴 목록'
        },
        totalAmount: {
          type: 'number',
          description: '총 금액'
        },
        specialRequest: {
          type: 'string',
          description: '특별 요청사항 (선택)'
        },
        chatId: {
          type: 'string',
          description: '수신자 Chat ID (생략 시 기본값 사용)'
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
    message += `  • ${item.name} x ${item.quantity} - ₩${itemTotal.toLocaleString()}\n`
  }

  message += `\n💰 <b>총 금액:</b> ₩${totalAmount.toLocaleString()}`

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

async function handleInitialize(id: string | number): Promise<JsonRpcResponse> {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2025-06-18',
      serverInfo: {
        name: 'telegram-mcp',
        version: '1.0.0'
      },
      capabilities: {
        tools: {}
      }
    }
  }
}

async function handleToolsList(id: string | number): Promise<JsonRpcResponse> {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools: TELEGRAM_TOOLS
    }
  }
}

async function handleToolsCall(
  id: string | number,
  params: { name: string; arguments?: Record<string, any> },
  botToken: string,
  defaultChatId: string
): Promise<JsonRpcResponse> {
  const { name, arguments: args = {} } = params

  const chatId = (args.chatId && args.chatId !== 'default') ? args.chatId : defaultChatId

  if (!chatId) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: 'Error: Chat ID not configured' }],
        isError: true
      }
    }
  }

  let result: { success: boolean; messageId?: number; error?: string }

  switch (name) {
    case 'send_message': {
      const messageArgs = args as SendMessageArgs
      const formattedMessage = formatSimpleMessage(messageArgs.message)
      result = await sendTelegramMessage(
        botToken,
        chatId,
        formattedMessage,
        messageArgs.parseMode || 'HTML'
      )
      break
    }

    case 'send_order_notification': {
      const orderArgs = args as SendOrderNotificationArgs
      const formattedMessage = formatOrderNotification(orderArgs)
      result = await sendTelegramMessage(botToken, chatId, formattedMessage, 'HTML')
      break
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: Unknown tool '${name}'` }],
          isError: true
        }
      }
  }

  if (result.success) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: `Message sent successfully. message_id: ${result.messageId}`
          }
        ]
      }
    }
  } else {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Error: ${result.error}` }],
        isError: true
      }
    }
  }
}

// ========================================
// ========================================

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
        { status: 401 }
      )
    }
    const userId = session.user.id

    const connectionId = request.nextUrl.searchParams.get('connectionId')
      || request.headers.get('X-MCP-Connection-Id')

    if (!connectionId) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Missing connectionId' }
        },
        { status: 400 }
      )
    }

    const body: JsonRpcRequest = await request.json()

    if (body.jsonrpc !== '2.0' || !body.method) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: body.id || null,
          error: { code: -32600, message: 'Invalid JSON-RPC request' }
        },
        { status: 400 }
      )
    }

    if (body.method === 'initialize') {
      return NextResponse.json(await handleInitialize(body.id))
    }

    if (body.method === 'notifications/initialized') {
      return NextResponse.json({ jsonrpc: '2.0', id: body.id, result: {} })
    }

    if (body.method === 'tools/list') {
      return NextResponse.json(await handleToolsList(body.id))
    }

    if (body.method === 'tools/call') {
      const connection = await prisma.workflowConnection.findFirst({
        where: {
          id: connectionId,
          ...userScopedWhere({ userId }, 'Telegram MCP RPC'),
          provider: 'telegram_mcp',
          status: 'active'
        }
      })

      if (!connection) {
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32001, message: 'Connection not found or inactive' }
        })
      }

      if (!connection.encryptedToken) {
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32002, message: 'Bot token not configured' }
        })
      }

      let botToken: string
      try {
        botToken = await decryptData(connection.encryptedToken)
      } catch {
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32003, message: 'Failed to decrypt bot token' }
        })
      }

      let defaultChatId = ''
      if (connection.serviceConfig) {
        try {
          const config = typeof connection.serviceConfig === 'string'
            ? JSON.parse(connection.serviceConfig)
            : connection.serviceConfig
          defaultChatId = config.chatId || ''
        } catch {
        }
      }

      await prisma.workflowConnection.update({
        where: { id: connectionId },
        data: { lastUsedAt: new Date() }
      })

      const response = await handleToolsCall(body.id, body.params!, botToken, defaultChatId)
      return NextResponse.json(response)
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: `Method not found: ${body.method}` }
    })

  } catch (error: any) {
    console.error('[Telegram MCP] Error:', error)
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: error.message || 'Internal error' }
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'telegram-mcp',
    version: '1.0.0',
    description: 'Telegram MCP Server for AI-driven message delivery',
    tools: TELEGRAM_TOOLS.map(t => t.name)
  })
}
