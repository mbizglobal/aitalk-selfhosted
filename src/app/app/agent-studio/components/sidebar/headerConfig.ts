
import type { Node } from 'reactflow'
import type { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { isOutboundPstnStartNode } from '../../utils/nodeUtils'
import {
  isChatWidgetNode,
  isAppStartNode,
  isScheduleNode,
  isAiNode,
  isSourceNode,
  isMcpNode,
  isWebSearchNode,
  isFunctionNode,
  isIfElseNode,
  isWhileNode,
  isWaitNode,
  isContinueNode,
  isDataSheetsNode,
  isSendGridNode,
  isTelegramNode,
  isSmsNode,
  isTelegramStartNode,
  isImapNode,
  isSmtpNode,
  isPstnNode,
  isPstnStartNode,
  isEndNode,
  isSubWorkflowStartNode,
  isSubWorkflowToolNode,
} from './nodeTypeUtils'

export interface HeaderInfo {
  title: string
  description: string
}

export function getHeaderInfo(
  selectedNode: Node | undefined,
  t: ReturnType<typeof getAgentStudioTranslation>
): HeaderInfo {
  if (!selectedNode) return { title: '', description: '' }

  if (isSubWorkflowStartNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.start_subworkflow || 'Start / Sub-workflow',
      description: t.subworkflow_start_desc || 'Entry point of a Sub-workflow — defines the tool (name, description, inputs) other workflows call'
    }
  }
  if (isSubWorkflowToolNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.toolsSubworkflow || 'Sub-workflow',
      description: t.subworkflow_tool_desc || 'The AI calls the selected Sub-workflow as a function'
    }
  }
  if (isAppStartNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.app_start || 'Start / App',
      description: t.app_start_desc || 'Opens as a work app for the agent team'
    }
  }
  if (isChatWidgetNode(selectedNode)) {
    return {
      title: t.start_chat_widget,
      description: t.chat_widget_desc
    }
  }
  if (isScheduleNode(selectedNode)) {
    return {
      title: t.start_schedule,
      description: t.schedule_desc
    }
  }
  if (isAiNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.ai,
      description: t.ai_desc
    }
  }
  if (isSourceNode(selectedNode)) {
    return {
      title: t.source,
      description: t.source_desc
    }
  }
  if (isMcpNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.mcp,
      description: t.mcp_desc
    }
  }
  if (isWebSearchNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.web_search,
      description: t.web_search_desc
    }
  }
  if (isFunctionNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || 'Function Calling',
      description: t.function_desc
    }
  }
  if (isIfElseNode(selectedNode)) {
    return {
      title: t.if_else,
      description: t.if_else_desc
    }
  }
  if (isWhileNode(selectedNode)) {
    return {
      title: t.while_loop,
      description: t.while_desc
    }
  }
  if (isWaitNode(selectedNode)) {
    return {
      title: t.wait,
      description: t.wait_desc
    }
  }
  if (isContinueNode(selectedNode)) {
    return {
      title: t.node_continue,
      description: ''
    }
  }
  if (isDataSheetsNode(selectedNode)) {
    return {
      title: t.data_sheets,
      description: t.data_sheets_desc
    }
  }
  if (isSendGridNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.sendgrid,
      description: t.sendgrid_desc
    }
  }
  if (isTelegramNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.telegram,
      description: t.telegram_desc
    }
  }
  if (isSmsNode(selectedNode)) {
    const smsNodeType = selectedNode.data?.nodeType as string | undefined
    const isAcsSms = smsNodeType === 'sms_acs' || smsNodeType === 'sms'
    return {
      title: selectedNode.data?.label || t.sms || 'SMS',
      description: isAcsSms
        ? (t.sms_desc || 'Send one-way SMS via Azure Communication Services')
        : (t.sms_desc_infobip || 'Send one-way SMS via Infobip')
    }
  }
  if (isTelegramStartNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.telegram_start,
      description: t.telegram_start_desc
    }
  }
  if (isImapNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.imap || 'IMAP',
      description: t.imap_desc || 'Read, move, or mark emails as read via IMAP'
    }
  }
  if (isSmtpNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.smtp || 'SMTP',
      description: t.smtp_desc || 'Send or forward emails via SMTP'
    }
  }
  if (isPstnStartNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || t.start_pstn || 'Start / PSTN',
      description: isOutboundPstnStartNode(selectedNode)
        ? (t.pstn_start_desc_outbound || 'Place outbound phone calls with AI voice from this workflow')
        : (t.pstn_start_desc || 'Receive incoming phone calls and respond with AI voice')
    }
  }
  if (isPstnNode(selectedNode)) {
    return {
      title: selectedNode.data?.label || 'PSTN',
      description: t.pstn_outbound_desc || 'Make outbound phone calls with AI voice'
    }
  }
  if (isEndNode(selectedNode)) {
    return {
      title: t.end,
      description: t.end_desc_short
    }
  }
  return {
    title: selectedNode.data?.label || t.properties,
    description: t.node_properties
  }
}
