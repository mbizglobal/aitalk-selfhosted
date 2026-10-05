
import { createLLMClient, AzureConfig } from '@/lib/ai-providers';
import { prisma } from '@/lib/prisma';

// ========================================
// Types
// ========================================

export type IntentType =
  | 'add_api_key'
  | 'delete_api_key'
  | 'check_api_key'
  | 'add_pinecone_key'
  | 'pinecone_config'
  | 'change_rag'
  | 'list_rag'
  | 'update_profile'
  | 'change_email'
  | 'list_models'
  | 'advanced_settings'
  | 'other_settings'
  | 'add_telegram_bot'
  | 'delete_telegram_bot'
  | 'add_slack_bot'
  | 'delete_slack_bot'
  | 'follow_up_redirect'
  | 'confirm_action'
  | 'create_agent'
  | 'create_workflow'
  | 'edit_workflow'
  | 'list_agents'
  | 'none';

export type LangCode = 'ko' | 'en' | 'de' | 'fr' | 'es';

export interface ClassifiedIntent {
  intent: IntentType;
  lang: LangCode;          // detected language of user input
  provider?: string;       // openai, claude, gemini, deepseek, grok, mistral
  field?: string;          // timezone, locale, name, timeFormat
  value?: string;          // Asia/Seoul, ko-KR, etc.
  feature?: string;        // conversations, usageLogs, deleteAgent, anonymize, chatLimit, continuousLimit
  ragProvider?: string;    // pinecone, openai_vector_store, gemini_file_search, none
  indexName?: string;      // Pinecone index name
  embeddingModel?: string; // Pinecone embedding model
}

// ========================================
// ========================================

const CLASSIFIER_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat',
  grok: 'grok-4-1-fast-reasoning',
  mistral: 'mistral-small-latest',
};

// ========================================
// System Prompt (~350 tokens)
// ========================================

const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier for an AI assistant dashboard. Classify the user's message into exactly one intent.

## Intents

| Intent | Description | Required params |
|--------|-------------|-----------------|
| add_api_key | User wants to add/register an AI provider API key | provider |
| delete_api_key | User wants to delete/remove an AI provider API key | provider |
| check_api_key | User asks if an API key is configured/exists, or which providers have keys set up | provider? |
| add_pinecone_key | User wants to add a Pinecone API key | - |
| pinecone_config | User wants to set Pinecone index name or embedding model | indexName?, embeddingModel? |
| change_rag | User wants to change RAG provider | ragProvider |
| list_rag | User asks about available RAG providers | - |
| update_profile | User wants to change name, timezone, language, or date format | field, value? |
| change_email | User wants to change their email address | value? |
| list_models | User asks about available/supported AI models, pricing, or model list. If user asks about "configured models" or "models with API key", also use this intent | - |
| advanced_settings | User asks about destructive actions (delete conversations, delete agent, anonymize data, delete execution stats) | feature |
| other_settings | User asks about chat rate limit or continuous answer limit settings | feature |
| add_telegram_bot | User wants to connect/add/setup Telegram (bot, channel, integration). Includes "텔레그램 연결", "telegram setup", "connect telegram" | - |
| delete_telegram_bot | User wants to disconnect/remove/delete Telegram bot or channel | - |
| add_slack_bot | User wants to connect/add/setup Slack (bot, app, channel, integration). Includes "슬랙 연결", "slack setup", "connect slack", "slack 연결 방법" | - |
| delete_slack_bot | User wants to disconnect/remove/delete Slack bot or channel | - |
| follow_up_redirect | User says "do it for me" after a previous add_api_key response | provider? |
| confirm_action | User confirms/agrees to a previous action (e.g., "yes", "ok", "do it", "네", "삭제", "확인"). Only when recent context shows a pending confirmation | - |
| create_agent | User explicitly wants to add a new agent slot/entity (e.g., "에이전트 추가", "add new agent", "새 에이전트 만들어줘"). NOT for building chatbots or automations | - |
| create_workflow | User wants to create a workflow, OR describes building a chatbot/automation/AI bot (e.g., "AI 챗봇 만들고 싶어요", "챗봇 만들어줘", "check emails and notify", "자동으로 이메일 분류", "build a chatbot") | - |
| edit_workflow | User wants to edit/modify/change/update an existing workflow, OR wants to see/select/list/analyze their existing workflows (e.g., "워크플로우 수정해줘", "edit my workflow", "워크플로우 편집", "워크플로우 선택", "워크플로우 보여줘", "워크플로우 목록", "워크플로우 분석", "show my workflows", "analyze my workflow", "만들어진 워크플로우", "existing workflows", "select a workflow"). Extract workflow name if mentioned | value? |
| list_agents | User wants to see all agents, agent list, or other agent's workflows (e.g., "에이전트 리스트", "agent list", "다른 에이전트", "other agent workflows") | - |
| none | General conversation, questions, analysis requests - NOT a settings action | - |

