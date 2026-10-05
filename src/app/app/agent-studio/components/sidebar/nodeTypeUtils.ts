
import type { Node } from 'reactflow'

export const isChatWidgetNode = (node: Node) =>
  (node.data?.label === 'Chat Widget' || node.data?.nodeType === 'start') &&
  node.data?.triggerType !== 'schedule' &&
  node.data?.triggerType !== 'telegram' &&
  node.data?.triggerType !== 'pstn' &&
  node.data?.triggerType !== 'subworkflow' &&
  node.data?.triggerType !== 'app'

export const isAppStartNode = (node: Node) =>
  node.data?.nodeType === 'start' && node.data?.triggerType === 'app'

export const isSubWorkflowStartNode = (node: Node) =>
  node.data?.nodeType === 'start' && node.data?.triggerType === 'subworkflow'

export const isSubWorkflowToolNode = (node: Node) =>
  node.type === 'tool' && node.data?.toolType === 'subworkflow'

export const isScheduleNode = (node: Node) =>
  node.data?.triggerType === 'schedule' || node.data?.nodeType === 'schedule'

export const isAiNode = (node: Node) =>
  node.data?.nodeType === 'ai' || node.data?.label === 'AI'

export const isSourceNode = (node: Node) =>
  node.type === 'tool' && node.data?.toolType === 'source'

export const isMiniAppNode = (node: Node) =>
  node.type === 'tool' && node.data?.nodeType === 'miniapp'

export const isMcpNode = (node: Node) =>
  node.type === 'tool' && node.data?.toolType === 'mcp'

export const isWebSearchNode = (node: Node) =>
  node.type === 'tool' && node.data?.toolType === 'webSearch'

export const isFunctionNode = (node: Node) =>
  node.type === 'tool' && node.data?.toolType === 'functionCalling'

export const isIfElseNode = (node: Node) =>
  node.type === 'ifElse' || node.data?.label === 'If / else'

export const isWhileNode = (node: Node) =>
  node.type === 'while' || node.data?.nodeType === 'while'

export const isWaitNode = (node: Node) =>
  node.type === 'wait' || node.data?.nodeType === 'wait'

export const isContinueNode = (node: Node) =>
  node.type === 'continue' || node.data?.nodeType === 'continue'

export const isDataSheetsNode = (node: Node) =>
  node.type === 'dataSheets' || node.data?.nodeType === 'dataSheets'

export const isSendGridNode = (node: Node) =>
  node.data?.nodeType === 'sendgrid' || (node.type === 'tool' && node.data?.toolType === 'sendgrid')

export const isTelegramNode = (node: Node) =>
  node.data?.nodeType === 'telegram' || (node.type === 'tool' && node.data?.toolType === 'telegram')

const SMS_NODE_TYPES = ['sms_infobip', 'sms_acs', 'sms']
export const isSmsNode = (node: Node) =>
  SMS_NODE_TYPES.includes(node.data?.nodeType as string) ||
  (node.type === 'tool' && SMS_NODE_TYPES.includes(node.data?.toolType as string))

export const isTelegramStartNode = (node: Node) =>
  node.data?.nodeType === 'start' && node.data?.triggerType === 'telegram'

export const isImapNode = (node: Node) =>
  node.data?.nodeType === 'imap' || node.data?.label === 'IMAP'

export const isSmtpNode = (node: Node) =>
  node.data?.nodeType === 'smtp' || node.data?.label === 'SMTP' || (node.type === 'tool' && node.data?.toolType === 'smtp')

export const isGoogleCalendarNode = (node: Node) =>
  node.data?.nodeType === 'google_calendar' || (node.type === 'tool' && node.data?.toolType === 'google_calendar')

export const isMicrosoftCalendarNode = (node: Node) =>
  node.data?.nodeType === 'microsoft_calendar' || (node.type === 'tool' && node.data?.toolType === 'microsoft_calendar')

export const isHttpRequestNode = (node: Node) =>
  node.data?.nodeType === 'httpRequest'

export const isStoreNode = (node: Node) =>
  node.data?.nodeType === 'store'

export const isPstnNode = (node: Node) =>
  node.data?.nodeType === 'pstn'

export const isPstnStartNode = (node: Node) =>
  node.data?.nodeType === 'start' && node.data?.triggerType === 'pstn'

export const isEndNode = (node: Node) =>
  node.data?.nodeType === 'end' || node.data?.label === 'End'

export const isEditableLabelNode = (node: Node) =>
  isMcpNode(node) ||
  isWebSearchNode(node) ||
  isFunctionNode(node) ||
  isDataSheetsNode(node) ||
  isSendGridNode(node) ||
  isTelegramNode(node) ||
  isSmsNode(node) ||
  isTelegramStartNode(node) ||
  isImapNode(node) ||
  isSmtpNode(node) ||
  isGoogleCalendarNode(node) ||
  isMicrosoftCalendarNode(node) ||
  isHttpRequestNode(node) ||
  isStoreNode(node) ||
  isPstnNode(node) ||
  isPstnStartNode(node) ||
  isIfElseNode(node) ||
  isWhileNode(node) ||
  isWaitNode(node) ||
  isContinueNode(node) ||
  isAiNode(node)
