
export interface NodeSpec {
  nodeType: string
  description: string
  requiredFields: string[]
  optionalFields: Record<string, string>
  enums: Record<string, string[]>
  clampedEnums?: string[]
  conditionalRequired?: Array<{
    whenField: string
    equals: string
    require?: string[]
    requireAnyOf?: string[][]
    requireArray?: Array<{ field: string; someTruthyKey?: string }>
    defaultsTo?: boolean
  }>
  arrayRequirements?: Array<{ field: string; someTruthyKey?: string }>
  advisoryRequiredFields?: string[]
  sourceHandles: string
  notes: string
  notExecutable?: boolean
}

export interface NodeSpecIssue {
  nodeId: string
  nodeType: string
  field?: string
  message: string
  severity?: 'warning'
}

const NODE_TYPE_ALIASES: Record<string, string> = {
  condition: 'ifElse',
}

export function resolveCatalogKey(kind: string): string {
  return NODE_TYPE_ALIASES[kind] ?? kind
}

export function validateNodeAgainstSpec(
  node: { id: string; data?: Record<string, unknown> },
  spec: NodeSpec,
): NodeSpecIssue[] {
  const issues: NodeSpecIssue[] = []
  const data = node.data ?? {}

  if (spec.notExecutable) {
    issues.push({
      nodeId: node.id,
      nodeType: spec.nodeType,
      message: `node type "${spec.nodeType}" is not executable (stub) — remove it or replace with a supported node`,
    })
    return issues
  }

  const missing = (field: string) => {
    const v = data[field]
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
  }

  for (const field of spec.requiredFields) {
    if (missing(field)) {
      issues.push({
        nodeId: node.id,
        nodeType: spec.nodeType,
        field,
        message: `required field "${field}" is missing or empty`,
      })
    }
  }

  const badArray = (req: { field: string; someTruthyKey?: string }): string | null => {
    const v = data[req.field]
    if (v === undefined || v === null) return null
    if (!Array.isArray(v) || v.length === 0) return `field "${req.field}" must be a non-empty array`
    if (v.some(item => item === null || item === undefined))
      return `field "${req.field}" must not contain null entries`
    if (req.someTruthyKey && !v.some(item => item && typeof item === 'object' && (item as Record<string, unknown>)[req.someTruthyKey!]))
      return `field "${req.field}" needs at least one entry with "${req.someTruthyKey}" set`
    return null
  }

  const isClampedViolation = (field: string): boolean => {
    const allowed = spec.enums[field]
    const v = data[field]
    return !!allowed && spec.clampedEnums?.includes(field) === true &&
      v !== undefined && v !== null && v !== '' && !(typeof v === 'string' && allowed.includes(v))
  }

  for (const rule of spec.conditionalRequired ?? []) {
    const actual = data[rule.whenField]
    const isAbsent = actual === undefined || actual === null || actual === ''
    const applies = actual === rule.equals ||
      (rule.defaultsTo === true && (isAbsent || isClampedViolation(rule.whenField)))
    if (applies) {
      const cond = isAbsent
        ? `${rule.whenField} defaults to "${rule.equals}"`
        : actual === rule.equals
          ? `${rule.whenField}="${rule.equals}"`
          : `${rule.whenField}=${JSON.stringify(actual)} is invalid and falls back to "${rule.equals}"`
      for (const field of rule.require ?? []) {
        if (missing(field)) {
          issues.push({
            nodeId: node.id,
            nodeType: spec.nodeType,
            field,
            message: `field "${field}" is required when ${cond}`,
          })
        }
      }
      for (const group of rule.requireAnyOf ?? []) {
        if (group.length === 0) continue
        if (group.every(missing)) {
          issues.push({
            nodeId: node.id,
            nodeType: spec.nodeType,
            field: group.join('|'),
            message: `one of ${group.map(f => `"${f}"`).join(' / ')} is required when ${cond}`,
          })
        }
      }
      for (const req of rule.requireArray ?? []) {
        const bad = badArray(req)
        if (bad) {
          issues.push({
            nodeId: node.id,
            nodeType: spec.nodeType,
            field: req.field,
            message: `${bad} when ${cond}`,
          })
        }
      }
    }
  }

  for (const req of spec.arrayRequirements ?? []) {
    const bad = badArray(req)
    if (bad) {
      issues.push({ nodeId: node.id, nodeType: spec.nodeType, field: req.field, message: bad })
    }
  }

  for (const field of spec.advisoryRequiredFields ?? []) {
    if (missing(field)) {
      issues.push({
        nodeId: node.id,
        nodeType: spec.nodeType,
        field,
        message: `field "${field}" is missing — the node runs but is a no-op without it`,
        severity: 'warning',
      })
    }
  }

  for (const [field, allowed] of Object.entries(spec.enums)) {
    const v = data[field]
    if (v !== undefined && v !== null && v !== '' && (typeof v !== 'string' || !allowed.includes(v))) {
      const clamped = spec.clampedEnums?.includes(field) === true
      issues.push({
        nodeId: node.id,
        nodeType: spec.nodeType,
        field,
        message: clamped
          ? `field "${field}" should be one of: ${allowed.join(', ')} (got ${JSON.stringify(v)}) — the executor falls back to its default, so this runs but the value is ignored`
          : `field "${field}" must be one of: ${allowed.join(', ')} (got ${JSON.stringify(v)})`,
        ...(clamped ? { severity: 'warning' as const } : {}),
      })
    }
  }

  return issues
}
