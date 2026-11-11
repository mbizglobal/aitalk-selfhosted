import { prisma } from '@/lib/prisma'
import { getAppBaseUrl } from '@/lib/app-url'
import { blocksForEdition } from '@/lib/work/assembled'
import type { McpAuthContext } from './auth'
import type { McpToolResult } from './tools'

const WA = 'Assembled work apps (no build — an app spec of ready-made blocks). Read aitalk://work-app-guide first.'

export const WORK_APP_MCP_TOOLS = [
  {
    name: 'list_work_blocks',
    get description() { return `${WA} List the blocks you can assemble a work app from (${blocksForEdition().filter((b) => b.available).map((b) => b.id).join(', ')}), the limits and the column kinds — the same source the validator checks against.` },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_work_app_spec',
    description: `${WA} Read an assembled work app: its app spec, version (the expectedVersion for update_work_app_spec), rows per table and per status value, the canvas workflowId and the app URL. Pass workAppId (from create_work_app) or the canvas workflowId.`,
    inputSchema: {
      type: 'object',
      properties: { workAppId: { type: 'string' }, workflowId: { type: 'string', description: 'canvas workflow of the app (list_workflows)' } },
      additionalProperties: false,
    },
  },
  {
    name: 'validate_work_app_spec',
    description: `${WA} Check an app spec without saving anything. Returns every problem with its path, code and reason. With workAppId it also checks the change rules against the saved spec and its current rows (they are checked again when you save).`,
    inputSchema: {
      type: 'object',
      properties: { spec: { type: 'object', additionalProperties: true }, workAppId: { type: 'string' } },
      required: ['spec'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_work_app',
    description: `${WA} Create a new assembled work app for an agent: a new canvas workflow (Start / App → the app) that is switched on right away for the team — it has no customer channel — plus the app spec as version 1, in one step. Plan limits on workflows and live workflows apply. Requires the write scope. Returns workAppId, workflowId, version and appUrl (give appUrl to the owner).`,
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string', description: 'from list_agents' }, spec: { type: 'object', additionalProperties: true } },
      required: ['agentId', 'spec'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_work_app_spec',
    description: `${WA} Change the app spec of an assembled work app. If the app has no rows yet the change is applied at once. If it has rows, nothing is changed: you get a confirmationUrl — give it to the account owner, who opens it while logged in, sees what changes and presses Apply (single use · about 15 minutes). expectedVersion = version from get_work_app_spec. dryRun:true checks everything and saves nothing (no link either). Requires the write scope.`,
    inputSchema: {
      type: 'object',
      properties: {
        workAppId: { type: 'string' },
        spec: { type: 'object', additionalProperties: true },
        expectedVersion: { type: 'integer' },
        dryRun: { type: 'boolean' },
      },
      required: ['workAppId', 'spec', 'expectedVersion'],
      additionalProperties: false,
    },
  },
] as const

export const WORK_APP_TOOL_SCOPES: Record<string, string> = {
  list_work_blocks: 'read',
  get_work_app_spec: 'read',
  validate_work_app_spec: 'read',
  create_work_app: 'write',
  update_work_app_spec: 'write',
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
const deps = async () => ({ db: prisma, dataKey: (await import('@/lib/user-data-key')).ensureUserDataKey })

async function resolveApp(userId: string, a: { workAppId?: unknown; workflowId?: unknown }): Promise<{ ok: true; projectId: string; appWorkflowId: string | null; status: string } | { ok: false; message: string; code: string; meta?: Record<string, unknown> }> {
  const id = str(a.workAppId)
  const wf = str(a.workflowId)
  if (!id && !wf) return { ok: false, code: 'INVALID', message: 'pass workAppId or workflowId' }
  const rows = await prisma.workProject.findMany({
    where: { userId, kind: 'assembled', ...(id ? { id } : { OR: [{ workflowId: wf }, { workflow: { parentWorkflowId: wf } }] }) },
    select: { id: true, workflowId: true, status: true },
  })
  if (!rows.length) return { ok: false, code: 'NOT_FOUND', message: 'no assembled work app with that id in this account' }
  if (rows.length > 1) return { ok: false, code: 'CHOOSE', message: 'this canvas has more than one assembled app — pass workAppId', meta: { workAppIds: rows.map((r) => r.id) } }
  return { ok: true, projectId: rows[0].id, appWorkflowId: rows[0].workflowId, status: rows[0].status }
}

async function appUrl(userId: string, appWorkflowId: string | null): Promise<string | null> {
  if (!appWorkflowId) return null
  const w = await prisma.workflow.findFirst({ where: { workflowId: appWorkflowId, agent: { userId } }, select: { agentId: true } })
  return w ? `${getAppBaseUrl()}/chat/${encodeURIComponent(w.agentId)}/app?workflowId=${encodeURIComponent(appWorkflowId)}` : null
}

const issuesErr = (issues: unknown, extra: Record<string, unknown> = {}): McpToolResult => ({ ok: false, code: 'SPEC_INVALID', message: 'the app spec was not accepted — fix every issue (path · code · message) and try again', meta: { issues, ...extra } })

export async function executeWorkAppTool(auth: McpAuthContext, name: string, args: Record<string, unknown> | undefined): Promise<McpToolResult> {
  const { WorkError } = await import('@/lib/work/errors')
  try {
    return await runWorkAppTool(auth, name, args ?? {})
  } catch (e) {
    if (e instanceof WorkError) return { ok: false, code: e.code, message: e.message || e.code }
    throw e
  }
}

async function runWorkAppTool(auth: McpAuthContext, name: string, a: Record<string, unknown>): Promise<McpToolResult> {
  const W = await import('@/lib/work/assembled')
  switch (name) {
    case 'list_work_blocks': {
      const { blockCatalogData } = await import('./resources/render-block-catalog')
      return { ok: true, data: blockCatalogData() }
    }
    case 'get_work_app_spec': {
      const r = await resolveApp(auth.userId, a)
      if (!r.ok) return r
      const d = await deps()
      const key = await d.dataKey(prisma, auth.userId)
      const sp = await W.readSpec(prisma, key, { userId: auth.userId, projectId: r.projectId })
      const { readSpecRowCounts } = await import('@/lib/work/assembled-proposals')
      const canvas = r.appWorkflowId ? (await prisma.workflow.findFirst({ where: { workflowId: r.appWorkflowId }, select: { parentWorkflowId: true } }))?.parentWorkflowId ?? null : null
      return {
        ok: true,
        data: {
          workAppId: r.projectId,
          workflowId: canvas,
          status: r.status,
          open: canvas ? (await prisma.workflow.findFirst({ where: { workflowId: canvas }, select: { status: true } }))?.status === 'production' : false,
          version: sp?.version ?? 0,
          spec: sp?.spec ?? null,
          rows: sp ? await readSpecRowCounts(prisma, { userId: auth.userId, projectId: r.projectId, spec: sp.spec }) : [],
          appUrl: await appUrl(auth.userId, r.appWorkflowId),
        },
      }
    }
    case 'validate_work_app_spec': {
      if (!a.workAppId) {
        const v = W.validateSpec(a.spec)
        return v.ok ? { ok: true, data: { ok: true, spec: v.spec } } : { ok: true, data: { ok: false, issues: v.issues } }
      }
      const r = await resolveApp(auth.userId, a)
      if (!r.ok) return r
      const { updateAppSpec } = await import('@/lib/work/assembled-proposals')
      const d = await deps()
      const key = await d.dataKey(prisma, auth.userId)
      const cur = await W.readSpec(prisma, key, { userId: auth.userId, projectId: r.projectId })
      const x = await updateAppSpec(d, { userId: auth.userId, tokenId: auth.tokenId, projectId: r.projectId, spec: a.spec, expectedVersion: cur?.version ?? 0, dryRun: true })
      return { ok: true, data: x.ok ? { ok: true, version: x.version, needsConfirmation: !!x.needsConfirmation, created: x.created, changed: x.changed } : { ok: false, issues: x.issues, ...(x.currentVersion !== undefined ? { currentVersion: x.currentVersion } : {}) } }
    }
    case 'create_work_app': {
      const agentId = str(a.agentId)
      if (!agentId) return { ok: false, code: 'INVALID', message: 'agentId is required — call list_agents first' }
      const { createAssembledApp } = await import('@/lib/workflow/service')
      const r = await createAssembledApp({ userId: auth.userId, agentId, spec: a.spec })
      if ('issues' in r) return issuesErr(r.issues)
      if (!r.ok) return { ok: false, message: r.message, code: r.code, meta: r.meta }
      return { ok: true, data: { workAppId: r.workAppId, workflowId: r.workflowId, version: r.version, appUrl: await appUrl(auth.userId, r.appWorkflowId), note: 'The app is open for the team now. Give appUrl to the owner. Rows are added in the app (screen or its AI chat), not over MCP.' } }
    }
    case 'update_work_app_spec': {
      if (!Number.isInteger(a.expectedVersion) || (a.expectedVersion as number) < 0) return { ok: false, code: 'INVALID', message: 'expectedVersion is the version from get_work_app_spec (a whole number, 0 or more)' }
      if (a.dryRun !== undefined && typeof a.dryRun !== 'boolean') return { ok: false, code: 'INVALID', message: 'dryRun is true or false' }
      const r = await resolveApp(auth.userId, a)
      if (!r.ok) return r
      const { updateAppSpec } = await import('@/lib/work/assembled-proposals')
      const x = await updateAppSpec(await deps(), { userId: auth.userId, tokenId: auth.tokenId, projectId: r.projectId, spec: a.spec, expectedVersion: a.expectedVersion, dryRun: a.dryRun === true })
      if (!x.ok) return issuesErr(x.issues, x.currentVersion !== undefined ? { currentVersion: x.currentVersion } : {})
      if (x.proposal) {
        return {
          ok: true,
          data: {
            applied: false, status: 'pending_owner_confirmation', version: x.version, rows: x.rows,
            confirmationUrl: `${getAppBaseUrl()}/app/work/spec/${x.proposal.id}`, expiresAt: x.proposal.expiresAt,
            note: 'NOT changed yet — the app has rows. Send confirmationUrl to the account owner: they open it while logged in, see what changes and press Apply. Single use; expires at expiresAt. If the app changes first, ask again.',
          },
        }
      }
      return { ok: true, data: { applied: x.applied, dryRun: x.dryRun, version: x.version, needsConfirmation: !!x.needsConfirmation, created: x.created, changed: x.changed } }
    }
  }
  return { ok: false, message: `Unknown tool: ${name}`, code: 'UNKNOWN_TOOL' }
}
