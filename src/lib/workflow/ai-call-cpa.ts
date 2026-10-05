import type { WorkflowContext } from '@/lib/workflow/types'
import type { CpaChargeFailure, CpaChargeReceipt } from '@/lib/cpa-service'

interface AiCallReservationRecord {
  reservationId: string
  receipt: CpaChargeReceipt
}
type OpenReservationResult =
  | { reservation: AiCallReservationRecord }
  | { failure: CpaChargeFailure }

type AiCallBillingContext = Pick<WorkflowContext, 'agentId' | 'userId' | 'isTestMode' | 'isManaged' | 'skipAiCallCpa'>

export interface AiCallReservation {
  settle(inputTokens?: number | null, outputTokens?: number | null): void
  cancel(): void
  finalize(sawOutput: boolean): void
}

export interface AiCallCpaDeps {
  open: (agentId: string, base: number, model: string) => Promise<OpenReservationResult>
  settle: (record: AiCallReservationRecord, extra: number) => void
  refund: (record: AiCallReservationRecord) => void
  deductUnreserved: (agentId: string, amount: number) => void
}

const NOOP_RESERVATION: AiCallReservation = { settle() {}, cancel() {}, finalize() {} }

export async function reserveCpaForAiCall(_context: AiCallBillingContext, _model: string, _deps?: AiCallCpaDeps): Promise<AiCallReservation> {
  return NOOP_RESERVATION
}
