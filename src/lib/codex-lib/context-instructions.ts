/**
 * AI Assistant Context-aware Instructions
 * Context-specific instructions for AI Assistant
 *
 * Each context is defined in a separate file under ./contexts/
 * See docs/as/context-mapping.md for context ↔ node/modal mapping
 */

// Re-export everything from contexts
export {
  type AIAssistantContext,
  CONTEXT_INSTRUCTIONS,
  generalContext,
  systemMessageContext,
  jsonSchemaContext,
  modelSettingsContext,
  toolsContext,
  dataSheetContext,
  whileLoopContext,
  whileToolsContext,
  sendgridBodyContext,
  widgetContext,
  mcpContext,
  webSearchContext,
  sourceContext,
  templateContext,
  teamContext,
  knowledgeContext,
  jsonOptionsContext,
  imapContext,
  dashboardContext,
} from './contexts';

import { type AIAssistantContext, CONTEXT_INSTRUCTIONS } from './contexts';
import { CONTEXT_METADATA } from './contexts/metadata';

// Re-export for external use
export { CONTEXT_METADATA } from './contexts/metadata';

const CONTEXT_KEYWORDS: Record<Exclude<AIAssistantContext, 'general'>, string[]> =
  Object.fromEntries(
    Object.entries(CONTEXT_METADATA).map(([key, value]) => [key, value.keywords])
  ) as Record<Exclude<AIAssistantContext, 'general'>, string[]>;

export function detectRelevantContexts(prompt: string): AIAssistantContext[] {
  const lowerPrompt = prompt.toLowerCase();
  const detected: AIAssistantContext[] = [];

  for (const [context, keywords] of Object.entries(CONTEXT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerPrompt.includes(keyword.toLowerCase())) {
        detected.push(context as AIAssistantContext);
        break;
      }
    }
  }

  return detected;
}

export interface WorkflowNodeDetection {
  contexts: AIAssistantContext[];
  mcpConnectionIds: string[];
  dataSheetIds: string[];
}

export function detectContextsFromWorkflow(
  existingWorkflow?: { nodes: any[]; edges: any[] }
): WorkflowNodeDetection {
  const result: WorkflowNodeDetection = {
    contexts: [],
    mcpConnectionIds: [],
    dataSheetIds: [],
  };

  if (!existingWorkflow?.nodes?.length) return result;

  const contextSet = new Set<AIAssistantContext>();
  const { nodes, edges } = existingWorkflow;

  for (const node of nodes) {
    const data = node.data || {};
    const nodeType = data.nodeType || '';
    const type = data.type || '';
    const toolType = data.toolType || '';

    if (nodeType === 'ai') {
      contextSet.add('modelSettings');
      contextSet.add('systemMessage');

      if (data.selectedTools?.mcp === true) {
        contextSet.add('mcp');
        const connectedNodeIds = (edges || [])
          .filter((e: any) => e.source === node.id || e.target === node.id)
          .map((e: any) => e.source === node.id ? e.target : e.source);

        for (const connId of connectedNodeIds) {
          const connNode = nodes.find((n: any) => n.id === connId);
          if (connNode?.data?.type === 'tool' && connNode.data.toolType === 'mcp' && connNode.data.mcpConnectionId) {
            result.mcpConnectionIds.push(connNode.data.mcpConnectionId);
          }
        }
      }
    }

    if (type === 'tool' && toolType === 'mcp') {
      contextSet.add('mcp');
      if (data.mcpConnectionId) {
        result.mcpConnectionIds.push(data.mcpConnectionId);
      }
    }

    if (type === 'dataSheets' || nodeType === 'dataSheets') {
      contextSet.add('dataSheet');
      if (data.sheetId) {
        result.dataSheetIds.push(data.sheetId);
      }
    }

    if (nodeType === 'store') {
      contextSet.add('dataSheet');
      if (data.sheetId) {
        result.dataSheetIds.push(data.sheetId);
      }
    }

    if (nodeType === 'ifElse') contextSet.add('systemMessage');
    if (nodeType === 'while') contextSet.add('whileLoop');
    if (nodeType === 'imap') contextSet.add('imap');
    if (nodeType === 'smtp') contextSet.add('systemMessage');
    if (nodeType === 'telegram') contextSet.add('systemMessage');
    if (nodeType === 'httpRequest') contextSet.add('systemMessage');
    if (nodeType === 'sendgrid') contextSet.add('sendgridBody');
  }

  result.contexts = Array.from(contextSet);
  result.mcpConnectionIds = [...new Set(result.mcpConnectionIds)];
  result.dataSheetIds = [...new Set(result.dataSheetIds)];

  return result;
}

