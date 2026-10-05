'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useEdition } from '@/components/EditionProvider'
import { offFeatureFor } from '@/lib/edition-features'
import { X, Plus, FileSearch, Globe, AlertCircle, GripHorizontal, RefreshCw, Send, Calendar, Puzzle, Briefcase } from 'lucide-react'
import { isAppWorkflow } from '@/lib/workflow/start-trigger'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { isAiNode } from '../utils'
import { MCPLogo } from '../nodes/icons/MCPLogo'
import { SendGridIcon, TelegramIcon, SmsIcon } from '../constants/components'
import type { Node } from 'reactflow'
import { toast } from 'sonner'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useDraggable } from '../hooks/useDraggable'
import { compareNodes, compareEdges } from '../utils/deepEqual'
import {
  planToolNodes,
  makeSlotAllocator,
  buildManagedToolData,
  reconcileToolEdges,
  MODAL_TOOL_TYPES,
  splitAttachedTools,
  type PlanItem as ToolPlanItem,
} from './tools-node-plan'

interface ToolItem {
  id: string
  name: string
  connectionId?: string
  mcpConnectionId?: string
  subWorkflowId?: string
  data?: Record<string, any>
}

interface ProviderFeatures {
  webSearch?: { enabled: boolean; label?: string }
  mcp?: { enabled: boolean; label?: string }
  vision?: { enabled: boolean; label?: string }
  functionCalling?: { enabled: boolean; label?: string }
}

interface AppConnection {
  id: string
  provider: string
  label: string
}

const SMS_TOOL_ENABLED = true

const TOOL_TYPES = {
  source: { name: 'Source', color: 'bg-yellow-500', textColor: 'text-white' },
  mcp: { name: 'MCP', color: 'bg-black', textColor: 'text-white' },
  webSearch: { name: 'Web Search', color: 'bg-green-500', textColor: 'text-white' },
  sendgrid: { name: 'SendGrid Email', color: 'bg-[#00A9D1]', textColor: 'text-white' },
  telegram: { name: 'Telegram', color: 'bg-blue-500', textColor: 'text-white' },
  sms: { name: 'SMS', color: 'bg-sky-500', textColor: 'text-white' },
  smtp: { name: 'SMTP Email', color: 'bg-purple-500', textColor: 'text-white' },
  google_calendar: { name: 'Google Calendar', color: 'bg-[#4285F4]', textColor: 'text-white' },
  microsoft_calendar: { name: 'Microsoft Calendar', color: 'bg-[#0078D4]', textColor: 'text-white' },
  subworkflow: { name: 'Sub-workflow', color: 'bg-pink-500', textColor: 'text-white' },
  workApp: { name: 'Work app', color: 'bg-emerald-600', textColor: 'text-white' },
}

interface SubWorkflowSummary {
  workflowId: string
  name: string
  status: string
  kind?: string
}

