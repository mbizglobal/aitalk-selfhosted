import { readFileSync } from 'fs'
import { join } from 'path'
import { renderNodeCatalog } from './resources/render-node-catalog'
import { renderBlockCatalog } from './resources/render-block-catalog'
import { guideForEdition } from './guide-edition'
import { isSelfHosted } from '@/lib/edition'

export const MCP_RESOURCES = [
  {
    uri: 'aitalk://workflow-guide',
    name: 'AiTalk Workflow Guide',
    description:
      'How to build AiTalk workflows over MCP: template + parameter flow, node basics, validation levels, error codes. Read before using write tools.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'aitalk://node-catalog',
    name: 'AiTalk Node Catalog',
    description:
      'Full schema of all workflow node types (required fields, enums, edge handle rules, canvas conventions). Read before authoring raw workflowJson with update_workflow. Rendered from the same source the server validates against.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'aitalk://work-app-guide',
    name: 'AiTalk Assembled Work App Guide',
    description: 'How to assemble a work app from blocks over MCP: flow (validate → create → change = applied at once while the app has no rows, otherwise an owner confirmation link), permanent keys, change rules, a full example, refusal codes.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'aitalk://block-catalog',
    name: 'AiTalk Assembled App Block Catalog',
    description: 'Every block an assembled work app can use, column kinds and limits — rendered from the same source the validator checks against.',
    mimeType: 'text/markdown',
  },
] as const

let workflowGuideCache: string | null = null
let workAppGuideCache: string | null = null
export function readMcpResource(uri: string): { mimeType: string; text: string } | null {
  if (uri === 'aitalk://workflow-guide') {
    if (workflowGuideCache === null) {
      workflowGuideCache = readFileSync(
        join(process.cwd(), 'src/lib/mcp-server/resources/workflow-guide.md'),
        'utf8',
      )
    }
    return { mimeType: 'text/markdown', text: workflowGuideCache }
  }
  if (uri === 'aitalk://node-catalog') {
    return { mimeType: 'text/markdown', text: renderNodeCatalog() }
  }
  if (uri === 'aitalk://work-app-guide') {
    if (workAppGuideCache === null) workAppGuideCache = readFileSync(join(process.cwd(), 'src/lib/mcp-server/resources/work-app-guide.md'), 'utf8')
    return { mimeType: 'text/markdown', text: guideForEdition(workAppGuideCache, isSelfHosted()) }
  }
  if (uri === 'aitalk://block-catalog') return { mimeType: 'text/markdown', text: renderBlockCatalog() }
  return null
}
