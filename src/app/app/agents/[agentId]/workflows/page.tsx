/**
 * Workflow List Page
 * /app/agents/[agentId]/workflows
 */

import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import WorkflowListClient from './client'
import { isSelfHosted } from '@/lib/edition'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'
import { APP_WORKFLOW_KIND, isAppCanvas, isLegacyAppWorkflow } from '@/lib/work/app-canvas'
import { workflowCardsWorkApps, type WorkflowWorkApp } from '@/lib/work/workflow-apps'
import { defaultWorkFileDeps } from '@/lib/work/files'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{
    agentId: string
  }>
}

export default async function WorkflowListPage({ params }: PageProps) {
  const { agentId } = await params

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/auth')
  }

  const agent = await prisma.agent.findFirst({
    where: {
      agentId,
      userId: session.user.id
    },
    select: {
      id: true,
      agentId: true,
      title: true,
      userId: true,
      accessMode: true,
    }
  })

  if (!agent) {
    redirect('/app')
  }

  const selfHosted = isSelfHosted()
  const user = selfHosted ? null : await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      subscription: {
        select: { status: true, planType: true }
      }
    }
  })

  // Self: Free=1, Starter=10, Standard=20, Growth=30, Pro=40
  // Managed: Starter=10, Standard=20, Pro=40
  const isPaidUser = selfHosted || (user?.subscription?.planType !== 'free' && user?.subscription?.status === 'active')
  let maxProductionLimit = 1
  if (selfHosted) maxProductionLimit = SELF_HOSTED_POLICY.maxProduction
  else if (isPaidUser) {
    const plan = user?.subscription?.planType || ''
    if (plan.includes('pro')) maxProductionLimit = 40
    else if (plan.includes('growth')) maxProductionLimit = 30
    else if (plan.includes('standard')) maxProductionLimit = 20
    else maxProductionLimit = 10 // starter
  }
  const maxWorkflowLimit = isPaidUser ? null : 10
  const maxDataSheetLimit = isPaidUser ? null : 2

  const workflows = await prisma.workflow.findMany({
    where: { agentId, kind: { not: 'app' } },
    orderBy: [
      { status: 'desc' },
      { updatedAt: 'desc' }
    ],
    select: {
      id: true,
      workflowId: true,
      name: true,
      description: true,
      status: true,
      trafficWeight: true,
      workflowJson: true,
      createdAt: true,
      updatedAt: true,
      kind: true,
    }
  })

  const dataSheets = await prisma.dataSheet.findMany({
    where: { agentId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      agentId: true,
      name: true,
      description: true,
      schema: true,
      sizeBytes: true,
      rowCount: true,
      createdAt: true,
      updatedAt: true,
    }
  })

  const workflowGroups = await prisma.workflowGroup.findMany({
    where: { agentId },
    include: {
      workflows: {
        include: { workflow: true },
        orderBy: { order: 'asc' }
      },
      dataSheets: {
        include: { dataSheet: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  })

  const groupWorkflows = workflowGroups.flatMap((g) => g.workflows.map((i) => i.workflow))
  const allWorkflows = [...workflows, ...groupWorkflows]
  const needsWorkApps = allWorkflows.some((w) => w.kind !== 'sub' && (isAppCanvas(w.workflowJson) || isLegacyAppWorkflow(w.workflowJson)))
    || (await prisma.workflow.count({ where: { agentId, kind: APP_WORKFLOW_KIND } })) > 0
  let workApps: Record<string, WorkflowWorkApp> = {}
  if (needsWorkApps) {
    try {
      const key = await (await defaultWorkFileDeps()).dataKey(prisma, session.user.id)
      workApps = await workflowCardsWorkApps(prisma, session.user.id, key, agentId, allWorkflows)
    } catch (e) {
      console.error('[workflows] work app rows', e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
  }
  const withWorkApp = <T extends { workflowId: string }>(w: T) => (workApps[w.workflowId] ? { ...w, workApp: workApps[w.workflowId] } : w)

  return (
    <WorkflowListClient
      agent={agent}
      initialWorkflows={workflows.map(withWorkApp)}
      initialDataSheets={dataSheets}
      initialWorkflowGroups={workflowGroups.map((g) => ({ ...g, workflows: g.workflows.map((i) => ({ ...i, workflow: withWorkApp(i.workflow) })) }))}
      maxProductionLimit={maxProductionLimit}
      maxWorkflowLimit={maxWorkflowLimit}
      maxDataSheetLimit={maxDataSheetLimit}
    />
  )
}
