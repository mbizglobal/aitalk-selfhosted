
import { WorkflowContext, RAGSearchResult } from '../../types'
import { NodeExecutionResult, NodeExecutionDebug } from '../base'
import { canReadTemplatePath } from '../../template-scope'
import { safeLogToken } from '@/lib/log-mask'

// ========================================
// ========================================

export function detectStreamFailure(
  chunk: any
): { message: string; code?: string; responseId?: string; usageInputTokens?: number; usageOutputTokens?: number } | null {
  if (chunk?.type === 'error') {
    return { message: chunk.message || chunk.code || 'stream error', code: safeErrorCode(chunk.code) }
  }
  if (chunk?.type === 'response.failed') {
    return {
      message: chunk.response?.error?.message || chunk.response?.error?.code || 'response failed',
      code: safeErrorCode(chunk.response?.error?.code),
      responseId: safeLogToken(chunk.response?.id),
      usageInputTokens: chunk.response?.usage?.input_tokens,
      usageOutputTokens: chunk.response?.usage?.output_tokens,
    }
  }
  return null
}

export interface StreamFailureError extends Error {
  streamFailureCode?: string
}

export function makeStreamFailureError(
  label: string,
  failure: { code?: string; responseId?: string; message: string }
): StreamFailureError {
  const err = new Error(
    `${label}: code=${failure.code ?? '-'} resp=${failure.responseId ?? '-'} (${failure.message.length} chars)`
  ) as StreamFailureError
  if (failure.code) err.streamFailureCode = failure.code
  return err
}

export function getStreamFailureCode(err: unknown): string | undefined {
  const code = (err as StreamFailureError | null)?.streamFailureCode
  return typeof code === 'string' && code ? code : undefined
}

const KNOWN_STREAM_ERROR_CODES: ReadonlySet<string> = new Set([
  'server_error', 'rate_limit_exceeded', 'invalid_prompt', 'vector_store_timeout',
  'invalid_image', 'invalid_image_format', 'invalid_base64_image', 'invalid_image_url',
  'image_too_large', 'image_too_small', 'image_parse_error', 'image_content_policy_violation',
  'invalid_image_mode', 'image_file_too_large', 'unsupported_image_media_type',
  'empty_image_file', 'failed_to_download_image', 'image_file_not_found',
  'invalid_request_error', 'context_length_exceeded', 'insufficient_quota', 'content_filter',
  'model_not_found', 'invalid_api_key', 'permission_denied', 'service_unavailable',
  'timeout', 'tokens_exceeded', 'response_cancelled', 'response_incomplete', 'internal_error',
  'invalid_json_schema',
  'empty_response',
])

function safeErrorCode(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined
  return KNOWN_STREAM_ERROR_CODES.has(v) ? v : 'other'
}

// ========================================
// ========================================

export interface ResultBuilders {
  createSuccessResult: (context: WorkflowContext, debug?: NodeExecutionDebug) => NodeExecutionResult
  createErrorResult: (context: WorkflowContext, error: string, input?: any) => NodeExecutionResult
}

// ========================================
// ========================================

export function extractPureJson(text: string): string {
  let cleaned = text.replace(/```json\s*([\s\S]*?)\s*```/g, '$1')
  cleaned = cleaned.replace(/```\s*([\s\S]*?)\s*```/g, '$1')

  cleaned = cleaned.trim()

  const jsonStartMatch = cleaned.match(/^(\{|\[)/)
  if (!jsonStartMatch) {
    return cleaned
  }

  let depth = 0
  let inString = false
  let escapeNext = false
  let jsonEnd = -1

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"' && !escapeNext) {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{' || char === '[') {
      depth++
    } else if (char === '}' || char === ']') {
      depth--
      if (depth === 0) {
        jsonEnd = i
        break
      }
    }
  }

  if (jsonEnd > 0) {
    return cleaned.substring(0, jsonEnd + 1)
  }

  return cleaned
}

// ========================================
// ========================================

export function transformCitations(text: string, baseUrl?: string | null): string {
  if (!text) return text

  const citationPattern = /【\d+:([^\】]+)】/g

  if (!baseUrl) {
    return text.replace(citationPattern, '')
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

  const citations: { path: string; original: string }[] = []
  let match
  while ((match = citationPattern.exec(text)) !== null) {
    citations.push({
      path: match[1],
      original: match[0]
    })
  }

  if (citations.length === 0) {
    return text
  }

  const uniquePaths = [...new Set(citations.map(c => c.path))]

  let result = text.replace(citationPattern, '')

  if (uniquePaths.length > 0) {
    const linkSection = uniquePaths
      .map(path => `- [${path}](${normalizedBaseUrl}/${path})`)
      .join('\n')

    result = result.replace(/[,\s]+$/, '')

    result = `${result}\n\n${linkSection}`
  }

  return result
}

// ========================================
// ========================================

export function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined
    }
    current = current[part]
  }

  return current
}

export function substituteTemplate(template: string, context: any): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    let trimmed = path.trim()
    if (trimmed.startsWith('context.')) {
      trimmed = trimmed.substring(8)
    }
    if (!canReadTemplatePath(context, trimmed)) return match
    const value = getNestedValue(context, trimmed)

    if (value === undefined || value === null) {
      return match
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2)
    }

    return String(value)
  })
}
