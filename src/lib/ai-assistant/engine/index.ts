/**
 * AI Assistant Engine
 * - Single processMessage() entry point
 * - Unified execution path for all providers (Adapter + DB session)
 * - Combines ContextBuilder + ResponseParser + ActionRegistry
 * - LLM Intent Classifier for pre-LLM intent detection
 */

import { OpenAI, AzureOpenAI } from 'openai';
import { createLLMClient, AzureConfig } from '@/lib/ai-providers';
import { prisma } from '@/lib/prisma';
import { estimateTokens } from '../token-counter';
import {
  createSession,
  saveMessage,
  checkAndSummarize,
  buildHierarchicalMessages,
  getSessionByWorkflow,
  getEditingWorkflow,
  clearEditingWorkflow,
  getSessionResponseId,
  setSessionResponseId,
} from '../session-service';
import { ContextBuilder } from '../context-builder';
import { ResponseParser } from '../response-parser';
import { ActionRegistry } from '../action-registry';
import { SettingsActionHandler } from '../actions/settings-actions';
import { WorkflowActionHandler } from '../actions/workflow-actions';
import { IntentClassifier } from '../intent-classifier';
import { handleOnboarding } from '../onboarding';
import { t } from './messages';
import { AI_ASSISTANT_PRICING } from './constants';
import { executeIntent, detectApiKeyPaste, PROVIDER_DISPLAY } from './intent-handlers';
import type { IntentContext } from './intent-handlers';
import { detectLangFromText, getLastAssistantAction } from './workflow-creation';
import { isEditingExit, isWorkflowEditingRequest, isViewStructureRequest, processWorkflowEdit } from './workflow-editing';
import type { EngineRequest, EngineResponse } from './types';
import { isGptReasoningFamily, replaceRetiredChatModel } from '@/lib/managed/model-lineup';

// ========================================
// ========================================
const CURRENT_AGENT_PATTERNS = [
  /현재.*(에이전트|agent)/i,
  /선택된.*(에이전트|agent)/i,
  /연결된.*(에이전트|agent)/i,
  /어떤.*(에이전트|agent)/i,
  /which\s+agent/i,
  /current\s+agent/i,
  /selected\s+agent/i,
  /connected\s+agent/i,
];

function isCurrentAgentQuestion(prompt: string): boolean {
  const text = prompt.trim().toLowerCase();
  return CURRENT_AGENT_PATTERNS.some(p => p.test(text));
}

// ========================================
// Backward-compatible re-exports
// ========================================
export { AI_ASSISTANT_PRICING, DEFAULT_MODELS, PROVIDER_KEY_MAP } from './constants';
export type { EngineRequest, EngineResponse } from './types';

// ========================================
// AIAssistantEngine class
// ========================================

export class AIAssistantEngine {
  private contextBuilder: ContextBuilder;
  private responseParser: ResponseParser;
  private actionRegistry: ActionRegistry;
  private intentClassifier: IntentClassifier;

  constructor() {
    this.contextBuilder = new ContextBuilder();
    this.responseParser = new ResponseParser();
    this.actionRegistry = new ActionRegistry();
    this.intentClassifier = new IntentClassifier();

    // Register action handlers
    this.actionRegistry.register(new SettingsActionHandler());
    this.actionRegistry.register(new WorkflowActionHandler());
  }

