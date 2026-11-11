'use client'

import { memo, useMemo, useCallback, useContext } from 'react'
import { NodeProps, Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow'
import { generateNodeSummary } from '../utils/generateNodeSummary'
import { analyzeNodeDependencies, type NodeDependency } from '../utils/analyzeDependencies'
import { MiniChip } from '../components/MiniChip'
import { Circle, MessageSquare, Clock, Bot, Inbox, Send, Globe, DatabaseZap, Phone, Puzzle, LayoutGrid, Link2, Briefcase, ClipboardCheck } from 'lucide-react'
import { TelegramIcon, SendGridIcon, SmsIcon } from '../constants/components'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { COMPANY_BOOK_KINDS } from '@/lib/work/app-template-kinds'
import { HandoffReadinessContext, handoffNotice, isHandoffTarget } from '../components/right-panel/handoff-readiness'

export const WORK_APP_LINES_IN = 'lines-in'
export const WORK_APP_LINES_IN_BOTTOM = 'lines-in-bottom'
export const lineHandleBase = (h: string | null | undefined): string | null | undefined => (h === 'ref-top' ? 'ref' : h === 'send-top' ? 'send' : h)

export function workAppLineOutHandle(base: 'ref' | 'send', from?: { position?: { y: number } | null; height?: number | null } | null, to?: { position?: { y: number } | null; height?: number | null } | null): string {
  const mid = (n?: { position?: { y: number } | null; height?: number | null } | null) => (n?.position?.y ?? 0) + (n?.height ?? 110) / 2
  return from && to && mid(to) < mid(from) ? `${base}-top` : base
}

export function workAppLineInHandle(given: string | null | undefined, from?: { position?: { y: number } | null; height?: number | null } | null, to?: { position?: { y: number } | null; height?: number | null } | null): string {
  if (given === WORK_APP_LINES_IN || given === WORK_APP_LINES_IN_BOTTOM) return given
  const mid = (n?: { position?: { y: number } | null; height?: number | null } | null) => (n?.position?.y ?? 0) + (n?.height ?? 110) / 2
  return from && to && mid(from) > mid(to) ? WORK_APP_LINES_IN_BOTTOM : WORK_APP_LINES_IN
}

const WORK_APP_EVENT_HANDLES = [
  { id: 'ev:sealed', key: 'work_app_ev_sealed', label: 'closed' },
  { id: 'ev:resubmitted', key: 'work_app_ev_resubmitted', label: 'resubmitted' },
  { id: 'ev:unlocked', key: 'work_app_ev_unlocked', label: 'unlocked' },
  { id: 'ev:inbox_row', key: 'work_app_ev_inbox_row', label: 'new inbox row' },
] as const

let globalAddToolHandler: ((aiNodeId: string) => void) | null = null

let globalBreakpointHandler: ((nodeId: string) => void) | null = null

export function setGlobalAddToolHandler(handler: ((aiNodeId: string) => void) | null) {
  globalAddToolHandler = handler
}

export function setGlobalBreakpointHandler(handler: ((nodeId: string) => void) | null) {
  globalBreakpointHandler = handler
}

export const CustomNode = memo(({ data, selected, id }: NodeProps) => {
  const edges = useEdges()
  const nodes = useNodes()
  const { setCenter, getZoom } = useReactFlow()

  const summary = useMemo(() => {
    const nodeType = data.nodeType || data.label?.toLowerCase().replace(' ', '-')
    return generateNodeSummary(nodeType, data)
  }, [data])

  const dependencies = useMemo(() => {
    const currentNode = nodes.find(n => n.id === id)
    if (!currentNode) return []
    return analyzeNodeDependencies(currentNode, nodes)
  }, [id, nodes])

  const focusNode = useCallback((nodeId: string) => {
    const targetNode = nodes.find(n => n.id === nodeId)
    if (targetNode && targetNode.position) {
      const zoom = getZoom()
      setCenter(targetNode.position.x + 75, targetNode.position.y + 30, {
        zoom,
        duration: 500
      })
    }
  }, [nodes, setCenter, getZoom])

  const isValidIcon = data.icon && typeof data.icon === 'function'

  const getRestoredIcon = () => {
    // Telegram
    if (data.triggerType === 'telegram' || data.label === 'Start / Telegram' || data.label?.includes('Telegram')) {
      return TelegramIcon
    }
    if (data.nodeType === 'start' && data.triggerType === 'app') {
      return LayoutGrid
    }
    if (data.nodeType === 'start' && data.triggerType === 'workEvent') {
      return Link2
    }
    if (data.nodeType === 'workApp') {
      return Briefcase
    }
    if (data.nodeType === 'workAppLink') {
      return Link2
    }
    if (data.nodeType === 'workAppStep') {
      return ClipboardCheck
    }
    // Chat Widget
    if (data.label === 'Chat Widget' || data.label === 'Start / Chat Widget' ||
        (data.nodeType === 'start' && !data.triggerType)) {
      return MessageSquare
    }
    // Schedule
    if (data.triggerType === 'schedule' || data.label === 'Start / Schedule' || data.label?.includes('Schedule')) {
      return Clock
    }
    // AI
    if (data.nodeType === 'ai' || data.label === 'AI') {
      return Bot
    }
    // End
    if (data.nodeType === 'end' || data.label === 'End') {
      return Circle
    }
    // IMAP
    if (data.nodeType === 'imap' || data.label === 'IMAP') {
      return Inbox
    }
    // SMTP
    if (data.nodeType === 'smtp' || data.label === 'SMTP') {
      return Send
    }
    // SendGrid
    if (data.nodeType === 'sendgrid' || data.label === 'SendGrid') {
      return SendGridIcon
    }
    if (data.nodeType === 'sms_infobip' || data.nodeType === 'sms_acs' || data.nodeType === 'sms' || data.label === 'SMS') {
      return SmsIcon
    }
    // HTTP Request
    if (data.nodeType === 'httpRequest' || data.label === 'HTTP Request') {
      return Globe
    }
    // Store
    if (data.nodeType === 'store' || data.label === 'Store') {
      return DatabaseZap
    }
    // PSTN
    if (data.triggerType === 'pstn' || data.nodeType === 'pstn' || data.label?.includes('PSTN')) {
      return Phone
    }
    if (data.triggerType === 'subworkflow') {
      return Puzzle
    }
    return null
  }

  const getRestoredColor = (): string | null => {
    if (data.triggerType === 'schedule') return 'bg-purple-500'
    if (data.nodeType === 'store') return 'bg-emerald-500'
    if (data.triggerType === 'workEvent') return 'bg-cyan-600'
    if (data.nodeType === 'workApp') return 'bg-amber-600'
    if (data.nodeType === 'workAppLink') return 'bg-sky-700'
    if (data.nodeType === 'workAppStep') return 'bg-amber-800'
    if (data.nodeType === 'httpRequest') return 'bg-orange-500'
    if (data.nodeType === 'sendgrid') return 'bg-[#00A9D1]'
    if (data.nodeType === 'sms_infobip' || data.nodeType === 'sms_acs' || data.nodeType === 'sms') return 'bg-sky-500'
    if (data.nodeType === 'imap') return 'bg-indigo-500'
    if (data.nodeType === 'smtp') return 'bg-purple-500'
    if (data.triggerType === 'pstn' || data.nodeType === 'pstn') return 'bg-teal-500'
    if (data.triggerType === 'subworkflow') return 'bg-pink-500'
    return null
  }

  const IconComponent = isValidIcon ? data.icon : getRestoredIcon()
  const nodeColor = getRestoredColor() || data.color || 'bg-blue-500'
  const showLeftHandle = data.showLeftHandle !== false
  const isStartNode = data.showLeftHandle === false
  const isAINode = data.nodeType === 'ai' || data.label === 'AI'
  const isEndNode = data.nodeType === 'end' || data.label === 'End'
  const isWorkAppStep = data.nodeType === 'workAppStep'
  const isWorkApp = data.nodeType === 'workApp'
  const isWorkAppLink = data.nodeType === 'workAppLink'
  const linkEmpty = isWorkAppLink && !(typeof data.linkedAppWorkflowId === 'string' && data.linkedAppWorkflowId)
  const { lang: studioLang } = useLanguage()
  const studioT = getAgentStudioTranslation(studioLang)
  const inCanvas = isWorkAppStep && nodes.some((n) => (n.data as { nodeType?: unknown } | undefined)?.nodeType === 'workApp')
  const hasOldLines = isWorkAppStep && edges.some((e) => (e.source === id || e.target === id) && (e.sourceHandle === 'ref' || e.sourceHandle === 'send'))
  const hasLineHandles = isWorkApp || (isWorkAppStep && (!inCanvas || hasOldLines))
  const handoffInCount = isWorkApp
    ? new Set(edges.filter((e) => {
        if (e.target !== id || e.sourceHandle === 'ref' || e.sourceHandle === 'send') return false
        const src = nodes.find((n) => n.id === e.source)
        return !!src && (src.data as { nodeType?: unknown } | undefined)?.nodeType !== 'start'
      }).map((e) => e.source)).size
    : 0
  const handoffReadiness = useContext(HandoffReadinessContext)
  const handoffWarn = isWorkApp && handoffReadiness !== null && handoffNotice(id, handoffReadiness, isHandoffTarget(id, nodes, edges)) !== null
  const isLoopTool = data.isLoopTool === true
  const hasBreakpoint = data.hasBreakpoint === true
  const canHaveBreakpoint = !isStartNode && !isEndNode
  const toolCount = data.toolCount ?? 0
  const toolLimitReached = toolCount >= 10
  const shouldShowTools = data.showTools || (isLoopTool && isAINode)
  const canAddTools = shouldShowTools && !toolLimitReached

  const hasIfElseInLoop = isLoopTool && nodes.some(node =>
    (node.data as any)?.isLoopTool && node.type === 'ifElse'
  )

  const handleOffset = '-3px'
  const handleBottomOffset = '-3px'

  const hasToolsConnection = data.hasToolsConnection || false

  const handleBreakpointToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const handler = data.onToggleBreakpoint || globalBreakpointHandler
    handler?.(id)
  }, [id, data.onToggleBreakpoint])

  return (
    <div className="relative">
      {canHaveBreakpoint && (
        <div
          className={`absolute -top-1.5 -left-1.5 z-10 cursor-pointer transition-all ${
            hasBreakpoint
              ? 'opacity-100'
              : 'opacity-0 hover:opacity-50'
          } group-hover:opacity-100`}
          onClick={handleBreakpointToggle}
          title={hasBreakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
        >
          <Circle
            className={`w-3 h-3 ${
              hasBreakpoint
                ? 'text-red-500 fill-red-500'
                : 'text-gray-500 hover:text-red-400'
            }`}
          />
        </div>
      )}

      {isLoopTool && (
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-orange-400 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            top: '-3px',
            left: '50%',
            transform: 'translateX(-50%)',
            border: '1px solid white'
          }}
        />
      )}

      <div className={`px-3 py-2 bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : hasBreakpoint ? 'border-red-500/50' : 'border-[#5A5A5A]'} rounded-xl shadow-lg hover:shadow-xl transition-all ${isAINode ? 'min-w-[150px]' : ''} ${isWorkApp ? 'min-w-[190px] min-h-[112px] pr-20' : ''} ${isWorkAppLink ? 'min-w-[190px] border-dashed' : ''} group`}>
        {!isLoopTool && showLeftHandle && !isWorkAppLink && (
          <Handle
            type="target"
            position={Position.Left}
            className="!bg-gray-400 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
            style={{
              width: '6px',
              height: '10px',
              borderRadius: '2px',
              top: '50%',
              left: handleOffset,
              transform: 'translateY(-50%)'
            }}
          />
        )}
        <div className="flex items-center gap-2.5">
          {IconComponent && (
            <div className={`p-2 rounded ${nodeColor} flex-shrink-0`}>
              <IconComponent className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="flex flex-col min-w-0 flex-1">
            {isStartNode && (
              <div className="text-sm font-medium text-gray-200 mb-0.5">
                Start
              </div>
            )}
            <div className={`${isStartNode ? 'text-xs text-gray-500' : 'text-sm font-medium text-gray-200'} whitespace-nowrap`}>
              {isStartNode && data.label?.startsWith('Start / ')
                ? data.label.replace('Start / ', '')
                : data.label}
            </div>
            {summary && !isStartNode && !isEndNode && (
              <div className="text-xs text-gray-500 max-w-[180px] mt-0.5 truncate" title={summary}>
                {summary}
              </div>
            )}
          </div>
        </div>
        {dependencies.length > 0 && !isStartNode && !isEndNode && (
          <div className="mt-2 pt-2 border-t border-gray-700">
            <div className="text-[10px] text-gray-500 mb-1">Used in this step</div>
            <div className="flex flex-wrap gap-1">
              {dependencies.slice(0, 3).map((dep) => (
                <MiniChip
                  key={dep.nodeId}
                  nodeId={dep.nodeId}
                  nodeName={dep.nodeName}
                  nodeType={dep.nodeType}
                  onClick={() => focusNode(dep.nodeId)}
                />
              ))}
              {dependencies.length > 3 && (
                <span className="text-[10px] text-gray-500 self-center">
                  +{dependencies.length - 3} more
                </span>
              )}
            </div>
          </div>
        )}
        {!isLoopTool && !isEndNode && !isWorkApp && !isWorkAppLink && (
          <Handle
            type="source"
            position={Position.Right}
            className="!bg-gray-400 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              right: handleOffset,
              top: '50%',
              transform: 'translateY(-50%)'
            }}
          />
        )}
      </div>

      {isLoopTool && hasIfElseInLoop && (
        <Handle
          type="target"
          position={Position.Left}
          id="bottom"
          className="!bg-yellow-500 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '6px',
            height: '10px',
            borderRadius: '2px',
            top: '50%',
            left: '-2px',
            transform: 'translateY(-50%)',
            border: '1px solid white'
          }}
        />
      )}

      {(isWorkApp || isWorkAppLink) && (
        <>
          <Handle
            type="target"
            position={Position.Top}
            id={WORK_APP_LINES_IN}
            title="send / ref"
            className="!bg-gray-400 before:content-[''] before:absolute before:inset-[-6px] before:bg-transparent"
            style={{ width: '10px', height: '6px', borderRadius: '2px', top: '-3px', left: '50%', transform: 'translateX(-50%)' }}
          />
          <Handle
            type="target"
            position={Position.Bottom}
            id={WORK_APP_LINES_IN_BOTTOM}
            title="send / ref"
            className="!bg-gray-400 before:content-[''] before:absolute before:inset-[-6px] before:bg-transparent"
            style={{ width: '10px', height: '6px', borderRadius: '2px', bottom: '-3px', top: 'auto', left: '50%', transform: 'translateX(-50%)' }}
          />
        </>
      )}
      {isWorkApp && (
        <div className="absolute flex items-center" style={{ right: '-3px', top: '20px' }}>
          <span className="absolute right-3 whitespace-nowrap text-[9px] font-semibold leading-none text-emerald-400 pointer-events-none select-none">{studioT.work_app_done || 'when closed'}</span>
          <Handle
            type="source"
            position={Position.Right}
            id="done"
            title={studioT.work_app_done || 'when closed'}
            className="!bg-emerald-400 before:content-[''] before:absolute before:inset-[-4px] before:bg-transparent !relative !right-0 !top-0 !transform-none"
            style={{ width: '9px', height: '9px', borderRadius: '50%', border: '1px solid white' }}
          />
        </div>
      )}
      {isWorkAppLink && (
        <div className={`absolute left-2 right-2 -top-9 truncate rounded px-1.5 py-0.5 text-center text-[9px] leading-none pointer-events-none select-none ${linkEmpty ? 'bg-amber-900/90 text-amber-200' : 'bg-sky-900/80 text-sky-200'}`}>
          {linkEmpty ? (COMPANY_BOOK_KINDS.includes(String(data.appTemplate)) ? (studioT.work_app_link_band_empty || 'Choose a ledger — open the panel') : (studioT.work_app_link_band_empty_app || 'Choose the app — open the panel')) : (studioT.work_app_link_band || 'Linked — lives in its own workflow')}
        </div>
      )}
      {isWorkApp && handoffWarn && (
        <div className="absolute left-2 right-2 -top-9 truncate rounded bg-amber-900/90 px-1.5 py-0.5 text-center text-[9px] leading-none text-amber-200 pointer-events-none select-none">
          {studioT.work_app_handoff_band || "Can't receive yet — open the panel"}
        </div>
      )}
      {isWorkApp && !handoffWarn && handoffInCount >= 2 && (
        <div className="absolute left-2 right-2 -top-9 truncate rounded bg-emerald-900/80 px-1.5 py-0.5 text-center text-[9px] leading-none text-emerald-200 pointer-events-none select-none">
          {studioT.work_app_gather_band || 'Opens the task when all arrive'}
        </div>
      )}
      {isWorkApp && WORK_APP_EVENT_HANDLES.map((h, i) => (
        <div key={h.id} className="absolute flex items-center" style={{ right: '-3px', top: `${40 + i * 16}px` }}>
          <span className="absolute right-3 whitespace-nowrap text-[9px] leading-none text-amber-400 pointer-events-none select-none">{studioT[h.key] || h.label}</span>
          <Handle
            type="source"
            position={Position.Right}
            id={h.id}
            title={studioT[h.key] || h.label}
            className="!bg-amber-400 before:content-[''] before:absolute before:inset-[-4px] before:bg-transparent !relative !right-0 !top-0 !transform-none"
            style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1px solid white' }}
          />
        </div>
      ))}

      {(hasLineHandles || isWorkAppLink) && (
        <div className="absolute flex flex-col items-center" style={{ bottom: '-3px', left: 'calc(50% - 18px)', transform: 'translateX(-50%)' }}>
          <Handle
            type="source"
            position={Position.Bottom}
            id="ref"
            title="ref"
            className="!bg-amber-500 before:content-[''] before:absolute before:inset-[-4px] before:bg-transparent !relative !left-0 !bottom-0 !transform-none"
            style={{ width: '8px', height: '8px', borderRadius: '2px', border: '1px dashed white' }}
          />
          <span className="absolute top-2 text-[9px] leading-none text-amber-500 pointer-events-none select-none">ref</span>
        </div>
      )}
      {hasLineHandles && (
        <div className="absolute flex flex-col items-center" style={{ bottom: '-3px', left: 'calc(50% + 18px)', transform: 'translateX(-50%)' }}>
          <Handle
            type="source"
            position={Position.Bottom}
            id="send"
            title="send"
            className="!bg-emerald-500 before:content-[''] before:absolute before:inset-[-4px] before:bg-transparent !relative !left-0 !bottom-0 !transform-none"
            style={{ width: '8px', height: '8px', borderRadius: '2px', border: '1px dashed white' }}
          />
          <span className="absolute top-2 text-[9px] leading-none text-emerald-500 pointer-events-none select-none">send</span>
        </div>
      )}
      {(isWorkApp || isWorkAppLink) && ([['ref-top', 'calc(50% - 18px)', '!bg-amber-500', 'text-amber-500', 'ref'], ...(isWorkAppLink ? [] : [['send-top', 'calc(50% + 18px)', '!bg-emerald-500', 'text-emerald-500', 'send']])] as const).map(([hid, left, bg, fg, text]) => (
        <div key={hid} className="absolute flex flex-col items-center" style={{ top: '-3px', left, transform: 'translateX(-50%)' }}>
          <span className={`absolute bottom-2 text-[9px] leading-none ${fg} pointer-events-none select-none`}>{text}</span>
          <Handle
            type="source"
            position={Position.Top}
            id={hid}
            title={text}
            className={`${bg} before:content-[''] before:absolute before:inset-[-4px] before:bg-transparent !relative !left-0 !top-0 !transform-none`}
            style={{ width: '8px', height: '8px', borderRadius: '2px', border: '1px dashed white' }}
          />
        </div>
      ))}

      {isAINode && shouldShowTools && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="miniapps"
          className="!bg-purple-500 before:content-[''] before:absolute before:inset-[-4px] before:bg-transparent"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            border: '1px solid white',
            left: '75%',
            bottom: '-3px',
            ...(data.hasMiniAppsConnection ? {} : { opacity: 0, pointerEvents: 'none' as const })
          }}
        />
      )}

      {isAINode && shouldShowTools && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center"
          style={{ bottom: canAddTools ? '-11px' : '-3px' }}
        >
          <Handle
            type="source"
            position={Position.Bottom}
            id="tools"
            className={`${canAddTools ? (isLoopTool ? '!bg-orange-500' : '!bg-blue-500') : '!bg-gray-400'} before:content-[''] before:absolute before:inset-[-4px] before:bg-transparent !relative !left-0 !bottom-0 !transform-none`}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              border: '1px solid white'
            }}
          />

          {canAddTools && (
            <>
              <div
                className={`border-l ${isLoopTool ? 'border-orange-500' : 'border-blue-500'}`}
                style={{ height: '8px', width: '1px' }}
              />

              <div
                className={`flex items-center justify-center w-3 h-3 border rounded transition-colors cursor-pointer ${isLoopTool
                  ? 'bg-[#1F2937] border-orange-500 text-orange-400 hover:bg-orange-900/50 hover:border-orange-400 hover:text-white'
                  : 'bg-[#1F2937] border-[#3B82F6] text-[#93C5FD] hover:bg-[#1E3A8A] hover:border-[#60A5FA] hover:text-white'
                  }`}
                style={{
                  fontSize: '8px',
                  lineHeight: '1',
                  position: 'absolute',
                  top: '16px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 20
                }}
                title="Add tool connection"
                onClick={(e) => {
                  e.stopPropagation()
                  const addToolHandler = data.onAddTool || globalAddToolHandler
                  addToolHandler?.(id)
                }}
              >
                +
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
})

CustomNode.displayName = 'CustomNode'