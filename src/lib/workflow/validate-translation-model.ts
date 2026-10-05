
import { findFirstAiNodeFromWorkflow } from './find-ai-node'

const RELIABLE_TRIGGER_MODEL = /^(gpt-realtime|gpt-5|gpt-6)/i

export interface TranslationModelGuardResult {
  ok: boolean
  error?: string
  code?: 'TRANSLATION_REQUIRES_RELIABLE_MODEL'
}

export function validateTranslationTriggerModel(
  workflowJson: string | Record<string, unknown> | null | undefined,
  opts?: { failOnInvalidJson?: boolean }
): TranslationModelGuardResult {
  if (!workflowJson) return { ok: true }
  let wf: any
  try {
    wf = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson
  } catch {
    if (opts?.failOnInvalidJson) {
      return { ok: false, error: 'Workflow JSON is invalid and cannot be validated for production.' }
    }
    return { ok: true }
  }
  const nodes: any[] = wf?.nodes || []
  const edges: any[] = wf?.edges || []
  const bridgeTranslateStarts = nodes.filter(
    (n: any) =>
      n?.data?.nodeType === 'start' &&
      n?.data?.triggerType === 'pstn' &&
      n?.data?.handoffMode === 'bridge_translate'
  )
  for (const startNode of bridgeTranslateStarts) {
    const aiNode = findFirstAiNodeFromWorkflow(startNode.id, nodes, edges)
    const model: string = aiNode?.data?.model || ''
    if (!RELIABLE_TRIGGER_MODEL.test(model)) {
      return {
        ok: false,
        code: 'TRANSLATION_REQUIRES_RELIABLE_MODEL',
        error:
          `Translation handoff (PSTN Human Handoff → "Bridge & translate") needs an AI model that reliably triggers the connection. ` +
          `The AI model on this PSTN path "${model || '(none)'}" does not reliably call it. ` +
          `Set that AI node's model to gpt-6-sol, or switch the pipeline to Realtime (gpt-realtime).`,
      }
    }
  }
  return { ok: true }
}
