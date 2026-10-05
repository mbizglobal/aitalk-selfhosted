/**
 * AI Assistant Engine Types
 */

import type { AIAssistantContext } from '@/lib/codex-lib/context-instructions';
import type { TemplateSource } from '@/lib/codex-lib';

export interface EngineRequest {
  // Required
  userId: string;
  prompt: string;
  provider: string;
  model: string;
  apiKey: string;

  // Managed (Azure OpenAI)
  azureConfig?: { endpoint: string; apiVersion: string };

  // Context
  context?: AIAssistantContext;
  agentId?: string;
  workflowId?: string;
  existingWorkflow?: { nodes: any[]; edges: any[] };
  nodeId?: string;

  // Session
  sessionId?: string;
  isFollowUp?: boolean;

  // Dashboard only
  providerStatus?: Record<string, boolean>;
  dataSheetId?: string;
  mcpConnectionId?: string;

  // Meta
  templateSource: TemplateSource;
}

export interface EngineResponse {
  sessionId: string;
  type: string;
  message: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
    pricing: { input: number; cachedInput?: number; output: number };
  };

  // Type-specific fields
  action?: string;
  value?: any;
  provider?: string;
  changes?: any[];
  dataSheetChanges?: any[];
  workflow?: { nodes: any[]; edges: any[] };
  preview?: any;
}
