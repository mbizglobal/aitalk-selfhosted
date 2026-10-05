
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { createWorkflowBundle } from '@/lib/workflow/service'
import { mergeBundleIntoTemplate } from '@/lib/workflow/bundle-template'
import { workflowServiceErrorResponse } from '@/lib/workflow/service-rest'
import { getLocalTemplate } from '@/lib/local-templates'
import { describeCaughtError } from '@/lib/log-mask'

function usesLocalTemplates(): boolean {
  return process.env.NODE_ENV !== 'production'
}

const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-]{0,49}$/

const ALLOWED_BODY_KEYS = new Set(['templateId', 'name', 'description'])

const BUNDLE_BODY_KEYS = new Set(['workflowJson', 'kind', 'dataSheetSchema', 'subWorkflows', 'dataSheets', 'wiring', 'group', 'bundleVersion'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { agentId } = await params
    const raw = await request.json().catch(() => null)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'A JSON object with templateId is required', code: 'TEMPLATE_ID_REQUIRED' }, { status: 400 })
    }
    const body = raw as Record<string, unknown>

    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_BODY_KEYS.has(k))
    if (unknownKeys.length > 0) {
      const sentBundleBody = unknownKeys.filter((k) => BUNDLE_BODY_KEYS.has(k))
      return NextResponse.json(
        sentBundleBody.length > 0
          ? {
              error: `This endpoint only takes templateId — the bundle body is read on the server. Remove: ${sentBundleBody.join(', ')}`,
              code: 'BUNDLE_BODY_NOT_ACCEPTED',
            }
          : { error: `Unexpected field(s): ${unknownKeys.join(', ')}`, code: 'BODY_KEY_NOT_ALLOWED' },
        { status: 400 },
      )
    }

    if (body.templateId === undefined) {
      return NextResponse.json({ error: 'templateId is required', code: 'TEMPLATE_ID_REQUIRED' }, { status: 400 })
    }
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : ''
    if (!TEMPLATE_ID_RE.test(templateId)) {
      return NextResponse.json({ error: 'templateId must be lower-case letters, digits and hyphens', code: 'TEMPLATE_ID_INVALID' }, { status: 400 })
    }
    for (const k of ['name', 'description'] as const) {
      if (body[k] !== undefined && typeof body[k] !== 'string') {
        return NextResponse.json({ error: `${k} must be a string`, code: 'BODY_FIELD_INVALID' }, { status: 400 })
      }
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (name.length > 255) {
      return NextResponse.json({ error: 'name is too long (max 255 characters)', code: 'BODY_FIELD_INVALID' }, { status: 400 })
    }

    const owned = await prisma.agent.findFirst({
      where: { agentId, userId: session.user.id },
      select: { agentId: true },
    })
    if (!owned) {
      return NextResponse.json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' }, { status: 404 })
    }

    let template: unknown = null
    if (usesLocalTemplates()) {
      template = getLocalTemplate(templateId) as unknown
    } else {
      const row = await prisma.workflowTemplate.findUnique({ where: { templateId } })
      if (row) {
        const merged = mergeBundleIntoTemplate({
          templateId: row.templateId,
          name: row.name,
          description: row.description,
          workflowJson: row.workflowJson,
          bundleJson: row.bundleJson,
        })
        if (!merged.ok) {
          console.error(
            `[from-template] stored bundle is invalid (templateId=${templateId}):`,
            merged.problems.map((p) => `${p.code} ${p.message}`).join(' / ')
          )
          return NextResponse.json(
            {
              error: 'This template is stored incorrectly and cannot be created. Ask the administrator to re-copy it.',
              code: 'BUNDLE_STORED_INVALID',
            },
            { status: 500 }
          )
        }
        template = merged.template
      }
    }
    if (!template) {
      return NextResponse.json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }, { status: 404 })
    }

    const created = await createWorkflowBundle({
      userId: session.user.id,
      agentId,
      template,
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    })
    if (!created.ok) {
      return workflowServiceErrorResponse(created)
    }

    return NextResponse.json({
      success: true,
      workflow: created.workflow,
      subWorkflows: created.subWorkflows.map(({ workflowJson, ...rest }) => rest),
      dataSheetIds: created.dataSheetIds,
      groupId: created.groupId,
    })
  } catch (error) {
    console.error('[POST /workflows/from-template] Error:', describeCaughtError(error))
    return NextResponse.json({ error: 'Failed to create the workflows for this template', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
