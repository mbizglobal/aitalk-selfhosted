
import type { ParsedResponse } from './response-parser';

// ========================================
// ========================================

export interface ActionContext {
  userId: string;
  agentId?: string;
}

export interface ActionResult {
  type: string;
  action?: string;
  value?: any;
  provider?: string;
  message: string;
  changes?: any[];
  dataSheetChanges?: any[];
  workflow?: { nodes: any[]; edges: any[] };
  preview?: any;
}

export interface ActionHandler {
  canHandle(parsed: ParsedResponse): boolean;
  execute(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult>;
}

// ========================================
// ========================================

export class ActionRegistry {
  private handlers: ActionHandler[] = [];

  register(handler: ActionHandler): void {
    this.handlers.push(handler);
  }

  canHandle(parsed: ParsedResponse): boolean {
    return this.handlers.some(h => h.canHandle(parsed));
  }

  async execute(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    const handler = this.handlers.find(h => h.canHandle(parsed));
    if (!handler) {
      throw new Error(`No handler found for action: ${parsed.type}/${parsed.action}`);
    }
    return handler.execute(parsed, context);
  }
}
