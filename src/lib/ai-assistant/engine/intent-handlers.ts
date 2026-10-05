
import { prisma } from '@/lib/prisma';
import { saveMessage, setEditingWorkflow, setSelectedAgent, getSelectedAgent } from '../session-service';
import { createAdditionalAgent } from '@/lib/agent';
import { t } from './messages';
import type { MsgKey } from './messages';
import { AI_ASSISTANT_PRICING, DEFAULT_MODELS } from './constants';
import {
  translateToEnglish,
  getLastAssistantAction,
  isBlankChoice,
  isTemplateChoice,
  isConfirmation,
  isDenial,
  matchTemplatesByDescription,
  executeCreateBlankWorkflow,
  executeCreateFromTemplate,
  executeCreateAiWorkflow,
} from './workflow-creation';
import type { ClassifiedIntent, LangCode } from '../intent-classifier';
import type { EngineRequest, EngineResponse } from './types';
import type { ActionRegistry } from '../action-registry';
import type { ResponseParser } from '../response-parser';

// ========================================
// ========================================

const API_KEY_PATTERNS: { regex: RegExp; provider: string }[] = [
  { regex: /^sk-proj-[A-Za-z0-9_-]{20,}/, provider: 'openai' },
  { regex: /^sk-[A-Za-z0-9_-]{40,}/, provider: 'openai' },
  { regex: /^sk-ant-api03-[A-Za-z0-9_-]{20,}/, provider: 'claude' },
  { regex: /^sk-ant-[A-Za-z0-9_-]{30,}/, provider: 'claude' },
  { regex: /^xai-[A-Za-z0-9_-]{20,}/, provider: 'grok' },
  { regex: /^AIza[A-Za-z0-9_-]{30,}/, provider: 'gemini' },
];

export const PROVIDER_DISPLAY: Record<string, string> = {
  openai: 'OpenAI', claude: 'Claude', grok: 'Grok', gemini: 'Gemini',
  deepseek: 'DeepSeek', mistral: 'Mistral',
};

export function detectApiKeyPaste(prompt: string): string | null {
  const trimmed = prompt.trim();
  for (const { regex, provider } of API_KEY_PATTERNS) {
    if (regex.test(trimmed)) return provider;
  }
  return null;
}

// ========================================
// ========================================

export interface IntentContext {
  actionRegistry: ActionRegistry;
  responseParser?: ResponseParser;
  executeLLM?: (
    provider: string,
    apiKey: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    model: string
  ) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
}

// ========================================
// Intent Executor
// ========================================