  async processMessage(rawRequest: EngineRequest): Promise<EngineResponse> {
    const request: EngineRequest = rawRequest.azureConfig
      ? { ...rawRequest, model: replaceRetiredChatModel(rawRequest.model) }
      : rawRequest;
    const sessionId = await this.ensureSession(request);

    // IntentContext for dependency injection
    const intentCtx: IntentContext = {
      actionRegistry: this.actionRegistry,
      responseParser: this.responseParser,
      executeLLM: (p: string, k: string, m: any, model: string) => this.executeLLM(p, k, m, model, request.azureConfig),
    };

    if (request.context === 'dashboard' || request.context === 'bot') {
      const pricing = AI_ASSISTANT_PRICING[request.provider]?.[request.model]
        || AI_ASSISTANT_PRICING.openai['gpt-5-mini'];

      if (request.agentId) {
        const onboardResult = await handleOnboarding(request.agentId, request.userId, request.prompt);
        if (onboardResult) {
          const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };
          const value: Record<string, any> = {};
          if (onboardResult.buttons) value.buttons = onboardResult.buttons;
          if (onboardResult.agentTitle) value.agentTitle = onboardResult.agentTitle;
          if (onboardResult.userName) value.userName = onboardResult.userName;
          return {
            sessionId,
            type: 'onboarding',
            message: onboardResult.message,
            value: Object.keys(value).length > 0 ? value : undefined,
            usage: zeroUsage,
          };
        }
        if (request.prompt === '__onboard_start__') {
          const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };
          return { sessionId, type: 'onboarding_skip', message: '', usage: zeroUsage };
        }
      }

