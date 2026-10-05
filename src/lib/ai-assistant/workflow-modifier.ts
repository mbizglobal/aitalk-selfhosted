
import { getOwnedWorkflow, updateWorkflow } from '@/lib/workflow/service';

// ========================================
// ========================================

function getByPath(obj: any, path: string): any {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function setByPath(obj: any, path: string, value: any): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null) {
      current[part] = isNaN(Number(parts[i + 1])) ? {} : [];
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

export function applyModifications(nodes: any[], changes: any[]): any[] {
  const updatedNodes = JSON.parse(JSON.stringify(nodes)); // Deep copy

  for (const change of changes) {
    const nodeIndex = updatedNodes.findIndex((n: any) => n.id === change.nodeId);
    if (nodeIndex === -1) {
      console.warn(`[WorkflowModifier] Node not found: ${change.nodeId}`);
      continue;
    }

    const node = updatedNodes[nodeIndex];
    const currentValue = getByPath(node, change.path);

    switch (change.action) {
      case 'set':
        setByPath(node, change.path, change.value);
        break;
      case 'push':
        if (Array.isArray(currentValue)) {
          currentValue.push(change.value);
        } else {
          setByPath(node, change.path, [change.value]);
        }
        break;
      case 'remove':
        if (Array.isArray(currentValue)) {
          const idx = currentValue.findIndex((item: any) =>
            JSON.stringify(item) === JSON.stringify(change.value) ||
            item === change.value ||
            item?.name === change.value ||
            (change.value?.id && item?.id === change.value.id) ||
            (typeof change.value === 'string' && item?.id === change.value)
          );
          if (idx !== -1) currentValue.splice(idx, 1);
        } else {
          const pathParts = change.path.split('.');
          const fieldName = pathParts.pop();
          const parent = getByPath(node, pathParts.join('.'));
          if (parent && fieldName) delete parent[fieldName];
        }
        break;
      case 'merge':
        if (typeof currentValue === 'object' && currentValue !== null) {
          setByPath(node, change.path, { ...currentValue, ...change.value });
        } else {
          setByPath(node, change.path, change.value);
        }
        break;
    }
  }

  return updatedNodes;
}

// ========================================
// ========================================

export async function applyModificationsToWorkflow(
  workflowId: string,
  userId: string,
  changes: any[]
): Promise<{ success: boolean; message: string }> {
  try {
    const resolved = await getOwnedWorkflow(userId, workflowId);
    if (!resolved.ok) {
      return { success: false, message: resolved.code === 'FORBIDDEN' ? 'Unauthorized' : 'Workflow not found' };
    }
    const workflow = resolved.workflow;

    const workflowData = workflow.workflowJson
      ? JSON.parse(workflow.workflowJson)
      : { nodes: [], edges: [] };

    const updatedNodes = applyModifications(workflowData.nodes || [], changes);

    const updatedJson = JSON.stringify({ ...workflowData, nodes: updatedNodes });
    const saved = await updateWorkflow({
      userId,
      workflowId,
      patch: { workflowJson: updatedJson },
      expectedVersion: workflow.version,
      source: 'ai-assistant',
    });
    if (!saved.ok) {
      return { success: false, message: saved.message };
    }

    const summaryLines = changes.map(ch => {
      const node = updatedNodes.find((n: any) => n.id === ch.nodeId);
      const label = node?.data?.label || node?.type || ch.nodeId;
      const field = ch.path?.split('.').pop() || ch.path;
      return `- ${label}: ${field} ${ch.action === 'set' ? '변경' : ch.action}`;
    });

    return { success: true, message: summaryLines.join('\n') };
  } catch (error) {
    console.error('[WorkflowModifier] applyModificationsToWorkflow failed:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function replaceWorkflowJson(
  workflowId: string,
  userId: string,
  nodes: any[],
  edges: any[]
): Promise<{ success: boolean; message: string }> {
  try {
    const validatedNodes = nodes.map(node => ({
      ...node,
      position: node.position || { x: 0, y: 0 },
    }));
    const updatedJson = JSON.stringify({ nodes: validatedNodes, edges });

    const current = await getOwnedWorkflow(userId, workflowId);
    if (!current.ok) {
      return { success: false, message: current.code === 'FORBIDDEN' ? 'Unauthorized' : 'Workflow not found' };
    }
    const saved = await updateWorkflow({
      userId,
      workflowId,
      patch: { workflowJson: updatedJson },
      expectedVersion: current.workflow.version,
      source: 'ai-assistant',
    });
    if (!saved.ok) {
      const message = saved.code === 'FORBIDDEN' ? 'Unauthorized'
        : saved.code === 'NOT_FOUND' ? 'Workflow not found'
        : saved.message;
      return { success: false, message };
    }

    return { success: true, message: 'Workflow replaced' };
  } catch (error) {
    console.error('[WorkflowModifier] replaceWorkflowJson failed:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}
