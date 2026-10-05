/**
 * AI Assistant Context Instructions
 * All context-specific instructions for Codex
 */

// Re-export metadata and type
export { CONTEXT_METADATA, type AIAssistantContext } from './metadata';

// Import all contexts
export { generalContext } from './general';
export { systemMessageContext } from './systemMessage';
export { jsonSchemaContext } from './jsonSchema';
export { modelSettingsContext } from './modelSettings';
export { toolsContext } from './tools';
export { dataSheetContext } from './dataSheet';
export { whileLoopContext } from './whileLoop';
export { whileToolsContext } from './whileTools';
export { sendgridBodyContext } from './sendgridBody';
export { mcpContext } from './mcp';
export { webSearchContext } from './webSearch';
export { sourceContext } from './source';
export { jsonOptionsContext } from './jsonOptions';
export { imapContext } from './imap';
export { smtpContext } from './smtp';
export { telegramContext } from './telegram';
export { ifElseContext } from './ifElse';
export { httpRequestContext } from './httpRequest';
export { dashboardContext } from './dashboard';
export { botContext } from './bot';
// TODO: Create these context files when needed
// export { widgetContext } from './widget';
// export { templateContext } from './template';
// export { teamContext } from './team';
// export { knowledgeContext } from './knowledge';

// Import for aggregation
import { type AIAssistantContext } from './metadata';
import { generalContext } from './general';
import { systemMessageContext } from './systemMessage';
import { jsonSchemaContext } from './jsonSchema';
import { modelSettingsContext } from './modelSettings';
import { toolsContext } from './tools';
import { dataSheetContext } from './dataSheet';
import { whileLoopContext } from './whileLoop';
import { whileToolsContext } from './whileTools';
import { sendgridBodyContext } from './sendgridBody';
import { mcpContext } from './mcp';
import { webSearchContext } from './webSearch';
import { sourceContext } from './source';
import { jsonOptionsContext } from './jsonOptions';
import { imapContext } from './imap';
import { smtpContext } from './smtp';
import { telegramContext } from './telegram';
import { ifElseContext } from './ifElse';
import { httpRequestContext } from './httpRequest';
import { dashboardContext } from './dashboard';
import { botContext } from './bot';

// Placeholder for missing context files
const placeholderContext = (name: string) =>
  `## Context: ${name}\n\nThis context is not yet implemented. Please select a specific node for detailed help.`;

// Aggregated context instructions
export const CONTEXT_INSTRUCTIONS: Record<AIAssistantContext, string> = {
  general: generalContext,
  systemMessage: systemMessageContext,
  jsonSchema: jsonSchemaContext,
  modelSettings: modelSettingsContext,
  tools: toolsContext,
  dataSheet: dataSheetContext,
  whileLoop: whileLoopContext,
  whileTools: whileToolsContext,
  sendgridBody: sendgridBodyContext,
  mcp: mcpContext,
  webSearch: webSearchContext,
  source: sourceContext,
  jsonOptions: jsonOptionsContext,
  imap: imapContext,
  smtp: smtpContext,
  telegram: telegramContext,
  ifElse: ifElseContext,
  httpRequest: httpRequestContext,
  dashboard: dashboardContext,
  bot: botContext,
  // TODO: Create these context files when needed
  widget: placeholderContext('Widget'),
  template: placeholderContext('Template'),
  team: placeholderContext('Team'),
  knowledge: placeholderContext('Knowledge Base'),
};
