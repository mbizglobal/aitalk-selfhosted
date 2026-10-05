
import { prisma } from '@/lib/prisma';
import { getLocalTemplate } from '@/lib/local-templates';
import {
  createWorkflow,
  cloneWorkflow,
  renameWorkflow,
  setWorkflowStatus,
  updateWorkflow,
  listWorkflows,
} from '@/lib/workflow/service';
import type { ParsedResponse } from '../response-parser';
import type { ActionHandler, ActionContext, ActionResult } from '../action-registry';

export class WorkflowActionHandler implements ActionHandler {
  private static SERVER_ACTIONS = [
    'create_workflow',
    'create_workflow_from_template',
    'clone_workflow',
    'rename_workflow',
    'change_status',
    'list_workflows',
  ];

  canHandle(parsed: ParsedResponse): boolean {
    return parsed.type === 'workflow_action'
      && !!parsed.action
      && WorkflowActionHandler.SERVER_ACTIONS.includes(parsed.action);
  }

  async execute(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    switch (parsed.action) {
      case 'create_workflow':
        return this.createWorkflow(parsed, context);
      case 'create_workflow_from_template':
        return this.createWorkflowFromTemplate(parsed, context);
      case 'clone_workflow':
        return this.cloneWorkflow(parsed, context);
      case 'rename_workflow':
        return this.renameWorkflow(parsed, context);
      case 'change_status':
        return this.changeStatus(parsed, context);
      case 'list_workflows':
        return this.listWorkflows(parsed, context);
      default:
        return {
          type: 'workflow_action',
          action: parsed.action,
          message: parsed.message || 'Unknown workflow action.',
        };
    }
  }

  private async createWorkflow(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    if (!context.agentId) {
      return { type: 'workflow_action', action: 'create_workflow', message: 'Agent ID is required.' };
    }

    try {
      const name = parsed.value?.name || 'New Workflow';
      const result = await createWorkflow({
        userId: context.userId,
        agentId: context.agentId,
        name,
      });
      if (!result.ok) {
        const message = result.code === 'AGENT_NOT_FOUND' ? 'Agent not found.' : result.message;
        return { type: 'workflow_action', action: 'create_workflow', message };
      }

      return {
        type: 'workflow_action',
        action: 'create_workflow',
        value: { workflowId: result.workflow.workflowId, name: result.workflow.name },
        message: parsed.message || `Workflow "${name}" created successfully.`,
      };
    } catch (err) {
      console.error('[WorkflowAction] Failed to create workflow:', err);
      return { type: 'workflow_action', action: 'create_workflow', message: 'Failed to create workflow.' };
    }
  }