export async function executeIntent(
  classified: ClassifiedIntent,
  sessionId: string,
  request: EngineRequest,
  pricing: { input: number; cachedInput?: number; output: number },
  ctx: IntentContext
): Promise<EngineResponse | null> {
  const { intent } = classified;
  const L = classified.lang || 'en';
  const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };

  switch (intent) {
    // ── add_api_key ──
    case 'add_api_key': {
      const provider = classified.provider;
      if (!provider) return null;
      const displayName = PROVIDER_DISPLAY[provider] || provider;
      const message = t('addApiKey', L, { provider: displayName });
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'settings_action', action: 'add_api_key', provider, message }));
      return { sessionId, type: 'settings_action', action: 'add_api_key', provider, message, usage: zeroUsage };
    }

    // ── delete_api_key ──
    case 'delete_api_key': {
      const provider = classified.provider;
      if (!provider) return null;
      const displayName = PROVIDER_DISPLAY[provider] || provider;
      const message = t('deleteApiKey', L, { provider: displayName });
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'settings_action', action: 'delete_api_key', provider, message }));
      return { sessionId, type: 'settings_action', action: 'delete_api_key', provider, message, value: { buttons: [{ label: '✅ 확인', data: 'yes' }, { label: '❌ 취소', data: 'no' }] }, usage: zeroUsage };
    }

    // ── check_api_key ──
    case 'check_api_key': {
      if (!request.providerStatus) return null;
      const provider = classified.provider;

      let message: string;
      if (provider) {
        const displayName = PROVIDER_DISPLAY[provider] || provider;
        const hasKey = request.providerStatus[provider];
        message = hasKey
          ? t('checkConfigured', L, { provider: displayName })
          : t('checkNotConfigured', L, { provider: displayName });
      } else {
        message = t('apiKeyStatus', L);
        for (const [p, display] of Object.entries(PROVIDER_DISPLAY)) {
          const hasKey = request.providerStatus[p];
          message += `- ${display}: ${hasKey ? t('configured', L) : t('notConfigured', L)}\n`;
        }
        message += `\n${t('manageKeys', L)}`;
      }

      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    // ── add_pinecone_key ──
    case 'add_pinecone_key': {
      const message = t('addPineconeKey', L);
      await saveMessage(sessionId, 'user', `[Pinecone API key input requested]`);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'settings_action', action: 'add_pinecone_api_key', message }));
      return { sessionId, type: 'settings_action', action: 'add_pinecone_api_key', message, usage: zeroUsage };
    }

    // ── pinecone_config ──
    case 'pinecone_config': {
      const indexName = classified.indexName;
      const embeddingModel = classified.embeddingModel;

      if (!indexName && !embeddingModel) {
        const message = t('pineconeAsk', L);
        await saveMessage(sessionId, 'user', request.prompt);
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'question', message }));
        return { sessionId, type: 'question', message, usage: zeroUsage };
      }

      const value = { indexName: indexName || '', embeddingModel: embeddingModel || 'llama-text-embed-v2', host: '', namespace: '' };
      const message = t('savingPinecone', L, { index: value.indexName, model: value.embeddingModel });
      const parsed = { type: 'settings_action', action: 'update_pinecone_config', value, message };
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify(parsed));
      if (ctx.actionRegistry.canHandle(parsed)) {
        const actionResult = await ctx.actionRegistry.execute(parsed, { userId: request.userId, agentId: request.agentId });
        return { sessionId, ...actionResult, usage: zeroUsage };
      }
      return { sessionId, type: 'settings_action', action: 'update_pinecone_config', value, message, usage: zeroUsage };
    }

    // ── change_rag ──
    case 'change_rag': {
      const ragProvider = classified.ragProvider;
      if (!ragProvider) return null;
      const ragDisplayNames: Record<string, string> = {
        pinecone: 'Pinecone', openai_vector_store: 'OpenAI Vector Store',
        gemini_file_search: 'Gemini File Search', none: 'None',
      };
      const displayName = ragDisplayNames[ragProvider] || ragProvider;
      const message = t('settingRag', L, { rag: displayName });
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'settings_action', action: 'set_rag_provider', value: ragProvider, message }));
      const parsed = { type: 'settings_action', action: 'set_rag_provider', value: ragProvider, message };
      if (ctx.actionRegistry.canHandle(parsed)) {
        const actionResult = await ctx.actionRegistry.execute(parsed, { userId: request.userId, agentId: request.agentId });
        return { sessionId, ...actionResult, usage: zeroUsage };
      }
      return { sessionId, type: 'settings_action', action: 'set_rag_provider', value: ragProvider, message, usage: zeroUsage };
    }

    // ── list_rag ──
    case 'list_rag': {
      const message = t('ragProviders', L) +
        `| Provider | Description |\n|----------|-------------|\n` +
        `| **None** | ${t('ragDisabled', L)} |\n` +
        `| **Pinecone** | ${t('ragPinecone', L)} |\n` +
        `| **OpenAI Vector Store** | ${t('ragOpenAI', L)} |\n` +
        `| **Gemini File Search** | ${t('ragGemini', L)} |\n\n` +
        t('ragConfigure', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    // ── update_profile ──
    case 'update_profile': {
      const field = classified.field;
      if (!field) return null;
      const value = classified.value;

      if (!value) {
        const askMap: Record<string, MsgKey> = { timezone: 'askTimezone', locale: 'askLocale', name: 'askName', timeFormat: 'askTimeFormat' };
        const message = t(askMap[field] || 'askValue', L);
        await saveMessage(sessionId, 'user', request.prompt);
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'question', message }));
        return { sessionId, type: 'question', message, usage: zeroUsage };
      }

      const profileValue: Record<string, string> = { [field]: value };
      const message = t('updatingProfile', L, { field, value });
      const parsed = { type: 'settings_action', action: 'update_profile', value: profileValue, message };
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify(parsed));
      if (ctx.actionRegistry.canHandle(parsed)) {
        const actionResult = await ctx.actionRegistry.execute(parsed, { userId: request.userId, agentId: request.agentId });
        return { sessionId, ...actionResult, usage: zeroUsage };
      }
      return { sessionId, type: 'settings_action', action: 'update_profile', value: profileValue, message, usage: zeroUsage };
    }

    // ── change_email ──
    case 'change_email': {
      const user = await prisma.user.findUnique({
        where: { id: request.userId },
        select: { email: true, password: true },
      });
      const currentEmail = user?.email || '';
      const isGoogleAccount = !user?.password;
      const isGmail = currentEmail.endsWith('@gmail.com') || currentEmail.endsWith('@googlemail.com');

      if (isGoogleAccount || isGmail) {
        const message = t('gmailRestriction', L);
        await saveMessage(sessionId, 'user', request.prompt);
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
        return { sessionId, type: 'answer', message, usage: zeroUsage };
      }

      const message = t('changeEmail', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'settings_action', action: 'change_email', value: classified.value || null, message }));
      return { sessionId, type: 'settings_action', action: 'change_email', value: classified.value || null, message, usage: zeroUsage };
    }

    case 'rename_agent' as any: {
      const message = t('renameAgentRedirect', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    // ── list_models ──
    case 'list_models': {
      const providerNames: Record<string, string> = {
        openai: 'OpenAI', claude: 'Anthropic Claude', gemini: 'Google Gemini',
        deepseek: 'DeepSeek', grok: 'xAI Grok', mistral: 'Mistral AI'
      };

      const hasFilter = request.providerStatus && Object.values(request.providerStatus).some(v => v);
      const configuredProviders = hasFilter
        ? Object.entries(request.providerStatus!).filter(([, v]) => v).map(([k]) => k)
        : null;

      let message = configuredProviders ? t('configuredModels', L) : t('supportedModels', L);

      let modelCount = 0;
      for (const [provider, models] of Object.entries(AI_ASSISTANT_PRICING)) {
        if (configuredProviders && !configuredProviders.includes(provider)) continue;
        const pName = providerNames[provider] || provider;
        const defaultModel = DEFAULT_MODELS[provider];
        const defaultPrice = models[defaultModel];
        const otherModels = Object.keys(models).filter(m => m !== defaultModel);

        if (defaultPrice) {
          message += `- **${pName}**: ${defaultModel} ($${defaultPrice.input.toFixed(2)}/$${defaultPrice.output.toFixed(2)})`;
          if (otherModels.length > 0) {
            message += ` +${otherModels.length}`;
          }
          message += '\n';
          modelCount++;
        }
      }

      if (configuredProviders && modelCount === 0) {
        message = t('noKeysConfigured', L);
      } else if (configuredProviders) {
        const unconfigured = Object.entries(request.providerStatus!)
          .filter(([, v]) => !v).map(([k]) => providerNames[k] || k);
        if (unconfigured.length > 0) {
          message += t('notConfiguredProviders', L, { providers: unconfigured.join(', ') });
          message += t('manageKeys', L);
        }
      }

      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    // ── advanced_settings ──
    case 'advanced_settings': {
      const feature = classified.feature;
      if (!feature) return null;
      const featureNames: Record<string, string> = {
        conversations: 'Delete All Conversations', usageLogs: 'Delete All Workflow Execution Stats',
        deleteAgent: 'Delete Current AI Agent', anonymize: 'Anonymize Personal Information',
      };
      const name = featureNames[feature] || feature;
      const message = t('criticalAction', L, { name }) + '\n\n' + t('openAdvanced', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    // ── other_settings ──
    case 'other_settings': {
      const feature = classified.feature;
      if (!feature) return null;
      const featureNames: Record<string, string> = { chatLimit: 'Chat Rate Limit', continuousLimit: 'Continuous AI Answer Limit' };
      const name = featureNames[feature] || feature;
      const message = t('settingsOther', L, { name }) + '\n\n' + t('openOther', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    // ── confirm_action ──
    case 'confirm_action': {
      try {
        const lastAssistant = await prisma.workflowAiAssistantMessage.findFirst({
          where: { sessionId, role: 'assistant' },
          orderBy: { createdAt: 'desc' },
          select: { content: true }
        });
        if (lastAssistant?.content) {
          const lastParsed = JSON.parse(lastAssistant.content);

          if (lastParsed.type === 'settings_action' && lastParsed.action === 'delete_api_key' && lastParsed.provider) {
            const parsed = { type: 'settings_action', action: 'delete_api_key', provider: lastParsed.provider, message: lastParsed.message };
            await saveMessage(sessionId, 'user', request.prompt);
            if (ctx.actionRegistry.canHandle(parsed)) {
              const actionResult = await ctx.actionRegistry.execute(parsed, { userId: request.userId, agentId: request.agentId });
              await saveMessage(sessionId, 'assistant', JSON.stringify(actionResult));
              return { sessionId, ...actionResult, usage: zeroUsage };
            }
            return { sessionId, type: 'settings_action', action: 'delete_api_key', provider: lastParsed.provider, message: lastParsed.message, usage: zeroUsage };
          }
        }
      } catch { }
      return null;
    }

    // ── add_telegram_bot ──
    case 'add_telegram_bot': {
      const message = t('addTelegramBot', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({
        type: 'settings_action', action: 'add_telegram_bot', message
      }));
      return { sessionId, type: 'settings_action', action: 'add_telegram_bot', message, usage: zeroUsage };
    }

    // ── add_slack_bot ──
    case 'add_slack_bot': {
      const baseUrl = process.env.NEXTAUTH_URL || 'https://www.aitalk.ch';
      const redirectUrl = `${baseUrl}/api/bots/slack/oauth/callback`;
      const eventsUrl = `${baseUrl}/api/bots/slack/events/${request.agentId || 'YOUR_AGENT_ID'}`;
      const message = t('addSlackBot', L, { redirectUrl, eventsUrl });
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({
        type: 'settings_action', action: 'add_slack_bot', message
      }));
      return { sessionId, type: 'settings_action', action: 'add_slack_bot', message, usage: zeroUsage };
    }

    // ── delete_telegram_bot ──
    case 'delete_telegram_bot': {
      const message = t('deleteTelegramBot', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({
        type: 'settings_action', action: 'delete_telegram_bot', message
      }));
      return { sessionId, type: 'settings_action', action: 'delete_telegram_bot', message, usage: zeroUsage };
    }

    // ── delete_slack_bot ──
    case 'delete_slack_bot': {
      const message = t('deleteSlackBot', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({
        type: 'settings_action', action: 'delete_slack_bot', message
      }));
      return { sessionId, type: 'settings_action', action: 'delete_slack_bot', message, usage: zeroUsage };
    }

    // ── follow_up_redirect ──
    case 'follow_up_redirect': {
      try {
        const lastMsg = await prisma.workflowAiAssistantMessage.findFirst({
          where: { sessionId, role: 'assistant' },
          orderBy: { createdAt: 'desc' },
          select: { content: true }
        });
        if (lastMsg?.content) {
          const lastParsed = JSON.parse(lastMsg.content);
          const botActions = ['add_telegram_bot', 'add_slack_bot', 'delete_telegram_bot', 'delete_slack_bot'];
          if (lastParsed.type === 'settings_action' && botActions.includes(lastParsed.action)) {
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify(lastParsed));
            return { sessionId, type: 'settings_action', action: lastParsed.action, message: lastParsed.message, usage: zeroUsage };
          }
        }
      } catch { /* fall through */ }

      const provider = classified.provider;
      const displayName = provider ? (PROVIDER_DISPLAY[provider] || provider) : 'the provider';
      const message = t('securityRedirect', L, { provider: displayName }) + t('securitySteps', L, { provider: displayName });
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    // ── create_agent ──
    case 'create_agent': {
      await saveMessage(sessionId, 'user', request.prompt);
      try {
        const langMap: Record<LangCode, 'en' | 'de' | 'fr' | 'es' | 'ko'> = { ko: 'ko', en: 'en', de: 'de', fr: 'fr', es: 'es' };
        const newAgent = await createAdditionalAgent(request.userId, langMap[L] || 'en');
        const message = t('agentCreated', L, { title: newAgent.title });
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'settings_action', action: 'create_agent', message, value: { agentId: newAgent.agentId, title: newAgent.title } }));
        return { sessionId, type: 'settings_action', action: 'create_agent', message, usage: zeroUsage };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const message = t('agentCreateFailed', L, { error: errorMsg });
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
        return { sessionId, type: 'answer', message, usage: zeroUsage };
      }
    }

    case 'create_workflow': {
      const lastAssistantMsg = await getLastAssistantAction(sessionId);
      const userInput = request.prompt.trim();

      if (lastAssistantMsg?.action?.startsWith('create_workflow_')) {
        const step = lastAssistantMsg.action;

        if (step === 'create_workflow_select_agent') {
          const agents: { agentId: string; title: string }[] = lastAssistantMsg.value?.agents || [];
          const num = parseInt(userInput, 10);
          if (num >= 1 && num <= agents.length) {
            const selected = agents[num - 1];
            request.agentId = selected.agentId;
            await setSelectedAgent(sessionId, selected.agentId);

            const savedDesc = lastAssistantMsg.value?.initialDescription;
            if (savedDesc) {
              const translated = await translateToEnglish(savedDesc, request.provider, request.apiKey, request.azureConfig);
              const matched = matchTemplatesByDescription(translated);
              if (matched) {
                const message = t('createWorkflowMatch', L, { name: matched.name, description: matched.description });
                await saveMessage(sessionId, 'user', request.prompt);
                await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_confirm', message, value: { templateId: matched.templateId, selectedAgentId: selected.agentId } }));
                return { sessionId, type: 'answer', message, value: { buttons: [{ label: '✅ 만들기', data: 'yes' }, { label: '❌ 취소', data: 'no' }] }, usage: zeroUsage };
              }
              const message = t('createWorkflowNoMatchAskAI', L);
              await saveMessage(sessionId, 'user', request.prompt);
              await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_ai_confirm', message, value: { description: savedDesc, selectedAgentId: selected.agentId } }));
              return { sessionId, type: 'answer', message, usage: zeroUsage };
            }

            const message = t('createWorkflowAsk', L);
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_ask', message, value: { selectedAgentId: selected.agentId } }));
            return { sessionId, type: 'answer', message, usage: zeroUsage };
          }
          return null;
        }

        if (step === 'create_workflow_ask') {
          if (lastAssistantMsg.value?.selectedAgentId) {
            request.agentId = lastAssistantMsg.value.selectedAgentId;
          }
          if (isBlankChoice(userInput)) {
            return executeCreateBlankWorkflow(sessionId, request, L, zeroUsage, ctx.actionRegistry);
          }
          if (isTemplateChoice(userInput)) {
            const message = t('createWorkflowDescribe', L);
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_describe', message, value: { selectedAgentId: lastAssistantMsg.value?.selectedAgentId } }));
            return { sessionId, type: 'answer', message, usage: zeroUsage };
          }
          return null;
        }

        if (step === 'create_workflow_describe') {
          if (lastAssistantMsg.value?.selectedAgentId) {
            request.agentId = lastAssistantMsg.value.selectedAgentId;
          }
          const translated = await translateToEnglish(userInput, request.provider, request.apiKey, request.azureConfig);
          const matched = matchTemplatesByDescription(translated);
          if (matched) {
            const message = t('createWorkflowMatch', L, { name: matched.name, description: matched.description });
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_confirm', message, value: { templateId: matched.templateId, selectedAgentId: lastAssistantMsg.value?.selectedAgentId } }));
            return { sessionId, type: 'answer', message, value: { buttons: [{ label: '✅ 만들기', data: 'yes' }, { label: '❌ 취소', data: 'no' }] }, usage: zeroUsage };
          }
          const message = t('createWorkflowNoMatchAskAI', L);
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_ai_confirm', message, value: { description: userInput, selectedAgentId: lastAssistantMsg.value?.selectedAgentId } }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }

        if (step === 'create_workflow_confirm') {
          if (lastAssistantMsg.value?.selectedAgentId) {
            request.agentId = lastAssistantMsg.value.selectedAgentId;
          }
          if (!isDenial(userInput)) {
            const templateId = lastAssistantMsg.value?.templateId;
            if (templateId) {
              return executeCreateFromTemplate(sessionId, request, templateId, L, zeroUsage, ctx.actionRegistry);
            }
          }
          const message = t('createWorkflowCancelled', L);
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }

        if (step === 'create_workflow_no_match') {
          if (lastAssistantMsg.value?.selectedAgentId) {
            request.agentId = lastAssistantMsg.value.selectedAgentId;
          }
          if (!isDenial(userInput)) {
            return executeCreateBlankWorkflow(sessionId, request, L, zeroUsage, ctx.actionRegistry);
          }
          const message = t('createWorkflowCancelled', L);
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }

        if (step === 'create_workflow_ai_confirm') {
          if (lastAssistantMsg.value?.selectedAgentId) {
            request.agentId = lastAssistantMsg.value.selectedAgentId;
          }
          if (!isDenial(userInput)) {
            const desc = lastAssistantMsg.value?.description || '';
            if (ctx.responseParser && ctx.executeLLM) {
              return executeCreateAiWorkflow(
                sessionId, request, desc, L, pricing,
                ctx.actionRegistry, { responseParser: ctx.responseParser, executeLLM: ctx.executeLLM }
              );
            }
            return executeCreateBlankWorkflow(sessionId, request, L, zeroUsage, ctx.actionRegistry);
          }
          return executeCreateBlankWorkflow(sessionId, request, L, zeroUsage, ctx.actionRegistry);
        }
      }

      const startsWithKeyword = /^(워크플로우|workflow|새로운|new|create|만들|추가)/i.test(userInput);
      const isDescriptive = userInput.length > 50 || (userInput.length > 10 && !startsWithKeyword);
      const initialDescription = isDescriptive ? userInput : null;

      if (request.context === 'bot') {
        const sessionAgent = await getSelectedAgent(sessionId);
        if (sessionAgent) {
          request.agentId = sessionAgent;
        }
      }

      if (!(request.context === 'bot' && request.agentId)) {
        const userAgents = await prisma.agent.findMany({
          where: { userId: request.userId },
          select: { agentId: true, title: true },
          orderBy: { createdAt: 'asc' },
        });

        if (userAgents.length > 1) {
          const agentList = userAgents.map((a, i) => `${i + 1}. **${a.title}** (\`${a.agentId}\`)`).join('\n');
          const message = t('createWorkflowSelectAgent', L, { agentList });
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_select_agent', message, value: { agents: userAgents, initialDescription } }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }

        if (userAgents.length === 1) {
          request.agentId = userAgents[0].agentId;
        }
      }

      if (initialDescription) {
        const translated = await translateToEnglish(initialDescription, request.provider, request.apiKey, request.azureConfig);
        const matched = matchTemplatesByDescription(translated);
        if (matched) {
          const message = t('createWorkflowMatch', L, { name: matched.name, description: matched.description });
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_confirm', message, value: { templateId: matched.templateId, selectedAgentId: request.agentId } }));
          return { sessionId, type: 'answer', message, value: { buttons: [{ label: '✅ 만들기', data: 'yes' }, { label: '❌ 취소', data: 'no' }] }, usage: zeroUsage };
        }
        const message = t('createWorkflowNoMatchAskAI', L);
        await saveMessage(sessionId, 'user', request.prompt);
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_ai_confirm', message, value: { description: initialDescription, selectedAgentId: request.agentId } }));
        return { sessionId, type: 'answer', message, usage: zeroUsage };
      }

      const message = t('createWorkflowAsk', L);
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'workflow_action', action: 'create_workflow_ask', message, value: { selectedAgentId: request.agentId } }));
      return { sessionId, type: 'answer', message, usage: zeroUsage };
    }

    case 'list_agents': {
      const lastAssistantMsg = await getLastAssistantAction(sessionId);

      if (lastAssistantMsg?.action === 'list_agents_select') {
        const agents: { agentId: string; title: string }[] = lastAssistantMsg.value?.agents || [];
        const num = parseInt(request.prompt.trim(), 10);
        if (num >= 1 && num <= agents.length) {
          const selected = agents[num - 1];
          await setSelectedAgent(sessionId, selected.agentId);
          const workflows = await prisma.workflow.findMany({
            where: { agentId: selected.agentId },
            orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
            select: { workflowId: true, name: true, status: true },
          });

          if (workflows.length === 0) {
            const message = t('editWorkflowNoWorkflows', L);
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
            return { sessionId, type: 'answer', message, usage: zeroUsage };
          }

          if (workflows.length === 1) {
            await setEditingWorkflow(sessionId, workflows[0].workflowId);
            const message = t('editWorkflowEntered', L, { name: workflows[0].name }) + t('editWorkflowTransition', L);
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
            return { sessionId, type: 'answer', message, usage: zeroUsage };
          }

          const workflowList = workflows.map((wf, i) => {
            const icon = wf.status === 'production' ? '\u{1F7E2}' : '\u{1F7E1}';
            return `${i + 1}. ${icon} **${wf.name}** (${wf.status})`;
          }).join('\n');
          const message = t('listAgentsWorkflows', L, { agentName: selected.title, workflowList });
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({
            type: 'workflow_action', action: 'edit_workflow_select', message,
            value: { workflows: workflows.map(wf => ({ workflowId: wf.workflowId, name: wf.name })) }
          }));
          const selectButtons = workflows.map((wf, i) => ({ label: `${i + 1}. ${wf.name}`, data: String(i + 1) }));
          return { sessionId, type: 'answer', message, value: { buttons: selectButtons }, usage: zeroUsage };
        }
        return null;
      }

      const userAgents = await prisma.agent.findMany({
        where: { userId: request.userId },
        select: { agentId: true, title: true, _count: { select: { workflows: true } } },
        orderBy: { createdAt: 'asc' },
      });

      if (userAgents.length === 0) {
        const message = t('editWorkflowNoWorkflows', L);
        await saveMessage(sessionId, 'user', request.prompt);
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
        return { sessionId, type: 'answer', message, usage: zeroUsage };
      }

      const promptLower = request.prompt.toLowerCase();
      const matchedAgent = userAgents.find(a => promptLower.includes(a.title.toLowerCase()));
      if (matchedAgent) {
        await setSelectedAgent(sessionId, matchedAgent.agentId);
        const workflows = await prisma.workflow.findMany({
          where: { agentId: matchedAgent.agentId },
          orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
          select: { workflowId: true, name: true, status: true },
        });
        if (workflows.length === 0) {
          const message = t('editWorkflowNoWorkflows', L);
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }
        const workflowList = workflows.map((wf, i) => {
          const icon = wf.status === 'production' ? '\u{1F7E2}' : '\u{1F7E1}';
          return `${i + 1}. ${icon} **${wf.name}** (${wf.status})`;
        }).join('\n');
        const message = t('listAgentsWorkflows', L, { agentName: matchedAgent.title, workflowList });
        await saveMessage(sessionId, 'user', request.prompt);
        await saveMessage(sessionId, 'assistant', JSON.stringify({
          type: 'workflow_action', action: 'edit_workflow_select', message,
          value: { workflows: workflows.map(wf => ({ workflowId: wf.workflowId, name: wf.name })) }
        }));
        const selectButtons = workflows.map((wf, i) => ({ label: `${i + 1}. ${wf.name}`, data: String(i + 1) }));
        return { sessionId, type: 'answer', message, value: { buttons: selectButtons }, usage: zeroUsage };
      }

      const agentList = userAgents.map((a, i) => `${i + 1}. **${a.title}** (${a._count.workflows} workflows)`).join('\n');
      const message = t('listAgentsSelect', L, { agentList });
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({
        type: 'workflow_action', action: 'list_agents_select', message,
        value: { agents: userAgents.map(a => ({ agentId: a.agentId, title: a.title })) }
      }));
      const agentButtons = userAgents.map((a, i) => ({ label: `${i + 1}. ${a.title}`, data: String(i + 1) }));
      return { sessionId, type: 'answer', message, value: { buttons: agentButtons }, usage: zeroUsage };
    }

    case 'edit_workflow': {
      const lastAssistantMsg = await getLastAssistantAction(sessionId);

      if (lastAssistantMsg?.action === 'edit_workflow_select') {
        const userInput = request.prompt.trim();

        if (userInput === 'other_agents') {
          const userAgents = await prisma.agent.findMany({
            where: { userId: request.userId },
            select: { agentId: true, title: true, _count: { select: { workflows: true } } },
            orderBy: { createdAt: 'asc' },
          });
          const agentList = userAgents.map((a, i) => `${i + 1}. **${a.title}** (${a._count.workflows} workflows)`).join('\n');
          const message = t('listAgentsSelect', L, { agentList });
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({
            type: 'workflow_action', action: 'list_agents_select', message,
            value: { agents: userAgents.map(a => ({ agentId: a.agentId, title: a.title })) }
          }));
          const agentButtons = userAgents.map((a, i) => ({ label: `${i + 1}. ${a.title}`, data: String(i + 1) }));
          return { sessionId, type: 'answer', message, value: { buttons: agentButtons }, usage: zeroUsage };
        }

        const workflows: { workflowId: string; name: string }[] = lastAssistantMsg.value?.workflows || [];
        const num = parseInt(userInput, 10);
        if (num >= 1 && num <= workflows.length) {
          const selected = workflows[num - 1];
          await setEditingWorkflow(sessionId, selected.workflowId);
          const message = t('editWorkflowEntered', L, { name: selected.name }) + t('editWorkflowTransition', L);
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }
        return null;
      }

      if (lastAssistantMsg?.action === 'list_agents_select') {
        const agents: { agentId: string; title: string }[] = lastAssistantMsg.value?.agents || [];
        const num = parseInt(request.prompt.trim(), 10);
        if (num >= 1 && num <= agents.length) {
          const selected = agents[num - 1];
          const workflows = await prisma.workflow.findMany({
            where: { agentId: selected.agentId },
            orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
            select: { workflowId: true, name: true, status: true },
          });

          if (workflows.length === 0) {
            const message = t('editWorkflowNoWorkflows', L);
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
            return { sessionId, type: 'answer', message, usage: zeroUsage };
          }

          if (workflows.length === 1) {
            await setEditingWorkflow(sessionId, workflows[0].workflowId);
            const message = t('editWorkflowEntered', L, { name: workflows[0].name }) + t('editWorkflowTransition', L);
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
            return { sessionId, type: 'answer', message, usage: zeroUsage };
          }

          const workflowList = workflows.map((wf, i) => {
            const icon = wf.status === 'production' ? '\u{1F7E2}' : '\u{1F7E1}';
            return `${i + 1}. ${icon} **${wf.name}** (${wf.status})`;
          }).join('\n');
          const message = t('listAgentsWorkflows', L, { agentName: selected.title, workflowList });
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({
            type: 'workflow_action', action: 'edit_workflow_select', message,
            value: { workflows: workflows.map(wf => ({ workflowId: wf.workflowId, name: wf.name })) }
          }));
          const selectButtons = workflows.map((wf, i) => ({ label: `${i + 1}. ${wf.name}`, data: String(i + 1) }));
          return { sessionId, type: 'answer', message, value: { buttons: selectButtons }, usage: zeroUsage };
        }
        return null;
      }

      const wfIdMatch = request.prompt.match(/workflowId\s*=\s*(wf_[a-zA-Z0-9]+)/i);
      if (wfIdMatch) {
        const directWfId = wfIdMatch[1];
        const directWf = await prisma.workflow.findFirst({
          where: { workflowId: directWfId },
          select: { workflowId: true, name: true, agentId: true, agent: { select: { userId: true } } },
        });
        if (directWf && directWf.agent?.userId === request.userId) {
          await setEditingWorkflow(sessionId, directWf.workflowId);
          const message = t('editWorkflowEntered', L, { name: directWf.name }) + t('editWorkflowTransition', L);
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }
      }

      let agentId = request.agentId;
      const promptLower = request.prompt.toLowerCase();
      const userAgentsForEdit = await prisma.agent.findMany({
        where: { userId: request.userId },
        select: { agentId: true, title: true },
      });
      const mentionedAgent = userAgentsForEdit.find(a =>
        a.agentId !== request.agentId && promptLower.includes(a.title.toLowerCase())
      );
      if (mentionedAgent) {
        agentId = mentionedAgent.agentId;
      }
      if (!agentId) return null;

      const workflows = await prisma.workflow.findMany({
        where: { agentId },
        orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
        select: { workflowId: true, name: true, status: true },
      });

      if (workflows.length === 0) {
        const message = t('editWorkflowNoWorkflows', L);
        await saveMessage(sessionId, 'user', request.prompt);
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
        return { sessionId, type: 'answer', message, usage: zeroUsage };
      }

      const searchName = classified.value;
      if (searchName) {
        const matched = workflows.find(wf =>
          wf.name.toLowerCase().includes(searchName.toLowerCase())
        );
        if (matched) {
          await setEditingWorkflow(sessionId, matched.workflowId);
          const message = t('editWorkflowEntered', L, { name: matched.name }) + t('editWorkflowTransition', L);
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }
      }

      if (workflows.length === 1) {
        await setEditingWorkflow(sessionId, workflows[0].workflowId);
        const message = t('editWorkflowEntered', L, { name: workflows[0].name }) + t('editWorkflowTransition', L);
        await saveMessage(sessionId, 'user', request.prompt);
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
        return { sessionId, type: 'answer', message, usage: zeroUsage };
      }

      const workflowList = workflows.map((wf, i) => {
        const icon = wf.status === 'production' ? '\u{1F7E2}' : '\u{1F7E1}';
        return `${i + 1}. ${icon} **${wf.name}** (${wf.status})`;
      }).join('\n');
      const message = t('editWorkflowSelect', L, { workflowList });
      await saveMessage(sessionId, 'user', request.prompt);
      await saveMessage(sessionId, 'assistant', JSON.stringify({
        type: 'workflow_action', action: 'edit_workflow_select', message,
        value: { workflows: workflows.map(wf => ({ workflowId: wf.workflowId, name: wf.name })) }
      }));
      const selectButtons: { label: string; data: string }[] = workflows.map((wf, i) => ({ label: `${i + 1}. ${wf.name}`, data: String(i + 1) }));

      if (request.context !== 'bot') {
        const agentCount = await prisma.agent.count({ where: { userId: request.userId } });
        if (agentCount > 1) {
          selectButtons.push({ label: '\uD83D\uDD04 다른 에이전트', data: 'other_agents' });
        }
      }

      return { sessionId, type: 'answer', message, value: { buttons: selectButtons }, usage: zeroUsage };
    }

    default:
      return null;
  }
}
