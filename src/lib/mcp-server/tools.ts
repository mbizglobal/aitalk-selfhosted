import { getAppBaseUrl } from '@/lib/app-url'
import { prisma } from '@/lib/prisma'
import {
  listWorkflows,
  getOwnedWorkflow,
  listWorkflowVersions,
  getWorkflowVersion,
  restoreWorkflow,
  createWorkflow,
  updateWorkflow,
  createDeployRequest,
  setWorkflowStatus,
} from '@/lib/workflow/service'
import { validateWorkflowJson } from '@/lib/workflow/validation'
import {
  MAIN_WORKFLOW_KIND,
  SUB_WORKFLOW_KIND,
  buildSubWorkflowSkeleton,
  normalizeWorkflowKind,
  readSubWorkflowDefinition,
  subWorkflowToolFunctionName,
} from '@/lib/workflow/subworkflow'
import { createTextSource } from '@/lib/storage/create-text'
import { deleteStorageItem } from '@/lib/storage/delete-item'
import { listMcpTemplates, getMcpTemplate } from './templates'
import { applyParams, type TemplateBinding } from './template-params'
import { restoreMaskedSecrets } from './masked-restore'
import { truncateUtf8, listConversationEntries, getConversationDetail } from './history'
import { MASK, maskSecrets, stripUrlCredentials } from './mask'
import type { McpAuthContext } from './auth'
import { isSelfHosted } from '@/lib/edition'

export { truncateUtf8 }
export { maskSecrets, stripUrlCredentials } from './mask'

