import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { PrismaClient } from '@prisma/client'
import { authOptions } from '../../auth/[...nextauth]/route'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { getApiTranslation } from '@/lib/translations'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

async function buildQuizDetail(
  rows: Array<{ role: string; content: Uint8Array | null; api_key: string | null; created_at: Date }>,
  dataKey: Buffer
) {
  let result: any = null
  for (const row of rows) {
    if (row.role !== 's' || !row.content) continue
    try {
      const parsed = JSON.parse(decrypt(Buffer.from(row.content), dataKey))
      if (parsed.quizResult) {
        result = parsed.quizResult
        break
      }
    } catch (e) {
      console.error('[history/messages] quiz result 복호화 실패:', e)
    }
  }
  if (!result) return null

  const payloadId = result.payloadId ?? rows[0].api_key
  let questionById = new Map<string, any>()
  if (payloadId) {
    const payload = await prisma.miniAppPayload.findUnique({
      where: { payloadId },
      select: { payloadJson: true },
    })
    if (payload?.payloadJson) {
      try {
        const quizJson = JSON.parse(payload.payloadJson)
        if (Array.isArray(quizJson.questions)) {
          questionById = new Map(quizJson.questions.map((q: any) => [q.id, q]))
        }
      } catch { }
    }
  }

  const displayAnswer = (q: any, value: unknown): string | null => {
    if (value === null || value === undefined) return null
    if (q?.type === 'multiple_choice' && typeof value === 'number' && Array.isArray(q.choices)) {
      return q.choices[value] ?? String(value)
    }
    if (typeof value === 'boolean') return value ? 'True' : 'False'
    return String(value)
  }

  const questions = (Array.isArray(result.answers) ? result.answers : []).map((a: any) => {
    const q = questionById.get(a.questionId)
    const correctValue = q
      ? q.type === 'multiple_choice' ? q.answerIndex : q.type === 'true_false' ? q.answerBool : q.answer
      : undefined
    return {
      questionId: a.questionId,
      question: q?.question ?? null,
      type: q?.type ?? null,
      choices: Array.isArray(q?.choices) ? q.choices : null,
      answered: displayAnswer(q, a.answered),
      correctAnswer: q ? displayAnswer(q, correctValue) : null,
      explanation: q?.explanation ?? null,
      correct: !!a.correct,
    }
  })

  return {
    title: result.title ?? 'Quiz',
    memberDisplayName: result.memberDisplayName ?? '',
    completedAt: rows[0].created_at.toISOString(),
    durationSeconds: result.durationSeconds ?? 0,
    studyCompleted: !!result.studyCompleted,
    questionsTotal: result.questionsTotal ?? questions.length,
    questionsAnswered: result.questionsAnswered ?? 0,
    correctCount: result.correctCount ?? 0,
    questions,
  }
}

export async function GET(request: NextRequest) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const conversationId = searchParams.get('conversationId')

    if (!conversationId) {
      return NextResponse.json({ error: t('api_error_conversation_id_required') }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        encryptedDataKey: true,
        zkiId: true,
        zki: { select: { masterKey: true } }
      }
    })

    if (!user?.encryptedDataKey) {
      return NextResponse.json({ error: t('api_error_encryption_key_not_found') }, { status: 500 })
    }

    let dataKey: Buffer
    if (user.zkiId && user.zki?.masterKey) {
      dataKey = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
    } else {
      dataKey = await decryptDataKey(Buffer.from(user.encryptedDataKey))
    }

    const rows = await prisma.conversation.findMany({
      where: {
        conversation_id: conversationId,
        agent: { userId: session.user.id }
      },
      orderBy: { created_at: 'asc' },
      include: {
        agent: {
          select: { title: true }
        }
      }
    })

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        messages: [],
      })
    }

    if (rows[0].model === 'miniapp-quiz') {
      const quiz = await buildQuizDetail(rows, dataKey)
      return NextResponse.json({ success: true, messages: [], quiz })
    }

    const parsedMessages: Array<{
      role: 'user' | 'assistant'
      content: string
      createdAt: string
      inputTokens: number | null
      outputTokens: number | null
      lang?: string | null
      at?: number | null
      sessionId?: string | null
      source?: string | null
      boundary?: boolean
    }> = []

    for (const row of rows) {
      try {
        if (!row.content) continue

        const decryptedContent = decrypt(Buffer.from(row.content), dataKey)
        const messageData = JSON.parse(decryptedContent)
        const rowIsBoundary = row.role === 'm'

        if (messageData.messages && Array.isArray(messageData.messages)) {
          let first = true
          for (const msg of messageData.messages) {
            if (msg.role !== 'user' && msg.role !== 'assistant') continue
            parsedMessages.push({
              role: msg.role,
              content: msg.content,
              createdAt: row.created_at.toISOString(),
              inputTokens: row.input_tokens,
              outputTokens: row.output_tokens,
              lang: msg.lang ?? null,
              at: msg.at ?? null,
              sessionId: msg.sessionId ?? row.api_key ?? null,
              source: row.model ?? null,
              boundary: rowIsBoundary && first,
            })
            first = false
          }
          if (rowIsBoundary && messageData.messages.length === 0) {
            parsedMessages.push({
              role: 'assistant',
              content: '',
              createdAt: row.created_at.toISOString(),
              inputTokens: null,
              outputTokens: null,
              lang: null,
              at: null,
              sessionId: row.api_key ?? null,
              source: row.model ?? null,
              boundary: true,
            })
          }
        }
      } catch (error) {
        console.error('Failed to decrypt message content:', error)
        continue
      }
    }

    return NextResponse.json({
      success: true,
      messages: parsedMessages,
    })
  } catch (error) {
    const t = getApiTranslation(request)
    console.error('[history/messages] Failed to load messages', error)
    return NextResponse.json({ error: t('api_error_failed_to_load_messages') }, { status: 500 })
  }
}
