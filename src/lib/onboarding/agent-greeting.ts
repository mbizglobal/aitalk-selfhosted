import { prisma } from '@/lib/prisma'
import { patchWorkflowJsonNarrow } from '@/lib/workflow/service'

function findStartNodeIndex(nodes: any[]): number {
  if (!Array.isArray(nodes)) return -1
  const byTrigger = nodes.findIndex((n) => n?.data?.triggerType)
  if (byTrigger >= 0) return byTrigger
  return nodes.findIndex((n) => n?.data && Object.prototype.hasOwnProperty.call(n.data, 'greeting'))
}

export interface AgentGreeting {
  agentId: string
  greeting: string
  language: string
}

export async function getDefaultAgentGreeting(userId: string, agentId?: string, workflowId?: string): Promise<AgentGreeting | null> {
  const agent = agentId
    ? await prisma.agent.findFirst({ where: { agentId, userId }, select: { agentId: true } })
    : await prisma.agent.findFirst({ where: { userId, isDefault: true }, select: { agentId: true } })
  if (!agent) return null
  const wf = workflowId
    ? await prisma.workflow.findFirst({
        where: { workflowId, agentId: agent.agentId },
        select: { workflowJson: true },
      })
    : await prisma.workflow.findFirst({
        where: { agentId: agent.agentId },
        orderBy: { updatedAt: 'desc' },
        select: { workflowJson: true },
      })
  if (!wf) return { agentId: agent.agentId, greeting: '', language: '' }
  let nodes: any[] = []
  try { nodes = JSON.parse(wf.workflowJson)?.nodes || [] } catch { nodes = [] }
  const idx = findStartNodeIndex(nodes)
  const d = idx >= 0 ? nodes[idx]?.data : null
  return { agentId: agent.agentId, greeting: d?.greeting ?? '', language: d?.language ?? '' }
}

export async function setDefaultAgentGreeting(
  userId: string,
  params: { greeting: string; language?: string },
  agentId?: string,
  workflowId?: string
): Promise<number> {
  const agent = agentId
    ? await prisma.agent.findFirst({ where: { agentId, userId }, select: { agentId: true } })
    : await prisma.agent.findFirst({ where: { userId, isDefault: true }, select: { agentId: true } })
  if (!agent) return 0
  const wfs = await prisma.workflow.findMany({
    where: workflowId ? { workflowId, agentId: agent.agentId } : { agentId: agent.agentId }, // IDOR-safe
    select: { workflowId: true },
  })
  let matched = 0
  for (const wf of wfs) {
    let hasStartNode = false
    const res = await patchWorkflowJsonNarrow({
      workflowId: wf.workflowId,
      mutate: (currentJson) => {
        let json: any
        try { json = JSON.parse(currentJson) } catch { return null }
        const nodes: any[] = json?.nodes || []
        const idx = findStartNodeIndex(nodes)
        if (idx < 0 || !nodes[idx]?.data) return null
        hasStartNode = true
        nodes[idx].data.greeting = params.greeting
        if (params.language) nodes[idx].data.language = params.language
        return JSON.stringify(json)
      },
      source: 'greeting',
      createdById: userId,
      note: 'onboarding greeting update',
    })
    if (!res.ok) {
      throw new Error(`[agent-greeting] workflow ${wf.workflowId} write failed: ${res.code}`)
    }
    if (hasStartNode) matched++
  }
  return matched
}
