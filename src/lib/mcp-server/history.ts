import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { stripUrlCredentials, maskSecrets } from './mask'

const VOICE_MODELS = ['voice-pstn', 'voice-web-live', 'voice-web-test']
const QUIZ_MODEL = 'miniapp-quiz'

export type HistorySource = 'text' | 'voice-pstn' | 'voice-web' | 'voice-web-test' | 'quiz'

export function classifySource(model: string | null | undefined): HistorySource {
  if (!model) return 'text'
  if (model === 'voice-pstn') return 'voice-pstn'
  if (model === 'voice-web-live') return 'voice-web'
  if (model === 'voice-web-test') return 'voice-web-test'
  if (model === QUIZ_MODEL) return 'quiz'
  return 'text'
}

export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean; totalBytes: number } {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return { text, truncated: false, totalBytes: buf.length }
  let end = maxBytes
  if ((buf[end] & 0xc0) === 0x80) {
    while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  }
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true, totalBytes: buf.length }
}

async function getUserDataKey(userId: string): Promise<Buffer | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { encryptedDataKey: true, zkiId: true, zki: { select: { masterKey: true } } },
  })
  if (!user?.encryptedDataKey) return null
  if (user.zkiId && user.zki?.masterKey) {
    return decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
  }
  return decryptDataKey(Buffer.from(user.encryptedDataKey))
}