  private async createWorkflowFromTemplate(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    if (!context.agentId) {
      return { type: 'workflow_action', action: 'create_workflow_from_template', message: 'Agent ID is required.' };
    }

    const templateId = parsed.value?.templateId;
    if (!templateId) {
      return { type: 'workflow_action', action: 'create_workflow_from_template', message: 'Template ID is required.' };
    }

    try {
      const template = getLocalTemplate(templateId);
      if (!template) {
        return { type: 'workflow_action', action: 'create_workflow_from_template', message: `Template "${templateId}" not found.` };
      }

      const result = await createWorkflow({
        userId: context.userId,
        agentId: context.agentId,
        name: template.name,
        description: template.description,
        workflowJson: template.workflowJson,
      });
      if (!result.ok) {
        const message = result.code === 'AGENT_NOT_FOUND' ? 'Agent not found.' : result.message;
        return { type: 'workflow_action', action: 'create_workflow_from_template', message };
      }
      const workflow = result.workflow;

      if (template.dataSheetSchema) {
        const schema = template.dataSheetSchema;
        const owner = await prisma.agent.findUniqueOrThrow({ where: { agentId: context.agentId }, select: { userId: true } });
        const dataSheet = await prisma.dataSheet.create({
          data: {
            agentId: context.agentId,
            userId: owner.userId,
            name: schema.name,
            description: schema.description || '',
            schema: JSON.stringify(schema.columns),
          },
        });
        const injectedJson = workflow.workflowJson.replace(
          /"dataSheetId"\s*:\s*"[^"]*"/g,
          `"dataSheetId": "${dataSheet.id}"`,
        );
        await updateWorkflow({
          userId: context.userId,
          workflowId: workflow.workflowId,
          patch: { workflowJson: injectedJson },
          expectedVersion: workflow.version,
          source: 'ai-assistant',
        });
      }

      return {
        type: 'workflow_action',
        action: 'create_workflow_from_template',
        value: { workflowId: workflow.workflowId, name: workflow.name, templateId },
        message: parsed.message || `Workflow "${template.name}" created from template.`,
      };
    } catch (err) {
      console.error('[WorkflowAction] Failed to create workflow from template:', err);
      return { type: 'workflow_action', action: 'create_workflow_from_template', message: 'Failed to create workflow from template.' };
    }
  }

  private async cloneWorkflow(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    const workflowId = parsed.value?.workflowId;
    if (!workflowId) {
      return { type: 'workflow_action', action: 'clone_workflow', message: 'Workflow ID is required.' };
    }

    try {
      const result = await cloneWorkflow({
        userId: context.userId,
        workflowId,
        name: parsed.value?.name,
      });
      if (!result.ok) {
        const hidden = result.code === 'NOT_FOUND' || result.code === 'FORBIDDEN';
        return { type: 'workflow_action', action: 'clone_workflow', message: hidden ? 'Workflow not found.' : result.message };
      }

      return {
        type: 'workflow_action',
        action: 'clone_workflow',
        value: { workflowId: result.workflow.workflowId, name: result.workflow.name },
        message: parsed.message || `Workflow cloned as "${result.workflow.name}".`,
      };
    } catch (err) {
      console.error('[WorkflowAction] Failed to clone workflow:', err);
      return { type: 'workflow_action', action: 'clone_workflow', message: 'Failed to clone workflow.' };
    }
  }

  private async renameWorkflow(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    const workflowId = parsed.value?.workflowId;
    const newName = parsed.value?.name;
    if (!workflowId || !newName) {
      return { type: 'workflow_action', action: 'rename_workflow', message: 'Workflow ID and new name are required.' };
    }

    try {
      const result = await renameWorkflow({ userId: context.userId, workflowId, name: newName });
      if (!result.ok) {
        const hidden = result.code === 'NOT_FOUND' || result.code === 'FORBIDDEN';
        return { type: 'workflow_action', action: 'rename_workflow', message: hidden ? 'Workflow not found.' : result.message };
      }

      return {
        type: 'workflow_action',
        action: 'rename_workflow',
        value: { workflowId, name: newName },
        message: parsed.message || `Workflow renamed to "${newName}".`,
      };
    } catch (err) {
      console.error('[WorkflowAction] Failed to rename workflow:', err);
      return { type: 'workflow_action', action: 'rename_workflow', message: 'Failed to rename workflow.' };
    }
  }

  private async changeStatus(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    const workflowId = parsed.value?.workflowId;
    const status = parsed.value?.status;
    if (!workflowId || !status) {
      return { type: 'workflow_action', action: 'change_status', message: 'Workflow ID and status are required.' };
    }

    try {
      const result = await setWorkflowStatus({ userId: context.userId, workflowId, status });
      if (!result.ok) {
        const hidden = result.code === 'NOT_FOUND' || result.code === 'FORBIDDEN';
        return { type: 'workflow_action', action: 'change_status', message: hidden ? 'Workflow not found.' : result.message };
      }

      return {
        type: 'workflow_action',
        action: 'change_status',
        value: { workflowId, status },
        message: parsed.message || `Workflow status changed to "${status}".`,
      };
    } catch (err) {
      console.error('[WorkflowAction] Failed to change workflow status:', err);
      return { type: 'workflow_action', action: 'change_status', message: 'Failed to change workflow status.' };
    }
  }

  private async listWorkflows(parsed: ParsedResponse, context: ActionContext): Promise<ActionResult> {
    if (!context.agentId) {
      return { type: 'workflow_action', action: 'list_workflows', message: 'Agent ID is required.' };
    }

    try {
      const result = await listWorkflows({ userId: context.userId, agentId: context.agentId });
      if (!result.ok) {
        return { type: 'workflow_action', action: 'list_workflows', message: 'Failed to list workflows.' };
      }
      const workflows = result.workflows;

      if (workflows.length === 0) {
        return {
          type: 'workflow_action',
          action: 'list_workflows',
          value: { workflows: [] },
          message: parsed.message || 'No workflows found for this agent.',
        };
      }

      const lines = workflows.map((wf, i) => {
        const statusIcon = wf.status === 'production' ? '\u{1F7E2}' : wf.status === 'draft' ? '\u{1F7E1}' : '\u{26AA}';
        return `${i + 1}. ${statusIcon} **${wf.name}** (${wf.status}) - \`${wf.workflowId}\``;
      });

      return {
        type: 'workflow_action',
        action: 'list_workflows',
        value: { workflows },
        message: parsed.message || `### Workflows (${workflows.length})\n\n${lines.join('\n')}`,
      };
    } catch (err) {
      console.error('[WorkflowAction] Failed to list workflows:', err);
      return { type: 'workflow_action', action: 'list_workflows', message: 'Failed to list workflows.' };
    }
  }
}
