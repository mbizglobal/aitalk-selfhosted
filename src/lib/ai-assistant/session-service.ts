
import { prisma } from '@/lib/prisma';
import { estimateTokens } from './token-counter';
import { createLLMClient, AzureConfig } from '@/lib/ai-providers';

// ========================================
// ========================================

const CONFIG = {
  recentTurns: 5,
  summaryMaxTokens: 500,
  summaryTrigger: 6,
};

const SUMMARY_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-haiku-4-5',
  gemini: 'gemini-2.0-flash-lite',
  deepseek: 'deepseek-chat',
  grok: 'grok-4-1-fast-reasoning',
};

// ========================================
// ========================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SessionWithMessages {
  id: string;
  userId: string;
  workflowId: string | null;
  provider: string | null;
  model: string | null;
  summary: string | null;
  entityJson: string | null;
  messages: Array<{
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: string;
    tokenCount: number | null;
    isSummarized: boolean;
    createdAt: Date;
  }>;
}

// ========================================
// ========================================

export async function createSession(
  userId: string,
  workflowId?: string,
  provider?: string,
  model?: string
): Promise<string> {
  const session = await prisma.workflowAiAssistantSession.create({
    data: {
      userId,
      workflowId: workflowId || null,
      provider: provider || null,
      model: model || null,
    },
  });
  return session.id;
}

export async function getSession(
  sessionId: string
): Promise<SessionWithMessages | null> {
  const session = await prisma.workflowAiAssistantSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!session) return null;

  return {
    id: session.id,
    userId: session.userId,
    workflowId: session.workflowId,
    provider: session.provider,
    model: session.model,
    summary: session.summary,
    entityJson: session.entityJson,
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
      tokenCount: m.tokenCount,
      isSummarized: m.isSummarized,
      createdAt: m.createdAt,
    })),
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.workflowAiAssistantSession.delete({
    where: { id: sessionId },
  });
}

export async function getSessionByWorkflow(
  userId: string,
  workflowId: string | null
): Promise<string | null> {
  const session = await prisma.workflowAiAssistantSession.findFirst({
    where: {
      userId,
      workflowId: workflowId || null,
    },
    orderBy: { createdAt: 'desc' },
  });
  return session?.id || null;
}

// ========================================
// ========================================

export async function setEditingWorkflow(sessionId: string, workflowId: string): Promise<void> {
  const session = await prisma.workflowAiAssistantSession.findUnique({
    where: { id: sessionId },
    select: { entityJson: true },
  });
  const existing = session?.entityJson ? JSON.parse(session.entityJson) : {};
  existing.editingWorkflowId = workflowId;
  await prisma.workflowAiAssistantSession.update({
    where: { id: sessionId },
    data: { entityJson: JSON.stringify(existing) },
  });
}

export async function getEditingWorkflow(sessionId: string): Promise<string | null> {
  const session = await prisma.workflowAiAssistantSession.findUnique({
    where: { id: sessionId },
    select: { entityJson: true },
  });
  if (!session?.entityJson) return null;
  try {
    const parsed = JSON.parse(session.entityJson);
    return parsed.editingWorkflowId || null;
  } catch {
    return null;
  }
}

export async function clearEditingWorkflow(sessionId: string): Promise<void> {
  const session = await prisma.workflowAiAssistantSession.findUnique({
    where: { id: sessionId },
    select: { entityJson: true },
  });
  if (!session?.entityJson) return;
  try {
    const existing = JSON.parse(session.entityJson);
    delete existing.editingWorkflowId;
    await prisma.workflowAiAssistantSession.update({
      where: { id: sessionId },
      data: { entityJson: JSON.stringify(existing) },
    });
  } catch { /* ignore */ }
}

export async function setSelectedAgent(sessionId: string, agentId: string): Promise<void> {
  const session = await prisma.workflowAiAssistantSession.findUnique({
    where: { id: sessionId },
    select: { entityJson: true },
  });
  const existing = session?.entityJson ? JSON.parse(session.entityJson) : {};
  existing.selectedAgentId = agentId;
  await prisma.workflowAiAssistantSession.update({
    where: { id: sessionId },
    data: { entityJson: JSON.stringify(existing) },
  });
}

export async function getSelectedAgent(sessionId: string): Promise<string | null> {
  const session = await prisma.workflowAiAssistantSession.findUnique({
    where: { id: sessionId },
    select: { entityJson: true },
  });
  if (!session?.entityJson) return null;
  try {
    const parsed = JSON.parse(session.entityJson);
    return parsed.selectedAgentId || null;
  } catch {
    return null;
  }
}

