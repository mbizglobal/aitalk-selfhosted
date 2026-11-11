
export type WorkErrorCode =
  | 'NOT_FOUND'
  | 'LOCKED'
  | 'READ_ONLY'
  | 'FORBIDDEN'
  | 'INVALID'
  | 'DUPLICATE'
  | 'PAIRED'
  | 'TEMPLATE_LOCKED'
  | 'TEMPLATE_UNKNOWN'
  | 'INTEGRITY'
  | 'REFERENCED'
  | 'UNCONFIRMED'
  | 'MODULE_STOPPED'
  | 'STALE'
  | 'CHECK_FAILED'
  | 'ROW_IN_USE'
  | 'IN_USE'
  | 'APPROVAL_REQUIRED'
  | 'AWAITING_APPROVAL'
  | 'UNAVAILABLE'
  | 'SENDING'
  | 'NO_APPROVER'
  | 'ALREADY_REQUESTED'
  | 'APP_CLOSED'
  | 'INVITE_GMAIL'
  | 'SEAT_LIMIT'
  | 'COMPANY_LIMIT'
  | 'RATE_LIMITED'
  | 'FORM_LIMIT'

export interface WorkStop {
  code: string
  params?: Record<string, string | number>
}

export class WorkError extends Error {
  constructor(readonly code: WorkErrorCode, readonly detail = '', readonly stop?: WorkStop) {
    super(detail ? `WORK ${code}: ${detail}` : `WORK ${code}`)
    this.name = 'WorkError'
  }
}

export const WORK_ERROR_STATUS: Record<WorkErrorCode, number> = {
  NOT_FOUND: 404,
  LOCKED: 409,
  READ_ONLY: 409,
  APP_CLOSED: 409,
  FORBIDDEN: 403,
  INVALID: 400,
  DUPLICATE: 409,
  PAIRED: 409,
  TEMPLATE_LOCKED: 409,
  TEMPLATE_UNKNOWN: 500,
  INTEGRITY: 500,
  REFERENCED: 409,
  UNCONFIRMED: 409,
  MODULE_STOPPED: 422,
  STALE: 409,
  IN_USE: 409,
  ROW_IN_USE: 409,
  CHECK_FAILED: 409,
  APPROVAL_REQUIRED: 409,
  AWAITING_APPROVAL: 409,
  SENDING: 409,
  UNAVAILABLE: 503,
  NO_APPROVER: 409,
  ALREADY_REQUESTED: 409,
  SEAT_LIMIT: 403,
  INVITE_GMAIL: 400,
  COMPANY_LIMIT: 403,
  RATE_LIMITED: 429,
  FORM_LIMIT: 403,
}
