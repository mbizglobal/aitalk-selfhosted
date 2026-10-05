import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { PrismaClient } from '@prisma/client'
import { authOptions } from '../../auth/[...nextauth]/route'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { getLanguageFromHeaders, getTranslations, getErrorMessage } from '@/lib/translations/dashboard'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 10

type SourceFilter = 'all' | 'text' | 'voice' | 'quiz'

function classifySource(model: string | null | undefined): 'text' | 'voice-pstn' | 'voice-web' | 'voice-web-test' | 'quiz' {
  if (!model) return 'text'
  if (model === 'voice-pstn') return 'voice-pstn'
  if (model === 'voice-web-live') return 'voice-web'
  if (model === 'voice-web-test') return 'voice-web-test'
  if (model === 'miniapp-quiz') return 'quiz'
  return 'text'
}

export async function GET(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)
  let session: { user?: { id?: string } } | null = null

  try {
    session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10)
    const requestedLimit = Number.parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)
    const agentId = searchParams.get('agentId')
    const sourceFilter: SourceFilter = (searchParams.get('source') as SourceFilter) || 'all'

    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT

    const skip = (page - 1) * limit

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        encryptedDataKey: true,
        zkiId: true,
        zki: { select: { masterKey: true } }
      }
    })

    if (!user?.encryptedDataKey) {
      return NextResponse.json({
        success: true,
        conversations: [],
        pageInfo: {
          currentPage: 1,
          totalPages: 1,
          limit,
          totalItems: 0,
        },
      })
    }

    let dataKey: Buffer
    if (user.zkiId && user.zki?.masterKey) {
      dataKey = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
    } else {
      dataKey = await decryptDataKey(Buffer.from(user.encryptedDataKey))
    }

    const whereCondition: any = {
      agent: { userId: session.user.id },
      role: 'm',
    }

    if (agentId) whereCondition.agentId = agentId

    if (sourceFilter === 'text') {
      whereCondition.OR = [
        { model: null },
        { model: { notIn: ['voice-pstn', 'voice-web-live', 'voice-web-test', 'miniapp-quiz'] } },
      ]
    } else if (sourceFilter === 'voice') {
      whereCondition.model = { in: ['voice-pstn', 'voice-web-live', 'voice-web-test'] }
    } else if (sourceFilter === 'quiz') {
      whereCondition.model = 'miniapp-quiz'
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: whereCondition,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          agent: {
            select: { title: true }
          }
        }
      }),
      prisma.conversation.count({
        where: whereCondition,
      }),
    ])

    const conversationIds = conversations.map(c => c.conversation_id)
    const tokenSums = await prisma.conversation.groupBy({
      by: ['conversation_id'],
      where: {
        conversation_id: { in: conversationIds },
        agent: { userId: session.user.id }
      },
      _sum: {
        input_tokens: true,
        output_tokens: true
      }
    })

    const pstnSessionIds = conversations
      .filter(c => c.model === 'voice-pstn' && c.api_key)
      .map(c => c.api_key!)
    const webSessionIds = conversations
      .filter(c => (c.model === 'voice-web-live' || c.model === 'voice-web-test') && c.api_key)
      .map(c => c.api_key!)

    const [pstnSessions, webSessions] = await Promise.all([
      pstnSessionIds.length
        ? prisma.callSession.findMany({
            where: { callConnectionId: { in: pstnSessionIds }, userId: session.user.id },
            select: {
              callConnectionId: true,
              callerNumber: true,
              callerNumberEnc: true,
              calleeNumber: true,
              durationSeconds: true,
              voiceName: true,
              language: true,
              status: true,
              startedAt: true,
              endedAt: true,
            },
          })
        : [],
      webSessionIds.length
        ? prisma.webVoiceSession.findMany({
            where: { sessionId: { in: webSessionIds }, agent: { userId: session.user.id } },
            select: {
              sessionId: true,
              mode: true,
              durationSeconds: true,
              voiceName: true,
              language: true,
              userIp: true,
              startedAt: true,
              endedAt: true,
            },
          })
        : [],
    ])
    const pstnMap = new Map(pstnSessions.map(s => [s.callConnectionId, s]))
    const webMap = new Map(webSessions.map(s => [s.sessionId, s]))

    const totalPages = total === 0 ? 1 : Math.ceil(total / limit)

    if (total === 0) {
      return NextResponse.json({
        success: true,
        conversations: [],
        pageInfo: {
          currentPage: 1,
          totalPages: 1,
          limit,
          totalItems: 0,
        },
      })
    }

    if (page > totalPages && totalPages > 0) {
      return NextResponse.json({
        success: true,
        conversations: [],
        pageInfo: {
          currentPage: totalPages,
          totalPages,
          limit,
          totalItems: total,
        },
      })
    }

    const tokenSumMap = new Map(
      tokenSums.map(sum => [
        sum.conversation_id,
        {
          totalInputTokens: sum._sum.input_tokens || 0,
          totalOutputTokens: sum._sum.output_tokens || 0
        }
      ])
    )

    const parsedConversations = conversations.map((conversation) => {
      let userQuestion = 'No question available.'
      let quizMeta: {
        title: string
        memberDisplayName: string
        durationSeconds: number
        questionsTotal: number
        questionsAnswered: number
        correctCount: number
      } | null = null

      try {
        if (conversation.content) {
          const decryptedContent = decrypt(Buffer.from(conversation.content), dataKey)
          const messages = JSON.parse(decryptedContent)

          if (conversation.model === 'miniapp-quiz' && messages.quiz) {
            quizMeta = {
              title: messages.quiz.title ?? 'Quiz',
              memberDisplayName: messages.quiz.memberDisplayName ?? '',
              durationSeconds: messages.quiz.durationSeconds ?? 0,
              questionsTotal: messages.quiz.questionsTotal ?? 0,
              questionsAnswered: messages.quiz.questionsAnswered ?? 0,
              correctCount: messages.quiz.correctCount ?? 0,
            }
            userQuestion = quizMeta.title
          } else if (messages.messages && Array.isArray(messages.messages)) {
            const userMessage = messages.messages.find((msg: any) => msg.role === 'user')
            if (userMessage && userMessage.content) {
              userQuestion = userMessage.content
            } else if (messages.messages[0]?.content) {
              userQuestion = messages.messages[0].content
            }
          }
        }
      } catch (error) {
        console.error('Failed to decrypt conversation content:', error)
        userQuestion = 'Error decrypting content.'
      }

      const tokenSum = tokenSumMap.get(conversation.conversation_id)
      const sourceKind = classifySource(conversation.model)
      const sessionId = conversation.api_key || null

      let voiceMeta: {
        duration: number | null
        voiceName: string | null
        language: string | null
        callerNumber?: string | null
        userIp?: string | null
        mode?: string | null
      } | null = null
      if (sourceKind === 'voice-pstn' && sessionId) {
        const s = pstnMap.get(sessionId)
        if (s) {
          let callerNumber: string | null = null
          if (s.callerNumberEnc) {
            try {
              callerNumber = decrypt(Buffer.from(s.callerNumberEnc), dataKey)
            } catch (e) {
              console.error('Failed to decrypt callerNumberEnc:', e)
            }
          }
          if (!callerNumber) callerNumber = s.callerNumber ?? null
          voiceMeta = {
            duration: s.durationSeconds ?? null,
            voiceName: s.voiceName ?? null,
            language: s.language ?? null,
            callerNumber,
          }
        }
      } else if ((sourceKind === 'voice-web' || sourceKind === 'voice-web-test') && sessionId) {
        const s = webMap.get(sessionId)
        if (s) {
          voiceMeta = {
            duration: s.durationSeconds ?? null,
            voiceName: s.voiceName ?? null,
            language: s.language ?? null,
            userIp: s.userIp ?? null,
            mode: s.mode ?? null,
          }
        }
      }

      return {
        conversationId: conversation.conversation_id,
        createdAt: conversation.created_at.toISOString(),
        userQuestion,
        inputTokens: tokenSum?.totalInputTokens || 0,
        outputTokens: tokenSum?.totalOutputTokens || 0,
        clientId: conversation.client_id,
        no: conversation.no,
        agentTitle: conversation.agent?.title || 'Unknown Agent',
        userIP: conversation.user_ip,
        source: sourceKind,
        sessionId,
        voiceMeta,
        quizMeta,
      }
    })

    return NextResponse.json({
      success: true,
      conversations: parsedConversations,
      pageInfo: {
        currentPage: page,
        totalPages,
        limit,
        totalItems: total,
      },
    })
  } catch (error) {
    console.error('[history/conversations] Failed to load conversations:', error)
    console.error('[history/conversations] Error details:', {
      userId: session?.user?.id,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })

    return NextResponse.json({
      error: t.history_load_failed,
      success: false
    }, { status: 500 })
  }
}
