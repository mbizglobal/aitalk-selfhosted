import fs from 'fs';
import path from 'path';
import { analyzeUserRequest } from './analyzer';
import { retrieveRelevantTemplates, debugTemplateMatching, TemplateSource } from './retriever';
import { CodexPromptContext, UserRequestAnalysis, WorkflowTemplate } from './types';

export async function buildCodexContext(
  userRequest: string,
  existingWorkflow?: any,
  debug: boolean = false,
  source: TemplateSource = 'local'
): Promise<CodexPromptContext> {

  const analysis = analyzeUserRequest(userRequest, existingWorkflow);

  if (debug) {
    console.log('🔍 User Request Analysis:', analysis);
    console.log(`📂 Template Source: ${source}`);
    await debugTemplateMatching(analysis, source);
  }

  const relevantTemplates = await retrieveRelevantTemplates(analysis, 2, source);

  if (debug) {
    console.log('📚 Retrieved Templates:', relevantTemplates.map(t => t.name));
  }

  const baseGuidePath = path.join(process.cwd(), 'src/lib/codex-lib/prompts/base-guide.md');
  const baseGuide = fs.existsSync(baseGuidePath)
    ? fs.readFileSync(baseGuidePath, 'utf-8')
    : '';

  return {
    baseGuide,
    relevantTemplates,
    relevantSchemas: [],
    userRequest,
    existingWorkflow
  };
}

export function generateCodexPrompt(context: CodexPromptContext): string {
  let prompt = '';

  prompt += context.baseGuide + '\n\n';

  if (context.relevantTemplates.length > 0) {
    prompt += '## Relevant Examples\n\n';

    context.relevantTemplates.forEach((template, index) => {
      prompt += `### Example ${index + 1}: ${template.name}\n`;
      prompt += `${template.description}\n\n`;
      prompt += `**Complete Workflow JSON:**\n`;
      prompt += '```json\n';
      prompt += JSON.stringify({ nodes: template.example.nodes, edges: template.example.edges }, null, 2);
      prompt += '\n```\n\n';
      prompt += `**Key Points:**\n${template.explanation}\n\n`;
    });
  }

  if (context.existingWorkflow) {
    prompt += '## Current Workflow (to modify)\n\n';
    prompt += '```json\n';
    prompt += JSON.stringify(context.existingWorkflow, null, 2);
    prompt += '\n```\n\n';
  }

  prompt += '## User Request\n\n';
  prompt += context.userRequest + '\n\n';

  prompt += '## Instructions\n\n';
  if (context.existingWorkflow) {
    prompt += '**CRITICAL: You MUST use type: "modification" response format.**\n';
    prompt += '- User has an EXISTING workflow and wants to modify it\n';
    prompt += '- Do NOT regenerate the entire workflow\n';
    prompt += '- Return ONLY modification instructions: {"type": "modification", "message": "...", "changes": [...]}\n';
    prompt += '- Use the existing node IDs from the workflow above\n';
    prompt += '- If the request is a question, return {"type": "answer", "message": "..."}\n';
  } else {
    prompt += '- Create a new workflow based on user request\n';
    prompt += '- Use the examples above as reference\n';
    prompt += '- Follow the structure and rules exactly\n';
    prompt += '- Return ONLY valid JSON in the format: {"type": "workflow", "message": "...", "nodes": [...], "edges": [...]}\n';
  }

  prompt += '- Ensure all required fields are present (especially for AI nodes)\n';
  prompt += '- No markdown blocks, no explanations - return ONLY JSON\n';

  return prompt;
}

export { analyzeUserRequest, retrieveRelevantTemplates, debugTemplateMatching };
export type { TemplateSource };
export * from './types';
