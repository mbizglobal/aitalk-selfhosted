import { isMiniAppNodeOfType } from './mini-app-registry'
import { replaceRetiredChatModel } from '@/lib/managed/model-lineup'

export const QUIZ_ALLOWED_MODELS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-6-luna', 'gpt-6-sol'] as const

export const QUIZ_BLOCKED_MODELS: readonly string[] = []

export const QUIZ_MODEL_FALLBACK = 'gpt-6-luna'

export function isQuizAllowedModel(model: string | undefined | null): boolean {
  return !!model && (QUIZ_ALLOWED_MODELS as readonly string[]).includes(model)
}

export interface QuizModelGuardResult {
  ok: boolean
  error?: string
  code?: 'QUIZ_MODEL_NOT_SUPPORTED'
}

export function validateQuizGenerationModel(
  workflowJson: string | Record<string, unknown> | null | undefined,
  opts?: {
    failOnInvalidJson?: boolean
    blockedModels?: readonly string[]
  }
): QuizModelGuardResult {
  const blocked = opts?.blockedModels ?? QUIZ_BLOCKED_MODELS
  if (!workflowJson) return { ok: true }
  let wf: any
  try {
    wf = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson
  } catch {
    if (opts?.failOnInvalidJson) {
      return { ok: false, error: 'Workflow JSON is invalid and cannot be validated.' }
    }
    return { ok: true }
  }
  const nodes: any[] = wf?.nodes || []
  const edges: any[] = wf?.edges || []
  if (nodes.length === 0) return { ok: true }

  const quizNodeIds = new Set(
    nodes
      .filter((n: any) => isMiniAppNodeOfType(n, 'quiz'))
      .map((n: any) => n.id)
  )
  if (quizNodeIds.size === 0) return { ok: true }

  for (const edge of edges) {
    if (edge?.sourceHandle !== 'miniapps' || !quizNodeIds.has(edge?.target)) continue
    const aiNode = nodes.find((n: any) => n.id === edge.source)
    if (!aiNode) continue
    const model: string = aiNode?.data?.model || ''
    if (!blocked.includes(replaceRetiredChatModel(model))) continue
    return {
      ok: false,
      code: 'QUIZ_MODEL_NOT_SUPPORTED',
      error:
        `Quiz does not support the AI model "${model}". ` +
        `Quiz generation is charged at a flat rate based on the number of questions and study length, ` +
        `so only the standard models are supported: ${QUIZ_ALLOWED_MODELS.join(', ')}. ` +
        `Change the AI node's model, or remove the Quiz from that AI node.`,
    }
  }
  return { ok: true }
}