export const MCP_TOOLS = [
  {
    name: 'list_agents',
    description:
      'List all AI agents in this AiTalk account. Each agent owns workflows, RAG sources, and channel settings. Returns agentId (needed for list_workflows), title, and whether it is the default agent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_workflows',
    description:
      "List workflows of an agent with status (draft/production/archived) and kind ('main' = a normal workflow; 'sub' = a Sub-workflow that other workflows attach as an AI tool — it is called by reference and never deployed). production = live. Returns workflowId (needed for get_workflow). Get agentId from list_agents first.",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID from list_agents' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_workflow',
    description:
      'Get the full definition of a workflow including its node graph (workflowJson: nodes + edges). Credential-like fields are masked. Get workflowId from list_workflows first. The response includes version — pass it back as expectedVersion when restoring.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID from list_workflows' },
      },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_workflow_versions',
    description:
      'List the saved edit history of a workflow (up to 10 snapshots, newest first). Each entry has a version number, timestamp, source (which surface saved it) and an optional note. Also returns currentVersion (use as expectedVersion for restore_workflow) and status (restore only works on draft).',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID from list_workflows' },
      },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_workflow_version',
    description:
      'Get the full body (workflowJson) of one saved version from the edit history. Credential-like fields are masked. Use list_workflow_versions first to find version numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID from list_workflows' },
        version: { type: 'integer', description: 'Version number from list_workflow_versions' },
      },
      required: ['workflowId', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'restore_workflow',
    description:
      'Restore a workflow to a previous saved version (draft workflows only — live/production workflows cannot be restored; clone or switch to draft first). Requires the write scope. expectedVersion must be the workflow currentVersion from list_workflow_versions or get_workflow; a mismatch returns a conflict — re-read and retry.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID from list_workflows' },
        targetVersion: { type: 'integer', description: 'Version to restore, from list_workflow_versions' },
        expectedVersion: { type: 'integer', description: 'Current workflow version (optimistic concurrency token)' },
      },
      required: ['workflowId', 'targetVersion', 'expectedVersion'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_workflow_templates',
    description:
      'List the built-in workflow templates, and whether each one can be copied into a new workflow over MCP. Each entry shows templateId (needed for get_workflow_template / create_workflow), what it does, node types, whether it is creatable over MCP, and how many editable parameters it exposes. The long per-template setup guide (`explanation`) is deliberately NOT here — call get_workflow_template for the one you picked.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_workflow_template',
    description:
      'Get one template in full: its node graph (workflowJson) and its editable parameter manifest. Each parameter has a stable parameterId, a type (string/number/boolean/enum), and constraints — these are the ONLY fields you can change after creating a workflow from this template (via patch_workflow_params). A template without a manifest cannot be parameter-patched — and that is NOT the same as being creatable: always check the `creatable` flag (with `notCreatableReason`) before calling create_workflow, because some templates cannot be created over MCP at all. `explanation` is the long setup guide for this template: what the end customer experiences, what the template creates, and what must be configured before going live.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: 'Template ID from list_workflow_templates' },
      },
      required: ['templateId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_workflow',
    description:
      'Create a new DRAFT workflow for an agent, either from a template (pass templateId — the recommended path) or blank. Requires the write scope. The workflow is created as draft: edit parameters with patch_workflow_params, inspect with get_workflow, and it only goes live when explicitly deployed. Plan limits on workflow count apply. Pass kind:"sub" to create a Sub-workflow instead — a workflow the AI calls as a function; it is seeded with a minimal valid graph (Start/Sub-workflow with a toolName derived from name, wired to one End node) that you then build out with update_workflow, it cannot be created from a template, and it is never deployed. Read the "Sub-workflows" section of aitalk://workflow-guide before creating one.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID from list_agents' },
        name: { type: 'string', description: 'Workflow name shown in the dashboard' },
        description: { type: 'string', description: 'Optional description' },
        templateId: { type: 'string', description: 'Optional template to copy (from list_workflow_templates). Omit for a blank workflow (an empty string counts as omitted). A non-empty value is not allowed with kind:"sub"' },
        kind: {
          type: 'string',
          enum: ['main', 'sub'],
          description: "'main' (default) = a normal workflow started by a channel trigger. 'sub' = a Sub-workflow that other workflows of the same agent attach to an AI node as a tool — called by reference, never deployed",
        },
      },
      required: ['agentId', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'patch_workflow_params',
    description:
      'Edit a template-created workflow by setting values for the parameterIds defined in its template manifest (see get_workflow_template). Works on draft AND live (production) workflows — editing a live one takes effect for customers immediately, so confirm with the owner before changing a live workflow. Archived workflows are rejected. Requires the write scope. Only works on workflows created via create_workflow from a template. Pass dryRun:true to validate the change without saving. expectedVersion must match the current version (from get_workflow); a mismatch returns a conflict.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID from create_workflow / list_workflows' },
        expectedVersion: { type: 'integer', description: 'Current workflow version (optimistic concurrency token)' },
        params: {
          type: 'object',
          description: 'Map of parameterId → new value. parameterIds and value constraints come from the template manifest',
          additionalProperties: true,
        },
        dryRun: { type: 'boolean', description: 'true = validate and report, do not save' },
      },
      required: ['workflowId', 'expectedVersion', 'params'],
      additionalProperties: false,
    },
  },
  {
    name: 'validate_workflow',
    description:
      'Validate the CURRENT SAVED content of a workflow without changing anything. level "structural" checks graph integrity (what every save requires); level "deployable" (default) additionally checks what deployment requires (Start/End nodes, reachability, dead ends, per-node required fields and enums). Use before deploying, or to diagnose why a save/deploy was rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID from list_workflows' },
        level: { type: 'string', enum: ['structural', 'deployable'], description: 'Validation level (default: deployable)' },
      },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_workflow',
    description:
      'Replace the ENTIRE node graph (workflowJson) of a workflow — draft OR live (production); archived is rejected. Editing a live workflow takes effect for customers immediately, so confirm with the owner before changing one. This is the full-assembly editor — read the aitalk://node-catalog resource first for node types, required fields and edge handle rules, and prefer patch_workflow_params for template workflows. Requires the write scope. The JSON must pass structural validation to save; the response reports what still blocks deployment. A node whose values are masked (***masked***) must be sent back EXACTLY as get_workflow returned it — it is then restored with its real secrets; editing such a node is rejected (send real values, or use patch_workflow_params). On a template-created workflow this clears the parameter binding (patch_workflow_params stops applying). Pass dryRun:true to validate without saving. expectedVersion must match (get_workflow); a mismatch returns a conflict.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID from list_workflows / create_workflow' },
        expectedVersion: { type: 'integer', description: 'Current workflow version (optimistic concurrency token)' },
        workflowJson: {
          type: 'object',
          description: 'The complete new graph: { nodes: [...], edges: [...] }. Replaces the stored graph entirely',
          additionalProperties: true,
        },
        dryRun: { type: 'boolean', description: 'true = validate and report, do not save' },
      },
      required: ['workflowId', 'expectedVersion', 'workflowJson'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_workflow_deploy',
    description:
      'Request deployment (go-live) of a DRAFT workflow. This does NOT deploy it directly — for safety, deployment must be confirmed by the logged-in account owner. It validates the draft is deployable, then returns a confirmationUrl: give that URL to the human owner, who opens it in their AiTalk dashboard (while logged in) and clicks Deploy to make the workflow live. Requires the write scope. The request is single-use and expires in ~15 minutes; if the draft is edited after this call the request becomes stale and must be requested again.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Draft workflow ID to deploy (from list_workflows / create_workflow)' },
      },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'deploy_workflow',
    description:
      'Deploy a workflow — switch it to production so it goes LIVE for customers right away. Requires the write scope. Confirm with the owner before calling this: the moment it succeeds the workflow starts answering real chats, phone calls and scheduled runs. It runs the same checks as the dashboard Deploy button (the graph must be deployable, plus plan entitlement and active-workflow limits) and returns the reason if any check fails. expectedVersion must match the current version (get_workflow, create_workflow, patch_workflow_params and update_workflow all return it) so you cannot deploy a graph someone changed in the meantime. If you would rather let the owner review and click Deploy themselves, use request_workflow_deploy instead.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID from list_workflows / create_workflow' },
        expectedVersion: { type: 'integer', description: 'Current workflow version (optimistic concurrency token)' },
      },
      required: ['workflowId', 'expectedVersion'],
      additionalProperties: false,
    },
  },
  {
    name: 'undeploy_workflow',
    description:
      'Take a live workflow off the air — switch it from production back to draft. Requires the write scope. WARNING: it immediately stops accepting NEW customer chats and phone calls, and its scheduled runs are skipped from the next tick — ask the owner before calling it. A phone call already connected keeps running until the caller hangs up; nothing in flight is killed. Nothing is deleted either — the workflow keeps its graph and history, and deploy_workflow puts it back live. Fails if the workflow is not currently live.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Live workflow ID from list_workflows' },
      },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_source_files',
    description:
      'List the knowledge-base (RAG) source files of an agent. Returns file metadata including indexing status: "processing" (not searchable yet), "completed" (indexed and searchable), "failed" (see errorMessage), or "deleting" (a deletion is in progress; it normally disappears within seconds). Content is not included — use get_source_file. Only file-type sources are accessible over MCP; website crawls, Google Drive, SharePoint and GitBook imports are managed in the dashboard.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID from list_agents' },
        limit: { type: 'integer', description: 'Max files to return (default 50, max 200)' },
        offset: { type: 'integer', description: 'Pagination offset (default 0)' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_source_file',
    description:
      'Get one knowledge-base source file including its text content (truncated at ~50KB). contentSource tells you where the text came from: "stored" = the original text as submitted; "indexed_chunks" = reassembled from the indexed chunks, i.e. the extracted text the AI actually searches — this is what you get for files uploaded through the dashboard (PDF/DOCX/…), so layout, images and tables are lost; null = no text was returned. When content is null or only partially readable, contentNote says why — indexing not finished, no extractable text in the file, an index lookup failure worth one retry, the account having no active managed region (retained/suspended subscription, where retrying will NOT help), or only the beginning of a long document. Read it before concluding anything about the document. To correct a document, read it here, then delete_source_file + create_source_text with the fixed text (there is no in-place update; note that a corrected binary comes back as a .txt and the original file is gone). status shows indexing progress — a newly added document starts as "processing" (not searchable) and reaches "completed" when indexing finishes.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID from list_agents' },
        storageId: { type: 'integer', description: 'Source file ID from list_source_files' },
      },
      required: ['agentId', 'storageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_source_text',
    description:
      'Add a TEXT document to the agent knowledge base (RAG). It is saved as a .txt source file and indexed asynchronously — the response returns status "processing" and the document is NOT searchable yet; poll get_source_file until status is "completed" (or "failed" — stop polling then and read errorMessage) before expecting the AI to use it. Binary files (PDF/DOCX/PPTX/XLSX/images) cannot be transferred over MCP: when the user asks to add such a file, first convert or extract it to plain text/markdown locally in YOUR environment and pass the text here — or direct the user to the dashboard Storage page for native binary upload. Indexing goes to the document search of this installation (Azure AI Search on AI Talk Cloud); on Cloud, accounts without a managed subscription cannot add documents over MCP and get UNSUPPORTED_SERVICE_VARIANT — send them to the dashboard Storage page. A self-hosted installation that searches a search server run by the customer gets KNOWLEDGE_EXTERNAL — documents are added in that system instead. Requires the write scope.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID from list_agents' },
        title: { type: 'string', description: 'Document title (becomes the .txt file name, max 200 chars)' },
        content: { type: 'string', description: 'Plain-text document content (min 20 bytes, max 1MB)' },
        ragSpaceId: { type: 'integer', description: 'RAG space to file the document under. Omit for the Default space' },
      },
      required: ['agentId', 'title', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_source_file',
    description:
      'Delete a knowledge-base source file, including its indexed chunks in the RAG provider (and the stored original, where applicable). Only file-type sources can be deleted over MCP — website/Google Drive/SharePoint/GitBook imports are managed in the dashboard. Requires the write scope. This cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID from list_agents' },
        storageId: { type: 'integer', description: 'Source file ID from list_source_files' },
      },
      required: ['agentId', 'storageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_conversations',
    description:
      'List conversation history entries newest first: text chats, voice calls (PSTN + web) and quiz attempts. Each entry is one conversation start or one voice call — voice calls are grouped per visitor per day under one conversationId, so several entries can share a conversationId; get_conversation returns the whole group with boundary markers. Returns a short preview, the channel (source), conversation token totals, and voice metadata (call duration; for PSTN the caller phone number). This is the account owner\'s own customer data (may include phone numbers and personal details) — use it only for what the owner asked.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Optional: only this agent (from list_agents). Omit for all agents' },
        source: { type: 'string', enum: ['all', 'text', 'voice', 'quiz'], description: 'Channel filter (default all)' },
        since: { type: 'string', description: 'Optional ISO 8601 date/time — only entries at/after this (a bare date like 2026-07-01 is interpreted as UTC midnight)' },
        until: { type: 'string', description: 'Optional ISO 8601 date/time — only entries at/before this' },
        limit: { type: 'integer', description: 'Max entries to return (default 20, max 100)' },
        offset: { type: 'integer', description: 'Pagination offset (default 0)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_conversation',
    description:
      'Get the decrypted message transcript of one conversation (ID from list_conversations), oldest first. boundary:true marks the start of each conversation/call — a voice conversationId groups all of one visitor\'s calls that day, so expect multiple boundaries. Long transcripts are windowed: if nextMessageOffset is non-null, call again with messageOffset set to it to continue; individual messages longer than ~8KB are truncated (contentTruncated). Quiz conversations return a result summary instead of messages (per-question detail is dashboard-only). Contains the owner\'s customer conversation content — use it only for what the owner asked.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'Conversation ID from list_conversations' },
        messageOffset: { type: 'integer', description: 'Skip this many messages (default 0). Pass nextMessageOffset from the previous response to continue' },
        messageLimit: { type: 'integer', description: 'Max messages to return (default 100, max 500)' },
      },
      required: ['conversationId'],
      additionalProperties: false,
    },
  },
] as const