## Provider values
openai, claude, gemini, deepseek, grok, mistral

## Profile field values
timezone, locale, name, timeFormat

## Feature values (advanced_settings)
conversations, usageLogs, deleteAgent, anonymize

## Feature values (other_settings)
chatLimit, continuousLimit

## RAG provider values
pinecone, openai_vector_store, gemini_file_search, none

## Pinecone embedding models
llama-text-embed-v2, multilingual-e5-large, text-embedding-3-small, text-embedding-3-large

## Rules
1. If the user message is a general question, analysis request, greeting, or anything that isn't a clear settings/config action, return intent "none".
2. For profile updates, extract the value if clearly stated (e.g., "Seoul" → timezone: "Asia/Seoul").
3. For follow_up_redirect, only match when recent context shows a previous add_api_key response and user asks to "do it for me".
4. Always detect the user's language and set "lang": "ko"|"en"|"de"|"fr"|"es".
5. Only output valid JSON. No explanation.
6. "Telegram"/"텔레그램" + (add/추가/연결/등록/connect/연결 방법/설정/setup) → add_telegram_bot (with or without "bot/봇")
7. "Slack"/"슬랙" + (add/추가/연결/등록/connect/연결 방법/설정/setup) → add_slack_bot (with or without "bot/봇")
8. "Telegram"/"텔레그램" + (delete/삭제/해제/끊기/disconnect/remove) → delete_telegram_bot (with or without "bot/봇")
9. "Slack"/"슬랙" + (delete/삭제/해제/끊기/disconnect/remove) → delete_slack_bot (with or without "bot/봇")
10. IMPORTANT: When user mentions "Telegram" or "Slack" with ANY intent to connect/setup/configure, ALWAYS use the bot intent (add_telegram_bot or add_slack_bot). NEVER return "none" for these.
11. "Agent"/"에이전트" + (create/add/new/추가/생성/만들기) → create_agent. ONLY when user explicitly says "에이전트" or "agent" — NOT "챗봇", "chatbot", "봇 만들기", or any automation description
12. "Workflow"/"워크플로우"/"워크플로" + (create/add/new/추가/생성/만들기/만들어) → create_workflow
13. IMPORTANT (HIGHER PRIORITY THAN RULE 11): "챗봇"/"chatbot"/"봇 만들"/"AI봇"/"자동화" or ANY description of building an automation, chatbot, or AI-powered process → create_workflow. Examples: "AI챗봇 만들고 싶어요", "챗봇 만들어줘", "봇을 만들고 싶어요", "이메일 자동 분류", "매일 보고서 보내기", "I want to build a chatbot", "automate my emails". When in doubt between create_agent and create_workflow, prefer create_workflow.
14. "Workflow"/"워크플로우"/"워크플로" + (edit/modify/change/update/수정/편집/변경/고치/바꾸/선택/보여/목록/분석/analyze/analysieren/analyser/analizar/show/list/select/알려/만들어진/existing) → edit_workflow. If a workflow name is mentioned, extract it as "value". Examples: "워크플로우 수정해줘", "AI Chatbot 워크플로우 편집", "edit the customer support workflow", "modify my workflow", "워크플로우 선택할 수 있는 것 알려주세요", "워크플로우 보여줘", "show my workflows", "만들어진 워크플로우 목록", "워크플로우 분석해줘", "analyze my workflow".
15. "에이전트 리스트"/"agent list"/"다른 에이전트"/"other agent" + (show/list/보여/리스트/워크플로우/workflows) → list_agents. Examples: "에이전트 리스트 보여줘", "다른 에이전트의 워크플로우", "show all agents", "other agent workflows".