      if (request.agentId && isCurrentAgentQuestion(request.prompt)) {
        const agent = await prisma.agent.findFirst({
          where: { agentId: request.agentId },
          select: { title: true, agentId: true }
        });
        if (agent) {
          const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };
          const message = `현재 연결된 에이전트는 **"${agent.title}"** (ID: ${agent.agentId})입니다.`;
          await saveMessage(sessionId, 'user', request.prompt);
          await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
          return { sessionId, type: 'answer', message, usage: zeroUsage };
        }
      }

      const pasteProvider = detectApiKeyPaste(request.prompt);
      if (pasteProvider) {
        const displayName = PROVIDER_DISPLAY[pasteProvider] || pasteProvider;
        const message = `Please enter your ${displayName} API key securely in the field below.`;
        await saveMessage(sessionId, 'user', `[${displayName} API key input detected]`);
        await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'settings_action', action: 'add_api_key', provider: pasteProvider, message }));
        return {
          sessionId, type: 'settings_action', action: 'add_api_key',
          provider: pasteProvider, message,
          usage: { inputTokens: 0, outputTokens: 0, model: request.model, pricing },
        };
      }

      if (request.context === 'bot') {
        try {
          const lastMsg = await prisma.workflowAiAssistantMessage.findFirst({
            where: { sessionId, role: 'assistant' },
            orderBy: { createdAt: 'desc' },
            select: { content: true }
          });
          if (lastMsg?.content) {
            const lastParsed = JSON.parse(lastMsg.content);
            if (lastParsed.type === 'settings_action' && lastParsed.action === 'add_api_key' && lastParsed.provider) {
              const trimmed = request.prompt.trim();
              if (trimmed.length >= 20 && !trimmed.includes(' ')) {
                const parsed = { type: 'settings_action', action: 'save_api_key', provider: lastParsed.provider, value: trimmed, message: '' };
                await saveMessage(sessionId, 'user', `[${lastParsed.provider} API key input]`);
                if (this.actionRegistry.canHandle(parsed)) {
                  const actionResult = await this.actionRegistry.execute(parsed, { userId: request.userId, agentId: request.agentId });
                  await saveMessage(sessionId, 'assistant', JSON.stringify(actionResult));
                  return { sessionId, ...actionResult, action: 'save_api_key', usage: { inputTokens: 0, outputTokens: 0, model: request.model, pricing } };
                }
              }
            }
          }
        } catch { }
      }

      {
        const pendingAction = await getLastAssistantAction(sessionId);
        if (pendingAction?.action?.startsWith('create_workflow_')) {
          const lang = detectLangFromText(request.prompt);
          const result = await executeIntent(
            { intent: 'create_workflow', lang },
            sessionId, request, pricing, intentCtx
          );
          if (result) return result;
        }
        if (pendingAction?.action === 'edit_workflow_select') {
          const lang = detectLangFromText(request.prompt);
          const result = await executeIntent(
            { intent: 'edit_workflow', lang },
            sessionId, request, pricing, intentCtx
          );
          if (result) return result;
        }
        if (pendingAction?.action === 'list_agents_select') {
          const lang = detectLangFromText(request.prompt);
          const result = await executeIntent(
            { intent: 'list_agents', lang },
            sessionId, request, pricing, intentCtx
          );
          if (result) return result;
        }
      }

      {
        const editingWorkflowId = await getEditingWorkflow(sessionId);
        if (editingWorkflowId) {
          const L = detectLangFromText(request.prompt);
          const zeroUsage = { inputTokens: 0, outputTokens: 0, model: request.model, pricing };

          if (isEditingExit(request.prompt)) {
            await clearEditingWorkflow(sessionId);
            const message = t('editWorkflowExited', L);
            await saveMessage(sessionId, 'user', request.prompt);
            await saveMessage(sessionId, 'assistant', JSON.stringify({ type: 'answer', message }));
            return { sessionId, type: 'answer', message, usage: zeroUsage };
          }

          if (isWorkflowEditingRequest(request.prompt) || isViewStructureRequest(request.prompt)) {
            const editResult = await processWorkflowEdit(
              sessionId, editingWorkflowId, request, L, pricing, {
                contextBuilder: this.contextBuilder,
                responseParser: this.responseParser,
                executeLLM: (p: string, k: string, m: any, model: string) => this.executeLLM(p, k, m, model, request.azureConfig),
              }
            );
            if (editResult) return editResult;
          }

          const recentHistory = await this.intentClassifier.getRecentHistory(sessionId);
          const classified = await this.intentClassifier.classify(
            request.provider, request.apiKey, request.prompt, recentHistory, request.azureConfig
          );

          if (classified.intent !== 'none' && classified.intent !== 'edit_workflow') {
            try {
              const editingWf = await prisma.workflow.findUnique({
                where: { workflowId: editingWorkflowId },
                select: { agentId: true },
              });
              if (editingWf) {
                request.agentId = editingWf.agentId;
              }
            } catch { /* ignore */ }
            await clearEditingWorkflow(sessionId);
            const result = await executeIntent(classified, sessionId, request, pricing, intentCtx);
            if (result) return result;
            // fall through to full LLM if executeIntent returns null
          } else {
            const editResult = await processWorkflowEdit(
              sessionId, editingWorkflowId, request, L, pricing, {
                contextBuilder: this.contextBuilder,
                responseParser: this.responseParser,
                executeLLM: (p: string, k: string, m: any, model: string) => this.executeLLM(p, k, m, model, request.azureConfig),
              }
            );
            if (editResult) return editResult;
          }
        }
      }

      // (2) LLM Intent Classifier
      const recentHistory = await this.intentClassifier.getRecentHistory(sessionId);
      const classified = await this.intentClassifier.classify(
        request.provider, request.apiKey, request.prompt, recentHistory, request.azureConfig
      );
      if (classified.intent !== 'none') {
        const result = await executeIntent(classified, sessionId, request, pricing, intentCtx);
        if (result) return result;
      }
    }

    // (3) Full LLM Call

    const { systemPrompt, userPrompt } = await this.contextBuilder.build({
      userId: request.userId,
      prompt: request.prompt,
      context: request.context,
      agentId: request.agentId,
      existingWorkflow: request.existingWorkflow,
      nodeId: request.nodeId,
      dataSheetId: request.dataSheetId,
      mcpConnectionId: request.mcpConnectionId,
      providerStatus: request.providerStatus,
      templateSource: request.templateSource,
      isFollowUp: request.isFollowUp,
    });

    const isOpenAI = request.provider === 'openai' || !!request.azureConfig;
    let llmResult: { content: string; inputTokens: number; outputTokens: number };

    if (isOpenAI) {
      const previousResponseId = await getSessionResponseId(sessionId);
      llmResult = await this.executeLLMWithResponsesAPI(
        request.provider, request.apiKey, systemPrompt, userPrompt,
        request.model, previousResponseId, request.azureConfig
      );
    } else {
      const historyMessages = await buildHierarchicalMessages(sessionId, systemPrompt);
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        ...historyMessages,
        { role: 'user', content: userPrompt },
      ];
      llmResult = await this.executeLLM(request.provider, request.apiKey, messages, request.model, request.azureConfig);
    }

    const pricing = AI_ASSISTANT_PRICING[request.provider]?.[request.model]
      || AI_ASSISTANT_PRICING.openai['gpt-5-mini'];

    const parsed = this.responseParser.parse(llmResult.content, request.context);

    await saveMessage(sessionId, 'user', userPrompt);
    await saveMessage(sessionId, 'assistant', llmResult.content);
    if (isOpenAI) {
      const responseId = (this as any)._lastResponseId;
      if (responseId) {
        await setSessionResponseId(sessionId, responseId);
        (this as any)._lastResponseId = null;
      }
      const allMessages = await prisma.workflowAiAssistantMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (allMessages.length > 10) {
        const idsToDelete = allMessages.slice(10).map(m => m.id);
        await prisma.workflowAiAssistantMessage.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }
    } else {
      await checkAndSummarize(sessionId, request.provider, request.apiKey, request.azureConfig);
    }

    const usage = {
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      model: request.model,
      pricing: {
        input: pricing.input,
        cachedInput: (pricing as any).cachedInput,
        output: pricing.output,
      },
    };

    if (this.actionRegistry.canHandle(parsed)) {
      const actionResult = await this.actionRegistry.execute(parsed, {
        userId: request.userId,
        agentId: request.agentId,
      });
      return { sessionId, ...actionResult, usage };
    }

    return this.buildResponse(sessionId, parsed, request, usage);
  }

  private async ensureSession(request: EngineRequest): Promise<string> {
    if (request.sessionId) {
      return request.sessionId;
    }

    const existingSessionId = await getSessionByWorkflow(request.userId, request.workflowId || null);
    if (existingSessionId) {
      return existingSessionId;
    }

    return createSession(request.userId, request.workflowId, request.provider, request.model);
  }

  private async executeLLM(
    provider: string,
    apiKey: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    model: string,
    azureConfig?: AzureConfig
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    try {
      const client = createLLMClient(provider as any, apiKey, azureConfig);
      const response = await client.chat(
        messages,
        { model, temperature: 0.1, maxTokens: 16384, responseFormat: 'json' as any }
      );

      const totalInputText = messages.map(m => m.content).join(' ');
      return {
        content: response.content,
        inputTokens: response.usage?.inputTokens || estimateTokens(totalInputText),
        outputTokens: response.usage?.outputTokens || estimateTokens(response.content),
      };
    } catch (adapterError: any) {
      // json_validate_failed: model generated text but not valid JSON
      const failedText = adapterError?.error?.error?.failed_generation;
      if (failedText && typeof failedText === 'string') {
        console.warn('[Engine] JSON validation failed, using failed_generation as answer:', failedText.substring(0, 100));
        const totalInputText = messages.map(m => m.content).join(' ');
        return {
          content: JSON.stringify({ type: 'answer', message: failedText }),
          inputTokens: estimateTokens(totalInputText),
          outputTokens: estimateTokens(failedText),
        };
      }
      throw adapterError;
    }
  }

  private async executeLLMWithResponsesAPI(
    provider: string,
    apiKey: string,
    systemPrompt: string,
    userPrompt: string,
    model: string,
    previousResponseId: string | null,
    azureConfig?: AzureConfig
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    try {
      let openai: OpenAI
      if (azureConfig) {
        openai = new AzureOpenAI({
          apiKey,
          endpoint: azureConfig.endpoint,
          apiVersion: azureConfig.apiVersion,
          deployment: model,
        })
      } else {
        openai = new OpenAI({ apiKey })
      }

      const requestConfig: any = {
        model,
        instructions: systemPrompt,
        input: userPrompt,
        store: true,
      }

      if (previousResponseId) {
        requestConfig.previous_response_id = previousResponseId
      }

      if (isGptReasoningFamily(model)) {
        requestConfig.reasoning = {
          effort: 'medium',
          summary: 'auto',
        }
        requestConfig.text = { format: { type: 'json_object' } }
      } else {
        requestConfig.temperature = 0.1
        requestConfig.text = { format: { type: 'json_object' } }
      }

      let response: any
      try {
        response = await openai.responses.create(requestConfig)
      } catch (error: any) {
        if (error?.code === 'previous_response_not_found' && previousResponseId) {
          delete requestConfig.previous_response_id
          response = await openai.responses.create(requestConfig)
        } else {
          throw error
        }
      }

      const outputText = response.output
        ?.filter((item: any) => item.type === 'message')
        ?.flatMap((item: any) => item.content)
        ?.filter((c: any) => c.type === 'output_text')
        ?.map((c: any) => c.text)
        ?.join('') || ''

      if (response.id) {
        ;(this as any)._lastResponseId = response.id
      }

      return {
        content: outputText,
        inputTokens: response.usage?.input_tokens || estimateTokens(systemPrompt + userPrompt),
        outputTokens: response.usage?.output_tokens || estimateTokens(outputText),
      }
    } catch (error: any) {
      // json_validate_failed fallback
      const failedText = error?.error?.error?.failed_generation
      if (failedText && typeof failedText === 'string') {
        console.warn('[Engine] Responses API JSON validation failed:', failedText.substring(0, 100))
        return {
          content: JSON.stringify({ type: 'answer', message: failedText }),
          inputTokens: estimateTokens(systemPrompt + userPrompt),
          outputTokens: estimateTokens(failedText),
        }
      }
      throw error
    }
  }

  private buildResponse(
    sessionId: string,
    parsed: any,
    request: EngineRequest,
    usage: EngineResponse['usage']
  ): EngineResponse {
    const type = parsed.type;

    if (type === 'answer') {
      return {
        sessionId,
        type: 'answer',
        message: parsed.message || '답변입니다.',
        usage,
      };
    }

    if (type === 'question') {
      return {
        sessionId,
        type: 'question',
        message: parsed.message || '질문이 있습니다.',
        usage,
      };
    }

    if (type === 'confirmation') {
      return {
        sessionId,
        type: 'confirmation',
        message: parsed.message || '확인해주세요.',
        preview: parsed.preview || null,
        usage,
      };
    }

    if (type === 'modification') {
      const rawChanges = parsed.changes || [];
      const validChanges = rawChanges.filter((change: any) => {
        if (!change.nodeId) {
          console.warn('[Engine] Invalid change rejected: missing nodeId', change);
          return false;
        }
        if (!change.path || !change.action) {
          console.warn('[Engine] Invalid change rejected: missing path or action', change);
          return false;
        }
        return true;
      });

      return {
        sessionId,
        type: 'modification',
        message: parsed.message || '수정 사항입니다.',
        changes: validChanges,
        dataSheetChanges: parsed.dataSheetChanges || [],
        usage,
      };
    }

    if (type === 'settings_action') {
      return {
        sessionId,
        type: 'settings_action',
        action: parsed.action,
        provider: parsed.provider,
        message: parsed.message || 'Settings action',
        usage,
      };
    }

    if (type === 'workflow_action') {
      return {
        sessionId,
        type: 'workflow_action',
        action: parsed.action,
        value: parsed.value,
        message: parsed.message || 'Workflow action',
        usage,
      };
    }

    // workflow (default)
    const workflow = {
      nodes: parsed.nodes,
      edges: parsed.edges,
    };

    if (!workflow.nodes || !workflow.edges) {
      throw new Error('Invalid workflow structure: missing nodes or edges');
    }
    if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
      throw new Error('Invalid workflow structure: nodes and edges must be arrays');
    }

    return {
      sessionId,
      type: 'workflow',
      workflow,
      message: parsed.message || 'Workflow generated successfully!',
      usage,
    };
  }
}
