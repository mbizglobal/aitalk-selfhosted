
import type { PendingBookingConfirm } from '@/lib/calendar/booking-confirm'
import { PrismaClient } from '@prisma/client'

export interface ToolDefinition {
  name: string
  description: string
  parameters: object
}

export interface ToolCallContext {
  callChannel?: 'pstn' | 'web_voice' | 'chat_widget' | 'booking_widget'
  callProvider?: 'acs' | 'clawops'
  callerNumber?: string | null
  callConnectionId?: string | null
  restrictedContact?: {
    name?: string | null
    phone?: string | null
    email?: string | null
  }
  callerUtterances?: string[]
  transcriptSource?: 'model_input_asr' | 'external_whisper'
  sameCallOwnedEventIds?: Set<string>
  pendingPhoneUpdate?: { eventId: string; phone: string }
  pendingBookingConfirm?: PendingBookingConfirm
  callerLastTurnAt?: number
  voiceQuiz?:
    | {
        roundId: string
        phase: string
        questionCount: number
        asked: number
        correct: number
        topic: string
        actionKey?: string
        anonKey?: string
      }
    | {
        phase: 'signup'
        consentText: string
        consentAt: string
        consentAfterMs: number
      }
}

export interface AIToolClient {
  listTools(): ToolDefinition[]

  callTool(name: string, args: Record<string, any>, callContext?: ToolCallContext): Promise<string>

  initialize(prisma: PrismaClient, connectionId: string, overrides?: any, userId?: string): Promise<void>
}
