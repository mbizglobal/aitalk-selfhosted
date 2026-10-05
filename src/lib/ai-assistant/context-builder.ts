
import { prisma } from '@/lib/prisma';
import { decryptData } from '@/lib/encryption';
import { buildCodexContext, generateCodexPrompt, TemplateSource } from '@/lib/codex-lib';
import {
  buildContextPrompt,
  buildDynamicGeneralPrompt,
  formatMcpSection,
  formatDataSheetSection,
  AIAssistantContext,
  McpConnectionInfo,
  WorkflowNodeDetection,
  CONTEXT_INSTRUCTIONS,
} from '@/lib/codex-lib/context-instructions';
import { McpClient } from '@/lib/workflow/nodes/mcp';
import { userScopedWhere } from '@/lib/connection-scope';
import { isSelfHosted } from '@/lib/edition';

export async function listMcpToolsAndClose(
  client: Pick<McpClient, 'initialize' | 'listTools' | 'close'>
): Promise<Array<{ name: string; description: string; inputSchema?: any }>> {
  try {
    await client.initialize();
    const mcpTools = await client.listTools();
    return mcpTools.map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema,
    }));
  } catch {
    return [];
  } finally {
    try { await client.close(); } catch { }
  }
}

// ========================================
// ========================================

export interface ContextBuilderRequest {
  userId: string;
  prompt: string;
  context?: AIAssistantContext;
  agentId?: string;
  existingWorkflow?: { nodes: any[]; edges: any[] };
  nodeId?: string;
  dataSheetId?: string;
  mcpConnectionId?: string;
  providerStatus?: Record<string, boolean>;
  templateSource: TemplateSource;
  isFollowUp?: boolean;
  nodeDetection?: WorkflowNodeDetection;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

// ========================================
// ========================================

export class ContextBuilder {
  async build(request: ContextBuilderRequest): Promise<BuiltPrompt> {
    if (request.context === 'bot') {
      return this.buildBotPrompt(request);
    }
    if (request.context === 'dashboard') {
      return this.buildDashboardPrompt(request);
    }
    return this.buildStudioPrompt(request);
  }

  private async buildBotPrompt(request: ContextBuilderRequest): Promise<BuiltPrompt> {
    let systemPrompt = CONTEXT_INSTRUCTIONS['bot'] || '';

    if (request.providerStatus) {
      const providerNames: Record<string, string> = {
        openai: 'OpenAI', gemini: 'Google Gemini', claude: 'Anthropic Claude',
        deepseek: 'DeepSeek', grok: 'xAI Grok', mistral: 'Mistral AI'
      };
      const statusLines = Object.entries(providerNames).map(([id, name]) => {
        const hasKey = request.providerStatus![id];
        return `- ${name}: ${hasKey ? '\u2705 Configured' : '\u274C Not configured'}`;
      });
      systemPrompt += `\n\n### Current AI Provider API Key Status\n${statusLines.join('\n')}\n`;
    }

    systemPrompt += await this.injectRagStatus(request.userId);

    systemPrompt += await this.injectProfileStatus(request.userId);

    if (request.agentId) {
      systemPrompt += await this.injectWorkflowList(request.agentId, request.userId);
    }

    const userPrompt = request.prompt
      + '\n\n[Respond in JSON: {"type":"answer"|"question", "message":"your response here"}. ONLY use "answer" or "question" types.]';

    return { systemPrompt, userPrompt };
  }

  private async buildDashboardPrompt(request: ContextBuilderRequest): Promise<BuiltPrompt> {
    let contextInstruction = await this.buildSpecificContext(request);

    if (request.providerStatus) {
      const providerNames: Record<string, string> = {
        openai: 'OpenAI', gemini: 'Google Gemini', claude: 'Anthropic Claude',
        deepseek: 'DeepSeek', grok: 'xAI Grok', mistral: 'Mistral AI'
      };
      const statusLines = Object.entries(providerNames).map(([id, name]) => {
        const hasKey = request.providerStatus![id];
        return `- ${name}: ${hasKey ? '\u2705 Configured' : '\u274C Not configured'}`;
      });
      contextInstruction += `\n\n### Current AI Provider API Key Status\n${statusLines.join('\n')}\n`;
    }

    contextInstruction += await this.injectRagStatus(request.userId);

    contextInstruction += await this.injectProfileStatus(request.userId);

    if (request.agentId) {
      contextInstruction += await this.injectWorkflowList(request.agentId, request.userId);
    }

    let systemPrompt = contextInstruction;
    if (request.existingWorkflow && request.existingWorkflow.nodes?.length > 0) {
      systemPrompt += `\n\n## Current Workflow State (${request.existingWorkflow.nodes.length} nodes, for analysis reference only - do NOT generate workflow)\n\n`;
      systemPrompt += '```json\n' + JSON.stringify(request.existingWorkflow, null, 2) + '\n```';
    }

    const userPrompt = request.prompt
      + '\n\n[Respond in JSON: {"type":"answer"|"question"|"settings_action"|"workflow_action", "message":"your response here"}. NEVER use type "workflow" or "modification".]';

    return { systemPrompt, userPrompt };
  }

