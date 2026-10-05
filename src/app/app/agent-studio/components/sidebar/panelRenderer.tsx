
import type { Node } from 'reactflow'
import type { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { isMiniAppNodeOfType } from '@/lib/workflow/mini-app-registry'
import {
  ChatWidgetPanel,
  AppStartPanel,
  SchedulePanel,
  AiNodePanel,
  SourcePanel,
  QuizPanel,
  VoiceQuizPanel,
  McpPanel,
  WebSearchPanel,
  FunctionPanel,
  EndPanel,
  DefaultPanel,
  IfElsePanel,
  WhilePanel,
  WaitPanel,
  DataSheetsPanel,
  SendGridPanel,
  TelegramPanel,
  SmsPanel,
  TelegramStartPanel,
  ImapPanel,
  SmtpPanel,
  GoogleCalendarToolPanel,
  MicrosoftCalendarToolPanel,
  HttpRequestPanel,
  StorePanel,
  PstnPanel,
  PstnStartPanel,
  SubWorkflowStartPanel,
  SubWorkflowToolPanel,
} from '../right-panel'
import {
  isChatWidgetNode,
  isAppStartNode,
  isScheduleNode,
  isAiNode,
  isSourceNode,
  isMiniAppNode,
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
  isGoogleCalendarNode,
  isMicrosoftCalendarNode,
  isHttpRequestNode,
  isStoreNode,
  isPstnNode,
  isPstnStartNode,
  isEndNode,
  isSubWorkflowStartNode,
  isSubWorkflowToolNode,
} from './nodeTypeUtils'

export function renderNodePanel(
  node: Node,
  updateNodeData: (patch: Record<string, any>) => void,
  t: ReturnType<typeof getAgentStudioTranslation>
) {
  if (isSubWorkflowStartNode(node)) {
    return <SubWorkflowStartPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isSubWorkflowToolNode(node)) {
    return <SubWorkflowToolPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isAppStartNode(node)) {
    return <AppStartPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isChatWidgetNode(node)) {
    return <ChatWidgetPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isScheduleNode(node)) {
    return <SchedulePanel node={node} updateNodeData={updateNodeData} />
  }
  if (isAiNode(node)) {
    return <AiNodePanel node={node} updateNodeData={updateNodeData} />
  }
  if (isMiniAppNode(node)) {
    if (isMiniAppNodeOfType(node, 'voice_quiz')) return <VoiceQuizPanel node={node} updateNodeData={updateNodeData} />
    return <QuizPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isSourceNode(node)) {
    return <SourcePanel node={node} />
  }
  if (isMcpNode(node)) {
    return <McpPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isWebSearchNode(node)) {
    return <WebSearchPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isFunctionNode(node)) {
    return <FunctionPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isIfElseNode(node)) {
    return <IfElsePanel node={node} updateNodeData={updateNodeData} />
  }
  if (isWhileNode(node)) {
    return <WhilePanel node={node} updateNodeData={updateNodeData} />
  }
  if (isWaitNode(node)) {
    return <WaitPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isContinueNode(node)) {
    return (
      <div className="text-sm text-gray-400 py-4">
        {t.continue_desc}
      </div>
    )
  }
  if (isDataSheetsNode(node)) {
    return <DataSheetsPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isSendGridNode(node)) {
    return <SendGridPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isTelegramNode(node)) {
    return <TelegramPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isSmsNode(node)) {
    return <SmsPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isTelegramStartNode(node)) {
    return <TelegramStartPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isImapNode(node)) {
    return <ImapPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isSmtpNode(node)) {
    return <SmtpPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isGoogleCalendarNode(node)) {
    return <GoogleCalendarToolPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isMicrosoftCalendarNode(node)) {
    return <MicrosoftCalendarToolPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isHttpRequestNode(node)) {
    return <HttpRequestPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isStoreNode(node)) {
    return <StorePanel node={node} updateNodeData={updateNodeData} />
  }
  if (isPstnStartNode(node)) {
    return <PstnStartPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isPstnNode(node)) {
    return <PstnPanel node={node} updateNodeData={updateNodeData} />
  }
  if (isEndNode(node)) {
    return <EndPanel node={node} updateNodeData={updateNodeData} />
  }
  return <DefaultPanel />
}