export function buildDynamicGeneralPrompt(
  prompt: string,
  existingWorkflow?: { nodes: any[]; edges: any[] },
  nodeDetection?: WorkflowNodeDetection
): string {
  const generalInstruction = CONTEXT_INSTRUCTIONS['general'];

  const keywordContexts = detectRelevantContexts(prompt);

  const nodeContexts = nodeDetection?.contexts || [];
  const mergedSet = new Set<AIAssistantContext>([...keywordContexts, ...nodeContexts]);
  const allContexts = Array.from(mergedSet);

  const maxContexts = nodeDetection ? 3 : 2;
  const limitedContexts = allContexts.slice(0, maxContexts);

  if (limitedContexts.length === 0) {
    return generalInstruction;
  }

  let combinedPrompt = generalInstruction;

  combinedPrompt += `\n\n---\n\n## Additional Context (based on your question)\n`;
  combinedPrompt += `Detected topics: ${limitedContexts.join(', ')}\n\n`;

  for (const ctx of limitedContexts) {
    const ctxInstruction = CONTEXT_INSTRUCTIONS[ctx];
    if (ctxInstruction) {
      combinedPrompt += `### ${ctx} Details\n`;
      combinedPrompt += nodeDetection ? ctxInstruction : extractKeyParts(ctxInstruction);
      combinedPrompt += `\n\n`;
    }
  }

  return combinedPrompt;
}

function extractKeyParts(instruction: string): string {
  const lines = instruction.split('\n');
  const keyParts: string[] = [];
  let capturing = false;
  let captureCount = 0;
  const maxLines = 50;

  for (const line of lines) {
    if (line.includes('Modifiable Fields') ||
        line.includes('Key Capabilities') ||
        line.includes('Supported') ||
        line.includes('CRITICAL') ||
        line.includes('Response format')) {
      capturing = true;
    }

    if (capturing) {
      keyParts.push(line);
      captureCount++;

      if (line.trim() === '' && keyParts[keyParts.length - 2]?.trim() === '') {
        capturing = false;
      }

      if (captureCount >= maxLines) break;
    }
  }

  return keyParts.length > 0 ? keyParts.join('\n') : instruction.substring(0, 1000);
}

export interface McpConnectionInfo {
  id: string;
  provider: string;
  label: string;
  description?: string;
  serverUrl: string;
  status: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema?: any;
  }>;
}

