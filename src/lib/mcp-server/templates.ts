
import { prisma } from '@/lib/prisma'
import { findEditionOffParts } from '@/lib/workflow/edition-guard'
import { getLocalTemplates } from '@/lib/local-templates'
import { TEMPLATE_MANIFESTS, NOT_CREATABLE } from './template-manifests'
import { validateManifestAgainstTemplate, type TemplateManifest } from './template-params'

export interface McpTemplate {
  templateId: string
  name: string
  description: string
  explanation?: string
  categoryCode: string
  complexity: string
  nodeTypes: string[]
  workflowJson: string
  creatable: boolean
  notCreatableReason?: string
  manifest?: TemplateManifest
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

function parseJsonArray(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function attachManifest(templateId: string, workflowJson: string): TemplateManifest | undefined {
  const manifest = TEMPLATE_MANIFESTS[templateId]
  if (!manifest) return undefined
  let parsed: { nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }> }
  try {
    parsed = JSON.parse(workflowJson)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed?.nodes)) return undefined
  const issues = validateManifestAgainstTemplate(manifest, parsed)
  if (issues.length > 0) {
    console.error(`[MCP] template manifest mismatch for "${templateId}" — hiding parameters:`, issues)
    return undefined
  }
  return manifest
}

interface RawTemplateRow {
  templateId: string
  name: string
  description: string
  explanation?: string
  categoryCode: string
  complexity: string
  nodeTypes: string | string[]
  workflowJson: string
}

export function toMcpTemplate(row: RawTemplateRow): McpTemplate {
  const notCreatableReason = NOT_CREATABLE[row.templateId]
  return {
    templateId: row.templateId,
    name: row.name,
    description: row.description,
    ...(row.explanation && row.explanation.trim() ? { explanation: row.explanation } : {}),
    categoryCode: row.categoryCode,
    complexity: String(row.complexity),
    nodeTypes: parseJsonArray(row.nodeTypes),
    workflowJson: row.workflowJson,
    creatable: !notCreatableReason,
    ...(notCreatableReason ? { notCreatableReason } : {}),
    ...(notCreatableReason ? {} : { manifest: attachManifest(row.templateId, row.workflowJson) }),
  }
}

function includedInEdition(t: McpTemplate): boolean {
  return findEditionOffParts(t.workflowJson).length === 0
}

export async function listMcpTemplates(): Promise<McpTemplate[]> {
  if (!isProd()) {
    return getLocalTemplates().map(t => toMcpTemplate(t as unknown as RawTemplateRow)).filter(includedInEdition)
  }
  const rows = await prisma.workflowTemplate.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      templateId: true, name: true, description: true,
      categoryCode: true, complexity: true, nodeTypes: true, workflowJson: true,
    },
  })
  return rows.map(r => toMcpTemplate({ ...r, complexity: String(r.complexity) })).filter(includedInEdition)
}

export async function getMcpTemplate(templateId: string): Promise<McpTemplate | null> {
  if (!isProd()) {
    const t = getLocalTemplates().find(t => t.templateId === templateId)
    const tpl = t ? toMcpTemplate(t as unknown as RawTemplateRow) : null
    return tpl && includedInEdition(tpl) ? tpl : null
  }
  const row = await prisma.workflowTemplate.findUnique({
    where: { templateId },
    select: {
      templateId: true, name: true, description: true, explanation: true,
      categoryCode: true, complexity: true, nodeTypes: true, workflowJson: true,
    },
  })
  const tpl = row ? toMcpTemplate({ ...row, complexity: String(row.complexity) }) : null
  return tpl && includedInEdition(tpl) ? tpl : null
}