export function ToolsModal() {
  const { ui, workflow, nodeHandlers, agent, reloadWorkflow } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const edition = useEdition()
  const toolInEdition = (toolType: string) => !offFeatureFor('toolTypes', toolType, edition)

  const [tempSourceItems, setTempSourceItemsRaw] = useState<ToolItem[]>([])
  const [tempMcpItems, setTempMcpItemsRaw] = useState<ToolItem[]>([])
  const [tempWebSearchItems, setTempWebSearchItemsRaw] = useState<ToolItem[]>([])

  const [tempSendgridItems, setTempSendgridItemsRaw] = useState<ToolItem[]>([])
  const [tempTelegramItems, setTempTelegramItemsRaw] = useState<ToolItem[]>([])
  const [tempSmsItems, setTempSmsItemsRaw] = useState<ToolItem[]>([])
  const [tempSmtpItems, setTempSmtpItemsRaw] = useState<ToolItem[]>([])
  const [tempGoogleCalendarItems, setTempGoogleCalendarItemsRaw] = useState<ToolItem[]>([])
  const [tempMicrosoftCalendarItems, setTempMicrosoftCalendarItemsRaw] = useState<ToolItem[]>([])
  const [tempSubWorkflowItems, setTempSubWorkflowItemsRaw] = useState<ToolItem[]>([])
  const [tempWorkAppItems, setTempWorkAppItemsRaw] = useState<ToolItem[]>([])

  const [modalDirty, setModalDirty] = useState(false)
  const markDirty = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (value: React.SetStateAction<T>) => {
      setModalDirty(true)
      setter(value)
    }
  const setTempSourceItems = markDirty(setTempSourceItemsRaw)
  const setTempMcpItems = markDirty(setTempMcpItemsRaw)
  const setTempWebSearchItems = markDirty(setTempWebSearchItemsRaw)
  const setTempSendgridItems = markDirty(setTempSendgridItemsRaw)
  const setTempTelegramItems = markDirty(setTempTelegramItemsRaw)
  const setTempSmsItems = markDirty(setTempSmsItemsRaw)
  const setTempSmtpItems = markDirty(setTempSmtpItemsRaw)
  const setTempGoogleCalendarItems = markDirty(setTempGoogleCalendarItemsRaw)
  const setTempMicrosoftCalendarItems = markDirty(setTempMicrosoftCalendarItemsRaw)
  const setTempSubWorkflowItems = markDirty(setTempSubWorkflowItemsRaw)
  const setTempWorkAppItems = markDirty(setTempWorkAppItemsRaw)

  const [subWorkflows, setSubWorkflows] = useState<SubWorkflowSummary[]>([])

  const [appConnections, setAppConnections] = useState<AppConnection[]>([])

  const [providerFeatures, setProviderFeatures] = useState<ProviderFeatures | null>(null)
  const [featuresLoading, setFeaturesLoading] = useState(false)

  const closeModal = () => {
    ui.setShowToolsModal(false)
    ui.setToolsModalAiNodeId(null)
  }

  const activeAiNode = useMemo(
    () => {
      const nodeId = ui.toolsModalAiNodeId || workflow.selectedNode
      return workflow.nodes.find(node => node.id === nodeId && isAiNode(node))
    },
    [workflow.nodes, workflow.selectedNode, ui.toolsModalAiNodeId]
  )

  const currentProvider = activeAiNode?.data?.provider || 'openai'
  const currentModel = activeAiNode?.data?.model || ''

  const isDeepSeek = currentProvider === 'deepseek'

  const isOpenAIWebSearchSupported = currentProvider === 'openai'
    ? !currentModel.startsWith('gpt-4.1-nano')
    : true

  const supportsWebSearch = !isDeepSeek && isOpenAIWebSearchSupported

  const supportsMcp = true

  const supportsAppsTools = providerFeatures?.functionCalling?.enabled !== false

  useEffect(() => {
    if (!ui.showToolsModal || !currentProvider) return

    const loadFeatures = async () => {
      setFeaturesLoading(true)
      try {
        const res = await fetch(`/api/agent-studio/provider-features?provider=${currentProvider}`)
        if (res.ok) {
          const data = await res.json()
          setProviderFeatures(data.features || null)
        }
      } catch (error) {
        console.error('Failed to load provider features:', error)
      } finally {
        setFeaturesLoading(false)
      }
    }

    loadFeatures()
  }, [ui.showToolsModal, currentProvider])

  useEffect(() => {
    if (!ui.showToolsModal || !activeAiNode) return

    const agentId = agent.agentId
    if (!agentId) return

    const loadConnections = async () => {
      try {
        const res = await fetch(`/api/agent-studio/app-connections?agentId=${agentId}&providers=sendgrid,telegram,infobip_sms,acs_sms,smtp,google_workspace,microsoft_workspace`)
        if (res.ok) {
          const data = await res.json()
          setAppConnections(data.connections || [])
        }
      } catch (error) {
        console.error('Failed to load app connections:', error)
      }
    }

    loadConnections()
  }, [ui.showToolsModal, activeAiNode, agent.agentId])

  useEffect(() => {
    if (!ui.showToolsModal || !activeAiNode) return
    const agentId = agent.agentId
    if (!agentId) return
    let cancelled = false
    fetch(`/api/agents/${agentId}/workflows`)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setSubWorkflows(
          ((data.workflows || []) as SubWorkflowSummary[]).filter((w) => w.kind === 'sub' && w.status !== 'archived'),
        )
      })
      .catch((error) => console.error('Failed to load sub-workflows:', error))
    return () => { cancelled = true }
  }, [ui.showToolsModal, activeAiNode, agent.agentId])

  //
  useEffect(() => {
    if (appConnections.length === 0) return
    const sgConns = appConnections.filter(c => c.provider === 'sendgrid')
    const tgConns = appConnections.filter(c => c.provider === 'telegram')
    const smsConns = [
      ...appConnections.filter(c => c.provider === 'infobip_sms'),
      ...appConnections.filter(c => c.provider === 'acs_sms'),
    ]
    const smConns = appConnections.filter(c => c.provider === 'smtp')
    const gcalConns = appConnections.filter(c => c.provider === 'google_workspace')
    const mcalConns = appConnections.filter(c => c.provider === 'microsoft_workspace')
    if (sgConns.length > 0) {
      setTempSendgridItemsRaw(prev => prev.map(item => item.connectionId ? item : { ...item, connectionId: sgConns[0].id }))
    }
    if (tgConns.length > 0) {
      setTempTelegramItemsRaw(prev => prev.map(item => item.connectionId ? item : { ...item, connectionId: tgConns[0].id }))
    }
    if (smsConns.length > 0) {
      setTempSmsItemsRaw(prev => prev.map(item => item.connectionId ? item : { ...item, connectionId: smsConns[0].id }))
    }
    if (smConns.length > 0) {
      setTempSmtpItemsRaw(prev => prev.map(item => item.connectionId ? item : { ...item, connectionId: smConns[0].id }))
    }
    if (gcalConns.length > 0) {
      setTempGoogleCalendarItemsRaw(prev => prev.map(item => item.connectionId ? item : { ...item, connectionId: gcalConns[0].id }))
    }
    if (mcalConns.length > 0) {
      setTempMicrosoftCalendarItemsRaw(prev => prev.map(item => item.connectionId ? item : { ...item, connectionId: mcalConns[0].id }))
    }
  }, [appConnections])

  // Sync with canvas on modal open
  useEffect(() => {
    if (!ui.showToolsModal || !activeAiNode) return

    // Find connected tool nodes
    const connectedToolEdges = workflow.edges.filter(
      e => e.source === activeAiNode.id && e.sourceHandle === 'tools'
    )
    const connectedToolNodeIds = connectedToolEdges.map(e => e.target)
    const connectedToolNodes = workflow.nodes.filter(n =>
      connectedToolNodeIds.includes(n.id) && n.type === 'tool'
    )

    // Group by tool type
    const sourceNodes = connectedToolNodes.filter(n => n.data?.toolType === 'source')
    const mcpNodes = connectedToolNodes.filter(n => n.data?.toolType === 'mcp')
    const webSearchNodes = connectedToolNodes.filter(n => n.data?.toolType === 'webSearch')
    const sendgridNodes = connectedToolNodes.filter(n => n.data?.toolType === 'sendgrid')
    const telegramNodes = connectedToolNodes.filter(n => n.data?.toolType === 'telegram')
    const smsNodes = connectedToolNodes.filter(n => n.data?.toolType === 'sms')
    const smtpNodes = connectedToolNodes.filter(n => n.data?.toolType === 'smtp')
    const googleCalendarNodes = connectedToolNodes.filter(n => n.data?.toolType === 'google_calendar')
    const microsoftCalendarNodes = connectedToolNodes.filter(n => n.data?.toolType === 'microsoft_calendar')
    const subWorkflowNodes = connectedToolNodes.filter(n => n.data?.toolType === 'subworkflow')
    const workAppNodes = connectedToolNodes.filter(n => n.data?.toolType === 'workApp')

    const asItem = (n: any) => ({
      id: n.id,
      name: n.data.label,
      connectionId: n.data.connectionId || '',
      data: n.data as Record<string, any>,
    })

    setTempSourceItemsRaw(sourceNodes.map(asItem))
    setTempMcpItemsRaw(mcpNodes.map(n => ({ ...asItem(n), mcpConnectionId: n.data.mcpConnectionId || '' })))
    setTempWebSearchItemsRaw(webSearchNodes.map(asItem))
    setTempSendgridItemsRaw(sendgridNodes.map(asItem))
    setTempTelegramItemsRaw(telegramNodes.map(asItem))
    setTempSmsItemsRaw(smsNodes.map(asItem))
    setTempSmtpItemsRaw(smtpNodes.map(asItem))
    setTempGoogleCalendarItemsRaw(googleCalendarNodes.map(asItem))
    setTempMicrosoftCalendarItemsRaw(microsoftCalendarNodes.map(asItem))
    setTempSubWorkflowItemsRaw(subWorkflowNodes.map(n => ({ ...asItem(n), subWorkflowId: n.data.subWorkflowId || '' })))
    setTempWorkAppItemsRaw(workAppNodes.map(asItem))
  }, [ui.showToolsModal, activeAiNode, workflow.edges, workflow.nodes])

  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (ui.showToolsModal && !wasOpenRef.current) setModalDirty(false)
    wasOpenRef.current = ui.showToolsModal
  }, [ui.showToolsModal])

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showToolsModal })

  if (!ui.showToolsModal) return null

  //
  const unmanagedAttachedCount = activeAiNode
    ? workflow.nodes.filter(n =>
        n.type === 'tool' &&
        n.data?.nodeType !== 'miniapp' &&
        !MODAL_TOOL_TYPES.has(n.data?.toolType) &&
        workflow.edges.some(e =>
          e.source === activeAiNode.id && e.sourceHandle === 'tools' && e.target === n.id)
      ).length
    : 0
  const totalCount = tempSourceItems.length + tempMcpItems.length + tempWebSearchItems.length
    + tempSendgridItems.length + tempTelegramItems.length + tempSmsItems.length + tempSmtpItems.length
    + tempSubWorkflowItems.length + tempWorkAppItems.length
    + unmanagedAttachedCount
  const totalCalendarCount = tempGoogleCalendarItems.length + tempMicrosoftCalendarItems.length

  const sendgridConnections = appConnections.filter(c => c.provider === 'sendgrid')
  const telegramConnections = appConnections.filter(c => c.provider === 'telegram')
  const smsConnections = [
    ...appConnections.filter(c => c.provider === 'infobip_sms'),
    ...appConnections.filter(c => c.provider === 'acs_sms'),
  ]
  const smtpConnections = appConnections.filter(c => c.provider === 'smtp')
  const googleCalendarConnections = appConnections.filter(c => c.provider === 'google_workspace')
  const microsoftCalendarConnections = appConnections.filter(c => c.provider === 'microsoft_workspace')

  const handleGoToSettings = (toolType: string) => {
    const rfInstance = workflow.reactFlowInstance as any
    handleSave()
    setTimeout(() => {
      try {
        const currentNodes = rfInstance?.getNodes?.() || []
        const targetNode = currentNodes.find((n: any) =>
          n.type === 'tool' && n.data?.toolType === toolType
        )
        if (targetNode) {
          workflow.setNodes(nds => nds.map(n => ({
            ...n,
            selected: n.id === targetNode.id
          })))
        }
      } catch (e) {
        // silently fail
      }
    }, 400)
  }

  const handleSave = () => {
    if (!activeAiNode) {
      toast.error(t.please_select_ai_node)
      return
    }

    //
    const allAttachedToolNodes = workflow.nodes
      .filter(n => n.type === 'tool' && n.data?.nodeType !== 'miniapp')
      .filter(n => workflow.edges.some(e =>
        e.source === activeAiNode.id && e.sourceHandle === 'tools' && e.target === n.id))
    const { managed: attachedToolNodes } = splitAttachedTools(allAttachedToolNodes)
    const attachedIds = new Set(attachedToolNodes.map(n => n.id))

    // Create new tool nodes (Source, MCP, Web Search + Apps)
    const allToolItems: Array<ToolItem & { type: 'source' | 'mcp' | 'webSearch' | 'sendgrid' | 'telegram' | 'sms' | 'smtp' | 'google_calendar' | 'microsoft_calendar' | 'subworkflow' | 'workApp' }> = [
      ...tempSourceItems.map(item => ({ ...item, type: 'source' as const })),
      ...tempMcpItems.map(item => ({ ...item, type: 'mcp' as const })),
      ...tempWebSearchItems.map(item => ({ ...item, type: 'webSearch' as const })),
      ...tempSendgridItems.map(item => ({ ...item, type: 'sendgrid' as const })),
      ...tempTelegramItems.map(item => ({ ...item, type: 'telegram' as const })),
      ...tempSmsItems.map(item => ({ ...item, type: 'sms' as const })),
      ...tempSmtpItems.map(item => ({ ...item, type: 'smtp' as const })),
      ...tempGoogleCalendarItems.map(item => ({ ...item, type: 'google_calendar' as const })),
      ...tempMicrosoftCalendarItems.map(item => ({ ...item, type: 'microsoft_calendar' as const })),
      ...tempSubWorkflowItems.map(item => ({ ...item, type: 'subworkflow' as const })),
      ...tempWorkAppItems.map(item => ({ ...item, type: 'workApp' as const })),
    ]

    const toolConfig: Record<string, { icon: any; color: string }> = {
      source: { icon: FileSearch, color: 'bg-yellow-500' },
      mcp: { icon: MCPLogo, color: 'bg-black' },
      webSearch: { icon: Globe, color: 'bg-green-500' },
      sendgrid: { icon: SendGridIcon, color: 'bg-[#00A9D1]' },
      telegram: { icon: TelegramIcon, color: 'bg-gray-200' },
      sms: { icon: SmsIcon, color: 'bg-sky-500' },
      smtp: { icon: Send, color: 'bg-purple-500' },
      google_calendar: { icon: Calendar, color: 'bg-[#4285F4]' },
      microsoft_calendar: { icon: Calendar, color: 'bg-[#0078D4]' },
      subworkflow: { icon: Puzzle, color: 'bg-pink-500' },
      workApp: { icon: Briefcase, color: 'bg-emerald-600' },
    }

    const positions = [
      { x: 150, y: 150 },   // 0: right bottom
      { x: -150, y: 150 },  // 1: left bottom
      { x: 150, y: 250 },   // 2
      { x: -150, y: 250 },  // 3
      { x: 150, y: 350 },   // 4
      { x: -150, y: 350 },  // 5
      { x: 150, y: 450 },   // 6
      { x: -150, y: 450 },  // 7
      { x: 150, y: 550 },   // 8
      { x: -150, y: 550 }   // 9
    ]

    const { entries: planned, keptIds, removedIds } = planToolNodes(
      allToolItems,
      attachedIds,
      (item, index) => `tool-${item.type}-${Date.now()}-${index}`,
    )
    const removedIdSet = new Set(removedIds)
    const takeSlot = makeSlotAllocator(
      positions,
      allAttachedToolNodes.filter(n => !removedIdSet.has(n.id)),
      activeAiNode.position,
    )
    const keptByNodeId = new Map(planned.filter(p => p.keep).map(p => [p.nodeId, p]))
    const buildManagedData = (
      p: { item: ToolPlanItem },
      existing: Record<string, any>,
    ): Record<string, any> =>
      buildManagedToolData(p.item, existing, {
        icon: toolConfig[p.item.type].icon,
        color: toolConfig[p.item.type].color,
        isLoopTool: activeAiNode.data.isLoopTool,
        providerOf: id => appConnections.find(c => c.id === id)?.provider,
      })

    const newToolNodes: Node[] = []
    const newToolEdges: any[] = []

    planned.forEach((p) => {
      if (p.keep) return
      const item = p.item
      const toolNodeId = p.nodeId
      const offset = takeSlot()

      newToolNodes.push({
        id: toolNodeId,
        type: 'tool',
        data: buildManagedData(p, item.data || {}),
        position: {
          x: activeAiNode.position.x + offset.x,
          y: activeAiNode.position.y + offset.y
        }
      })

      newToolEdges.push({
        id: `e-${activeAiNode.id}-${toolNodeId}`,
        source: activeAiNode.id,
        sourceHandle: 'tools',
        target: toolNodeId,
        type: 'toolEdge',
        animated: false,
        markerEnd: undefined,
        style: activeAiNode.data.isLoopTool ? { stroke: '#f97316' } : undefined
      })
    })

    //
    const nextNodes: Node[] = [
      ...workflow.nodes
      .filter(n => !removedIds.includes(n.id))
      .map(n => {
        if (n.id === activeAiNode.id) {
          const {
            sendgridConnectionId,
            telegramConnectionId,
            smsConnectionId,
            smtpConnectionId,
            googleCalendarConnectionId,
            microsoftCalendarConnectionId,
            ...restData
          } = n.data
          return {
            ...n,
            data: {
              ...restData,
              selectedTools: {
                ...restData.selectedTools,
                sendgrid: false,
                telegram: false,
                sms: false,
                smtp: false,
                googleCalendar: false,
                microsoftCalendar: false,
              },
            }
          }
        }
        const kept = keptByNodeId.get(n.id)
        if (kept) return { ...n, data: buildManagedData(kept, n.data) }
        return n
      }),
      ...newToolNodes,
    ]

    const nextEdges: any[] = [
      ...reconcileToolEdges(workflow.edges as any, {
        aiNodeId: activeAiNode.id,
        keptIds,
        removedIds,
        isLoopTool: activeAiNode.data.isLoopTool,
      }) as any,
      ...newToolEdges,
    ]

    workflow.setNodes(nextNodes)
    workflow.setEdges(nextEdges)

    //
    const withoutDerived = (nds: Node[]): Node[] => nds.map(n =>
      n.id === activeAiNode.id
        ? { ...n, data: { ...n.data, selectedTools: {} } }
        : n
    )
    if (!compareNodes(withoutDerived(nextNodes), withoutDerived(workflow.nodes))
      || !compareEdges(nextEdges, workflow.edges)) {
      workflow.saveToHistory(nextNodes, nextEdges)
    }

    closeModal()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    >
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-2xl w-full max-h-[85vh] flex flex-col"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="p-6 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-200">{t.select_tools}</h2>
              <p className="text-sm text-gray-400 mt-1">
                {t.choose_tools_desc}
                {currentProvider && edition !== 'selfhosted' && (
                  <span className="ml-2 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
                    {currentProvider.charAt(0).toUpperCase() + currentProvider.slice(1)}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if ((ui.hasChanges || modalDirty) && !window.confirm(t.reload_discard_confirm || t.unsaved_changes_confirm)) return
                if (await reloadWorkflow()) setModalDirty(false)
              }}
              className="p-1.5 rounded transition-colors text-gray-400 hover:text-gray-200"
              title={t.reload_workflow || 'Reload from server'}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={() => closeModal()}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto system-message-scrollbar p-6 space-y-6">
          {/* Source Section (max 1) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded ${TOOL_TYPES.source.color}`}>
                  <FileSearch className="w-4 h-4 text-white" />
                </div>
                <label className="text-sm font-medium text-gray-200">{TOOL_TYPES.source.name}</label>
              </div>
              <span className="text-xs text-gray-400">{tempSourceItems.length}/1</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {tempSourceItems.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.source.color} text-white`}
                >
                  <span className="text-sm font-medium">{item.name}</span>
                  <button
                    onClick={() => setTempSourceItems([])}
                    className="hover:opacity-70"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {tempSourceItems.length === 0 && (
                <button
                  onClick={() => {
                    if (totalCount >= 10) {
                      toast.error(t.max_tools_allowed)
                      return
                    }
                    const newId = `source-${Date.now()}`
                    setTempSourceItems([{ id: newId, name: 'Source' }])
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-sm font-medium">{t.add_source}</span>
                </button>
              )}
            </div>
          </div>

          {/* MCP Section */}
          {supportsMcp && providerFeatures?.mcp?.enabled !== false ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded ${TOOL_TYPES.mcp.color}`}>
                    <MCPLogo className={`w-4 h-4 ${TOOL_TYPES.mcp.textColor}`} />
                  </div>
                  <label className="text-sm font-medium text-gray-200">{TOOL_TYPES.mcp.name}</label>
                </div>
                <span className="text-xs text-gray-400">{tempMcpItems.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {tempMcpItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.mcp.color} ${TOOL_TYPES.mcp.textColor}`}
                  >
                    <span className="text-sm font-medium">{item.name}</span>
                    <button
                      onClick={() => setTempMcpItems(prev => prev.filter(i => i.id !== item.id))}
                      className={`hover:opacity-70 ${TOOL_TYPES.mcp.textColor}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    if (totalCount >= 10) {
                      toast.error(t.max_tools_allowed)
                      return
                    }
                    const newId = `mcp-${Date.now()}`
                    setTempMcpItems(prev => [...prev, { id: newId, name: `MCP ${prev.length + 1}` }])
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-sm font-medium">{t.add_mcp}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="opacity-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-gray-600">
                    <MCPLogo className="w-4 h-4 text-gray-400" />
                  </div>
                  <label className="text-sm font-medium text-gray-400">{TOOL_TYPES.mcp.name}</label>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {t.not_supported}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Web Search Section */}
          {supportsWebSearch && providerFeatures?.webSearch?.enabled !== false ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded ${TOOL_TYPES.webSearch.color}`}>
                    <Globe className="w-4 h-4 text-white" />
                  </div>
                  <label className="text-sm font-medium text-gray-200">{TOOL_TYPES.webSearch.name}</label>
                </div>
                <span className="text-xs text-gray-400">{tempWebSearchItems.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {tempWebSearchItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.webSearch.color} text-white`}
                  >
                    <span className="text-sm font-medium">{item.name}</span>
                    <button
                      onClick={() => setTempWebSearchItems(prev => prev.filter(i => i.id !== item.id))}
                      className="hover:opacity-70"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    if (totalCount >= 10) {
                      toast.error(t.max_tools_allowed)
                      return
                    }
                    const newId = `web-${Date.now()}`
                    setTempWebSearchItems(prev => [...prev, { id: newId, name: `Web Search ${prev.length + 1}` }])
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-sm font-medium">{t.add_web_search}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="opacity-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded bg-gray-600`}>
                    <Globe className="w-4 h-4 text-gray-400" />
                  </div>
                  <label className="text-sm font-medium text-gray-400">{TOOL_TYPES.webSearch.name}</label>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {t.not_supported}
                  </span>
                </div>
              </div>
            </div>
          )}

          {isAppWorkflow({ nodes: workflow.nodes }) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded ${TOOL_TYPES.workApp.color}`}>
                    <Briefcase className="w-4 h-4 text-white" />
                  </div>
                  <label className="text-sm font-medium text-gray-200">{TOOL_TYPES.workApp.name}</label>
                </div>
                <span className="text-xs text-gray-400">{tempWorkAppItems.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {tempWorkAppItems.map((item) => (
                  <div key={item.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.workApp.color} text-white`}>
                    <span className="text-sm font-medium">{item.name}</span>
                    <button onClick={() => setTempWorkAppItems(prev => prev.filter(i => i.id !== item.id))} className="hover:opacity-70">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {tempWorkAppItems.length === 0 && (
                  <button
                    onClick={() => {
                      if (totalCount >= 10) {
                        toast.error(t.max_tools_allowed)
                        return
                      }
                      setTempWorkAppItems([{ id: `workapp-${Date.now()}`, name: 'Work app' }])
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm font-medium">{t.add_work_app_tool}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {supportsAppsTools ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded ${TOOL_TYPES.subworkflow.color}`}>
                    <Puzzle className="w-4 h-4 text-white" />
                  </div>
                  <label className="text-sm font-medium text-gray-200">{t.toolsSubworkflow || TOOL_TYPES.subworkflow.name}</label>
                </div>
                <span className="text-xs text-gray-400">{tempSubWorkflowItems.length}</span>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {tempSubWorkflowItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.subworkflow.color} text-white`}
                    >
                      <span className="text-sm font-medium">{item.name}</span>
                      <button
                        onClick={() => setTempSubWorkflowItems(prev => prev.filter(i => i.id !== item.id))}
                        className="hover:opacity-70"
                        aria-label={`${t.remove || 'Remove'}: ${item.name}`}
                        title={`${t.remove || 'Remove'}: ${item.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {(() => {
                    const usedIds = new Set(tempSubWorkflowItems.map(i => i.subWorkflowId).filter(Boolean))
                    const candidates = subWorkflows.filter(w => !usedIds.has(w.workflowId))
                    if (subWorkflows.length === 0) {
                      return (
                        <span className="text-xs text-gray-500 self-center">
                          {t.subworkflow_none || 'No Sub-workflow in this agent yet. Create one from the workflow list (New → Sub-workflow).'}
                        </span>
                      )
                    }
                    if (candidates.length === 0) return null
                    return (
                      <select
                        value=""
                        onChange={(e) => {
                          const picked = subWorkflows.find(w => w.workflowId === e.target.value)
                          if (!picked) return
                          if (totalCount >= 10) {
                            toast.error(t.max_tools_allowed)
                            return
                          }
                          setTempSubWorkflowItems(prev => [
                            ...prev,
                            { id: `subworkflow-${Date.now()}`, name: picked.name, subWorkflowId: picked.workflowId },
                          ])
                        }}
                        className="px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] bg-transparent text-sm text-gray-400 hover:border-gray-500 hover:text-gray-300 focus:outline-none"
                      >
                        <option value="">+ {t.add_subworkflow || 'Add Sub-workflow'}</option>
                        {candidates.map(w => (
                          <option key={w.workflowId} value={w.workflowId}>{w.name}</option>
                        ))}
                      </select>
                    )
                  })()}
                </div>
                <p className="text-xs text-gray-500">
                  {t.subworkflow_tools_hint || 'The AI calls a Sub-workflow like a function — its name, description and inputs come from that Sub-workflow\'s Start node.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="opacity-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded bg-gray-600`}>
                    <Puzzle className="w-4 h-4 text-gray-400" />
                  </div>
                  <label className="text-sm font-medium text-gray-400">{TOOL_TYPES.subworkflow.name}</label>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {t.not_supported}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* SendGrid Email Section (max 1) */}
              {supportsAppsTools ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded ${TOOL_TYPES.sendgrid.color}`}>
                        <SendGridIcon className="w-4 h-4" />
                      </div>
                      <label className="text-sm font-medium text-gray-200">{t.toolsSendgrid || TOOL_TYPES.sendgrid.name}</label>
                    </div>
                    <span className="text-xs text-gray-400">{tempSendgridItems.length}/1</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {tempSendgridItems.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.sendgrid.color} text-white`}
                        >
                          <span className="text-sm font-medium">{item.name}</span>
                          <button
                            onClick={() => setTempSendgridItems([])}
                            className="hover:opacity-70"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {tempSendgridItems.length === 0 && (
                        <button
                          onClick={() => {
                            if (totalCount >= 10) {
                              toast.error(t.max_tools_allowed)
                              return
                            }
                            const newId = `sendgrid-${Date.now()}`
                            const autoConnectionId = sendgridConnections.length > 0 ? sendgridConnections[0].id : ''
                            setTempSendgridItems([{ id: newId, name: t.toolsSendgrid || 'SendGrid Email', connectionId: autoConnectionId }])
                          }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">{t.add_sendgrid || 'Add SendGrid Email'}</span>
                        </button>
                      )}
                    </div>
                    {tempSendgridItems.length > 0 && sendgridConnections.length === 0 && (
                      <div
                        onClick={() => handleGoToSettings('sendgrid')}
                        className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-400 underline">{t.toolsNoConnection || 'No connection. Add in Settings'}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="opacity-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-gray-600">
                        <SendGridIcon className="w-4 h-4 opacity-50" />
                      </div>
                      <label className="text-sm font-medium text-gray-400">{t.toolsSendgrid || TOOL_TYPES.sendgrid.name}</label>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {t.not_supported}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Telegram Section (max 1) */}
              {supportsAppsTools ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-gray-200">
                        <TelegramIcon className="w-4 h-4" />
                      </div>
                      <label className="text-sm font-medium text-gray-200">{t.toolsTelegram || TOOL_TYPES.telegram.name}</label>
                    </div>
                    <span className="text-xs text-gray-400">{tempTelegramItems.length}/1</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {tempTelegramItems.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.telegram.color} text-white`}
                        >
                          <span className="text-sm font-medium">{item.name}</span>
                          <button
                            onClick={() => setTempTelegramItems([])}
                            className="hover:opacity-70"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {tempTelegramItems.length === 0 && (
                        <button
                          onClick={() => {
                            if (totalCount >= 10) {
                              toast.error(t.max_tools_allowed)
                              return
                            }
                            const newId = `telegram-${Date.now()}`
                            const autoConnectionId = telegramConnections.length > 0 ? telegramConnections[0].id : ''
                            setTempTelegramItems([{ id: newId, name: t.toolsTelegram || 'Telegram', connectionId: autoConnectionId }])
                          }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">{t.add_telegram || 'Add Telegram'}</span>
                        </button>
                      )}
                    </div>
                    {tempTelegramItems.length > 0 && telegramConnections.length === 0 && (
                      <div
                        onClick={() => handleGoToSettings('telegram')}
                        className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-400 underline">{t.toolsNoConnection || 'No connection. Add in Settings'}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="opacity-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-gray-600">
                        <TelegramIcon className="w-4 h-4 opacity-50" />
                      </div>
                      <label className="text-sm font-medium text-gray-400">{t.toolsTelegram || TOOL_TYPES.telegram.name}</label>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {t.not_supported}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {SMS_TOOL_ENABLED && toolInEdition('sms') && (supportsAppsTools ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-sky-500">
                        <SmsIcon className="w-4 h-4" />
                      </div>
                      <label className="text-sm font-medium text-gray-200">{t.toolsSms || TOOL_TYPES.sms.name}</label>
                    </div>
                    <span className="text-xs text-gray-400">{tempSmsItems.length}/1</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {tempSmsItems.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.sms.color} text-white`}
                        >
                          <span className="text-sm font-medium">{item.name}</span>
                          <button
                            onClick={() => setTempSmsItems([])}
                            className="hover:opacity-70"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {tempSmsItems.length === 0 && (
                        <button
                          onClick={() => {
                            if (totalCount >= 10) {
                              toast.error(t.max_tools_allowed)
                              return
                            }
                            const newId = `sms-${Date.now()}`
                            const autoConnectionId = smsConnections.length > 0 ? smsConnections[0].id : ''
                            setTempSmsItems([{ id: newId, name: t.toolsSms || 'SMS', connectionId: autoConnectionId }])
                          }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">{t.add_sms || 'Add SMS'}</span>
                        </button>
                      )}
                    </div>
                    {tempSmsItems.length > 0 && smsConnections.length === 0 && (
                      <div
                        onClick={() => handleGoToSettings('sms')}
                        className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-400 underline">{t.toolsNoConnection || 'No connection. Add in Settings'}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="opacity-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-gray-600">
                        <SmsIcon className="w-4 h-4 opacity-50" />
                      </div>
                      <label className="text-sm font-medium text-gray-400">{t.toolsSms || TOOL_TYPES.sms.name}</label>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {t.not_supported}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* SMTP Email Section (max 1) */}
              {supportsAppsTools ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded ${TOOL_TYPES.smtp.color}`}>
                        <Send className="w-4 h-4 text-white" />
                      </div>
                      <label className="text-sm font-medium text-gray-200">{t.toolsSmtp || TOOL_TYPES.smtp.name}</label>
                    </div>
                    <span className="text-xs text-gray-400">{tempSmtpItems.length}/1</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {tempSmtpItems.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.smtp.color} text-white`}
                        >
                          <span className="text-sm font-medium">{item.name}</span>
                          <button
                            onClick={() => setTempSmtpItems([])}
                            className="hover:opacity-70"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {tempSmtpItems.length === 0 && (
                        <button
                          onClick={() => {
                            if (totalCount >= 10) {
                              toast.error(t.max_tools_allowed)
                              return
                            }
                            const newId = `smtp-${Date.now()}`
                            const autoConnectionId = smtpConnections.length > 0 ? smtpConnections[0].id : ''
                            setTempSmtpItems([{ id: newId, name: t.toolsSmtp || 'SMTP Email', connectionId: autoConnectionId }])
                          }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">{t.add_smtp || 'Add SMTP Email'}</span>
                        </button>
                      )}
                    </div>
                    {tempSmtpItems.length > 0 && smtpConnections.length === 0 && (
                      <div
                        onClick={() => handleGoToSettings('smtp')}
                        className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-400 underline">{t.toolsNoConnection || 'No connection. Add in Settings'}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="opacity-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-gray-600">
                        <Send className="w-4 h-4 text-gray-400" />
                      </div>
                      <label className="text-sm font-medium text-gray-400">{t.toolsSmtp || TOOL_TYPES.smtp.name}</label>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {t.not_supported}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Google Calendar Section (max 1) */}
              {toolInEdition('google_calendar') && (supportsAppsTools ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded ${TOOL_TYPES.google_calendar.color}`}>
                        <Calendar className="w-4 h-4 text-white" />
                      </div>
                      <label className="text-sm font-medium text-gray-200">{t.toolsGoogleCalendar || TOOL_TYPES.google_calendar.name}</label>
                    </div>
                    <span className="text-xs text-gray-400">{tempGoogleCalendarItems.length}/15</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {tempGoogleCalendarItems.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.google_calendar.color} text-white`}
                        >
                          <span className="text-sm font-medium">{item.name}</span>
                          <button
                            onClick={() => setTempGoogleCalendarItems(prev => prev.filter(i => i.id !== item.id))}
                            className="hover:opacity-70"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {totalCalendarCount < 15 && (
                        <button
                          onClick={() => {
                            if (totalCalendarCount >= 15) {
                              toast.error(t.calendar_max_15_reached || 'Maximum 15 calendars per workflow.')
                              return
                            }
                            const newId = `google_calendar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
                            const autoConnectionId = googleCalendarConnections.length > 0 ? googleCalendarConnections[0].id : ''
                            const idx = tempGoogleCalendarItems.length + 1
                            const baseName = t.toolsGoogleCalendar || 'Google Calendar'
                            const name = idx === 1 ? baseName : `${baseName} ${idx}`
                            setTempGoogleCalendarItems(prev => [...prev, { id: newId, name, connectionId: autoConnectionId }])
                          }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">{t.add_google_calendar || 'Add Google Calendar'}</span>
                        </button>
                      )}
                    </div>
                    {tempGoogleCalendarItems.length > 0 && googleCalendarConnections.length === 0 && (
                      <div
                        onClick={() => handleGoToSettings('google_calendar')}
                        className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-400 underline">{t.calendar_connect_prompt || 'Not connected. Click to connect Google Calendar'}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="opacity-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-gray-600">
                        <Calendar className="w-4 h-4 text-gray-400" />
                      </div>
                      <label className="text-sm font-medium text-gray-400">{t.toolsGoogleCalendar || TOOL_TYPES.google_calendar.name}</label>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {t.not_supported}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Microsoft Calendar Section (max 1) */}
              {toolInEdition('microsoft_calendar') && (supportsAppsTools ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded ${TOOL_TYPES.microsoft_calendar.color}`}>
                        <Calendar className="w-4 h-4 text-white" />
                      </div>
                      <label className="text-sm font-medium text-gray-200">{t.toolsMicrosoftCalendar || TOOL_TYPES.microsoft_calendar.name}</label>
                    </div>
                    <span className="text-xs text-gray-400">{tempMicrosoftCalendarItems.length}/15</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {tempMicrosoftCalendarItems.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${TOOL_TYPES.microsoft_calendar.color} text-white`}
                        >
                          <span className="text-sm font-medium">{item.name}</span>
                          <button
                            onClick={() => setTempMicrosoftCalendarItems(prev => prev.filter(i => i.id !== item.id))}
                            className="hover:opacity-70"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {totalCalendarCount < 15 && (
                        <button
                          onClick={() => {
                            if (totalCalendarCount >= 15) {
                              toast.error(t.calendar_max_15_reached || 'Maximum 15 calendars per workflow.')
                              return
                            }
                            const newId = `microsoft_calendar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
                            const autoConnectionId = microsoftCalendarConnections.length > 0 ? microsoftCalendarConnections[0].id : ''
                            const idx = tempMicrosoftCalendarItems.length + 1
                            const baseName = t.toolsMicrosoftCalendar || 'Microsoft Calendar'
                            const name = idx === 1 ? baseName : `${baseName} ${idx}`
                            setTempMicrosoftCalendarItems(prev => [...prev, { id: newId, name, connectionId: autoConnectionId }])
                          }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">{t.add_microsoft_calendar || 'Add Microsoft Calendar'}</span>
                        </button>
                      )}
                    </div>
                    {tempMicrosoftCalendarItems.length > 0 && microsoftCalendarConnections.length === 0 && (
                      <div
                        onClick={() => handleGoToSettings('microsoft_calendar')}
                        className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-pointer hover:bg-amber-500/20 transition-colors"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-400 underline">{t.calendar_connect_prompt || 'Not connected. Click to connect Microsoft Calendar'}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="opacity-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-gray-600">
                        <Calendar className="w-4 h-4 text-gray-400" />
                      </div>
                      <label className="text-sm font-medium text-gray-400">{t.toolsMicrosoftCalendar || TOOL_TYPES.microsoft_calendar.name}</label>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {t.not_supported}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

          {/* Total count */}
          <div className="pt-4 border-t border-[#3A3A3A]">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">{t.total_tools}</span>
              <span className="font-medium text-gray-200">
                {totalCount} / 10
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[#3A3A3A] flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => closeModal()}
            className="border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A]"
          >
            {t.cancel}
          </Button>
          <Button onClick={handleSave}>
            {t.save}
          </Button>
        </div>
      </div>
    </div>
  )
}