export function formatMcpSection(mcpInfo: McpConnectionInfo): string {
  let section = `\n\n## Connected MCP Server (Live Data)\n`;
  section += `- **Connection ID**: ${mcpInfo.id}\n`;
  section += `- **Label**: ${mcpInfo.label}\n`;
  section += `- **Provider**: ${mcpInfo.provider}\n`;
  section += `- **Server URL**: ${mcpInfo.serverUrl}\n`;
  section += `- **Status**: ${mcpInfo.status}\n`;
  if (mcpInfo.description) {
    section += `- **Description**: ${mcpInfo.description}\n`;
  }

  section += `\n### Available Tools (${mcpInfo.tools.length} tools)\n`;
  if (mcpInfo.tools.length > 0) {
    mcpInfo.tools.forEach((tool) => {
      section += `\n#### \`${tool.name}\`\n`;
      section += `${tool.description || 'No description'}\n`;
      if (tool.inputSchema?.properties) {
        const props = tool.inputSchema.properties;
        const required = tool.inputSchema.required || [];
        const params = Object.entries(props).map(([name, schema]: [string, any]) => {
          const isRequired = required.includes(name);
          return `  - \`${name}\` (${schema.type || 'any'}${isRequired ? ', required' : ''}): ${schema.description || ''}`;
        });
        if (params.length > 0) {
          section += `Parameters:\n${params.join('\n')}\n`;
        }
      }
    });
  } else {
    section += `No tools available from this MCP server.\n`;
  }

  section += `\n### Service Description\n`;
  section += `Based on the tools above, describe what this MCP server does and how to use it in workflows.\n`;

  return section;
}

export function formatDataSheetSection(dataSheetInfo: { id: string; name: string; schema: any }): string {
  let section = `\n\n## Selected Data Sheet (ONLY this sheet can be modified)\n`;
  section += `- **Sheet ID**: ${dataSheetInfo.id}\n`;
  section += `- **Sheet Name**: ${dataSheetInfo.name}\n`;
  section += `- **Current Columns**:\n`;
  if (dataSheetInfo.schema?.columns) {
    dataSheetInfo.schema.columns.forEach((col: any) => {
      section += `  - ${col.name} (${col.type}${col.required ? ', required' : ''})\n`;
    });
  }
  section += `\n### To modify this Data Sheet, return:\n`;
  section += `\`\`\`json
{
  "type": "modification",
  "message": "Description of changes",
  "changes": [],
  "dataSheetChanges": [
    {
      "sheetId": "${dataSheetInfo.id}",
      "action": "updateSchema",
      "schema": {
        "columns": [
          { "name": "column_name", "type": "string|number|boolean|date", "required": true|false },
          ...
        ]
      }
    }
  ]
}
\`\`\`
**CRITICAL: sheetId MUST be "${dataSheetInfo.id}" - do NOT use any other sheet ID.**
`;
  return section;
}

/**
 * Build context prompt based on context and node info
 */
export function buildContextPrompt(
  context: AIAssistantContext,
  nodeId?: string,
  existingWorkflow?: { nodes: any[]; edges: any[] },
  dataSheetInfo?: { id: string; name: string; schema: any },
  mcpInfo?: McpConnectionInfo
): string {
  const instruction = CONTEXT_INSTRUCTIONS[context];

  if (!instruction) {
    return '';
  }

  let prompt = instruction;

  // Add node info if nodeId is provided
  if (nodeId && existingWorkflow?.nodes) {
    const node = existingWorkflow.nodes.find(n => n.id === nodeId);
    if (node) {
      prompt += `\n\n## Currently Selected Node\n`;
      prompt += `- **ID**: ${node.id}\n`;
      prompt += `- **Label**: ${node.data?.label || 'Unnamed'}\n`;
      prompt += `- **Type**: ${node.data?.nodeType || 'custom'}\n`;

      // Additional info by node type
      if (node.data?.nodeType === 'ai') {
        if (node.data?.systemMessage) {
          prompt += `- **System Message**: ${node.data.systemMessage.substring(0, 200)}...\n`;
        }
        if (node.data?.model) {
          prompt += `- **Model**: ${node.data.model}\n`;
        }
        if (node.data?.outputFormat) {
          prompt += `- **Output Format**: ${node.data.outputFormat}\n`;
        }
        if (node.data?.schemaName) {
          prompt += `- **Schema Name**: ${node.data.schemaName}\n`;
        }
      }
    }
  }

  if (context === 'dataSheet' && dataSheetInfo) {
    prompt += formatDataSheetSection(dataSheetInfo);
  }

  if (context === 'mcp' && mcpInfo) {
    prompt += formatMcpSection(mcpInfo);
  }

  return prompt;
}
