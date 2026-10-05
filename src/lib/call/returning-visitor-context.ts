import type { PrismaClient } from '@prisma/client'
import type { AIToolClient } from '@/lib/workflow/tools'
import type { MultiCalendarDispatcher } from '@/lib/workflow/tools/multi-calendar-dispatcher'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export interface ReturningVisitorContextInput {
  prisma: PrismaClient
  agentId: string
  clientId: string
  dataKey?: Buffer | null
  currentConversationId?: string | null
  lookbackDays?: number
  lookupClient?: AIToolClient | null
  phoneHint?: string | null
  callChannel?: 'web_voice' | 'chat_widget'
  multiCalendarDispatcher?: MultiCalendarDispatcher | null
  userId?: string
}
export interface PreflightAppointment {
  calendarKey?: string
  calendarName?: string
  appointment: any
}
export interface ReturningVisitorContextResult {
  instructions: string
  extractedContact?: { name?: string; phone?: string; email?: string }
  phase1TimeoutKeys?: string[]
  phase1EventIds?: Set<string>
  enrichedAppointments?: PreflightAppointment[]
}
export async function buildReturningVisitorContext(_input: ReturningVisitorContextInput): Promise<ReturningVisitorContextResult | null> {
  return unavailable('Returning-visitor context')
}
