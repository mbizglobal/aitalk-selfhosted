import type { PrismaClient } from '@prisma/client'
import type { AIToolClient, ToolCallContext, ToolDefinition } from '@/lib/workflow/tools/types'

export class CallTransferToolClient implements AIToolClient {
  async initialize(_prisma: PrismaClient, _connectionId: string, _overrides?: { agentId?: string; staffTransferNumber?: string }, _userId?: string): Promise<void> {}
  listTools(): ToolDefinition[] { return [] }
  async callTool(_name: string, _args: Record<string, any>, _callContext?: ToolCallContext): Promise<string> {
    throw new Error('Call transfer is not part of this installation (self-hosted edition)')
  }
}
