
import type { AIAssistantContext } from '@/lib/codex-lib/context-instructions';

// ========================================
// ========================================

export interface ParsedResponse {
  type: string;
  message: string;
  // settings_action
  action?: string;
  value?: any;
  provider?: string;
  // modification
  changes?: any[];
  dataSheetChanges?: any[];
  // workflow
  nodes?: any[];
  edges?: any[];
  // confirmation
  preview?: any;
  explanation?: string;
  description?: string;
  summary?: string;
  content?: string;
  [key: string]: any;
}

// ========================================
// ========================================

export function tryRepairJson(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch {
  }

  let repaired = jsonStr.trim();

  const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    repaired += '"';
  }

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    const prevChar = i > 0 ? repaired[i - 1] : '';

    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    } else if (!inString) {
      if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
    }
  }

  while (openBrackets > 0) {
    repaired += ']';
    openBrackets--;
  }

  while (openBraces > 0) {
    repaired += '}';
    openBraces--;
  }

  try {
    return JSON.parse(repaired);
  } catch {
    const lastComma = repaired.lastIndexOf(',');
    if (lastComma > 0) {
      const beforeComma = repaired.substring(0, lastComma);
      let finalRepair = beforeComma;
      openBraces = 0;
      openBrackets = 0;
      inString = false;

      for (let i = 0; i < finalRepair.length; i++) {
        const char = finalRepair[i];
        const prevChar = i > 0 ? finalRepair[i - 1] : '';

        if (char === '"' && prevChar !== '\\') {
          inString = !inString;
        } else if (!inString) {
          if (char === '{') openBraces++;
          else if (char === '}') openBraces--;
          else if (char === '[') openBrackets++;
          else if (char === ']') openBrackets--;
        }
      }

      while (openBrackets > 0) {
        finalRepair += ']';
        openBrackets--;
      }
      while (openBraces > 0) {
        finalRepair += '}';
        openBraces--;
      }

      try {
        return JSON.parse(finalRepair);
      } catch {
      }
    }
  }

  return null;
}

// ========================================
// ========================================

export class ResponseParser {
  parse(rawText: string, context?: AIAssistantContext): ParsedResponse {
    if (!rawText || rawText.trim().length === 0) {
      throw new Error('Codex returned empty response. Please try again.');
    }

    let cleanJson = rawText.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*\n/, '').replace(/\n```\s*$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*\n/, '').replace(/\n```\s*$/, '');
    }

    let parsed = tryRepairJson(cleanJson);
    if (!parsed) {
      if (cleanJson.length >= 10 && !cleanJson.startsWith('{') && !cleanJson.startsWith('[')) {
        console.warn('[ResponseParser] Plain text response detected, wrapping as answer:', cleanJson.substring(0, 100));
        return { type: 'answer', message: cleanJson };
      }
      throw new Error(`Failed to parse JSON response. Response may be incomplete (length: ${cleanJson.length})`);
    }

    let type = parsed.type || 'workflow';

    if (context === 'dashboard') {
      type = this.enforceDashboardTypes(type, parsed);
    }

    if (context === 'bot') {
      type = this.enforceBotTypes(type, parsed);
    }

    return { ...parsed, type, message: parsed.message || '' };
  }

  private enforceDashboardTypes(type: string, parsed: any): string {
    if (type === 'modification' || type === 'workflow' || type === 'confirmation') {
      console.warn(`[ResponseParser] Dashboard context: converting '${type}' to 'answer'`);
      if (!parsed.message) {
        parsed.message = parsed.explanation
          || parsed.description
          || parsed.summary
          || (typeof parsed.content === 'string' ? parsed.content : null)
          || (parsed.changes?.length > 0
            ? `The AI suggested ${parsed.changes.length} change(s). To apply modifications, please use Agent Studio.`
            : 'I\'m sorry, I couldn\'t process your request properly. Could you please rephrase your question?');
      }
      return 'answer';
    }
    return type;
  }

  private enforceBotTypes(type: string, parsed: any): string {
    if (type !== 'answer' && type !== 'question') {
      console.warn(`[ResponseParser] Bot context: converting '${type}' to 'answer'`);
      if (!parsed.message) {
        parsed.message = parsed.explanation
          || parsed.description
          || parsed.summary
          || (typeof parsed.content === 'string' ? parsed.content : null)
          || 'I\'m sorry, I couldn\'t process your request properly. Could you please rephrase your question?';
      }
      return 'answer';
    }
    return type;
  }
}