export interface McpToolError {
  ok: false
  message: string
  code?: string
  meta?: Record<string, unknown>
}

export interface McpToolOk {
  ok: true
  data: unknown
}

export type McpToolResult = McpToolOk | McpToolError

export const TOOL_REQUIRED_SCOPE: Record<string, string> = {
  list_agents: 'read',
  list_workflows: 'read',
  get_workflow: 'read',
  list_workflow_versions: 'read',
  get_workflow_version: 'read',
  restore_workflow: 'write',
  list_workflow_templates: 'read',
  get_workflow_template: 'read',
  create_workflow: 'write',
  patch_workflow_params: 'write',
  validate_workflow: 'read',
  update_workflow: 'write',
  request_workflow_deploy: 'write',
  deploy_workflow: 'write',
  undeploy_workflow: 'write',
  list_source_files: 'read',
  get_source_file: 'read',
  create_source_text: 'write',
  delete_source_file: 'write',
  list_conversations: 'read',
  get_conversation: 'read',
}

function isPositiveInt32(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647
}

const SOURCE_CONTENT_MAX_BYTES = 50_000

async function requireOwnedAgent(userId: string, agentId: string): Promise<boolean> {
  const agent = await prisma.agent.findFirst({ where: { agentId, userId }, select: { agentId: true } })
  return agent !== null
}

const INDEXED_CHUNK_FETCH_LIMIT = 1000

type IndexedTextResult =
  | { ok: true; text: string; chunkCount: number; partial: boolean }
  | { ok: false; reason: 'no_region' | 'lookup_failed' | 'empty' }

export function assembleIndexedChunks(
  chunks: Array<{ chunkIndex: number; content: string }>,
  expectedChunks: number | null,
  fetchLimit: number,
): { text: string; chunkCount: number; partial: boolean } | null {
  if (chunks.length === 0) return null
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
  const prefix: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].chunkIndex !== i) break
    prefix.push(sorted[i].content)
  }
  if (prefix.length === 0) return null
  const stoppedEarly = prefix.length < chunks.length
  const hitLimit = chunks.length >= fetchLimit
  const shortOfRecord = expectedChunks !== null && prefix.length < expectedChunks
  const partial = stoppedEarly || hitLimit || shortOfRecord
  return { text: prefix.join('\n'), chunkCount: prefix.length, partial }
}

async function readIndexedText(
  userId: string,
  agentId: string,
  storageId: number,
  expectedChunks: number | null,
): Promise<IndexedTextResult> {
  try {
    const { getKnowledgeStore, SELFHOSTED_REGION } = await import('@/lib/knowledge')
    const selfHosted = isSelfHosted()
    const region = selfHosted ? SELFHOSTED_REGION : (await prisma.subscription.findUnique({
      where: { id: userId },
      select: { managedRegion: true },
    }))?.managedRegion
    if (!region) return { ok: false, reason: 'no_region' }

    const store = selfHosted ? await getKnowledgeStore({ regionId: region, allowSelfHosted: true }) : await getKnowledgeStore({ regionId: region })

    const chunks = await store.listChunks({ agentId }, { storageId, maxChunks: INDEXED_CHUNK_FETCH_LIMIT })
    if (chunks.length === 0) return { ok: false, reason: expectedChunks === 0 ? 'empty' : 'lookup_failed' }

    const assembled = assembleIndexedChunks(chunks, expectedChunks, INDEXED_CHUNK_FETCH_LIMIT)
    if (!assembled) return { ok: false, reason: 'lookup_failed' }
    return { ok: true, ...assembled }
  } catch (e) {
    console.warn(`[MCP] indexed text read failed (storage=${storageId}):`, e)
    return { ok: false, reason: 'lookup_failed' }
  }
}

