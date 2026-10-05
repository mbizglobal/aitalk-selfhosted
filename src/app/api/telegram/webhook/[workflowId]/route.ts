
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { timingSafeEqual } from 'crypto'
import { decryptData, encrypt } from '@/lib/encryption'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkflowEngine, WorkflowContext } from '@/lib/workflow'
import { extractTelegramMessage, sendTypingIndicator, sendTelegramMessage } from '@/lib/bots/telegram/utils'
import { describeCaughtError, safeLogId, safeLogToken } from '@/lib/log-mask'
import type { TelegramUpdate } from '@/lib/bots/telegram/types'
import { isSelfHosted } from '@/lib/edition'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const WORKFLOW_ERROR_MESSAGE = 'Sorry, I could not process your request.'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const startTime = Date.now()
  const { workflowId } = await params

  let restoreStorageSnapshot: (() => Promise<void>) | null = null

  try {
    const update: TelegramUpdate = await request.json()

    const extracted = extractTelegramMessage(update)
    if (!extracted) {
      return NextResponse.json({ ok: true })
    }

    const { chatId, text: userMessage, userId: telegramUserId, username: telegramUsername } = extracted

    //
    console.log(`[Telegram Webhook] Received message from chat ${safeLogId(String(chatId))} (${userMessage?.length ?? 0} chars)`)

    const workflow = await prisma.workflow.findUnique({
      where: { workflowId }
    })

    if (!workflow?.workflowJson) {
      console.error('[Telegram Webhook] No workflow found:', safeLogId(workflowId))
      return NextResponse.json({ ok: true })
    }

    if (workflow.status !== 'production') {
      console.log(`[Telegram Webhook] Workflow ${safeLogToken(workflow.workflowId)} is not active (status: ${workflow.status}), skipping`)
      return NextResponse.json({ ok: true })
    }

    const connection = await prisma.workflowConnection.findFirst({
      where: {
        workflowId,
        provider: 'telegram_webhook',
        status: 'active'
      }
    })

    if (!connection?.encryptedToken) {
      console.error('[Telegram Webhook] No bot token found for workflow:', safeLogToken(workflow.workflowId))
      return NextResponse.json({ ok: true })
    }

    if (connection.agentId !== workflow.agentId) {
      console.warn(`[Telegram Webhook] connection/workflow agent mismatch for ${safeLogToken(workflow.workflowId)} — rejected`)
      return NextResponse.json({ ok: true })
    }

    let expectedSecret: string | undefined
    if (connection.serviceConfig) {
      try { expectedSecret = JSON.parse(connection.serviceConfig)?.webhookSecret } catch { }
    }
    const providedSecret = request.headers.get('x-telegram-bot-api-secret-token')
    const secretOk = !!expectedSecret && !!providedSecret &&
      Buffer.byteLength(providedSecret) === Buffer.byteLength(expectedSecret) &&
      timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret))
    if (!secretOk) {
      console.warn(`[Telegram Webhook] Secret mismatch for workflow ${safeLogToken(workflow.workflowId)} — rejected (re-save webhook in Agent Studio if legit)`)
      return NextResponse.json({ ok: true })
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId: workflow.agentId }
    })

    const botToken = await decryptData(connection.encryptedToken)

    await sendTypingIndicator(botToken, chatId)

    const workflowJson = JSON.parse(workflow.workflowJson)

    let parseMode = 'HTML'
    const telegramStartNode = workflowJson.nodes?.find(
      (n: any) => n.data?.nodeType === 'start' && n.data?.triggerType === 'telegram'
    )
    if (telegramStartNode?.data?.parseMode) {
      parseMode = telegramStartNode.data.parseMode
    }

    const engine = new WorkflowEngine()
    const sessionKey = `telegram:${chatId}`

    //
    const existingStorage = await prisma.workflowTempStorage.findFirst({
      where: {
        conversationId: sessionKey,
        agentId: workflow.agentId,
        status: { in: ['waiting', 'pending', 'confirmed'] }
      },
      orderBy: { updatedAt: 'desc' }
    })

    let chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
    let isResuming = false
    let waitingNodeId: string | undefined
    let savedContext: any = undefined
    let statePersisted = false

    restoreStorageSnapshot = async () => {
      if (!existingStorage || statePersisted) return
      try {
        await prisma.workflowTempStorage.update({
          where: { id: existingStorage.id },
          data: {
            status: existingStorage.status,
            waitNodeId: existingStorage.waitNodeId,
            executionContext: existingStorage.executionContext,
          }
        })
      } catch (e) {
        console.error(`[Telegram Webhook] Failed to roll back storage state for chat ${safeLogId(String(chatId))}: ${describeCaughtError(e)}`)
      }
    }

    if (existingStorage) {
      if (existingStorage.executionContext) {
        try {
          const parsedContext = JSON.parse(existingStorage.executionContext)
          if (Array.isArray(parsedContext.chatHistory)) {
            chatHistory = parsedContext.chatHistory
          } else if (Array.isArray(parsedContext.context?.chatHistory)) {
            chatHistory = parsedContext.context.chatHistory
          }
          if (parsedContext.context) {
            savedContext = parsedContext.context
          }
        } catch (e) {
          console.error('[Telegram Webhook] Failed to parse execution context:', describeCaughtError(e))
        }
      }

      if (existingStorage.waitNodeId) {
        isResuming = true
        waitingNodeId = existingStorage.waitNodeId

        await prisma.workflowTempStorage.update({
          where: { id: existingStorage.id },
          data: { status: 'pending' }
        })
      }
    }

    const subscription = isSelfHosted() ? null : await prisma.subscription.findUnique({
      where: { id: agent?.userId || '' },
      select: { serviceVariant: true, managedRegion: true }
    })

    const context: WorkflowContext = {
      ...(savedContext || {}),
      message: userMessage,
      agentId: workflow.agentId,
      userId: agent?.userId || '',
      workflowId: workflow.workflowId,
      request,
      clientId: sessionKey,
      conversationId: sessionKey,
      chatHistory,
      telegramChatId: chatId,
      telegramUserId,
      telegramUsername,
      isTelegramWebhook: true,
      isResuming,
      waitingNodeId,
      isManaged: subscription?.serviceVariant === 'managed',
      managedRegion: subscription?.managedRegion || undefined,
      chatSummaryProtocol: 1,
    }

    //
    const result = await engine.execute(workflowJson, context)

    //
    //
    if (result.nodeError) {
      console.error(`[Telegram Webhook] Workflow ${safeLogToken(workflow.workflowId)} failed at node ${safeLogToken(result.nodeError.nodeId)} for chat ${safeLogId(String(chatId))}`)

      await restoreStorageSnapshot()
      await sendTelegramMessage(botToken, chatId, WORKFLOW_ERROR_MESSAGE, parseMode)
      return NextResponse.json({ ok: true })
    }

    //
    let aiResponse = result.context?.finalAnswer || result.context?.aiResponse || ''
    if (!aiResponse) {
      aiResponse = WORKFLOW_ERROR_MESSAGE
    }

    const isNewContextTurn = chatHistory.length === 0

    chatHistory.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: aiResponse }
    )
    if (chatHistory.length > 40) {
      chatHistory = chatHistory.slice(-40)
    }

    //
    //
    try {
      const storageRecord = await prisma.workflowTempStorage.findFirst({
        where: {
          conversationId: sessionKey,
          agentId: workflow.agentId
        },
        orderBy: { updatedAt: 'desc' }
      })

      if (result.waitingNodeId) {
        const storageData = {
          waitNodeId: result.waitingNodeId,
          status: 'waiting' as const,
          executionContext: JSON.stringify({
            chatHistory,
            //
            context: { ...result.context, request: undefined, finalAnswer: undefined },
            whileLoopContext: result.context?.whileLoopContext
          }),
          updatedAt: new Date()
        }

        if (storageRecord) {
          await prisma.workflowTempStorage.update({
            where: { id: storageRecord.id },
            data: storageData
          })
        } else {
          await prisma.workflowTempStorage.create({
            data: {
              conversationId: sessionKey,
              agentId: workflow.agentId,
              jsonData: '{}',
              ...storageData
            }
          })
        }
      } else {
        const storageData = {
          waitNodeId: null,
          status: 'confirmed' as const,
          executionContext: JSON.stringify({ chatHistory }),
          updatedAt: new Date()
        }

        if (storageRecord) {
          await prisma.workflowTempStorage.update({
            where: { id: storageRecord.id },
            data: storageData
          })
        } else {
          await prisma.workflowTempStorage.create({
            data: {
              conversationId: sessionKey,
              agentId: workflow.agentId,
              jsonData: '{}',
              ...storageData
            }
          })
        }
      }
      statePersisted = true
    } catch (e) {
      console.error(`[Telegram Webhook] Failed to persist conversation state for chat ${safeLogId(String(chatId))}: ${describeCaughtError(e)}`)
      await restoreStorageSnapshot()
      await sendTelegramMessage(botToken, chatId, WORKFLOW_ERROR_MESSAGE, parseMode)
      return NextResponse.json({ ok: true })
    }

    //
    const delivered = await sendTelegramMessage(botToken, chatId, aiResponse, parseMode)

    //
    if (!delivered) {
      console.error(`[Telegram Webhook] Delivery failed for chat ${safeLogId(String(chatId))} — History 기록 생략`)
    }

    //
    if (delivered && agent?.userId) {
      try {
        const dataKey = await ensureUserDataKey(prisma, agent.userId)

        await prisma.conversation.create({
          data: {
            conversation_id: `bot:${workflow.agentId}:${sessionKey}`,
            client_id: String(telegramUserId),
            agentId: workflow.agentId,
            role: isNewContextTurn ? 'm' : 's',
            content: new Uint8Array(encrypt(JSON.stringify({
              messages: [
                { role: 'user', content: userMessage },
                { role: 'assistant', content: aiResponse },
              ]
            }), dataKey)),
            input_tokens: result.context?.inputTokens || null,
            output_tokens: result.context?.outputTokens || null,
            model: result.context?.model || null,
          }
        })
      } catch (e) {
        console.error(`[Telegram Webhook] Conversation logging failed for chat ${safeLogId(String(chatId))}: ${describeCaughtError(e)}`)
      }
    }

    const elapsed = Date.now() - startTime
    console.log(`[Telegram Webhook] Processed chat ${safeLogId(String(chatId))} in ${elapsed}ms`)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Telegram Webhook] Error:', describeCaughtError(error))
    if (restoreStorageSnapshot) await restoreStorageSnapshot()
    return NextResponse.json({ ok: true })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params

  const connection = await prisma.workflowConnection.findFirst({
    where: {
      workflowId,
      provider: 'telegram_webhook'
    },
    select: {
      id: true,
      status: true,
      serverUrl: true
    }
  })

  return NextResponse.json({
    workflowId,
    connected: !!connection?.serverUrl,
    status: connection?.status || 'not_configured'
  })
}
