import type { PrismaClient } from '@prisma/client'
import type { AIToolClient, ToolDefinition, ToolCallContext } from '@/lib/workflow/tools/types'

interface SmsSendResult { success: boolean; messageId?: string; errorMessage?: string; status?: 'accepted' | 'delivered' | 'unknown'; providerStatus?: string }
interface SmsProvider { readonly kind: 'acs' | 'infobip'; readonly sender: string; send(to: string, message: string): Promise<SmsSendResult> }
type ResolveSmsProvider = (prisma: PrismaClient, connectionId: string, userId: string, agentId?: string) => Promise<SmsProvider | null>

export class SmsToolClient implements AIToolClient {
  constructor(_resolveProvider?: ResolveSmsProvider) {}
  async initialize(_prisma: PrismaClient, _connectionId: string, _overrides?: { agentId?: string; defaultTo?: string }, _userId?: string): Promise<void> {}
  isRecipientPinned(): boolean { return false }
  listTools(): ToolDefinition[] { return [] }
  async callTool(_name: string, _args: Record<string, any>, _callContext?: ToolCallContext): Promise<string> {
    throw new Error('SMS is not part of this installation (self-hosted edition)')
  }
}