// ========================================
// OpenAI Responses API (previous_response_id)
// ========================================

export async function getSessionResponseId(sessionId: string): Promise<string | null> {
  const session = await prisma.workflowAiAssistantSession.findUnique({
    where: { id: sessionId },
    select: { previousResponseId: true },
  });
  return session?.previousResponseId || null;
}

export async function setSessionResponseId(sessionId: string, responseId: string): Promise<void> {
  await prisma.workflowAiAssistantSession.update({
    where: { id: sessionId },
    data: { previousResponseId: responseId, updatedAt: new Date() },
  });
}

// ========================================
// ========================================

export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<string> {
  const tokenCount = estimateTokens(content);

  const message = await prisma.workflowAiAssistantMessage.create({
    data: {
      sessionId,
      role,
      content,
      tokenCount,
    },
  });

  await prisma.workflowAiAssistantSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });

  return message.id;
}

export function countTurns(
  messages: Array<{ role: string; isSummarized: boolean }>
): number {
  const unsummarized = messages.filter((m: { role: string; isSummarized: boolean }) => !m.isSummarized);
  const userMessages = unsummarized.filter((m) => m.role === 'user');
  return userMessages.length;
}

// ========================================
// ========================================

export async function buildHierarchicalMessages(
  sessionId: string,
  systemPrompt?: string
): Promise<ChatMessage[]> {
  const session = await getSession(sessionId);
  if (!session) return [];

  const messages: ChatMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  if (session.summary) {
    messages.push({
      role: 'system',
      content: `## Previous Context Summary\n${session.summary}`,
    });
  }

  const recentMessages = session.messages
    .filter((m) => !m.isSummarized)
    .slice(-(CONFIG.recentTurns * 2));

  for (const msg of recentMessages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  return messages;
}

// ========================================
// ========================================

export async function checkAndSummarize(
  sessionId: string,
  provider: string,
  apiKey: string,
  azureConfig?: AzureConfig
): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;

  const unsummarized = session.messages.filter((m) => !m.isSummarized);
  const turns = countTurns(unsummarized);

  if (turns <= CONFIG.summaryTrigger) return;

  const messagesToSummarize = unsummarized.slice(
    0,
    -(CONFIG.recentTurns * 2)
  );

  if (messagesToSummarize.length === 0) return;

  const newSummary = await generateSummary(
    session.summary,
    messagesToSummarize,
    provider,
    apiKey,
    azureConfig
  );

  const summarizedIds = messagesToSummarize.map((m) => m.id);
  await prisma.$transaction([
    prisma.workflowAiAssistantSession.update({
      where: { id: sessionId },
      data: { summary: newSummary },
    }),
    prisma.workflowAiAssistantMessage.deleteMany({
      where: { id: { in: summarizedIds } },
    }),
  ]);
}

async function generateSummary(
  previousSummary: string | null,
  newMessages: Array<{ role: string; content: string }>,
  provider: string,
  apiKey: string,
  azureConfig?: AzureConfig
): Promise<string> {
  const client = createLLMClient(provider as any, apiKey, azureConfig);
  const summaryModel = azureConfig ? 'gpt-6-luna' : (SUMMARY_MODELS[provider] || SUMMARY_MODELS.openai);

  const conversationText = newMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const summaryPrompt = `You are a conversation summarizer for an AI coding assistant.

### Instructions:
1. Summarize the conversation while preserving:
   - Technical decisions made (architecture, libraries, patterns)
   - Code snippets mentioned (keep key snippets, max 300 chars each)
   - User preferences (coding style, naming conventions)
   - Current problem/goal being worked on
   - Any errors or bugs discussed

2. Keep total output under 500 tokens.
3. Respond in the SAME LANGUAGE as the original conversation.
4. Output as plain text (not JSON).

### Previous Summary (if exists):
${previousSummary || '(None)'}

### New Messages to Incorporate:
${conversationText}

### Output your updated summary:`;

  try {
    const response = await client.chat(
      [{ role: 'user', content: summaryPrompt }],
      {
        model: summaryModel,
        temperature: 0.3,
        maxTokens: 600,
      }
    );

    return response.content || previousSummary || '';
  } catch (error) {
    console.error(`[AI Assistant] Summary generation failed (${provider}/${summaryModel}):`, error);
    return previousSummary || '';
  }
}
