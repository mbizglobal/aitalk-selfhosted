
import { PrismaClient } from '@prisma/client'
import { WorkflowNode, WorkflowContext } from '../types'
import {
  startNodeExecutor,
  endNodeExecutor,
  aiNodeExecutor,
  fileSearchNodeExecutor,
  sourceNodeExecutor,
  waitNodeExecutor,
  DataSheetsNodeExecutor,
  ifElseNodeExecutor,
  mcpExecutor,
  SendGridNodeExecutor,
  TelegramNodeExecutor,
  SmsNodeExecutor,
  ImapNodeExecutor,
  SmtpNodeExecutor,
  HttpRequestNodeExecutor,
  StoreNodeExecutor,
  PstnNodeExecutor,
  NodeExecutionResult
} from '../nodes'

export { SUPPORTED_NODE_TYPES, isSupportedNodeType, resolveNodeType } from './resolve-node-type'

export async function executeNodeByType(
  node: WorkflowNode,
  nodeType: WorkflowNode['type'],
  data: WorkflowContext,
  prisma: PrismaClient
): Promise<NodeExecutionResult> {
  switch (nodeType) {
    case 'start':
      return await startNodeExecutor.execute(node, data, prisma)

    case 'source':
      return await sourceNodeExecutor.execute(node, data, prisma)

    case 'file_search':
      return await fileSearchNodeExecutor.execute(node, data, prisma)

    case 'ai':
      return await aiNodeExecutor.execute(node, data, prisma)

    case 'condition':
    case 'ifElse':
      return await ifElseNodeExecutor.execute(node, data, prisma)

    case 'webhook':
      console.warn('[Workflow] Webhook node not yet implemented')
      return { context: data }

    case 'while':
      return { context: data }

    case 'wait':
      return await waitNodeExecutor.execute(node, data, prisma)

    case 'dataSheets':
      const dataSheetsExecutor = new DataSheetsNodeExecutor()
      return await dataSheetsExecutor.execute(node, data, prisma)

    case 'mcp':
      return await mcpExecutor.execute(node, data, prisma)

    case 'sendgrid':
      const sendgridExecutor = new SendGridNodeExecutor()
      return await sendgridExecutor.execute(node, data, prisma)

    case 'telegram':
      const telegramExecutor = new TelegramNodeExecutor()
      return await telegramExecutor.execute(node, data, prisma)

    // 'sms' = legacy alias → ACS
    case 'sms':
    case 'sms_acs':
    case 'sms_infobip':
      const smsExecutor = new SmsNodeExecutor()
      return await smsExecutor.execute(node, data, prisma)

    case 'imap':
      const imapExecutor = new ImapNodeExecutor()
      return await imapExecutor.execute(node, data, prisma)

    case 'smtp':
      const smtpExecutor = new SmtpNodeExecutor()
      return await smtpExecutor.execute(node, data, prisma)

    case 'httpRequest':
      const httpRequestExecutor = new HttpRequestNodeExecutor()
      return await httpRequestExecutor.execute(node, data, prisma)

    case 'store':
      const storeExecutor = new StoreNodeExecutor()
      return await storeExecutor.execute(node, data, prisma)

    case 'pstn':
      const pstnExecutor = new PstnNodeExecutor()
      return await pstnExecutor.execute(node, data, prisma)

    case 'continue':
      return { context: data }

    case 'end':
      return await endNodeExecutor.execute(node, data, prisma)

    default:
      console.warn(`[Workflow] Unknown node type: ${node.type}`)
      return { context: data }
  }
}