function decryptRowJson(content: Uint8Array, dataKey: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(decrypt(Buffer.from(content), dataKey))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export interface QuizSummary {
  title: string
  memberDisplayName: string
  durationSeconds: number
  questionsTotal: number
  questionsAnswered: number
  correctCount: number
}

export const QUIZ_TEXT_MAX_CHARS = 240

export function readQuizSummary(data: Record<string, unknown>): QuizSummary | null {
  const quiz = data.quiz as Record<string, unknown> | undefined
  if (!quiz || typeof quiz !== 'object') return null
  return {
    title: typeof quiz.title === 'string' ? quiz.title.slice(0, QUIZ_TEXT_MAX_CHARS) : 'Quiz',
    memberDisplayName: typeof quiz.memberDisplayName === 'string' ? quiz.memberDisplayName.slice(0, QUIZ_TEXT_MAX_CHARS) : '',
    durationSeconds: typeof quiz.durationSeconds === 'number' ? quiz.durationSeconds : 0,
    questionsTotal: typeof quiz.questionsTotal === 'number' ? quiz.questionsTotal : 0,
    questionsAnswered: typeof quiz.questionsAnswered === 'number' ? quiz.questionsAnswered : 0,
    correctCount: typeof quiz.correctCount === 'number' ? quiz.correctCount : 0,
  }
}

const PREVIEW_MAX_BYTES = 240
const CALLER_NUMBER_MAX_CHARS = 40

export interface ConversationEntry {
  conversationId: string
  createdAt: Date
  source: HistorySource
  preview: string | null
  previewTruncated: boolean
  decryptFailed?: boolean
  agentId: string | null
  agentTitle: string | null
  clientId: string | null
  userIp: string | null
  sessionId: string | null
  totalInputTokens: number
  totalOutputTokens: number
  voiceMeta: {
    durationSeconds: number | null
    voiceName: string | null
    language: string | null
    callerNumber?: string | null
    userIp?: string | null
    mode?: string | null
  } | null
  quizMeta: QuizSummary | null
}

export interface ListConversationsInput {
  userId: string
  agentId: string | null
  source: 'all' | 'text' | 'voice' | 'quiz'
  since: Date | null
  until: Date | null
  limit: number
  offset: number
}

export async function listConversationEntries(
  input: ListConversationsInput,
): Promise<{ entries: ConversationEntry[]; total: number }> {
  const dataKey = await getUserDataKey(input.userId)
  if (!dataKey) return { entries: [], total: 0 }

  const where: Prisma.conversationWhereInput = {
    agent: { userId: input.userId },
    role: 'm',
  }
  if (input.agentId) where.agentId = input.agentId
  if (input.source === 'text') {
    where.OR = [{ model: null }, { model: { notIn: [...VOICE_MODELS, QUIZ_MODEL] } }]
  } else if (input.source === 'voice') {
    where.model = { in: VOICE_MODELS }
  } else if (input.source === 'quiz') {
    where.model = QUIZ_MODEL
  }
  if (input.since || input.until) {
    where.created_at = {
      ...(input.since ? { gte: input.since } : {}),
      ...(input.until ? { lte: input.until } : {}),
    }
  }

  const [rows, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { no: 'desc' }],
      skip: input.offset,
      take: input.limit,
      include: { agent: { select: { title: true } } },
    }),
    prisma.conversation.count({ where }),
  ])
  if (rows.length === 0) return { entries: [], total }

  const tokenSums = await prisma.conversation.groupBy({
    by: ['conversation_id'],
    where: {
      conversation_id: { in: rows.map(r => r.conversation_id) },
      agent: { userId: input.userId },
    },
    _sum: { input_tokens: true, output_tokens: true },
  })
  const tokenSumMap = new Map(
    tokenSums.map(s => [s.conversation_id, { input: s._sum.input_tokens ?? 0, output: s._sum.output_tokens ?? 0 }]),
  )

  const pstnIds = rows.filter(r => r.model === 'voice-pstn' && r.api_key).map(r => r.api_key!)
  const webIds = rows
    .filter(r => (r.model === 'voice-web-live' || r.model === 'voice-web-test') && r.api_key)
    .map(r => r.api_key!)
  const [pstnSessions, webSessions] = await Promise.all([
    pstnIds.length
      ? prisma.callSession.findMany({
          where: { callConnectionId: { in: pstnIds }, userId: input.userId },
          select: {
            callConnectionId: true, callerNumber: true, callerNumberEnc: true,
            durationSeconds: true, voiceName: true, language: true,
          },
        })
      : [],
    webIds.length
      ? prisma.webVoiceSession.findMany({
          where: { sessionId: { in: webIds }, agent: { userId: input.userId } },
          select: { sessionId: true, mode: true, durationSeconds: true, voiceName: true, language: true, userIp: true },
        })
      : [],
  ])
  const pstnMap = new Map(pstnSessions.map(s => [s.callConnectionId, s]))
  const webMap = new Map(webSessions.map(s => [s.sessionId, s]))

  const entries: ConversationEntry[] = rows.map(row => {
    const source = classifySource(row.model)
    const sessionId = source !== 'text' && row.api_key ? row.api_key : null

    let preview: string | null = null
    let previewTruncated = false
    let decryptFailed = false
    let quizMeta: QuizSummary | null = null
    if (row.content) {
      const data = decryptRowJson(row.content, dataKey)
      if (!data) {
        decryptFailed = true
      } else {
        if (source === 'quiz') {
          quizMeta = readQuizSummary(data)
          preview = quizMeta?.title ?? null
        } else if (Array.isArray(data.messages)) {
          const msgs = data.messages as Array<{ role?: unknown; content?: unknown }>
          const firstUser = msgs.find(m => m.role === 'user' && typeof m.content === 'string')
          const raw = (firstUser?.content ?? (typeof msgs[0]?.content === 'string' ? msgs[0].content : null)) as
            | string
            | null
          if (raw) {
            const t = truncateUtf8(stripUrlCredentials(raw), PREVIEW_MAX_BYTES)
            preview = t.text
            previewTruncated = t.truncated
          }
        }
      }
    }

    let voiceMeta: ConversationEntry['voiceMeta'] = null
    if (source === 'voice-pstn' && sessionId) {
      const s = pstnMap.get(sessionId)
      if (s) {
        let callerNumber: string | null = null
        if (s.callerNumberEnc) {
          try {
            callerNumber = decrypt(Buffer.from(s.callerNumberEnc), dataKey)
            if (callerNumber === 'Decryption failed') callerNumber = null
          } catch {
            callerNumber = null
          }
        }
        if (!callerNumber) callerNumber = s.callerNumber ?? null
        if (callerNumber) callerNumber = callerNumber.slice(0, CALLER_NUMBER_MAX_CHARS)
        voiceMeta = {
          durationSeconds: s.durationSeconds ?? null,
          voiceName: s.voiceName ?? null,
          language: s.language ?? null,
          callerNumber,
        }
      }
    } else if ((source === 'voice-web' || source === 'voice-web-test') && sessionId) {
      const s = webMap.get(sessionId)
      if (s) {
        voiceMeta = {
          durationSeconds: s.durationSeconds ?? null,
          voiceName: s.voiceName ?? null,
          language: s.language ?? null,
          userIp: s.userIp ?? null,
          mode: s.mode ?? null,
        }
      }
    }

    const tokens = tokenSumMap.get(row.conversation_id)
    return {
      conversationId: row.conversation_id,
      createdAt: row.created_at,
      source,
      preview,
      previewTruncated,
      ...(decryptFailed ? { decryptFailed: true } : {}),
      agentId: row.agentId,
      agentTitle: row.agent?.title ?? null,
      clientId: row.client_id,
      userIp: row.user_ip,
      sessionId,
      totalInputTokens: tokens?.input ?? 0,
      totalOutputTokens: tokens?.output ?? 0,
      voiceMeta,
      quizMeta,
    }
  })

  return { entries, total }
}