## Timezone mappings
Switzerland/Zurich→Europe/Zurich, Seoul/Korea→Asia/Seoul, Tokyo/Japan→Asia/Tokyo, New York→America/New_York, London→Europe/London, Paris→Europe/Paris, Berlin→Europe/Berlin, Shanghai→Asia/Shanghai, Singapore→Asia/Singapore, Sydney→Australia/Sydney, Dubai→Asia/Dubai, Toronto→America/Toronto

## Locale mappings
Korean/한국어→ko-KR, English→en-US, Deutsch/German→de-DE, Français/French→fr-FR, Español/Spanish→es-ES

Respond with ONLY a JSON object: {"intent":"...","lang":"...","provider":"...","field":"...","value":"...","feature":"...","ragProvider":"...","indexName":"...","embeddingModel":"..."}
"lang" is always required. Omit other fields that don't apply.`;

// ========================================
// IntentClassifier class
// ========================================

export class IntentClassifier {
  async getRecentHistory(sessionId: string): Promise<string> {
    try {
      const messages = await prisma.workflowAiAssistantMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { role: true, content: true },
      });

      if (messages.length === 0) return '';

      const sorted = messages.reverse();

      return sorted.map(m => {
        if (m.role === 'assistant') {
          try {
            const parsed = JSON.parse(m.content);
            if (parsed.type && parsed.action) {
              return `ASSISTANT: [action: ${parsed.action}, provider: ${parsed.provider || '-'}]`;
            }
            if (parsed.type === 'answer') {
              const msg = parsed.message || '';
              return `ASSISTANT: ${msg.substring(0, 100)}`;
            }
          } catch { /* not JSON, use as-is */ }
        }
        return `${m.role.toUpperCase()}: ${m.content.substring(0, 150)}`;
      }).join('\n');
    } catch {
      return '';
    }
  }

  async classify(
    provider: string,
    apiKey: string,
    userMessage: string,
    recentHistory: string,
    azureConfig?: AzureConfig
  ): Promise<ClassifiedIntent> {
    try {
      const classifierModel = azureConfig ? 'gpt-6-luna' : (CLASSIFIER_MODELS[provider] || CLASSIFIER_MODELS.openai);
      const client = createLLMClient(provider as any, apiKey, azureConfig);

      let userPrompt = '';
      if (recentHistory) {
        userPrompt += `## Recent conversation:\n${recentHistory}\n\n`;
      }
      userPrompt += `## Current message:\n${userMessage}`;

      const response = await client.chat(
        [
          { role: 'user', content: userPrompt },
        ],
        {
          model: classifierModel,
          temperature: 0,
          maxTokens: 100,
          systemMessage: CLASSIFIER_SYSTEM_PROMPT,
          responseFormat: 'json' as any,
        }
      );

      const content = response.content.trim();
      const parsed = JSON.parse(content) as ClassifiedIntent;

      const validIntents: IntentType[] = [
        'add_api_key', 'delete_api_key', 'check_api_key',
        'add_pinecone_key', 'pinecone_config',
        'change_rag', 'list_rag',
        'update_profile', 'change_email',
        'list_models', 'advanced_settings', 'other_settings',
        'add_telegram_bot', 'delete_telegram_bot',
        'add_slack_bot', 'delete_slack_bot',
        'follow_up_redirect', 'confirm_action', 'create_agent', 'create_workflow', 'edit_workflow', 'list_agents', 'none',
      ];

      if (!validIntents.includes(parsed.intent)) {
        console.warn(`[IntentClassifier] Unknown intent: ${parsed.intent}, falling back to none`);
        return { intent: 'none', lang: 'en' };
      }

      const validLangs: LangCode[] = ['ko', 'en', 'de', 'fr', 'es'];
      if (!parsed.lang || !validLangs.includes(parsed.lang)) {
        parsed.lang = 'en';
      }

      return parsed;
    } catch (error) {
      console.warn('[IntentClassifier] Classification failed, falling back to full LLM:', error);
      return { intent: 'none', lang: 'en' };
    }
  }
}
