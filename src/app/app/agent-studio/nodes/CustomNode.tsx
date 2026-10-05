'use client'

import { memo, useMemo, useCallback } from 'react'
import { NodeProps, Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow'
import { generateNodeSummary } from '../utils/generateNodeSummary'
import { analyzeNodeDependencies, type NodeDependency } from '../utils/analyzeDependencies'
import { MiniChip } from '../components/MiniChip'
import { Circle, MessageSquare, Clock, Bot, Inbox, Send, Globe, DatabaseZap, Phone, Puzzle, LayoutGrid } from 'lucide-react'
import { TelegramIcon, SendGridIcon, SmsIcon } from '../constants/components'

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

      <div className={`px-3 py-2 bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : hasBreakpoint ? 'border-red-500/50' : 'border-[#5A5A5A]'} rounded-xl shadow-lg hover:shadow-xl transition-all ${isAINode ? 'min-w-[150px]' : ''} group`}>
        {!isLoopTool && showLeftHandle && (
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
        {!isLoopTool && !isEndNode && (
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