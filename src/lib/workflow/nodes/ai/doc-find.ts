import type { OpenAI } from 'openai'
import { holdFixedCpaForAiCall, type FixedCpaHold } from '../../ai-call-cpa'
import type { WorkflowContext } from '../../types'
import { isGptReasoningFamily } from '@/lib/managed/model-lineup'
import { isSelfHosted } from '@/lib/edition'
import { makeAiEngine, makeDiEngine, type DocReadEngine, type EngineOutcome } from '@/lib/work/doc-read'
import { DOC_FIND_CPA, type AskFindFn } from '@/lib/work/doc-find'
import { makeImageReader } from './read-images'

const FIND_MAX_OUTPUT = 2_000

export interface DocFindFns {
  holdFind(): Promise<FixedCpaHold>
  holdScan(): Promise<FixedCpaHold>
  ask: AskFindFn
  engine(userId: string): Promise<DocReadEngine>
}

const NO_ENGINE: DocReadEngine = {
  kind: 'di',
  async readPdf(_b, pages) { return new Map<number, EngineOutcome>(pages.map((n) => [n, { kind: 'service' }])) },
  async readImage() { return { kind: 'service' } },
}

export function makeDocFinder(openai: OpenAI, textModel: string, imageModel: string | null, context: WorkflowContext): DocFindFns {
  const hold = () => holdFixedCpaForAiCall(context, textModel, DOC_FIND_CPA)
  return {
    holdFind: hold,
    holdScan: hold,
    async ask(instructions, input, signal) {
      const r: any = await openai.responses.create({
        model: textModel,
        instructions,
        max_output_tokens: FIND_MAX_OUTPUT,
        ...(isGptReasoningFamily(textModel) ? { reasoning: { effort: 'low' } } : {}),
        text: { format: { type: 'json_object' } },
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] }],
      } as any, { signal })
      if (r?.status === 'incomplete') return null
      try { return JSON.parse(String(r?.output_text ?? '')) } catch { return null }
    },
    async engine(userId) {
      if (isSelfHosted()) return makeAiEngine(makeImageReader(openai, imageModel, context))
      const [{ prisma }, { workStorageRegion }, { getManagedAzureConfig }] = await Promise.all([import('@/lib/prisma'), import('@/lib/work/files'), import('@/lib/managed/api-key')])
      try {
        const cfg = await getManagedAzureConfig(await workStorageRegion(prisma, userId))
        if (!cfg.docIntelligenceEndpoint || !cfg.docIntelligenceKey) return NO_ENGINE
        return makeDiEngine({ endpoint: cfg.docIntelligenceEndpoint, key: cfg.docIntelligenceKey })
      } catch {
        return NO_ENGINE
      }
    },
  }
}
