
import { WorkError } from './errors'

export function moduleStop(code: string, detail: string, params?: Record<string, string | number>): WorkError {
  return new WorkError('MODULE_STOPPED', detail, { code, ...(params ? { params } : {}) })
}
