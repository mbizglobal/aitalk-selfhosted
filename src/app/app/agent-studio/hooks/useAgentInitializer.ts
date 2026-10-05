import { useEffect, useRef } from 'react'
import { aiDefaultConfig } from '../constants/initialData'
import type { useAgentState } from './useAgentState'

export function useAgentInitializer(
  agent: ReturnType<typeof useAgentState>,
  initialAgent: any,
  initialWorkflow: any,
  initialAgentId: string | null
) {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const resolvedAgentId = initialAgent?.agentId ?? initialAgentId ?? null
    agent.setAgentId(resolvedAgentId)
    agent.setWorkflowId(initialWorkflow?.workflowId || null)
    agent.setWorkflowName(initialWorkflow?.name || 'Untitled Workflow')
    agent.setWorkflowStatus(initialWorkflow?.status || 'draft')
    agent.setWorkflowKind(initialWorkflow?.kind === 'sub' ? 'sub' : 'main')
    agent.workflowVersionRef.current = initialWorkflow?.version ?? 1
    agent.setAgentName(initialAgent?.title || 'Untitled Agent')
    agent.setAgentDescription(initialAgent?.summary || initialAgent?.description || '')

    if (resolvedAgentId) {
      localStorage.setItem('activeAgentId', resolvedAgentId)
    }
    agent.updateAiSettings({
      model: initialAgent?.model || aiDefaultConfig.model,
      temperature: initialAgent?.temperature ?? aiDefaultConfig.temperature,
      maxTokens: initialAgent?.maxTokens ?? aiDefaultConfig.maxTokens,
      topP: initialAgent?.topP ?? aiDefaultConfig.topP,
      effort: initialAgent?.effort || aiDefaultConfig.effort,
      verbosity: initialAgent?.verbosity || aiDefaultConfig.verbosity,
      summary: initialAgent?.summary || aiDefaultConfig.summary,
      storeLogs: initialAgent?.storeLogs ?? aiDefaultConfig.storeLogs,
      systemMessage: initialAgent?.systemMessage || aiDefaultConfig.systemMessage,
      outputFormat: initialAgent?.outputFormat || aiDefaultConfig.outputFormat,
      jsonSchema: initialAgent?.jsonSchema || ''
    })
  }, [agent, initialAgent, initialWorkflow, initialAgentId])
}
