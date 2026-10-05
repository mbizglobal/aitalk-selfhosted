
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { readToolTraceEntries, type PreviousToolTrace, type ToolTraceEntry } from '@/lib/workflow/nodes/ai/tool-trace'

export type ThreadDecision =
  | { action: 'reuse' }
  | {
      action: 'new'
      reason:
        | 'no_conversation_id'
        | 'no_client_id'
        | 'unowned_thread'
        | 'foreign_thread'
        | 'other_agent'
    }

export function decideThread(input: {
  requestedConversationId?: string | null
  requestClientId?: string | null
  requestAgentId?: string | null
  threadExists: boolean
  existingThreadClientId?: string | null
  existingThreadAgentId?: string | null
}): ThreadDecision {
  if (!input.requestedConversationId) return { action: 'new', reason: 'no_conversation_id' }
  if (!input.requestClientId) return { action: 'new', reason: 'no_client_id' }
  if (!input.threadExists) return { action: 'reuse' }
  if (!input.existingThreadClientId) return { action: 'new', reason: 'unowned_thread' }
  if (input.existingThreadClientId !== input.requestClientId) {
    return { action: 'new', reason: 'foreign_thread' }
  }
  if (input.existingThreadAgentId !== input.requestAgentId) {
    return { action: 'new', reason: 'other_agent' }
  }
  return { action: 'reuse' }
}

export const SAVE_ELIGIBLE_SOURCES: ReadonlySet<string> = new Set(['widget', 'playground'])

export function shouldSaveConversation(input: {
  source: string
  agentAccessMode?: string | null
}): boolean {
  if (!SAVE_ELIGIBLE_SOURCES.has(input.source)) return false
  if (input.source === 'playground') return true
  return input.agentAccessMode === 'public'
}

export function shouldPersistCollected(input: {
  responseId?: string | null
  clientId?: string | null
  content: string
  sawError: boolean
}): boolean {
  if (input.sawError) return false
  if (!input.content) return false
  if (!input.responseId) return false
  if (!input.clientId) return false
  return true
}

export function deriveConversationRole(previousResponseId?: string | null): 'm' | 's' {
  return previousResponseId ? 's' : 'm'
}

export interface ExecutedConversation {
  agentId: string
  ownerUserId: string
  conversationId?: string | null
  clientId?: string | null
  previousResponseId?: string | null
  userMessage: string
  assistantMessage: string
  inputTokens?: number | null
  outputTokens?: number | null
  model?: string | null
  userIp?: string | null
  toolTrace?: ToolTraceEntry[] | null
}

export interface ServerSaveDeps {
  prisma: PrismaClient
  ensureUserDataKey: (prisma: PrismaClient, userId: string) => Promise<Buffer>
  encrypt: (plaintext: string, key: Buffer) => Buffer
}

export interface ServerSaveResult {
  conversationId: string
  thread: ThreadDecision
}

export async function saveExecutedConversation(
  deps: ServerSaveDeps,
  input: ExecutedConversation
): Promise<ServerSaveResult> {
  //
  let existing: { client_id: string | null; agentId: string | null } | null = null
  if (input.conversationId) {
    existing = await deps.prisma.conversation.findFirst({
      where: { conversation_id: input.conversationId },
      select: { client_id: true, agentId: true },
      orderBy: { no: 'asc' },
    })
  }

  const thread = decideThread({
    requestedConversationId: input.conversationId,
    requestClientId: input.clientId,
    requestAgentId: input.agentId,
    threadExists: existing !== null,
    existingThreadClientId: existing?.client_id ?? null,
    existingThreadAgentId: existing?.agentId ?? null,
  })

  const conversationId =
    thread.action === 'reuse' ? input.conversationId! : randomUUID()

  const dataKey = await deps.ensureUserDataKey(deps.prisma, input.ownerUserId)

  const encrypted = deps.encrypt(
    JSON.stringify({
      messages: [
        { role: 'user', content: input.userMessage },
        { role: 'assistant', content: input.assistantMessage },
      ],
      ...(input.toolTrace && input.toolTrace.length > 0 ? { tools: readToolTraceEntries(input.toolTrace) } : {}),
    }),
    dataKey
  )
  const content = new Uint8Array(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength)

  await deps.prisma.conversation.create({
    data: {
      conversation_id: conversationId,
      client_id: input.clientId ?? null,
      agentId: input.agentId,
      role: deriveConversationRole(input.previousResponseId),
      content,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      model: input.model || 'gpt-4o-mini',
      api_key: 'default',
      user_ip: input.userIp ?? null,
    },
  })

  return { conversationId, thread }
}

export interface LoadToolTraceDeps {
  prisma: PrismaClient
  ensureUserDataKey: (prisma: PrismaClient, userId: string) => Promise<Buffer>
  decrypt: (ciphertext: Buffer, key: Buffer) => string
}

export async function loadPreviousToolTrace(
  deps: LoadToolTraceDeps,
  input: { conversationId?: string | null; clientId?: string | null; agentId: string; ownerUserId: string },
): Promise<PreviousToolTrace | null> {
  if (!input.conversationId || !input.clientId) return null
  const owner = await deps.prisma.conversation.findFirst({
    where: { conversation_id: input.conversationId },
    select: { client_id: true, agentId: true },
    orderBy: { no: 'asc' },
  })
  if (!owner) return null
  const thread = decideThread({
    requestedConversationId: input.conversationId,
    requestClientId: input.clientId,
    requestAgentId: input.agentId,
    threadExists: true,
    existingThreadClientId: owner.client_id,
    existingThreadAgentId: owner.agentId,
  })
  if (thread.action !== 'reuse') return null
  const row = await deps.prisma.conversation.findFirst({
    where: { conversation_id: input.conversationId },
    select: { client_id: true, agentId: true, content: true },
    orderBy: { no: 'desc' },
  })
  if (!row?.content || row.client_id !== input.clientId || row.agentId !== input.agentId) return null
  try {
    const dataKey = await deps.ensureUserDataKey(deps.prisma, input.ownerUserId)
    const data = JSON.parse(deps.decrypt(Buffer.from(row.content), dataKey))
    const entries = readToolTraceEntries(data?.tools)
    const assistant = Array.isArray(data?.messages)
      ? data.messages.filter((m: any) => m?.role === 'assistant' && typeof m.content === 'string').pop()
      : null
    if (entries.length === 0 || !assistant) return null
    return { assistantMessage: assistant.content, entries }
  } catch {
    return null
  }
}
