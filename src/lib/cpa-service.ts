import type { Prisma } from '@prisma/client'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export interface CpaChargeReceipt {
  agentId: string
  userId: string
  freeCharged: number
  boosterCharged: number
  paidCharged: number
  total: number
  logDate: Date
  boosterExpiresAt?: Date | null
}
export type CpaChargeFailure = 'insufficient' | 'subscription_not_found' | 'agent_not_found' | 'error'

export async function chargeCPA(_agentId: string, _amount: number, _txClient?: Prisma.TransactionClient): Promise<CpaChargeReceipt | null> {
  return unavailable('CPA charging')
}
export async function chargeCPAWithReason(_agentId: string, _amount: number, _txClient?: Prisma.TransactionClient): Promise<{ receipt: CpaChargeReceipt } | { failure: CpaChargeFailure }> {
  return unavailable('CPA charging')
}
export async function refundCPACharge(_receipt: CpaChargeReceipt, _txClient?: Prisma.TransactionClient): Promise<boolean> {
  return unavailable('CPA refunds')
}
export async function checkCPABalance(_userId: string): Promise<number | null> {
  return unavailable('CPA balance')
}
export async function validateCPAWithCache(_userId: string, _clientCache: any): Promise<{ allowed: boolean; balance: number; resetDate?: Date; newCache?: any }> {
  return { allowed: true, balance: 0 }
}
