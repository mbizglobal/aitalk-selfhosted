
import { parseBundleSpec, type BundleProblem } from './bundle'

export const BUNDLE_KEYS = ['bundleVersion', 'group', 'dataSheets', 'subWorkflows', 'wiring'] as const

export type BundleExtractResult =
  | { ok: true; bundleJson: string | null }
  | { ok: false; problems: BundleProblem[] }

export function extractBundleJson(template: unknown): BundleExtractResult {
  const parsed = parseBundleSpec(template)
  if (parsed === null) return { ok: true, bundleJson: null }
  if (!parsed.ok) return { ok: false, problems: parsed.problems }

  const t = template as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of BUNDLE_KEYS) {
    if (t[k] !== undefined) out[k] = t[k]
  }
  return { ok: true, bundleJson: JSON.stringify(out) }
}

const BUNDLE_MARKER_MAX_CHARS = 1_048_576

export function readStoredBundleVersion(bundleJson: string | null | undefined): number | undefined {
  if (!bundleJson) return undefined
  if (bundleJson.length > BUNDLE_MARKER_MAX_CHARS) return undefined
  const firstNonSpace = bundleJson.search(/\S/)
  if (firstNonSpace < 0 || bundleJson.charCodeAt(firstNonSpace) !== 0x7b /* { */) return undefined
  try {
    const v = (JSON.parse(bundleJson) as Record<string, unknown>)?.bundleVersion
    return typeof v === 'number' ? v : undefined
  } catch {
    return undefined
  }
}

export type BundleMergeResult =
  | { ok: true; template: unknown }
  | { ok: false; problems: BundleProblem[] }

export function mergeBundleIntoTemplate(row: {
  templateId: string
  name: string
  description: string
  workflowJson: string
  bundleJson: string | null
}): BundleMergeResult {
  const base: Record<string, unknown> = {
    templateId: row.templateId,
    name: row.name,
    description: row.description,
    workflowJson: row.workflowJson,
  }
  if (row.bundleJson === null || row.bundleJson === undefined) return { ok: true, template: base }

  if (row.bundleJson.trim() === '') {
    return {
      ok: false,
      problems: [{ code: 'BUNDLE_JSON_UNREADABLE', message: 'The stored bundle definition is empty. Re-copy this template from the local file.' }],
    }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(row.bundleJson)
  } catch {
    return {
      ok: false,
      problems: [{ code: 'BUNDLE_JSON_UNREADABLE', message: 'The stored bundle definition is not valid JSON. Re-copy this template from the local file.' }],
    }
  }
  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    return {
      ok: false,
      problems: [{ code: 'BUNDLE_JSON_UNREADABLE', message: 'The stored bundle definition is not an object. Re-copy this template from the local file.' }],
    }
  }

  const b = parsedJson as Record<string, unknown>
  for (const k of BUNDLE_KEYS) {
    if (b[k] !== undefined) base[k] = b[k]
  }

  const check = parseBundleSpec(base)
  if (check === null) {
    return {
      ok: false,
      problems: [{ code: 'BUNDLE_JSON_INCOMPLETE', message: 'The stored bundle definition has no bundleVersion. Re-copy this template from the local file.' }],
    }
  }
  if (!check.ok) return { ok: false, problems: check.problems }

  return { ok: true, template: base }
}
