import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import AgentStudioClient from './client'
import { hasApiKey } from '@/lib/ai-providers'
import { APP_WORKFLOW_KIND } from '@/lib/work/app-canvas'

interface PageProps {
  searchParams: Promise<{
    workflowId?: string
    agentId?: string
  }>
}

export default async function AgentStudioPage({ searchParams }: PageProps) {
  const params = await searchParams
  const workflowId = params.workflowId
  const agentId = params.agentId

  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return (
      <AgentStudioClient
        initialAgent={null}
        initialWorkflow={null}
      />
    )
  }

  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { aiProviders: true }
  })

  const hasOpenAIApiKey = user ? hasApiKey(user, 'openai') : false

  let initialAgent = null
  let initialWorkflow = null

  try {
    if (workflowId) {
      const hidden = await prisma.workflow.findFirst({ where: { workflowId, kind: APP_WORKFLOW_KIND, agent: { userId } }, select: { parentWorkflowId: true } })
      initialWorkflow = await prisma.workflow.findFirst({
        where: {
          workflowId: hidden ? (hidden.parentWorkflowId ?? '') : workflowId,
          kind: { not: APP_WORKFLOW_KIND },
          agent: { userId }
        },
        include: {
          agent: {
            select: {
              id: true,
              agentId: true,
              title: true,
              accessMode: true,
              vectorStoreId: true,
            }
          }
        }
      })

      if (initialWorkflow) {
        initialAgent = initialWorkflow.agent
      }
    }
    else if (agentId) {
      initialWorkflow = await prisma.workflow.findFirst({
        where: {
          agentId,
          kind: { not: APP_WORKFLOW_KIND },
          agent: { userId }
        },
        orderBy: [
          { status: 'desc' },
          { updatedAt: 'desc' }
        ],
        include: {
          agent: {
            select: {
              id: true,
              agentId: true,
              title: true,
              accessMode: true,
              vectorStoreId: true,
            }
          }
        }
      })

      if (initialWorkflow) {
        initialAgent = initialWorkflow.agent
      }
    }
    else {
      const firstAgent = await prisma.agent.findFirst({
        where: { userId, workflows: { some: { kind: { not: APP_WORKFLOW_KIND } } } },
        orderBy: { createdAt: 'desc' },
      })

      if (firstAgent) {
        initialWorkflow = await prisma.workflow.findFirst({
          where: { agentId: firstAgent.agentId, kind: { not: APP_WORKFLOW_KIND } },
          orderBy: [
            { status: 'desc' },
            { updatedAt: 'desc' }
          ],
          include: {
            agent: {
              select: {
                id: true,
                agentId: true,
                title: true,
                accessMode: true,
                vectorStoreId: true,
              }
            }
          }
        })

        if (initialWorkflow) {
          initialAgent = initialWorkflow.agent
        }
      }
    }
  } catch (error) {
    console.error('[Agent Studio] Failed to load workflow:', error)
    throw error
  }

  if (!initialWorkflow) {
    redirect(!workflowId && agentId ? `/app/agents/${encodeURIComponent(agentId)}/workflows` : '/app')
  }

  return (
    <AgentStudioClient
      initialAgent={initialAgent}
      initialWorkflow={initialWorkflow}
      hasOpenAIApiKey={hasOpenAIApiKey}
    />
  )
}