function azureChunkCount(ragStatus: string | null): number | null {
  if (!ragStatus) return null
  try {
    const st = JSON.parse(ragStatus)
    const n = (st?.azure_ai_search ?? st?.pgvector)?.chunkCount
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

export async function executeMcpTool(
  auth: McpAuthContext,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<McpToolResult> {
  const required = TOOL_REQUIRED_SCOPE[name]
  if (!required) return { ok: false, message: `Unknown tool: ${name}`, code: 'UNKNOWN_TOOL' }
  if (!auth.scopes.includes(required)) {
    return { ok: false, message: `This token lacks the '${required}' scope required for ${name}.`, code: 'SCOPE_DENIED' }
  }

  switch (name) {
    case 'list_agents': {
      const agents = await prisma.agent.findMany({
        where: { userId: auth.userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { agentId: true, title: true, isDefault: true, createdAt: true },
      })
      return { ok: true, data: { agents } }
    }

    case 'list_workflows': {
      const agentId = typeof args?.agentId === 'string' ? args.agentId : ''
      if (!agentId) return { ok: false, message: 'agentId is required. Call list_agents first.' }
      const result = await listWorkflows({ userId: auth.userId, agentId })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      return { ok: true, data: { workflows: result.workflows } }
    }

    case 'get_workflow': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required. Call list_workflows first.' }
      const result = await getOwnedWorkflow(auth.userId, workflowId)
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      const wf = result.workflow
      let workflowJson: unknown
      try {
        workflowJson = maskSecrets(JSON.parse(wf.workflowJson))
      } catch {
        workflowJson = null
      }
      return {
        ok: true,
        data: {
          workflowId: wf.workflowId,
          agentId: wf.agentId,
          name: wf.name,
          description: wf.description,
          status: wf.status,
          kind: normalizeWorkflowKind(wf.kind),
          version: wf.version,
          createdAt: wf.createdAt,
          updatedAt: wf.updatedAt,
          workflowJson,
        },
      }
    }

    case 'list_workflow_versions': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required. Call list_workflows first.' }
      const result = await listWorkflowVersions({ userId: auth.userId, workflowId })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      return {
        ok: true,
        data: { versions: result.versions, currentVersion: result.currentVersion, status: result.status },
      }
    }

    case 'get_workflow_version': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required. Call list_workflows first.' }
      if (!isPositiveInt32(args?.version)) {
        return { ok: false, message: 'version must be a positive integer. Call list_workflow_versions first.' }
      }
      const result = await getWorkflowVersion({ userId: auth.userId, workflowId, version: args.version })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      const v = result.version
      let workflowJson: unknown
      try {
        workflowJson = maskSecrets(JSON.parse(v.workflowJson))
      } catch {
        workflowJson = null
      }
      return {
        ok: true,
        data: {
          workflowId,
          version: v.version,
          name: v.name,
          description: v.description,
          source: v.source,
          note: v.note,
          createdAt: v.createdAt,
          workflowJson,
        },
      }
    }

    case 'restore_workflow': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required. Call list_workflows first.' }
      if (!isPositiveInt32(args?.targetVersion) || !isPositiveInt32(args?.expectedVersion)) {
        return {
          ok: false,
          message: 'targetVersion and expectedVersion must be positive integers. Call list_workflow_versions to get both.',
        }
      }
      const result = await restoreWorkflow({
        userId: auth.userId,
        workflowId,
        targetVersion: args.targetVersion,
        expectedVersion: args.expectedVersion,
      })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      return {
        ok: true,
        data: {
          workflowId: result.workflow.workflowId,
          restoredFrom: args.targetVersion,
          version: result.workflow.version,
          status: result.workflow.status,
          updatedAt: result.workflow.updatedAt,
        },
      }
    }

    case 'list_workflow_templates': {
      const templates = await listMcpTemplates()
      return {
        ok: true,
        data: {
          templates: templates.map(t => ({
            templateId: t.templateId,
            name: t.name,
            description: t.description,
            categoryCode: t.categoryCode,
            complexity: t.complexity,
            nodeTypes: t.nodeTypes,
            creatable: t.creatable,
            ...(t.notCreatableReason ? { notCreatableReason: t.notCreatableReason } : {}),
            parameterCount: t.manifest?.parameters.length ?? 0,
          })),
        },
      }
    }

    case 'get_workflow_template': {
      const templateId = typeof args?.templateId === 'string' ? args.templateId : ''
      if (!templateId) return { ok: false, message: 'templateId is required. Call list_workflow_templates first.' }
      const template = await getMcpTemplate(templateId)
      if (!template) return { ok: false, message: `Template "${templateId}" not found. Call list_workflow_templates for valid IDs.`, code: 'TEMPLATE_NOT_FOUND' }
      let workflowJson: unknown
      try {
        workflowJson = maskSecrets(JSON.parse(template.workflowJson))
      } catch {
        workflowJson = null
      }
      return {
        ok: true,
        data: {
          templateId: template.templateId,
          name: template.name,
          description: template.description,
          ...(template.explanation ? { explanation: template.explanation } : {}),
          categoryCode: template.categoryCode,
          complexity: template.complexity,
          nodeTypes: template.nodeTypes,
          creatable: template.creatable,
          ...(template.notCreatableReason ? { notCreatableReason: template.notCreatableReason } : {}),
          parameters: template.manifest?.parameters ?? [],
          workflowJson,
        },
      }
    }

    case 'create_workflow': {
      const agentId = typeof args?.agentId === 'string' ? args.agentId : ''
      const wfName = typeof args?.name === 'string' ? args.name.trim() : ''
      if (!agentId) return { ok: false, message: 'agentId is required. Call list_agents first.' }
      if (!wfName) return { ok: false, message: 'name is required.' }
      if (wfName.length > 255) return { ok: false, message: 'name is too long (max 255 chars).' }
      const description = typeof args?.description === 'string' ? args.description : null
      const templateId = typeof args?.templateId === 'string' && args.templateId ? args.templateId : null

      if (args?.kind !== undefined && args.kind !== MAIN_WORKFLOW_KIND && args.kind !== SUB_WORKFLOW_KIND) {
        return {
          ok: false,
          code: 'INVALID_PARAMS',
          message: `kind must be "${MAIN_WORKFLOW_KIND}" or "${SUB_WORKFLOW_KIND}" (see the "Sub-workflows" section of aitalk://workflow-guide).`,
        }
      }
      const kind = normalizeWorkflowKind(args?.kind)

      let workflowJson: string | undefined
      let templateBinding: string | undefined
      if (templateId) {
        if (kind === SUB_WORKFLOW_KIND) {
          return {
            ok: false,
            code: 'SUB_WORKFLOW_TEMPLATE_UNSUPPORTED',
            message: 'Templates are channel-triggered main workflows, so they cannot be created as a Sub-workflow. Call create_workflow({agentId, name, kind:"sub"}) without templateId — it returns a valid skeleton — then assemble the graph with update_workflow.',
          }
        }
        const template = await getMcpTemplate(templateId)
        if (!template) return { ok: false, message: `Template "${templateId}" not found. Call list_workflow_templates for valid IDs.`, code: 'TEMPLATE_NOT_FOUND' }
        if (!template.creatable) {
          return { ok: false, message: template.notCreatableReason ?? 'This template cannot be created over MCP.', code: 'TEMPLATE_NOT_CREATABLE' }
        }
        workflowJson = template.workflowJson
        if (template.manifest) {
          const binding: TemplateBinding = { templateId: template.templateId, parameters: template.manifest.parameters }
          templateBinding = JSON.stringify(binding)
        }
      }

      if (kind === SUB_WORKFLOW_KIND) {
        const siblings = await prisma.workflow.findMany({
          where: { agentId, kind: SUB_WORKFLOW_KIND, agent: { userId: auth.userId } },
          select: { workflowJson: true },
        })
        const taken = new Set<string>()
        for (const sib of siblings) {
          const d = readSubWorkflowDefinition(sib.workflowJson)
          if (d.ok) taken.add(d.def.toolName)
        }
        workflowJson = buildSubWorkflowSkeleton(wfName, (n) => taken.has(n))
      }

      const result = await createWorkflow({
        userId: auth.userId,
        agentId,
        name: wfName,
        description,
        workflowJson, // undefined = blank
        templateBinding,
        kind,
      })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      const wf = result.workflow
      const subDef = kind === SUB_WORKFLOW_KIND ? readSubWorkflowDefinition(wf.workflowJson) : null
      return {
        ok: true,
        data: {
          workflowId: wf.workflowId,
          name: wf.name,
          status: wf.status,
          version: wf.version,
          kind,
          templateId,
          editableParameters: templateBinding ? (JSON.parse(templateBinding) as TemplateBinding).parameters.map(p => p.parameterId) : [],
          ...(subDef?.ok
            ? {
                toolName: subDef.def.toolName,
                toolFunctionName: subWorkflowToolFunctionName(subDef.def.toolName),
                note: 'Seeded skeleton: Start/Sub-workflow → End("Done."). Define the tool (toolName, toolDescription, inputs, timeoutSeconds) on the Start node and build the body with update_workflow. It is never deployed — attach it to a caller\'s AI node with a {type:"tool", data:{toolType:"subworkflow", subWorkflowId}} node.',
              }
            : {}),
        },
      }
    }

    case 'patch_workflow_params': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required.' }
      if (!isPositiveInt32(args?.expectedVersion)) {
        return { ok: false, message: 'expectedVersion must be a positive integer. Get it from get_workflow or create_workflow.' }
      }
      const params = args?.params
      if (typeof params !== 'object' || params === null || Array.isArray(params) || Object.keys(params).length === 0) {
        return { ok: false, message: 'params must be a non-empty object of parameterId → value. Get parameterIds from get_workflow_template.' }
      }
      if (Object.keys(params).length > 50) return { ok: false, message: 'Too many params in one call (max 50).' }
      if (args?.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
        return { ok: false, code: 'INVALID_PARAMS', message: 'dryRun must be a boolean (true or false), not a string.' }
      }
      const dryRun = args?.dryRun === true

      const resolved = await getOwnedWorkflow(auth.userId, workflowId)
      if (!resolved.ok) return { ok: false, message: resolved.message, code: resolved.code, meta: resolved.meta }
      const wf = resolved.workflow

      if (wf.status === 'archived') {
        return {
          ok: false,
          code: 'DRAFT_REQUIRED',
          message: 'Parameters cannot be patched on an archived workflow. Switch it to draft or production first.',
        }
      }

      if (!wf.templateBinding) {
        return {
          ok: false,
          code: 'NO_TEMPLATE_BINDING',
          message: 'This workflow was not created from a template via MCP, so it has no editable parameter set. Only workflows created with create_workflow({templateId}) can be patched.',
        }
      }
      let binding: TemplateBinding
      try {
        binding = JSON.parse(wf.templateBinding)
      } catch {
        return { ok: false, code: 'BINDING_CORRUPT', message: 'Stored template binding is unreadable. Recreate the workflow from the template.' }
      }

      if (wf.version !== args.expectedVersion) {
        return {
          ok: false,
          code: 'STALE_CONFLICT',
          message: `Workflow version is ${wf.version}, not ${args.expectedVersion}. Re-read with get_workflow and retry.`,
          meta: { currentVersion: wf.version },
        }
      }

      let parsed: { nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }> }
      try {
        parsed = JSON.parse(wf.workflowJson)
      } catch {
        return { ok: false, code: 'WORKFLOW_JSON_INVALID', message: 'Stored workflowJson is not valid JSON.' }
      }

      const { issues } = applyParams(binding, parsed, params as Record<string, unknown>)
      if (issues.length > 0) {
        return {
          ok: false,
          code: 'PARAM_VALIDATION_FAILED',
          message: `Parameter validation failed: ${issues.map(i => `${i.parameterId ?? '?'}: ${i.message}`).join('; ')}`,
          meta: { issues },
        }
      }

      const newJson = JSON.stringify(parsed)
      const wfKind = normalizeWorkflowKind(wf.kind)
      const structural = validateWorkflowJson(newJson, 'structural', wfKind)
      if (!structural.valid) {
        return {
          ok: false,
          code: 'WORKFLOW_STRUCTURE_INVALID',
          message: `Patched workflow failed structural validation: ${structural.issues.map(i => i.message).join('; ')}`,
          meta: { issues: structural.issues },
        }
      }

      if (dryRun) {
        const deployable = validateWorkflowJson(newJson, 'deployable', wfKind)
        return {
          ok: true,
          data: {
            dryRun: true,
            applied: Object.keys(params),
            structuralValid: true,
            deployableValid: deployable.valid,
            deployableBlockers: deployable.issues.filter(i => i.severity !== 'warning'),
            deployableWarnings: deployable.issues.filter(i => i.severity === 'warning'),
            version: wf.version,
          },
        }
      }

      const result = await updateWorkflow({
        userId: auth.userId,
        workflowId,
        patch: { workflowJson: newJson },
        expectedVersion: args.expectedVersion,
        source: 'mcp',
        createdById: auth.userId,
        note: `params: ${Object.keys(params).join(', ')}`,
        forbidArchived: true,
      })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      return {
        ok: true,
        data: {
          workflowId,
          applied: Object.keys(params),
          version: result.workflow.version,
          status: result.workflow.status,
        },
      }
    }

    case 'validate_workflow': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required.' }
      if (args?.level !== undefined && args.level !== 'structural' && args.level !== 'deployable') {
        return { ok: false, code: 'INVALID_PARAMS', message: `level must be "structural" or "deployable" (got ${JSON.stringify(args.level)}).` }
      }
      const level = args?.level === 'structural' ? 'structural' : 'deployable'
      const resolved = await getOwnedWorkflow(auth.userId, workflowId)
      if (!resolved.ok) return { ok: false, message: resolved.message, code: resolved.code, meta: resolved.meta }
      const r = validateWorkflowJson(resolved.workflow.workflowJson, level, normalizeWorkflowKind(resolved.workflow.kind))
      return {
        ok: true,
        data: {
          workflowId,
          level,
          valid: r.valid,
          issues: r.issues,
          status: resolved.workflow.status,
          kind: normalizeWorkflowKind(resolved.workflow.kind),
          version: resolved.workflow.version,
        },
      }
    }

    case 'update_workflow': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required.' }
      if (!isPositiveInt32(args?.expectedVersion)) {
        return { ok: false, message: 'expectedVersion must be a positive integer. Get it from get_workflow.' }
      }
      if (args?.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
        return { ok: false, code: 'INVALID_PARAMS', message: 'dryRun must be a boolean (true or false), not a string.' }
      }
      const dryRun = args?.dryRun === true
      const incoming = args?.workflowJson
      if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'workflowJson must be an object of shape { nodes: [...], edges: [...] }.' }
      }
      if (JSON.stringify(incoming).length > 1_000_000) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'workflowJson is too large (max 1MB).' }
      }

      const resolved = await getOwnedWorkflow(auth.userId, workflowId)
      if (!resolved.ok) return { ok: false, message: resolved.message, code: resolved.code, meta: resolved.meta }
      const wf = resolved.workflow

      if (wf.status === 'archived') {
        return {
          ok: false,
          code: 'DRAFT_REQUIRED',
          message: 'The node graph cannot be replaced on an archived workflow. Switch it to draft or production first.',
        }
      }

      if (wf.version !== args.expectedVersion) {
        return {
          ok: false,
          code: 'STALE_CONFLICT',
          message: `Workflow version is ${wf.version}, not ${args.expectedVersion}. Re-read with get_workflow and retry.`,
          meta: { currentVersion: wf.version },
        }
      }

      const incomingGraph = incoming as { nodes?: unknown }
      if (Array.isArray(incomingGraph.nodes)) {
        let storedParsed: { nodes: Array<{ id: string; data?: unknown }> } | null = null
        try {
          storedParsed = JSON.parse(wf.workflowJson)
        } catch {
          storedParsed = null
        }
        const maskIssues = restoreMaskedSecrets(
          incoming as { nodes: Array<{ id: string; data?: unknown }> },
          storedParsed && Array.isArray(storedParsed.nodes) ? storedParsed : { nodes: [] },
        )
        if (maskIssues.length > 0) {
          return {
            ok: false,
            code: 'MASKED_VALUE_UNRESOLVED',
            message: `Masked values could not be resolved: ${maskIssues.map(i => `node "${i.nodeId}" ${i.message}`).join(' | ')}`,
            meta: { issues: maskIssues },
          }
        }
      }

      const newJson = JSON.stringify(incoming)

      const outsideNodes = Object.fromEntries(
        Object.entries(incoming as Record<string, unknown>).filter(([k]) => k !== 'nodes'),
      )
      if (JSON.stringify(outsideNodes).includes(MASK)) {
        return {
          ok: false,
          code: 'MASKED_VALUE_UNRESOLVED',
          message: `${MASK} placeholders were found outside node data (e.g. in edges) — only values inside an unmodified node can be restored. Replace them with real values.`,
        }
      }
      const byteSize = Buffer.byteLength(newJson, 'utf8')
      if (byteSize > 1_000_000) {
        return { ok: false, code: 'INVALID_PARAMS', message: `workflowJson is too large (${byteSize} bytes, max 1MB).` }
      }
      const wfKind = normalizeWorkflowKind(wf.kind)
      const structural = validateWorkflowJson(newJson, 'structural', wfKind)
      if (!structural.valid) {
        return {
          ok: false,
          code: 'WORKFLOW_STRUCTURE_INVALID',
          message: `Workflow failed structural validation: ${structural.issues.map(i => i.message).join('; ')}`,
          meta: { issues: structural.issues },
        }
      }
      const deployable = validateWorkflowJson(newJson, 'deployable', wfKind)

      if (dryRun) {
        return {
          ok: true,
          data: {
            dryRun: true,
            structuralValid: true,
            deployableValid: deployable.valid,
            deployableBlockers: deployable.issues.filter(i => i.severity !== 'warning'),
            deployableWarnings: deployable.issues.filter(i => i.severity === 'warning'),
            version: wf.version,
          },
        }
      }

      const result = await updateWorkflow({
        userId: auth.userId,
        workflowId,
        patch: { workflowJson: newJson, ...(wf.templateBinding ? { templateBinding: null } : {}) },
        expectedVersion: args.expectedVersion,
        source: 'mcp',
        createdById: auth.userId,
        note: 'full graph update',
        forbidArchived: true,
      })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      return {
        ok: true,
        data: {
          workflowId,
          version: result.workflow.version,
          status: result.workflow.status,
          deployableValid: deployable.valid,
          deployableBlockers: deployable.issues.filter(i => i.severity !== 'warning'),
          deployableWarnings: deployable.issues.filter(i => i.severity === 'warning'),
          ...(wf.templateBinding
            ? {
                templateBindingCleared: true,
                note: 'This workflow was created from a template; replacing the whole graph removed its template parameter binding, so patch_workflow_params no longer applies. Use update_workflow from now on.',
              }
            : {}),
        },
      }
    }

    case 'request_workflow_deploy': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required. Call list_workflows first.' }
      const result = await createDeployRequest({ userId: auth.userId, tokenId: auth.tokenId, workflowId })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      const baseUrl = getAppBaseUrl()
      const confirmationUrl = `${baseUrl}/app/deploy/${result.request.id}`
      return {
        ok: true,
        data: {
          requestId: result.request.id,
          confirmationUrl,
          expiresAt: result.request.expiresAt,
          workflowId: result.request.workflowId,
          targetVersion: result.request.targetVersion,
          status: 'pending_owner_confirmation',
          note:
            'Deployment is NOT done yet. Send confirmationUrl to the account owner — they must open it while logged in ' +
            'to their AiTalk dashboard and click Deploy to make this workflow live. The request is single-use and ' +
            'expires at expiresAt. If you edit the draft after this, the request becomes stale and you must call ' +
            'request_workflow_deploy again.',
        },
      }
    }

    case 'deploy_workflow': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required. Call list_workflows first.' }
      if (!isPositiveInt32(args?.expectedVersion)) {
        return { ok: false, message: 'expectedVersion must be a positive integer. Get it from get_workflow.' }
      }
      const result = await setWorkflowStatus({
        userId: auth.userId,
        workflowId,
        status: 'production',
        expectedVersion: args.expectedVersion,
      })
      if (!result.ok) return { ok: false, message: result.message, code: result.code, meta: result.meta }
      const wasLive = result.previousStatus === 'production'
      return {
        ok: true,
        data: {
          workflowId: result.workflow.workflowId,
          status: result.workflow.status,
          version: result.workflow.version,
          ...(wasLive ? { alreadyLive: true } : {}),
          note: wasLive
            ? 'No change — this workflow was already live. Nothing was re-validated or re-deployed.'
            : 'This workflow is now LIVE and handles real customer traffic. Use undeploy_workflow to take it off the air.',
        },
      }
    }

    case 'undeploy_workflow': {
      const workflowId = typeof args?.workflowId === 'string' ? args.workflowId : ''
      if (!workflowId) return { ok: false, message: 'workflowId is required. Call list_workflows first.' }
      const result = await setWorkflowStatus({
        userId: auth.userId,
        workflowId,
        status: 'draft',
        expectedCurrentStatus: 'production',
      })
      if (!result.ok) {
        if (result.code === 'STATUS_CHANGED') {
          const cur = (result.meta as { currentStatus?: string } | undefined)?.currentStatus ?? 'unknown'
          return {
            ok: false,
            code: 'NOT_LIVE',
            message: `This workflow is not live (status: ${cur}), so there is nothing to take off the air.`,
          }
        }
        return { ok: false, message: result.message, code: result.code, meta: result.meta }
      }
      return {
        ok: true,
        data: {
          workflowId: result.workflow.workflowId,
          status: result.workflow.status,
          version: result.workflow.version,
          note: 'Taken off the air: as of now no new chats or calls are routed to it and scheduled runs are skipped. A call already connected continues until it ends.',
        },
      }
    }

    case 'list_source_files': {
      const agentId = typeof args?.agentId === 'string' ? args.agentId : ''
      if (!agentId) return { ok: false, message: 'agentId is required. Call list_agents first.' }
      if (args?.limit !== undefined && !isPositiveInt32(args.limit)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'limit must be a positive integer.' }
      }
      if (args?.offset !== undefined && !(typeof args.offset === 'number' && Number.isInteger(args.offset) && args.offset >= 0 && args.offset <= 2147483647)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'offset must be a non-negative int32.' }
      }
      const limit = Math.min(typeof args?.limit === 'number' ? args.limit : 50, 200)
      const offset = typeof args?.offset === 'number' ? args.offset : 0
      if (!(await requireOwnedAgent(auth.userId, agentId))) {
        return { ok: false, code: 'AGENT_NOT_FOUND', message: 'Agent not found or unauthorized. Call list_agents first.' }
      }
      const where = { agentId, type: 'file' }
      const [files, total] = await Promise.all([
        prisma.storage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true, title: true, status: true, fileSizeBytes: true, mimeType: true,
            ragProvider: true, ragSpaceId: true, errorMessage: true, createdAt: true, updatedAt: true,
          },
        }),
        prisma.storage.count({ where }),
      ])
      return {
        ok: true,
        data: {
          files: files.map(f => ({
            storageId: f.id,
            title: stripUrlCredentials(f.title),
            status: f.status, // processing | completed | failed
            fileSizeBytes: f.fileSizeBytes,
            mimeType: f.mimeType ? stripUrlCredentials(f.mimeType) : f.mimeType,
            ragProvider: f.ragProvider,
            ragSpaceId: f.ragSpaceId,
            ...(f.errorMessage ? { errorMessage: stripUrlCredentials(f.errorMessage) } : {}),
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          })),
          total,
          limit,
          offset,
        },
      }
    }

    case 'get_source_file': {
      const agentId = typeof args?.agentId === 'string' ? args.agentId : ''
      if (!agentId) return { ok: false, message: 'agentId is required. Call list_agents first.' }
      if (!isPositiveInt32(args?.storageId)) {
        return { ok: false, message: 'storageId must be a positive integer. Call list_source_files first.' }
      }
      if (!(await requireOwnedAgent(auth.userId, agentId))) {
        return { ok: false, code: 'AGENT_NOT_FOUND', message: 'Agent not found or unauthorized. Call list_agents first.' }
      }
      const item = await prisma.storage.findFirst({
        where: { id: args.storageId, agentId, type: 'file' },
        select: {
          id: true, title: true, status: true, fileSizeBytes: true, mimeType: true,
          ragProvider: true, ragSpaceId: true, content: true, errorMessage: true,
          ragStatus: true, createdAt: true, updatedAt: true,
        },
      })
      if (!item) {
        return {
          ok: false,
          code: 'SOURCE_FILE_NOT_FOUND',
          message: 'Source file not found for this agent. Only file-type sources are accessible over MCP — call list_source_files for valid IDs.',
        }
      }
      let content: string | null = null
      let contentTruncated = false
      let totalContentBytes = 0
      let contentSource: 'stored' | 'indexed_chunks' | null = null
      let contentNote: string | null = null
      const INDEXED_PREFIX =
        'This text was reassembled from the indexed chunks (the extracted text the AI actually searches), ' +
        'not the uploaded original — layout, images and tables are lost.'
      if (item.content) {
        const t = truncateUtf8(stripUrlCredentials(item.content), SOURCE_CONTENT_MAX_BYTES)
        content = t.text
        contentTruncated = t.truncated
        totalContentBytes = t.totalBytes
        contentSource = 'stored'
      } else if ((item.ragProvider === 'azure_ai_search' || item.ragProvider === 'pgvector') && item.status === 'completed') {
        const expected = azureChunkCount(item.ragStatus)
        const indexed = await readIndexedText(auth.userId, agentId, item.id, expected)
        if (indexed.ok) {
          const t = truncateUtf8(stripUrlCredentials(indexed.text), SOURCE_CONTENT_MAX_BYTES)
          content = t.text
          contentTruncated = t.truncated
          totalContentBytes = t.totalBytes
          contentSource = 'indexed_chunks'
          contentNote = indexed.partial
            ? `${INDEXED_PREFIX} Only the beginning of the document could be read back${expected !== null ? ` (${indexed.chunkCount} of ${expected} chunks)` : ''} — the rest is missing, so do not treat this as the complete document.`
            : INDEXED_PREFIX
        } else if (indexed.reason === 'empty') {
          contentNote = 'This file is indexed but holds no extractable text (e.g. a scanned image with no recognisable characters), so there is nothing to read back.'
        } else if (indexed.reason === 'no_region') {
          contentNote = 'The document text cannot be read back for this account, because it has no active managed region (for example a retained or suspended subscription). Retrying will not help; the file metadata above is still accurate.'
        } else {
          contentNote = 'The document text could not be read back from the search index. Retry once. If it keeps failing, do not assume the document is empty or broken — report it to the account owner, who can check the file on the dashboard Storage page.'
        }
      }
      if (content === null && !contentNote) {
        contentNote = item.status === 'processing'
          ? 'The document text is not available yet because indexing is still running. Poll this tool until status is "completed" (or "failed").'
          : item.status === 'failed'
            ? 'The document text is not available because indexing failed. Read errorMessage above and address that specific cause — re-adding the document only helps if the content itself was the problem.'
            : 'No document text is available for this file.'
      }
      return {
        ok: true,
        data: {
          storageId: item.id,
          title: stripUrlCredentials(item.title),
          status: item.status,
          fileSizeBytes: item.fileSizeBytes,
          mimeType: item.mimeType ? stripUrlCredentials(item.mimeType) : item.mimeType, // codex R19 #3
          ragProvider: item.ragProvider,
          ragSpaceId: item.ragSpaceId,
          ...(item.errorMessage ? { errorMessage: stripUrlCredentials(item.errorMessage) } : {}),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          content,
          contentSource, // stored | indexed_chunks | null
          contentTruncated,
          totalContentBytes,
          ...(contentNote ? { contentNote } : {}),
          ...(item.status === 'processing'
            ? { note: 'Indexing is still in progress — the document is not searchable by the AI yet. Poll this tool until status is "completed" (or "failed").' }
            : {}),
        },
      }
    }

    case 'create_source_text': {
      const agentId = typeof args?.agentId === 'string' ? args.agentId : ''
      if (!agentId) return { ok: false, message: 'agentId is required. Call list_agents first.' }
      const title = typeof args?.title === 'string' ? args.title.trim() : ''
      if (!title) return { ok: false, code: 'INVALID_PARAMS', message: 'title is required.' }
      if (title.length > 200) return { ok: false, code: 'INVALID_PARAMS', message: 'title is too long (max 200 chars).' }
      const content = typeof args?.content === 'string' ? args.content : ''
      if (!content.trim()) return { ok: false, code: 'INVALID_PARAMS', message: 'content is required (plain text).' }
      if (Buffer.byteLength(content, 'utf8') > 1_000_000) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'content is too large (max 1MB). Split the document into multiple source files.' }
      }
      if (args?.ragSpaceId !== undefined && !isPositiveInt32(args.ragSpaceId)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'ragSpaceId must be a positive integer (or omitted for the Default space).' }
      }
      const result = await createTextSource({
        userId: auth.userId,
        agentId,
        title,
        content,
        requestRagProvider: null,
        requireManaged: true,
        ragSpaceIdInput: typeof args?.ragSpaceId === 'number' ? args.ragSpaceId : null,
      })
      if (!result.ok) return { ok: false, message: result.message, code: result.code }
      return {
        ok: true,
        data: {
          storageId: result.storageId,
          status: 'processing',
          note:
            'Indexing is asynchronous — the document is NOT searchable by the AI yet. Poll get_source_file until ' +
            'status is "completed" (typically seconds to a few minutes). If status becomes "failed", check errorMessage.',
        },
      }
    }

    case 'delete_source_file': {
      const agentId = typeof args?.agentId === 'string' ? args.agentId : ''
      if (!agentId) return { ok: false, message: 'agentId is required. Call list_agents first.' }
      if (!isPositiveInt32(args?.storageId)) {
        return { ok: false, message: 'storageId must be a positive integer. Call list_source_files first.' }
      }
      if (!(await requireOwnedAgent(auth.userId, agentId))) {
        return { ok: false, code: 'AGENT_NOT_FOUND', message: 'Agent not found or unauthorized. Call list_agents first.' }
      }
      const item = await prisma.storage.findFirst({
        where: { id: args.storageId, agentId },
        select: { type: true, status: true },
      })
      if (!item) {
        return {
          ok: false,
          code: 'SOURCE_FILE_NOT_FOUND',
          message: 'Source file not found for this agent. Call list_source_files for valid IDs.',
        }
      }
      if (item.type !== 'file') {
        return {
          ok: false,
          code: 'NOT_A_SOURCE_FILE',
          message: `Only file-type sources can be deleted over MCP (this item is type "${item.type}"). Manage website/Google Drive/SharePoint/GitBook sources in the dashboard.`,
        }
      }
      if (item.status === 'processing') {
        return {
          ok: false,
          code: 'SOURCE_FILE_PROCESSING',
          message: 'This file is still being indexed. Poll get_source_file until status is "completed" or "failed", then delete.',
        }
      }
      const result = await deleteStorageItem({ userId: auth.userId, agentId, storageId: args.storageId })
      if (!result.ok) return { ok: false, message: result.message, code: result.code }
      return { ok: true, data: { storageId: args.storageId, deleted: true } }
    }

    case 'list_conversations': {
      if (args?.agentId !== undefined && (typeof args.agentId !== 'string' || !args.agentId)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'agentId must be a non-empty string (or omitted for all agents).' }
      }
      const agentId = typeof args?.agentId === 'string' ? args.agentId : null
      const SOURCE_FILTERS = ['all', 'text', 'voice', 'quiz'] as const
      if (args?.source !== undefined && !SOURCE_FILTERS.includes(args.source as (typeof SOURCE_FILTERS)[number])) {
        return { ok: false, code: 'INVALID_PARAMS', message: `source must be one of ${SOURCE_FILTERS.join(', ')} (got ${JSON.stringify(args.source)}).` }
      }
      const source = (args?.source as (typeof SOURCE_FILTERS)[number] | undefined) ?? 'all'
      let since: Date | null = null
      if (args?.since !== undefined) {
        if (typeof args.since !== 'string' || Number.isNaN(Date.parse(args.since))) {
          return { ok: false, code: 'INVALID_PARAMS', message: 'since must be an ISO 8601 date/time string (e.g. 2026-07-01 or 2026-07-01T00:00:00Z).' }
        }
        since = new Date(args.since)
      }
      let until: Date | null = null
      if (args?.until !== undefined) {
        if (typeof args.until !== 'string' || Number.isNaN(Date.parse(args.until))) {
          return { ok: false, code: 'INVALID_PARAMS', message: 'until must be an ISO 8601 date/time string (e.g. 2026-07-21 or 2026-07-21T23:59:59Z).' }
        }
        until = new Date(args.until)
      }
      if (args?.limit !== undefined && !isPositiveInt32(args.limit)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'limit must be a positive integer.' }
      }
      if (args?.offset !== undefined && !(typeof args.offset === 'number' && Number.isInteger(args.offset) && args.offset >= 0 && args.offset <= 2147483647)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'offset must be a non-negative int32.' }
      }
      const limit = Math.min(typeof args?.limit === 'number' ? args.limit : 20, 100)
      const offset = typeof args?.offset === 'number' ? args.offset : 0
      if (agentId && !(await requireOwnedAgent(auth.userId, agentId))) {
        return { ok: false, code: 'AGENT_NOT_FOUND', message: 'Agent not found or unauthorized. Call list_agents first.' }
      }
      const { entries, total } = await listConversationEntries({
        userId: auth.userId, agentId, source, since, until, limit, offset,
      })
      return { ok: true, data: { conversations: entries, total, limit, offset } }
    }

    case 'get_conversation': {
      const conversationId = typeof args?.conversationId === 'string' ? args.conversationId : ''
      if (!conversationId) return { ok: false, message: 'conversationId is required. Call list_conversations first.' }
      if (args?.messageOffset !== undefined && !(typeof args.messageOffset === 'number' && Number.isInteger(args.messageOffset) && args.messageOffset >= 0 && args.messageOffset <= 2147483647)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'messageOffset must be a non-negative int32.' }
      }
      if (args?.messageLimit !== undefined && !isPositiveInt32(args.messageLimit)) {
        return { ok: false, code: 'INVALID_PARAMS', message: 'messageLimit must be a positive integer.' }
      }
      const messageOffset = typeof args?.messageOffset === 'number' ? args.messageOffset : 0
      const messageLimit = Math.min(typeof args?.messageLimit === 'number' ? args.messageLimit : 100, 500)
      const result = await getConversationDetail({ userId: auth.userId, conversationId, messageOffset, messageLimit })
      if (!result.ok) return { ok: false, message: result.message, code: result.code }
      const { ok: _ok, decryptFailedRows, ...data } = result
      const notes: string[] = []
      if (decryptFailedRows > 0) notes.push(`${decryptFailedRows} stored row(s) could not be decrypted and were skipped.`)
      if (result.rowLimitReached) notes.push('This conversation exceeds the 500-row window; only messages from the first 500 rows are accessible over MCP.')
      return {
        ok: true,
        data: {
          ...data,
          ...(decryptFailedRows > 0 ? { decryptFailedRows } : {}),
          ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
        },
      }
    }

    default:
      return { ok: false, message: `Unknown tool: ${name}` }
  }
}
