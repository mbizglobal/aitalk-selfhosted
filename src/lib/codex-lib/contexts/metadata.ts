/**
 * Context Metadata
 * Defines keywords, labels, and descriptions for each context
 *
 * NOTE: When adding a new node/context:
 * 1. Add entry to CONTEXT_METADATA below
 * 2. Create context file (e.g., newNode.ts)
 * 3. Export from index.ts
 * That's it! general.ts will auto-update.
 *
 * LANGUAGE: Keywords are English-only.
 * AI handles translation for non-English user queries.
 */

// Context type definition (duplicated here to avoid circular import)
export type AIAssistantContext =
  | 'general'
  | 'systemMessage'
  | 'modelSettings'
  | 'tools'
  | 'jsonSchema'
  | 'jsonOptions'
  | 'dataSheet'
  | 'whileLoop'
  | 'whileTools'
  | 'sendgridBody'
  | 'mcp'
  | 'webSearch'
  | 'source'
  | 'imap'
  | 'smtp'
  | 'telegram'
  | 'ifElse'
  | 'httpRequest'
  | 'widget'
  | 'template'
  | 'team'
  | 'knowledge'
  | 'dashboard'
  | 'bot';

/**
 * Context Metadata
 * - keywords: Used for dynamic context detection (English only)
 * - label: Display name
 * - description: Brief description (shown in general context)
 * - category: Grouping for display
 */
export const CONTEXT_METADATA: Record<Exclude<AIAssistantContext, 'general'>, {
  keywords: string[];
  label: string;
  description: string;
  category: 'core' | 'tools' | 'integration' | 'other';
}> = {
  systemMessage: {
    keywords: ['system message', 'prompt', 'instruction', 'role', 'persona'],
    label: 'System Message',
    description: 'Configure AI role and instructions, auto-generate prompts',
    category: 'core',
  },
  jsonSchema: {
    keywords: ['json schema', 'schema', 'output format', 'structured output', 'json output'],
    label: 'JSON Schema',
    description: 'Define AI output format, auto-generate schemas',
    category: 'core',
  },
  modelSettings: {
    keywords: ['model', 'temperature', 'token', 'max token', 'gpt', 'claude', 'gemini', 'mistral', 'provider'],
    label: 'Model Settings',
    description: 'Select model, configure temperature and max tokens',
    category: 'core',
  },
  dataSheet: {
    keywords: ['data sheet', 'column', 'storage', 'table', 'database', 'save data'],
    label: 'Data Sheet',
    description: 'Data storage, add/modify/delete columns',
    category: 'core',
  },
  whileLoop: {
    keywords: ['while', 'loop', 'foreach', 'for each', 'iteration', 'repeat', 'array loop'],
    label: 'While Loop',
    description: 'Condition-based loop (While) and array iteration (ForEach)',
    category: 'core',
  },
  whileTools: {
    keywords: ['loop tool', 'while tool', 'tool in loop', 'iteration tool'],
    label: 'While Tools',
    description: 'Configure AI node tools inside loops, cost optimization',
    category: 'core',
  },
  tools: {
    keywords: ['tool', 'ai tool', 'select tool', 'enable tool', 'apps tool', 'function calling tool'],
    label: 'Tools',
    description: 'Select tools for AI node (Source, WebSearch, MCP, SendGrid, Telegram, SMTP)',
    category: 'tools',
  },
  source: {
    keywords: ['source', 'file upload', 'rag', 'pinecone', 'embedding', 'vector', 'document'],
    label: 'Source (RAG)',
    description: 'File upload, RAG search, Pinecone vector DB',
    category: 'tools',
  },
  webSearch: {
    keywords: ['web search', 'search', 'google', 'domain filter', 'internet search'],
    label: 'Web Search',
    description: 'Real-time web search, domain filtering',
    category: 'tools',
  },
  mcp: {
    keywords: ['mcp', 'notion', 'slack', 'github', 'external service', 'integration'],
    label: 'MCP',
    description: 'Connect external services (Notion, Telegram, Slack)',
    category: 'tools',
  },
  imap: {
    keywords: ['imap', 'email', 'inbox', 'read email', 'folder', 'oauth', 'mail'],
    label: 'IMAP',
    description: 'Read emails, move to folders, OAuth2 authentication',
    category: 'integration',
  },
  smtp: {
    keywords: ['smtp', 'send email', 'outgoing mail', 'mail server', 'email send'],
    label: 'SMTP',
    description: 'Send emails via SMTP, configure mail server',
    category: 'integration',
  },
  telegram: {
    keywords: ['telegram', 'bot', 'chat', 'message', 'notification', 'send message'],
    label: 'Telegram',
    description: 'Send Telegram messages, bot configuration',
    category: 'integration',
  },
  ifElse: {
    keywords: ['if', 'else', 'condition', 'branch', 'compare', 'conditional'],
    label: 'If/Else',
    description: 'Conditional branching, compare values, operators',
    category: 'core',
  },
  httpRequest: {
    keywords: ['http', 'api', 'rest', 'request', 'url', 'endpoint', 'get', 'post', 'put', 'delete', 'bearer', 'authentication'],
    label: 'HTTP Request',
    description: 'HTTP API calls, authentication, presets',
    category: 'integration',
  },
  sendgridBody: {
    keywords: ['sendgrid', 'email template', 'html email', 'send email', 'email body'],
    label: 'SendGrid',
    description: 'Send emails, create HTML templates',
    category: 'integration',
  },
  widget: {
    keywords: ['widget', 'embed', 'chatbot', 'website', 'iframe'],
    label: 'Widget',
    description: 'Website embed, chatbot widget configuration',
    category: 'other',
  },
  template: {
    keywords: ['template', 'preset', 'workflow template', 'save workflow'],
    label: 'Template',
    description: 'Save/load workflow templates',
    category: 'other',
  },
  team: {
    keywords: ['team', 'agent', 'multi-agent', 'collaboration', 'crew'],
    label: 'Team',
    description: 'Multi-agent collaboration settings',
    category: 'other',
  },
  knowledge: {
    keywords: ['knowledge', 'knowledge base', 'document', 'kb'],
    label: 'Knowledge Base',
    description: 'Manage knowledge base, upload documents',
    category: 'other',
  },
  jsonOptions: {
    keywords: ['json option', 'strict', 'additional properties'],
    label: 'JSON Options',
    description: 'JSON schema options (strict mode, etc.)',
    category: 'other',
  },
  dashboard: {
    keywords: ['dashboard', 'overview', 'agent overview', 'workflow summary'],
    label: 'Dashboard',
    description: 'Dashboard AI Assistant for workflow analysis and guidance',
    category: 'other',
  },
  bot: {
    keywords: ['bot', 'telegram', 'messaging', 'chat bot'],
    label: 'Bot',
    description: 'Bot channel AI Assistant (Telegram, etc.)',
    category: 'other',
  },
};
