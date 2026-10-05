
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { describeCaughtError } from '@/lib/log-mask'
import { isTeamChatWorkflow } from '@/lib/chat/public-access'

function isTeamSelectable(workflowJson: unknown, agentAccessMode: string | null | undefined): boolean {
  try {
    const data = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson
    return isTeamChatWorkflow((data as any)?.nodes, agentAccessMode)
  } catch {
    return false
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params

    let isOwner = false
    const authHeader = request.headers.get('authorization')

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)

      if (!payload || payload.agentId !== agentId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else {
      const session = await getServerSession(authOptions as any) as any
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const agent = await prisma.agent.findUnique({
        where: { agentId },
        select: { userId: true }
      })

      if (!agent || agent.userId !== session.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      isOwner = true
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        agentId: true,
        title: true,
        accessMode: true
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workflows = await prisma.workflow.findMany({
      where: {
        agentId,
        status: 'production'
      },
      select: {
        workflowId: true,
        name: true,
        description: true,
        status: true,
        updatedAt: true,
        workflowJson: true
      },
      orderBy: {
        updatedAt: 'desc'
      }
    })

    const workflowsWithAccess = workflows.filter(wf => isTeamSelectable(wf.workflowJson, agent.accessMode)).map(wf => {
      let fileInputConfig = { imageInput: false, pdfInput: false, csvInput: false }
      let teamWelcomeMessage = ''

      try {
        if (wf.workflowJson) {
          const workflowData = typeof wf.workflowJson === 'string'
            ? JSON.parse(wf.workflowJson)
            : wf.workflowJson

          const aiNode = workflowData.nodes?.find((node: any) =>
            node.type === 'ai' || node.data?.nodeType === 'ai'
          )

          if (aiNode?.data) {
            fileInputConfig = {
              imageInput: aiNode.data.imageInput || false,
              pdfInput: aiNode.data.pdfInput || false,
              csvInput: aiNode.data.csvInput || false
            }
          }

          const startNode = workflowData.nodes?.find((node: any) =>
            node.type === 'start' || node.data?.nodeType === 'start'
          )
          if (startNode?.data?.teamWelcomeMessage) {
            teamWelcomeMessage = startNode.data.teamWelcomeMessage
          }
        }
      } catch (e) {
        console.error('Failed to parse workflowJson:', describeCaughtError(e))
      }

      return {
        workflowId: wf.workflowId,
        name: wf.name,
        description: wf.description,
        status: wf.status,
        updatedAt: wf.updatedAt,
        accessMode: agent.accessMode, // public | team
        fileInputConfig,
        teamWelcomeMessage
      }
    })

    const requestedWorkflowId = request.nextUrl.searchParams.get('workflowId')
    let singleWorkflow = null
    if (requestedWorkflowId && !workflowsWithAccess.find(w => w.workflowId === requestedWorkflowId)) {
      const wf = await prisma.workflow.findFirst({
        where: { workflowId: requestedWorkflowId, agentId, status: 'production' },
        select: { workflowId: true, name: true, description: true, status: true, updatedAt: true, workflowJson: true }
      })
      if (wf && isTeamSelectable(wf.workflowJson, agent.accessMode)) {
        let fileInputConfig = { imageInput: false, pdfInput: false, csvInput: false }
        let teamWelcomeMessage = ''
        try {
          if (wf.workflowJson) {
            const workflowData = typeof wf.workflowJson === 'string' ? JSON.parse(wf.workflowJson) : wf.workflowJson
            const aiNode = workflowData.nodes?.find((node: any) => node.data?.nodeType === 'ai')
            if (aiNode?.data) {
              fileInputConfig = { imageInput: aiNode.data.imageInput || false, pdfInput: aiNode.data.pdfInput || false, csvInput: aiNode.data.csvInput || false }
            }
            const startNode = workflowData.nodes?.find((node: any) => node.data?.nodeType === 'start')
            if (startNode?.data?.teamWelcomeMessage) {
              teamWelcomeMessage = startNode.data.teamWelcomeMessage
            }
          }
        } catch {}
        singleWorkflow = {
          workflowId: wf.workflowId, name: wf.name, description: wf.description, status: wf.status,
          updatedAt: wf.updatedAt, accessMode: agent.accessMode, fileInputConfig, teamWelcomeMessage
        }
      }
    }

    return NextResponse.json({
      success: true,
      agent: {
        agentId: agent.agentId,
        title: agent.title,
        accessMode: agent.accessMode
      },
      workflows: workflowsWithAccess,
      ...(singleWorkflow ? { workflow: singleWorkflow } : {}),
      isOwner
    })

  } catch (error) {
    console.error('[GET /api/chat/[agentId]/team/workflows] Error:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
