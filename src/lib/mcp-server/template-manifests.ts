
import { REALTIME_VOICE_LOCALES } from '@/lib/call/voice-locales'
import type { TemplateManifest } from './template-params'

const TEXT_MODELS = [
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-6-luna',
  'gpt-6-sol',
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-5.1',
  'gpt-5.4-mini',
  'gpt-5.4',
]

const REALTIME_MODELS = ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini']

const REALTIME_VOICES = [
  'realtime:coral', 'realtime:sage', 'realtime:shimmer', 'realtime:ash',
  'realtime:ballad', 'realtime:echo', 'realtime:verse', 'realtime:alloy',
]

const REALTIME_LANGUAGES = REALTIME_VOICE_LOCALES.map((l) => l.value)

const QUIZ_LANGUAGES = ['en', 'de', 'fr', 'ko']

const QUIZ_STUDY_LENGTHS = ['none', 'short', 'standard', 'deep']

const QUIZ_TTS_LANGUAGES = [
  'en-US', 'en-GB', 'en-AU', 'en-IN', 'de-DE', 'fr-FR', 'fr-CA', 'es-ES', 'es-US', 'it-IT',
  'pt-BR', 'pt-PT', 'ko-KR', 'ja-JP', 'zh-CN', 'zh-TW', 'nl-NL', 'pl-PL', 'tr-TR', 'hi-IN',
  'vi-VN', 'th-TH', 'id-ID', 'ar', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'el-GR', 'uk-UA',
  'cs-CZ', 'hu-HU', 'ro-RO', 'he-IL',
]

