
import { createLLMClient, AzureConfig } from '@/lib/ai-providers';
import { prisma } from '@/lib/prisma';
import { saveMessage, setEditingWorkflow } from '../session-service';
import { replaceWorkflowJson } from '../workflow-modifier';
import { getLocalTemplates } from '@/lib/local-templates';
import { buildCodexContext, generateCodexPrompt } from '@/lib/codex-lib';
import { t } from './messages';
import type { LangCode } from '../intent-classifier';
import type { EngineRequest, EngineResponse } from './types';
import type { ActionRegistry } from '../action-registry';
import type { ResponseParser } from '../response-parser';

export function detectLangFromText(text: string): LangCode {
  if (/[가-힣]/.test(text)) return 'ko';
  if (/[àâäéèêëïôùûüÿçœæ]/i.test(text)) return 'fr';
  if (/[äöüß]/i.test(text)) return 'de';
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es';
  return 'en';
}

export async function translateToEnglish(text: string, provider: string, apiKey: string, azureConfig?: AzureConfig): Promise<string> {
  if (/^[\x00-\x7F\s]*$/.test(text)) return text;
  try {
    const CLASSIFIER_MODELS: Record<string, string> = {
      openai: 'gpt-4o-mini', claude: 'claude-sonnet-4-6', gemini: 'gemini-2.5-flash',
      deepseek: 'deepseek-chat', grok: 'grok-4-1-fast-reasoning', mistral: 'mistral-small-latest',
    };
    const client = createLLMClient(provider as any, apiKey, azureConfig);
    const model = azureConfig ? 'gpt-6-luna' : (CLASSIFIER_MODELS[provider] || CLASSIFIER_MODELS.openai);
    const response = await client.chat(
      [{ role: 'user', content: `Translate to English keywords: "${text}"\nOutput ONLY the English keywords, nothing else.` }],
      { model, temperature: 0, maxTokens: 50 }
    );
    const result = response.content.trim();
    return `${result} ${text}`;
  } catch {
    return text;
  }
}

const MULTI_STEP_TIMEOUT_MS = 10 * 60 * 1000;

export async function getLastAssistantAction(sessionId: string): Promise<{ action?: string; value?: any } | null> {
  try {
    const lastMsg = await prisma.workflowAiAssistantMessage.findFirst({
      where: { sessionId, role: 'assistant' },
      orderBy: { createdAt: 'desc' },
      select: { content: true, createdAt: true },
    });
    if (lastMsg?.content) {
      if (lastMsg.createdAt && Date.now() - lastMsg.createdAt.getTime() > MULTI_STEP_TIMEOUT_MS) {
        return null;
      }
      const parsed = JSON.parse(lastMsg.content);
      return { action: parsed.action, value: parsed.value };
    }
  } catch { /* not JSON */ }
  return null;
}

export function isBlankChoice(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  return /^1$|^빈|^blank|^empty|^leer|^vide|^vacío/i.test(normalized);
}

export function isTemplateChoice(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  return /^2$|^템플릿|^template|^vorlage|^modèle|^plantilla/i.test(normalized);
}

export function isConfirmation(input: string): boolean {
  const normalized = input.toLowerCase().trim().replace(/[!?.,~]+$/g, '');
  return /^(네|넵|넹|예|응|ㅇ|ㅇㅇ|좋아|좋아요|그래|그래요|yes|yeah|yep|yup|ok|okay|sure|ja|jawohl|oui|bien sûr|sí|si|vale|claro|do it|만들어|생성|확인|해줘)$/i.test(normalized);
}

export function isDenial(input: string): boolean {
  const normalized = input.toLowerCase().trim().replace(/[!?.,~]+$/g, '');
  if (/^(아니|아니요|아니오|아뇨|싫어|싫어요|안해|안할래|안할래요|그만|됐어|됐어요|no|nope|nah|cancel|취소|nicht|nein|nö|non|pas|jamais|no quiero|cancelar|parar|nunca)$/i.test(normalized)) return true;
  if (/^(취소|cancel|cancelar|annuler|abbrechen|안 ?만들|그만|됐어)/.test(normalized)) return true;
  return false;
}

export function matchTemplatesByDescription(description: string): { templateId: string; name: string; description: string } | null {
  const templates = getLocalTemplates();
  if (templates.length === 0) return null;

  const words = description.toLowerCase().split(/[\s,.\-_]+/).filter(w => w.length >= 2);
  let bestMatch: { templateId: string; name: string; description: string; score: number } | null = null;

  const wordMatch = (text: string, word: string): boolean => {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(text);
  };

  const stemMatch = (a: string, b: string): boolean => {
    if (a.length < 4 || b.length < 4) return false;
    return a.startsWith(b) || b.startsWith(a);
  };

  for (const tmpl of templates) {
    let score = 0;

    for (const keyword of tmpl.keywords) {
      const kwLower = keyword.toLowerCase();
      if (words.some(w => w === kwLower || wordMatch(kwLower, w) || wordMatch(w, kwLower))) {
        score += 10;
      } else if (words.some(w => stemMatch(w, kwLower))) {
        score += 7;
      }
    }

    const nameLower = tmpl.name.toLowerCase();
    for (const w of words) {
      if (wordMatch(nameLower, w)) {
        score += 5;
      }
    }

    const descLower = tmpl.description.toLowerCase();
    for (const w of words) {
      if (wordMatch(descLower, w)) {
        score += 3;
      }
    }

    if (score >= 10 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { templateId: tmpl.templateId, name: tmpl.name, description: tmpl.description, score };
    }
  }

  return bestMatch ? { templateId: bestMatch.templateId, name: bestMatch.name, description: bestMatch.description } : null;
}

