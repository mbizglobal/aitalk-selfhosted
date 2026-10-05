
import { resolveNodeType } from '@/lib/workflow/engine/resolve-node-type'

export const PRIVILEGED_CHAT_SOURCES: ReadonlySet<string> = new Set([
  'playground',
  'workflow-playground',
  'team',
])

export function isPublicChatSource(source: string | undefined | null): boolean {
  return !source || !PRIVILEGED_CHAT_SOURCES.has(source)
}

const LOGGABLE_CHAT_SOURCES: ReadonlySet<string> = new Set([
  'external', 'widget', 'team', 'playground', 'workflow-playground',
  'app', 'quiz', 'pstn', 'voice', 'voice-web', 'voice-pstn', 'voice-web-test', 'ai-assistant',
])

export function describeChatSource(source: string | undefined | null): string {
  if (!source) return 'none'
  return LOGGABLE_CHAT_SOURCES.has(source) ? source : 'other'
}

export function isStartCandidate(node: any): boolean {
  return resolveNodeType(node as any) === 'start'
}

export function isWorkflowPubliclyAccessible(
  nodes: unknown,
  agentAccessMode: string | null | undefined
): boolean {
  const agentMode = agentAccessMode || 'public'
  const candidates = Array.isArray(nodes) ? nodes.filter(isStartCandidate) : []

  if (candidates.length === 0) return agentMode === 'public'

  return candidates.every(n => {
    const raw = n?.data?.accessMode
    const mode = raw === undefined || raw === null ? agentMode : raw
    return mode === 'public'
  })
}

export function isTeamChatWorkflow(
  nodes: unknown,
  agentAccessMode: string | null | undefined
): boolean {
  const agentMode = agentAccessMode || 'public'
  const candidates = Array.isArray(nodes) ? nodes.filter(isStartCandidate) : []
  return candidates.some(n => {
    const trigger = n?.data?.triggerType
    const isChat = trigger === undefined || trigger === null || trigger === 'chatWidget'
    const raw = n?.data?.accessMode
    const mode = raw === undefined || raw === null ? agentMode : raw
    return isChat && mode === 'team'
  })
}