export const TEMPLATE_MANIFESTS: Record<string, TemplateManifest> = {
  'text-generation': {
    templateId: 'text-generation',
    parameters: [
      {
        parameterId: 'system_message',
        label: 'AI instructions',
        description: 'System message that defines what the AI generates (tone, format, subject constraints).',
        type: 'string', targetNodeId: '2b3c4d5e-6f7a-4b2c-9d0e-1f2a3b4c5d6e', targetNodeType: 'ai',
        path: 'systemMessage', required: true,
      },
      {
        parameterId: 'model',
        label: 'AI model',
        description: 'Model used for generation.',
        type: 'enum', targetNodeId: '2b3c4d5e-6f7a-4b2c-9d0e-1f2a3b4c5d6e', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: TEXT_MODELS,
      },
    ],
  },

  'ai-chatbot-rag': {
    templateId: 'ai-chatbot-rag',
    parameters: [
      {
        parameterId: 'system_message',
        label: 'Chatbot instructions',
        description: 'System message defining the chatbot persona and how it should answer from the knowledge base.',
        type: 'string', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'systemMessage', required: true,
      },
      {
        parameterId: 'model',
        label: 'AI model',
        description: 'Model used to answer.',
        type: 'enum', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: TEXT_MODELS,
      },
    ],
  },

  'receipt-extraction': {
    templateId: 'receipt-extraction',
    parameters: [
      {
        parameterId: 'system_message',
        label: 'Extraction instructions',
        description: 'System message describing what to extract from uploaded receipts.',
        type: 'string', targetNodeId: '6714b8ca-98f6-40ef-9697-b33f5810c266', targetNodeType: 'ai',
        path: 'systemMessage', required: true,
      },
      {
        parameterId: 'model',
        label: 'AI model',
        description: 'Vision-capable model used for extraction.',
        type: 'enum', targetNodeId: '6714b8ca-98f6-40ef-9697-b33f5810c266', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: TEXT_MODELS,
      },
    ],
  },

  'daily-email-report': {
    templateId: 'daily-email-report',
    parameters: [
      {
        parameterId: 'report_instructions',
        label: 'Report instructions',
        description: 'System message describing what the daily report should cover (topics, sources, format).',
        type: 'string', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'systemMessage', required: true,
      },
      {
        parameterId: 'model',
        label: 'AI model',
        description: 'Model used to write the report.',
        type: 'enum', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: TEXT_MODELS,
      },
      {
        parameterId: 'to_email',
        label: 'Recipient email',
        description: 'Where the daily report is sent.',
        type: 'string', format: 'email', targetNodeId: 'sendgrid-1', targetNodeType: 'sendgrid',
        path: 'toEmail', required: true,
      },
      {
        parameterId: 'from_email',
        label: 'Sender email',
        description: 'Verified SendGrid sender address.',
        type: 'string', format: 'email', targetNodeId: 'sendgrid-1', targetNodeType: 'sendgrid',
        path: 'fromEmail', required: true,
      },
      {
        parameterId: 'from_name',
        label: 'Sender name',
        description: 'Display name on the report email.',
        type: 'string', targetNodeId: 'sendgrid-1', targetNodeType: 'sendgrid',
        path: 'fromName', required: false,
      },
      {
        parameterId: 'subject',
        label: 'Email subject',
        description: 'Subject line of the report email.',
        type: 'string', targetNodeId: 'sendgrid-1', targetNodeType: 'sendgrid',
        path: 'subject', required: true,
      },
      {
        parameterId: 'schedule_cron',
        label: 'Schedule (cron)',
        description: 'When the report runs, as a cron expression (e.g. "0 18 * * *" = daily 18:00).',
        type: 'string', format: 'cron', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'cronExpression', required: true,
      },
      {
        parameterId: 'schedule_timezone',
        label: 'Schedule timezone',
        description: 'IANA timezone for the schedule (e.g. "Europe/Zurich").',
        type: 'string', format: 'timezone', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'scheduleTimezone', required: true,
      },
      {
        parameterId: 'schedule_enabled',
        label: 'Schedule enabled',
        description: 'Whether the schedule actually fires (only runs while the workflow is deployed).',
        type: 'boolean', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'scheduleEnabled', required: false,
      },
      {
        parameterId: 'web_search_domains',
        label: 'Web search domains',
        description: 'Optional comma-separated domains to restrict the report web search (empty = whole web).',
        type: 'string', targetNodeId: 'tool-webSearch-1', targetNodeType: 'tool',
        path: 'webSearchDomains', required: false,
      },
    ],
  },

  'email-auto-classification': {
    templateId: 'email-auto-classification',
    parameters: [
      {
        parameterId: 'classification_instructions',
        label: 'Classification instructions',
        description: 'System message defining the email categories and how to classify.',
        type: 'string', targetNodeId: 'ai-loop-1', targetNodeType: 'ai',
        path: 'systemMessage', required: true,
      },
      {
        parameterId: 'model',
        label: 'AI model',
        description: 'Model used to classify emails.',
        type: 'enum', targetNodeId: 'ai-loop-1', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: TEXT_MODELS,
      },
      {
        parameterId: 'max_emails',
        label: 'Max emails per run',
        description: 'How many unread emails to process each run.',
        type: 'number', targetNodeId: 'imap-read-1', targetNodeType: 'imap',
        path: 'maxEmails', required: false, min: 1, max: 50,
      },
      {
        parameterId: 'support_forward_to',
        label: 'Support forward address',
        description: 'Where support emails are forwarded.',
        type: 'string', format: 'email', targetNodeId: 'smtp-forward-1', targetNodeType: 'smtp',
        path: 'to', required: true,
      },
      {
        parameterId: 'telegram_chat_id',
        label: 'Telegram chat ID',
        description: 'Chat that receives invoice notifications (Telegram connection is set up in Studio).',
        type: 'string', targetNodeId: 'telegram-1', targetNodeType: 'telegram',
        path: 'chatId', required: true,
      },
      {
        parameterId: 'schedule_cron',
        label: 'Schedule (cron)',
        description: 'How often the inbox is checked (e.g. "*/15 * * * *" = every 15 minutes).',
        type: 'string', format: 'cron', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'cronExpression', required: true,
      },
      {
        parameterId: 'schedule_enabled',
        label: 'Schedule enabled',
        description: 'Whether the schedule actually fires (only runs while the workflow is deployed).',
        type: 'boolean', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'scheduleEnabled', required: false,
      },
    ],
  },

  'ai-voice-assistant': {
    templateId: 'ai-voice-assistant',
    parameters: [
      {
        parameterId: 'system_message',
        label: 'Assistant instructions',
        description: 'What the voice assistant may say — company context, how to answer pricing questions, and the rule to answer only from the knowledge base.',
        type: 'string', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'systemMessage', required: true,
      },
      {
        parameterId: 'model',
        label: 'Realtime model',
        description: 'Speech-to-speech model. "gpt-realtime-2.1-mini" costs less per minute than the full models.',
        type: 'enum', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: REALTIME_MODELS,
      },
      {
        parameterId: 'greeting',
        label: 'Greeting',
        description: 'First sentence the assistant speaks when the call connects.',
        type: 'string', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'greeting', required: true,
      },
      {
        parameterId: 'goodbye_message',
        label: 'Goodbye message',
        description: 'Sentence spoken before hanging up.',
        type: 'string', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'goodbyeMessage', required: false,
      },
      {
        parameterId: 'language',
        label: 'Primary language',
        description: 'Locale the assistant starts in (it still follows the caller if they switch language).',
        type: 'enum', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'language', required: true, allowedValues: REALTIME_LANGUAGES,
      },
      {
        parameterId: 'voice_name',
        label: 'Voice',
        description: 'Realtime voice used for speech output.',
        type: 'enum', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'voiceName', required: true, allowedValues: REALTIME_VOICES,
      },
      {
        parameterId: 'end_call_phrase',
        label: 'End-call phrase',
        description: 'Word or phrase from the caller that ends the call (e.g. "goodbye").',
        type: 'string', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'endCallPhrase', required: false,
      },
    ],
  },

  'quiz-knowledge-check': {
    templateId: 'quiz-knowledge-check',
    parameters: [
      {
        parameterId: 'system_message',
        label: 'Quiz author instructions',
        description: 'What the quiz should cover, at what level, and how questions and explanations should be written.',
        type: 'string', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'systemMessage', required: true,
      },
      {
        parameterId: 'model',
        label: 'AI model',
        description: 'Model that writes the study section and the questions.',
        type: 'enum', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: TEXT_MODELS,
      },
      {
        parameterId: 'quiz_language',
        label: 'Quiz output language',
        description: 'Language of the question wording, choices and explanations.',
        type: 'enum', targetNodeId: 'miniapp-quiz-1', targetNodeType: 'miniapp',
        path: 'language', required: true, allowedValues: QUIZ_LANGUAGES,
      },
      {
        parameterId: 'study_length',
        label: 'Study material length',
        description: 'How much study text precedes the questions. "deep" uses noticeably more tokens per run.',
        type: 'enum', targetNodeId: 'miniapp-quiz-1', targetNodeType: 'miniapp',
        path: 'studyLength', required: true, allowedValues: QUIZ_STUDY_LENGTHS,
      },
      {
        parameterId: 'schedule_cron',
        label: 'Schedule (cron)',
        description: 'How often the quiz is generated (e.g. "0 9 * * *" = every day at 09:00).',
        type: 'string', format: 'cron', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'cronExpression', required: true,
      },
      {
        parameterId: 'schedule_timezone',
        label: 'Schedule timezone',
        description: 'IANA timezone the schedule runs in (e.g. "Europe/Zurich").',
        type: 'string', format: 'timezone', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'scheduleTimezone', required: true,
      },
      {
        parameterId: 'schedule_enabled',
        label: 'Schedule enabled',
        description: 'Whether the schedule actually fires. Ships as false — turn it on only when the knowledge base and team members are ready (each run costs CPA).',
        type: 'boolean', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'scheduleEnabled', required: false,
      },
    ],
  },

  'quiz-language-learning': {
    templateId: 'quiz-language-learning',
    parameters: [
      {
        parameterId: 'system_message',
        label: 'Quiz author instructions',
        description: 'What the quiz should cover, at what level, and how questions and explanations should be written.',
        type: 'string', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'systemMessage', required: true,
      },
      {
        parameterId: 'model',
        label: 'AI model',
        description: 'Model that writes the study section and the questions.',
        type: 'enum', targetNodeId: 'ai-1', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: TEXT_MODELS,
      },
      {
        parameterId: 'quiz_language',
        label: 'Quiz output language',
        description: 'Language of the question wording, choices and explanations.',
        type: 'enum', targetNodeId: 'miniapp-quiz-1', targetNodeType: 'miniapp',
        path: 'language', required: true, allowedValues: QUIZ_LANGUAGES,
      },
      {
        parameterId: 'study_length',
        label: 'Study material length',
        description: 'How much study text precedes the questions. "deep" uses noticeably more tokens per run.',
        type: 'enum', targetNodeId: 'miniapp-quiz-1', targetNodeType: 'miniapp',
        path: 'studyLength', required: true, allowedValues: QUIZ_STUDY_LENGTHS,
      },
      {
        parameterId: 'pronunciation_language',
        label: 'Pronunciation language',
        description: 'Language used for the 🔊 pronunciation playback in the app. Set this to the language being taught.',
        type: 'enum', targetNodeId: 'miniapp-quiz-1', targetNodeType: 'miniapp',
        path: 'ttsLanguage', required: true, allowedValues: QUIZ_TTS_LANGUAGES,
      },
      {
        parameterId: 'schedule_cron',
        label: 'Schedule (cron)',
        description: 'How often the quiz is generated (e.g. "0 9 * * *" = every day at 09:00).',
        type: 'string', format: 'cron', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'cronExpression', required: true,
      },
      {
        parameterId: 'schedule_timezone',
        label: 'Schedule timezone',
        description: 'IANA timezone the schedule runs in (e.g. "Europe/Zurich").',
        type: 'string', format: 'timezone', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'scheduleTimezone', required: true,
      },
      {
        parameterId: 'schedule_enabled',
        label: 'Schedule enabled',
        description: 'Whether the schedule actually fires. Ships as false — turn it on only when the knowledge base and team members are ready (each run costs CPA).',
        type: 'boolean', targetNodeId: 'start-1', targetNodeType: 'start',
        path: 'scheduleEnabled', required: false,
      },
    ],
  },

  'trading212-portfolio-tracker': {
    templateId: 'trading212-portfolio-tracker',
    parameters: [
      {
        parameterId: 'model',
        label: 'AI model',
        description: 'Model used to format portfolio data.',
        type: 'enum', targetNodeId: 'ai-format-1', targetNodeType: 'ai',
        path: 'model', required: true, allowedValues: TEXT_MODELS,
      },
    ],
  },
}

export const NOT_CREATABLE: Record<string, string> = {
  'bank-csv-parser':
    'This template requires automatic Data Sheet provisioning, which is not yet supported over MCP. Create it from the AiTalk web app instead.',
  'voice-quiz-reward':
    'This template creates several workflows plus a data sheet in one go, which is not yet supported over MCP. Create it from the AiTalk web app instead.',
}
