
import { isValidCronExpression } from '@/lib/schedule'

// ========================================
// ========================================

export interface TemplateParameter {
  parameterId: string
  label: string
  description: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  format?: 'email' | 'cron' | 'timezone'
  targetNodeId: string
  targetNodeType: string
  path: string
  required: boolean
  allowedValues?: string[]
  min?: number
  max?: number
}

export interface TemplateManifest {
  templateId: string
  parameters: TemplateParameter[]
}

export interface TemplateBinding {
  templateId: string
  parameters: TemplateParameter[]
}

export interface ParamIssue {
  parameterId?: string
  message: string
}

// ========================================
// ========================================

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const SAFE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/

export function tokenizePath(path: string): string[] | null {
  if (!path) return null
  const segments = path.split('.')
  for (const seg of segments) {
    if (!SAFE_SEGMENT.test(seg) || FORBIDDEN_SEGMENTS.has(seg)) return null
  }
  return segments
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function getAtPath(data: unknown, segments: string[]): { exists: boolean; value?: unknown } {
  let cur: unknown = data
  for (let i = 0; i < segments.length; i++) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, segments[i])) {
      return { exists: false }
    }
    cur = cur[segments[i]]
  }
  return { exists: true, value: cur }
}

export function setAtPathExistingLeaf(data: unknown, segments: string[], value: unknown): boolean {
  if (segments.length === 0) return false
  let cur: unknown = data
  for (let i = 0; i < segments.length - 1; i++) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, segments[i])) return false
    cur = cur[segments[i]]
  }
  const leaf = segments[segments.length - 1]
  if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, leaf)) return false
  cur[leaf] = value
  return true
}

// ========================================
// ========================================

export function validateManifestAgainstTemplate(
  manifest: TemplateManifest,
  workflowJson: { nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }> },
): ParamIssue[] {
  const issues: ParamIssue[] = []
  const seen = new Set<string>()
  const nodeById = new Map(workflowJson.nodes.map(n => [n.id, n]))

  for (const p of manifest.parameters) {
    const at = (message: string) => issues.push({ parameterId: p.parameterId, message })

    if (seen.has(p.parameterId)) at('duplicate parameterId')
    seen.add(p.parameterId)

    const segments = tokenizePath(p.path)
    if (!segments) { at(`unsafe or invalid path "${p.path}"`); continue }

    const node = nodeById.get(p.targetNodeId)
    if (!node) { at(`target node "${p.targetNodeId}" not found in template`); continue }
    const kind = (node.data?.nodeType as string) || node.type || 'unknown'
    if (kind !== p.targetNodeType) { at(`target node type mismatch: manifest=${p.targetNodeType}, template=${kind}`); continue }

    const leaf = getAtPath(node.data ?? {}, segments)
    if (!leaf.exists) { at(`path "${p.path}" does not exist in template node data`); continue }

    const v = leaf.value
    if (p.type === 'number' && typeof v !== 'number') at(`template default is not a number (${typeof v})`)
    if (p.type === 'boolean' && typeof v !== 'boolean') at(`template default is not a boolean (${typeof v})`)
    if ((p.type === 'string' || p.type === 'enum') && typeof v !== 'string') at(`template default is not a string (${typeof v})`)

    if (p.type === 'enum') {
      if (!p.allowedValues || p.allowedValues.length === 0) at('enum parameter requires allowedValues')
      else if (typeof v === 'string' && !p.allowedValues.includes(v)) at(`template default "${v}" not in allowedValues`)
    }
  }
  return issues
}

// ========================================
// ========================================

export function validateParamValue(p: TemplateParameter, value: unknown): string | null {
  switch (p.type) {
    case 'boolean':
      if (typeof value !== 'boolean') return 'must be a boolean'
      return null
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number'
      if (p.min !== undefined && value < p.min) return `must be >= ${p.min}`
      if (p.max !== undefined && value > p.max) return `must be <= ${p.max}`
      return null
    }
    case 'enum': {
      if (typeof value !== 'string') return 'must be a string'
      if (!p.allowedValues?.includes(value)) return `must be one of: ${p.allowedValues?.join(', ')}`
      return null
    }
    case 'string': {
      if (typeof value !== 'string') return 'must be a string'
      if (p.required && value.trim() === '') return 'must not be empty'
      if (value.length > 20000) return 'too long (max 20000 chars)'
      if (p.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'must be a valid email address'
      if (p.format === 'cron' && !isValidCronExpression(value)) return 'must be a valid cron expression (e.g. "0 18 * * *")'
      if (p.format === 'timezone') {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
        } catch {
          return 'must be a valid IANA timezone (e.g. "Europe/Zurich")'
        }
      }
      return null
    }
  }
}

export function applyParams(
  binding: TemplateBinding,
  workflowJson: { nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }> },
  params: Record<string, unknown>,
): { issues: ParamIssue[] } {
  const issues: ParamIssue[] = []
  const byId = new Map(binding.parameters.map(p => [p.parameterId, p]))
  const nodeById = new Map(workflowJson.nodes.map(n => [n.id, n]))

  for (const [parameterId, value] of Object.entries(params)) {
    const p = byId.get(parameterId)
    if (!p) {
      issues.push({ parameterId, message: `unknown parameterId — allowed: ${[...byId.keys()].join(', ')}` })
      continue
    }
    const valueError = validateParamValue(p, value)
    if (valueError) { issues.push({ parameterId, message: valueError }); continue }

    const segments = tokenizePath(p.path)
    if (!segments) { issues.push({ parameterId, message: `unsafe path in binding: "${p.path}"` }); continue }

    const node = nodeById.get(p.targetNodeId)
    if (!node) {
      issues.push({ parameterId, message: `target node "${p.targetNodeId}" no longer exists in this workflow — it may have been edited in Studio` })
      continue
    }
    const kind = (node.data?.nodeType as string) || node.type || 'unknown'
    if (kind !== p.targetNodeType) {
      issues.push({ parameterId, message: `target node "${p.targetNodeId}" type changed (expected ${p.targetNodeType}, got ${kind})` })
      continue
    }
    if (!setAtPathExistingLeaf(node.data ?? {}, segments, value)) {
      issues.push({ parameterId, message: `path "${p.path}" no longer exists on target node — it may have been edited in Studio` })
    }
  }
  return { issues }
}