const MESSAGE_CONTENT_MAX_BYTES = 8_000
const RESPONSE_DATA_BYTE_BUDGET = 99_600
const LANG_MAX_CHARS = 32
const SESSION_ID_MAX_CHARS = 128
const MAX_DETAIL_ROWS = 500

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  contentTruncated?: boolean
  createdAt: Date
  lang: string | null
  at: number | null
  sessionId: string | null
  source: string | null
  boundary?: boolean
}

export type ConversationDetailResult =
  | { ok: false; code: 'ENCRYPTION_KEY_UNAVAILABLE' | 'CONVERSATION_NOT_FOUND'; message: string }
  | {
      ok: true
      conversationId: string
      agentId: string | null
      agentTitle: string | null
      quiz: (QuizSummary & { completedAt: Date }) | null
      messages: ConversationMessage[]
      totalMessages: number
      messageOffset: number
      nextMessageOffset: number | null
      totalInputTokens: number
      totalOutputTokens: number
      decryptFailedRows: number
      rowLimitReached?: boolean
    }

export async function getConversationDetail(input: {
  userId: string
  conversationId: string
  messageOffset: number
  messageLimit: number
}): Promise<ConversationDetailResult> {
  const dataKey = await getUserDataKey(input.userId)
  if (!dataKey) {
    return {
      ok: false,
      code: 'ENCRYPTION_KEY_UNAVAILABLE',
      message: 'This account has no encryption key, so stored history cannot be decrypted.',
    }
  }

  const rows = await prisma.conversation.findMany({
    where: { conversation_id: input.conversationId, agent: { userId: input.userId } },
    orderBy: [{ created_at: 'asc' }, { no: 'asc' }],
    include: { agent: { select: { title: true } } },
    take: MAX_DETAIL_ROWS + 1,
  })
  const rowLimitReached = rows.length > MAX_DETAIL_ROWS
  if (rowLimitReached) rows.length = MAX_DETAIL_ROWS
  if (rows.length === 0) {
    return {
      ok: false,
      code: 'CONVERSATION_NOT_FOUND',
      message: 'Conversation not found for this account. Call list_conversations for valid IDs.',
    }
  }

  let totalInputTokens: number
  let totalOutputTokens: number
  if (rowLimitReached) {
    const agg = await prisma.conversation.aggregate({
      where: { conversation_id: input.conversationId, agent: { userId: input.userId } },
      _sum: { input_tokens: true, output_tokens: true },
    })
    totalInputTokens = agg._sum.input_tokens ?? 0
    totalOutputTokens = agg._sum.output_tokens ?? 0
  } else {
    totalInputTokens = rows.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0)
    totalOutputTokens = rows.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0)
  }
  const base = {
    conversationId: input.conversationId,
    agentId: rows[0].agentId,
    agentTitle: rows[0].agent?.title ?? null,
    totalInputTokens,
    totalOutputTokens,
  }

  if (rows[0].model === QUIZ_MODEL) {
    let quiz: (QuizSummary & { completedAt: Date }) | null = null
    let quizDecryptFailed = 0
    for (const row of rows) {
      if (!row.content) continue
      const data = decryptRowJson(row.content, dataKey)
      if (!data) {
        quizDecryptFailed++
        continue
      }
      if (!quiz && row.role === 'm') {
        const summary = readQuizSummary(data)
        if (summary) quiz = { ...summary, completedAt: row.created_at }
      }
    }
    return {
      ok: true,
      ...base,
      quiz,
      messages: [],
      totalMessages: 0,
      messageOffset: 0,
      nextMessageOffset: null,
      decryptFailedRows: quizDecryptFailed,
      ...(rowLimitReached ? { rowLimitReached: true } : {}),
    }
  }

  const all: ConversationMessage[] = []
  let decryptFailedRows = 0
  for (const row of rows) {
    if (!row.content) continue
    const data = decryptRowJson(row.content, dataKey)
    if (!data) {
      decryptFailedRows++
      continue
    }
    if (!Array.isArray(data.messages)) continue
    const rowIsBoundary = row.role === 'm'
    const rowSessionId = classifySource(row.model) !== 'text' ? row.api_key ?? null : null
    let first = true
    for (const msg of data.messages as Array<Record<string, unknown>>) {
      if (msg.role !== 'user' && msg.role !== 'assistant') continue
      if (typeof msg.content !== 'string') continue
      all.push({
        role: msg.role,
        content: stripUrlCredentials(msg.content),
        createdAt: row.created_at,
        lang: typeof msg.lang === 'string' ? msg.lang.slice(0, LANG_MAX_CHARS) : null,
        at: typeof msg.at === 'number' ? msg.at : null,
        sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId.slice(0, SESSION_ID_MAX_CHARS) : null) ?? rowSessionId,
        source: row.model ?? null,
        ...(rowIsBoundary && first ? { boundary: true } : {}),
      })
      first = false
    }
    if (rowIsBoundary && (data.messages as unknown[]).length === 0) {
      all.push({
        role: 'assistant',
        content: '',
        createdAt: row.created_at,
        lang: null,
        at: null,
        sessionId: rowSessionId,
        source: row.model ?? null,
        boundary: true,
      })
    }
  }

  const envelopeBase = maskSecrets({
    ...base,
    quiz: null,
    totalMessages: all.length,
    messageOffset: input.messageOffset,
    decryptFailedRows,
    ...(rowLimitReached ? { rowLimitReached: true } : {}),
  })
  const { messages, nextMessageOffset } = windowMessagesToBudget(
    all,
    input.messageOffset,
    input.messageLimit,
    envelopeBase as Record<string, unknown>,
  )

  return {
    ok: true,
    ...base,
    quiz: null,
    messages,
    totalMessages: all.length,
    messageOffset: input.messageOffset,
    nextMessageOffset,
    decryptFailedRows,
    ...(rowLimitReached ? { rowLimitReached: true } : {}),
  }
}

export function windowMessagesToBudget(
  all: ConversationMessage[],
  offset: number,
  limit: number,
  envelopeBase: Record<string, unknown>,
): { messages: ConversationMessage[]; nextMessageOffset: number | null } {
  const measure = (msgs: ConversationMessage[]): number =>
    Buffer.byteLength(
      JSON.stringify({ ...envelopeBase, nextMessageOffset: 2147483647, messages: msgs }, null, 2),
      'utf8',
    )
  const messages: ConversationMessage[] = []
  for (let i = offset; i < all.length && messages.length < limit; i++) {
    const t = truncateUtf8(all[i].content, MESSAGE_CONTENT_MAX_BYTES)
    const candidate = maskSecrets<ConversationMessage>({
      ...all[i],
      content: t.text,
      ...(t.truncated ? { contentTruncated: true } : {}),
    })
    messages.push(candidate)
    if (messages.length > 1 && measure(messages) > RESPONSE_DATA_BYTE_BUDGET) {
      messages.pop()
      break
    }
  }
  const nextMessageOffset = offset + messages.length < all.length ? offset + messages.length : null
  return { messages, nextMessageOffset }
}
