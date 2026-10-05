
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { createWorkflow, listWorkflows, updateWorkflow } from '@/lib/workflow/service'
import { buildSubWorkflowSkeleton, readSubWorkflowDefinition } from '@/lib/workflow/subworkflow'
import { workflowServiceErrorResponse } from '@/lib/workflow/service-rest'

// ========================================
// GET /api/agents/[agentId]/workflows
// ========================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params

    const result = await listWorkflows({ userId: session.user.id, agentId })
    if (!result.ok) {
      return workflowServiceErrorResponse(result)
    }

    return NextResponse.json({
      success: true,
      workflows: result.workflows
    })

  } catch (error) {
    console.error('[GET /api/agents/[agentId]/workflows] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ========================================
// POST /api/agents/[agentId]/workflows
// ========================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params
    const body = await request.json()

    let finalWorkflowJson = body.workflowJson
    if (body.workflowJson) {
      try {
        const workflowData = JSON.parse(body.workflowJson)
        if (workflowData.nodes && Array.isArray(workflowData.nodes)) {
          workflowData.nodes = workflowData.nodes.map((node: any) => {
            if (node.data?.nodeType === 'ai' &&
                node.data?.outputFormat === 'json' &&
                node.data?.schemaProperties &&
                node.data.schemaProperties.length > 0 &&
                !node.data.jsonSchema) {
              const schemaProperties = node.data.schemaProperties
              const schemaName = node.data.schemaName || 'json_schema'
              const schema: any = {
                name: schemaName,
                schema: {
                  type: 'object',
                  properties: {},
                  required: [],
                  additionalProperties: false
                }
              }
              for (const prop of schemaProperties) {
                if (!prop.name) continue
                let propSchema: any = { type: prop.type }
                if (prop.description) propSchema.description = prop.description
                if (prop.type === 'enum' && prop.enumValues?.length > 0) {
                  propSchema = { enum: prop.enumValues }
                }
                schema.schema.properties[prop.name] = propSchema
                if (prop.required) schema.schema.required.push(prop.name)
              }
              node.data.jsonSchema = JSON.stringify(schema, null, 2)
            }
            return node
          })
          finalWorkflowJson = JSON.stringify(workflowData)
        }
      } catch (e) {
        console.warn('[API] Failed to process workflowJson:', e)
      }
    }

    const kind = body.kind === 'sub' ? 'sub' : 'main'
    if (kind === 'sub' && !finalWorkflowJson) {
      const siblings = await prisma.workflow.findMany({
        where: { agentId, kind: 'sub' },
        select: { workflowJson: true },
      })
      const taken = new Set<string>()
      for (const sib of siblings) {
        const d = readSubWorkflowDefinition(sib.workflowJson)
        if (d.ok) taken.add(d.def.toolName)
      }
      finalWorkflowJson = buildSubWorkflowSkeleton(typeof body.name === 'string' ? body.name : '', (n) => taken.has(n))
    }
    const created = await createWorkflow({
      userId: session.user.id,
      agentId,
      name: body.name,
      description: body.description || null,
      workflowJson: finalWorkflowJson || undefined,
      status: body.status,
      kind,
    })
    if (!created.ok) {
      return workflowServiceErrorResponse(created)
    }
    let workflow = created.workflow

    let createdDataSheet: Awaited<ReturnType<typeof prisma.dataSheet.create>> | null = null
    if (body.dataSheetSchema && body.dataSheetSchema.columns?.length > 0) {
      const compensateAndFail = async () => {
        try {
          await prisma.$transaction([
            ...(createdDataSheet ? [prisma.dataSheet.delete({ where: { id: createdDataSheet.id } })] : []),
            prisma.workflow.delete({ where: { workflowId: workflow.workflowId } }),
          ])
        } catch (cleanupErr) {
          console.error('[API] DataSheet 주입 보상 삭제 실패:', workflow.workflowId, createdDataSheet?.id, cleanupErr)
        }
        return NextResponse.json(
          { error: 'Failed to attach data sheet to the workflow', code: 'DATASHEET_INJECTION_FAILED' },
          { status: 500 }
        )
      }

      try {
        const baseName = body.dataSheetSchema.name || 'Auto-created Sheet'
        let finalName = baseName
        let counter = 1

        while (true) {
          const existing = await prisma.dataSheet.findFirst({
            where: { agentId, name: finalName }
          })
          if (!existing) break
          counter++
          finalName = `${baseName} (${counter})`
        }

        const owner = await prisma.agent.findUniqueOrThrow({ where: { agentId }, select: { userId: true } })
        createdDataSheet = await prisma.dataSheet.create({
          data: {
            agentId,
            userId: owner.userId,
            name: finalName,
            description: body.dataSheetSchema.description || null,
            schema: JSON.stringify({ columns: body.dataSheetSchema.columns }),
            sizeBytes: 0n,
            rowCount: 0,
          }
        })

        let injectionOk = false
        const workflowData = JSON.parse(workflow.workflowJson)
        let matched = 0
        if (workflowData.nodes && Array.isArray(workflowData.nodes)) {
          workflowData.nodes = workflowData.nodes.map((node: any) => {
            if (node.type === 'dataSheets' || node.data?.nodeType === 'dataSheets') {
              node.data.sheetId = createdDataSheet!.id
              node.data.sheetName = createdDataSheet!.name
              matched++
            }
            return node
          })
        }
        if (matched > 0) {
          const injected = await updateWorkflow({
            userId: session.user.id,
            workflowId: workflow.workflowId,
            patch: { workflowJson: JSON.stringify(workflowData) },
            expectedVersion: workflow.version,
            source: 'ui',
          })
          if (injected.ok) {
            workflow = injected.workflow
            injectionOk = true
          } else {
            console.error('[API] DataSheet sheetId 주입 실패:', injected.code, injected.message)
          }
        } else {
          console.error('[API] DataSheet 주입 대상(dataSheets 노드) 없음 — schema 는 있으나 붙일 노드 없음')
        }

        if (!injectionOk) return await compensateAndFail()
      } catch (e) {
        console.error('[API] DataSheet 주입 예외 → 보상 삭제:', e)
        return await compensateAndFail()
      }
    }

    return NextResponse.json({
      success: true,
      workflow,
      ...(createdDataSheet && { createdDataSheet: { id: createdDataSheet.id, name: createdDataSheet.name } })
    }, { status: 201 })

  } catch (error) {
    console.error('[POST /api/agents/[agentId]/workflows] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
