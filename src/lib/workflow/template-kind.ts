import { isAppWorkflow } from './start-trigger'
import { isAppTemplateKind } from '@/lib/work/app-template-kinds'

export type TemplateListKind = 'workApp' | 'workflow'

export function parseTemplateListKind(raw: string | null): TemplateListKind | null | 'invalid' {
  if (raw === null) return null
  return raw === 'workApp' || raw === 'workflow' ? raw : 'invalid'
}

export function fixedAppTemplatesKnown(workflowJson: unknown, known: (kind: string) => boolean = isAppTemplateKind): boolean {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes
  if (!Array.isArray(nodes)) return true
  return nodes.every((n) => {
    const d = (n as { data?: { nodeType?: unknown; appTemplate?: unknown } } | null)?.data
    if ((d?.nodeType !== 'workApp' && d?.nodeType !== 'workAppLink') || d.appTemplate === undefined || d.appTemplate === null || d.appTemplate === '') return true
    return typeof d.appTemplate === 'string' && known(d.appTemplate)
  })
}

export function filterTemplatesByKind<T extends { workflowJson: unknown }>(items: readonly T[], kind: TemplateListKind | null, known?: (kind: string) => boolean): T[] {
  if (!kind) return [...items]
  return items.filter((t) => isAppWorkflow(t.workflowJson) === (kind === 'workApp') && (kind !== 'workApp' || fixedAppTemplatesKnown(t.workflowJson, known)))
}