  private async buildStudioPrompt(request: ContextBuilderRequest): Promise<BuiltPrompt> {
    const codexContext = await buildCodexContext(
      request.prompt,
      request.existingWorkflow,
      false,
      request.templateSource
    );
    const fullContextPrompt = generateCodexPrompt(codexContext);

    let contextInstruction = '';
    if (request.context) {
      if (request.context === 'general') {
        contextInstruction = buildDynamicGeneralPrompt(request.prompt, request.existingWorkflow, request.nodeDetection);
      } else {
        contextInstruction = await this.buildSpecificContext(request);
      }
    }

    const systemPrompt = contextInstruction
      ? contextInstruction + '\n\n---\n\n' + fullContextPrompt
      : fullContextPrompt;

    let userPrompt = request.prompt;
    if (request.existingWorkflow && request.existingWorkflow.nodes?.length > 0) {
      userPrompt = `## Current Workflow State (${request.existingWorkflow.nodes.length} nodes)\n\n`;
      userPrompt += '```json\n' + JSON.stringify(request.existingWorkflow, null, 2) + '\n```\n\n';
      userPrompt += `## User Request\n\n${request.prompt}`;
    }

    return { systemPrompt, userPrompt };
  }

  private async buildSpecificContext(request: ContextBuilderRequest): Promise<string> {
    if (!request.context) return '';

    if (request.context === 'general') return '';

    // Data Sheet context
    let dataSheetInfo: { id: string; name: string; schema: any } | undefined;
    if (request.context === 'dataSheet' && request.dataSheetId) {
      try {
        const sheet = await prisma.dataSheet.findFirst({
          where: {
            id: request.dataSheetId,
            agent: { userId: request.userId },
            ...(request.agentId ? { agentId: request.agentId } : {}),
          },
          select: { id: true, name: true, schema: true }
        });
        if (sheet) {
          dataSheetInfo = {
            id: sheet.id,
            name: sheet.name,
            schema: JSON.parse(sheet.schema)
          };
        }
      } catch (err) {
        console.error('Failed to fetch Data Sheet for context:', err);
      }
    }

    // MCP context
    let mcpInfo: McpConnectionInfo | undefined;
    if (request.context === 'mcp') {
      mcpInfo = await this.fetchMcpInfo(request);
    }

    return buildContextPrompt(
      request.context,
      request.nodeId,
      request.existingWorkflow,
      dataSheetInfo,
      mcpInfo
    ) || '';
  }

  private async fetchMcpInfo(request: ContextBuilderRequest): Promise<McpConnectionInfo | undefined> {
    let connectionId = request.mcpConnectionId;
    if (!connectionId && request.nodeId && request.existingWorkflow?.nodes) {
      const node = request.existingWorkflow.nodes.find(n => n.id === request.nodeId);
      connectionId = node?.data?.mcpConnectionId;
    }

    if (!connectionId) return undefined;

    try {
      const connection = await prisma.workflowConnection.findFirst({
        where: {
          id: connectionId,
          ...userScopedWhere(request, 'AI Assistant MCP Context'),
          status: 'active',
        },
        select: {
          id: true,
          provider: true,
          label: true,
          description: true,
          serverUrl: true,
          status: true,
          encryptedToken: true,
        }
      });

      if (!connection || !connection.serverUrl) return undefined;

      let accessToken: string | null = null;
      if (connection.encryptedToken) {
        try {
          accessToken = await decryptData(connection.encryptedToken);
        } catch {
        }
      }

      const tools = await listMcpToolsAndClose(new McpClient(connection.serverUrl, accessToken));

      console.log(`[ContextBuilder] MCP info loaded: ${connection.label} (${tools.length} tools)`);

      return {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        description: connection.description || undefined,
        serverUrl: connection.serverUrl,
        status: connection.status,
        tools,
      };
    } catch (err) {
      console.error('Failed to fetch MCP connection for context:', err);
      return undefined;
    }
  }

  private async injectAgentInfo(agentId: string): Promise<string> {
    try {
      const agent = await prisma.agent.findFirst({
        where: { agentId },
        select: { agentId: true, title: true }
      });
      if (!agent) return '';
      return agent.title;
    } catch {
      return '';
    }
  }

