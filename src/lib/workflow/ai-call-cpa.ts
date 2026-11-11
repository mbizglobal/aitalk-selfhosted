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
  settle(inputTokens?: number | null, outputTokens?: number | null, webSearches?: number | null): void
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

type ReservationTx = { aiCallCpaReservation: { updateMany(args: { where: { reservationId: string; status: string }; data: { status: string; closedAt: Date } }): Promise<{ count: number }> } }

export interface FixedCpaHold {
  readonly reservationId: string | null
  settleInTx(tx: ReservationTx): Promise<boolean>
  markSettled(): void
  cancel(): void
}

const NOOP_HOLD: FixedCpaHold = { reservationId: null, settleInTx: async () => true, markSettled() {}, cancel() {} }

export async function holdFixedCpaForAiCall(_context: AiCallBillingContext, _model: string, _amount: number, _deps?: Pick<AiCallCpaDeps, 'open' | 'refund'>): Promise<FixedCpaHold> {
  return NOOP_HOLD
}