export async function executeCreateBlankWorkflow(
  sessionId: string, request: EngineRequest, L: LangCode,
  zeroUsage: EngineResponse['usage'],
  actionRegistry: ActionRegistry
): Promise<EngineResponse> {
  await saveMessage(sessionId, 'user', request.prompt);
  const parsed = { type: 'workflow_action', action: 'create_workflow', value: { name: 'New Workflow' }, message: '' };
  if (actionRegistry.canHandle(parsed)) {
    const actionResult = await actionRegistry.execute(parsed, { userId: request.userId, agentId: request.agentId });
    let message = actionResult.value?.name
      ? t('createWorkflowCreated', L, { name: actionResult.value.name })
      : t('createWorkflowFailed', L, { error: actionResult.message });

    if (actionResult.value?.workflowId) {
      await setEditingWorkflow(sessionId, actionResult.value.workflowId);
      message += t('editWorkflowTransition', L);
    }

    await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message, value: actionResult.value }));
    return { sessionId, ...actionResult, message, usage: zeroUsage };
  }
  const message = t('createWorkflowFailed', L, { error: 'No handler' });
  await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
  return { sessionId, type: 'answer', message, usage: zeroUsage };
}

export async function executeCreateFromTemplate(
  sessionId: string, request: EngineRequest, templateId: string, L: LangCode,
  zeroUsage: EngineResponse['usage'],
  actionRegistry: ActionRegistry
): Promise<EngineResponse> {
  await saveMessage(sessionId, 'user', request.prompt);
  const parsed = { type: 'workflow_action', action: 'create_workflow_from_template', value: { templateId }, message: '' };
  if (actionRegistry.canHandle(parsed)) {
    const actionResult = await actionRegistry.execute(parsed, { userId: request.userId, agentId: request.agentId });
    let message = actionResult.value?.name
      ? t('createWorkflowCreated', L, { name: actionResult.value.name })
      : t('createWorkflowFailed', L, { error: actionResult.message });

    if (actionResult.value?.workflowId) {
      await setEditingWorkflow(sessionId, actionResult.value.workflowId);
      message += t('editWorkflowTransition', L);
    }

    await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message, value: actionResult.value }));
    return { sessionId, ...actionResult, message, usage: zeroUsage };
  }
  const message = t('createWorkflowFailed', L, { error: 'No handler' });
  await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
  return { sessionId, type: 'answer', message, usage: zeroUsage };
}

export async function executeCreateAiWorkflow(
  sessionId: string,
  request: EngineRequest,
  description: string,
  L: LangCode,
  pricing: EngineResponse['usage']['pricing'],
  actionRegistry: ActionRegistry,
  deps: {
    responseParser: ResponseParser;
    executeLLM: (
      provider: string,
      apiKey: string,
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      model: string
    ) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
  }
): Promise<EngineResponse> {
  const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };

  const createResult = await executeCreateBlankWorkflow(sessionId, request, L, zeroUsage, actionRegistry);
  const workflowId = createResult.value?.workflowId;
  if (!workflowId) return createResult;

  try {
    const codexContext = await buildCodexContext(description, undefined, false, request.templateSource);
    const codexPrompt = generateCodexPrompt(codexContext);
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: codexPrompt },
      { role: 'user', content: description },
    ];
    const llmResult = await deps.executeLLM(request.provider, request.apiKey, messages, request.model);

    const parsed = deps.responseParser.parse(llmResult.content);

    const usage = {
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      model: request.model,
      pricing,
    };

    if (parsed.type === 'workflow' && parsed.nodes && parsed.edges) {
      await replaceWorkflowJson(workflowId, request.userId, parsed.nodes, parsed.edges);
      await setEditingWorkflow(sessionId, workflowId);
      const name = createResult.value?.name || 'Workflow';
      const message = t('createWorkflowAiGenerated', L, { name }) + t('editWorkflowTransition', L);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message, value: { workflowId, name } }));
      return { sessionId, type: 'answer', message, value: { workflowId, name }, usage };
    }

    await setEditingWorkflow(sessionId, workflowId);
    return { ...createResult, usage };
  } catch (error) {
    console.error('[Engine] executeCreateAiWorkflow LLM failed:', error);
    return createResult;
  }
}