  private async injectWorkflowList(agentId: string, userId: string): Promise<string> {
    try {
      const workflows = await prisma.workflow.findMany({
        where: { agentId },
        orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
        select: { workflowId: true, name: true, status: true, updatedAt: true }
      });

      const selfHosted = isSelfHosted();
      const user = selfHosted ? null : await prisma.user.findUnique({
        where: { id: userId },
        select: { subscription: { select: { status: true, planType: true } } }
      });
      const isPaid = selfHosted || (user?.subscription?.planType !== 'free' && user?.subscription?.status === 'active');
      const maxWorkflows = isPaid ? 'unlimited' : '10';
      let maxProduction = '1';
      if (selfHosted) maxProduction = 'unlimited';
      else if (isPaid) {
        const plan = user?.subscription?.planType || '';
        if (plan.includes('pro')) maxProduction = '40';
        else if (plan.includes('growth')) maxProduction = '30';
        else if (plan.includes('standard')) maxProduction = '20';
        else maxProduction = '10';
      }

      let result = `\n\n### Current Workflows\n`;
      if (workflows.length === 0) {
        result += `- No workflows yet\n`;
      } else {
        for (const wf of workflows) {
          result += `- "${wf.name}" (${wf.status}) - ${wf.workflowId}\n`;
        }
      }
      result += `- Total: ${workflows.length} workflows (limit: ${maxWorkflows}, production limit: ${maxProduction})\n`;

      return result;
    } catch {
      return '';
    }
  }

  private async injectRagStatus(userId: string): Promise<string> {
    try {
      const ragProviders = await prisma.ragProviders.findUnique({
        where: { id: userId },
        select: { defaultProvider: true, providers: true }
      });
      let pineconeStatus = '\u274C Not configured';
      if (ragProviders?.providers) {
        try {
          const parsed = typeof ragProviders.providers === 'string'
            ? JSON.parse(ragProviders.providers)
            : ragProviders.providers;
          if (parsed?.pinecone) {
            const hasKey = !!parsed.pinecone.apiKey;
            const hasIndex = !!parsed.pinecone.indexName;
            if (hasKey && hasIndex) {
              pineconeStatus = `\u2705 Configured (API Key: \u2705, Index: ${parsed.pinecone.indexName}, Model: ${parsed.pinecone.embeddingModel || 'N/A'})`;
            } else if (hasKey) {
              pineconeStatus = `\u26A0\uFE0F Partial (API Key: \u2705, Index Name: \u274C not set yet)`;
            } else {
              pineconeStatus = '\u274C Not configured (API Key not set)';
            }
          }
        } catch {
          // ignore parse error
        }
      }
      let result = `\n\n### Current RAG Provider Status\n`;
      result += `- Default: ${ragProviders?.defaultProvider || 'none'}\n`;
      result += `- Pinecone: ${pineconeStatus}\n`;
      result += `- Valid RAG provider values for set_rag_provider action:\n`;
      result += `  * none → Disable RAG\n`;
      result += `  * openai_vector_store → OpenAI Vector Store (requires OpenAI API key)\n`;
      result += `  * gemini_file_search → Google Gemini File Search (requires Gemini API key)\n`;
      result += `  * pinecone → Pinecone (requires Pinecone API key + index config)\n`;
      return result;
    } catch {
      return '';
    }
  }

  async enrichWithLiveData(
    scope: { userId: string; agentId?: string },
    mcpConnectionIds: string[],
    dataSheetIds: string[]
  ): Promise<string> {
    let enriched = '';

    if (mcpConnectionIds.length > 0) {
      try {
        const mcpInfo = await this.fetchMcpInfo({
          userId: scope.userId,
          agentId: scope.agentId,
          mcpConnectionId: mcpConnectionIds[0],
        } as ContextBuilderRequest);

        if (mcpInfo) {
          enriched += formatMcpSection(mcpInfo);
        }
      } catch (err) {
        console.error('[ContextBuilder] enrichWithLiveData MCP failed:', err);
      }
    }

    if (dataSheetIds.length > 0) {
      try {
        const sheet = await prisma.dataSheet.findFirst({
          where: {
            id: dataSheetIds[0],
            agent: { userId: scope.userId },
            ...(scope.agentId ? { agentId: scope.agentId } : {}),
          },
          select: { id: true, name: true, schema: true }
        });

        if (sheet) {
          enriched += formatDataSheetSection({
            id: sheet.id,
            name: sheet.name,
            schema: JSON.parse(sheet.schema),
          });
        }
      } catch (err) {
        console.error('[ContextBuilder] enrichWithLiveData DataSheet failed:', err);
      }
    }

    return enriched;
  }

  private async injectProfileStatus(userId: string): Promise<string> {
    try {
      const userSettings = await prisma.settings.findUnique({
        where: { id: userId }, select: { timezone: true, locale: true, time_format: true }
      });
      const userInfo = await prisma.user.findUnique({
        where: { id: userId }, select: { name: true, email: true, password: true }
      });
      const isGoogleUser = !userInfo?.password;
      let result = `\n\n### Current Profile (UI settings only - does NOT determine your response language)\n`;
      result += `- Name: ${userInfo?.name || 'Not set'}\n`;
      result += `- Email: ${userInfo?.email || 'Not set'}${isGoogleUser ? ' (Google account - email cannot be changed)' : ' (can be changed)'}\n`;
      result += `- Timezone: ${userSettings?.timezone || 'UTC'}\n`;
      result += `- UI Language (locale): ${userSettings?.locale || 'en-US'}\n`;
      result += `- Date/Time Format: ${userSettings?.time_format || 'DD.MM.YYYY HH:mm'}\n`;
      return result;
    } catch {
      return '';
    }
  }
}
