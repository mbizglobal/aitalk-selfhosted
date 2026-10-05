import { NextResponse } from 'next/server'
import type { WorkflowServiceError } from './service'

const CODE_AS_ERROR_FIELD = new Set(['workflow_limit_reached', 'free_limit_reached', 'paid_limit_reached'])

export function workflowServiceErrorResponse(err: WorkflowServiceError): NextResponse {
  if (CODE_AS_ERROR_FIELD.has(err.code)) {
    return NextResponse.json({ error: err.code, ...(err.meta ?? {}) }, { status: err.status })
  }
  return NextResponse.json({ error: err.message, code: err.code, ...(err.meta ?? {}) }, { status: err.status })
}
