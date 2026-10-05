'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, Bot, GripVertical, Pause, Database, GitBranch, RotateCw, GripHorizontal, RefreshCw, Mail, Send, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { isLoopToolAllowedForKind } from '../utils/palette-visibility'
import type { WorkflowKind } from '@/lib/workflow/subworkflow'
import { MCPLogo } from '../nodes/icons/MCPLogo'
import { SendGridIcon, TelegramIcon } from '../constants/components'
import type { Node } from 'reactflow'
import { toast } from 'sonner'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useDraggable } from '../hooks/useDraggable'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface ToolItem {
  id: string
  name: string
  type: 'ai' | 'mcp' | 'wait' | 'dataSheets' | 'ifElse' | 'continue' | 'imap' | 'smtp' | 'telegram' | 'sendgrid'
}

const TOOL_TYPES = {
  ai: { name: 'AI', color: 'bg-blue-500', textColor: 'text-white' },
  mcp: { name: 'MCP', color: 'bg-black', textColor: 'text-white' },
  wait: { name: 'Wait', color: 'bg-orange-400', textColor: 'text-white' },
  dataSheets: { name: 'Data Sheets', color: 'bg-indigo-500', textColor: 'text-white' },
  ifElse: { name: 'If / Else', color: 'bg-yellow-500', textColor: 'text-white' },
  continue: { name: 'Continue', color: 'bg-green-500', textColor: 'text-white' },
  imap: { name: 'IMAP', color: 'bg-blue-600', textColor: 'text-white' },
  smtp: { name: 'SMTP', color: 'bg-purple-500', textColor: 'text-white' },
  telegram: { name: 'Telegram', color: 'bg-sky-500', textColor: 'text-white' },
  sendgrid: { name: 'SendGrid', color: 'bg-blue-400', textColor: 'text-white' }
}

// Sortable Tool Item Component
function SortableToolItem({
  tool,
  index,
  onRemove,
  onNameChange
}: {
  tool: ToolItem
  index: number
  onRemove: () => void
  onNameChange: (name: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: tool.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  const config = TOOL_TYPES[tool.type]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-3 bg-[#1E1E1E] rounded-lg border border-[#3A3A3A] hover:border-[#4A4A4A] transition-colors"
    >
      {/* Drag Handle */}
      <div
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300 transition-colors"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Order Number */}
      <span className="text-sm font-medium text-gray-400 w-6">{index + 1}.</span>

      {/* Icon */}
      <div className={`p-1.5 rounded ${config.color} flex-shrink-0`}>
        {tool.type === 'ai' ? (
          <Bot className="w-4 h-4 text-white" />
        ) : tool.type === 'wait' ? (
          <Pause className="w-4 h-4 text-white" />
        ) : tool.type === 'dataSheets' ? (
          <Database className="w-4 h-4 text-white" />
        ) : tool.type === 'ifElse' ? (
          <GitBranch className="w-4 h-4 text-white" />
        ) : tool.type === 'continue' ? (
          <RotateCw className="w-4 h-4 text-white" />
        ) : tool.type === 'imap' ? (
          <Mail className="w-4 h-4 text-white" />
        ) : tool.type === 'smtp' ? (
          <Send className="w-4 h-4 text-white" />
        ) : tool.type === 'telegram' ? (
          <TelegramIcon className="w-4 h-4 text-white" />
        ) : tool.type === 'sendgrid' ? (
          <SendGridIcon className="w-4 h-4 text-white" />
        ) : (
          <MCPLogo className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Name Input */}
      <input
        type="text"
        value={tool.name}
        onChange={(e) => onNameChange(e.target.value)}
        className="flex-1 bg-transparent border-none outline-none text-sm text-gray-200 placeholder-gray-500"
        placeholder={`${config.name} name`}
      />

      {/* Remove Button */}
      <button
        onClick={onRemove}
        className="text-gray-500 hover:text-red-400 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

export function WhileToolsModal() {
  const { ui, workflow, reloadWorkflow, agent } = useWorkflowContext()
  const workflowKind: WorkflowKind = agent.workflowKind === 'sub' ? 'sub' : 'main'
  const canAdd = (type: ToolItem['type']) => isLoopToolAllowedForKind(type, workflowKind)
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [orderedTools, setOrderedToolsRaw] = useState<ToolItem[]>([])

  const [modalDirty, setModalDirty] = useState(false)
  const setOrderedTools: React.Dispatch<React.SetStateAction<ToolItem[]>> = (value) => {
    setModalDirty(true)
    setOrderedToolsRaw(value)
  }

  const activeWhileNode = useMemo(
    () => workflow.nodes.find(node => node.id === workflow.selectedNode && node.type === 'while'),
    [workflow.nodes, workflow.selectedNode]
  )

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  // Sync with canvas on modal open
  useEffect(() => {
    if (!ui.showWhileToolsModal || !activeWhileNode) return

    // Find all loop tool nodes connected to this While node
    const loopToolNodes = workflow.nodes.filter(n => n.data?.isLoopTool)

    // Filter only those connected via edges (directly or indirectly)
    const connectedIds = new Set<string>()
    const loopEdges = workflow.edges.filter(e => e.source === activeWhileNode.id && e.sourceHandle === 'loop')

    // BFS to find all connected loop tools
    const queue = loopEdges.map(e => e.target)
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (connectedIds.has(nodeId)) continue

      const node = workflow.nodes.find(n => n.id === nodeId)
      if (node?.data?.isLoopTool) {
        connectedIds.add(nodeId)

        // Find next nodes (exclude AI tool connections like webSearch, fileSearch)
        const nextEdges = workflow.edges.filter(e =>
          e.source === nodeId &&
          e.sourceHandle !== 'tools'
        )
        nextEdges.forEach(e => {
          if (!connectedIds.has(e.target)) {
            queue.push(e.target)
          }
        })
      }
    }

    const connectedLoopNodes = loopToolNodes.filter(n => connectedIds.has(n.id))

    // Sort by loopOrder if available, otherwise by position
    const sortedNodes = connectedLoopNodes.sort((a, b) => {
      const orderA = a.data?.loopOrder ?? 999
      const orderB = b.data?.loopOrder ?? 999
      if (orderA !== orderB) return orderA - orderB

      // Fallback to position
      return a.position.y - b.position.y
    })

    // Create ordered tool list
    const allTools: ToolItem[] = sortedNodes.map(n => ({
      id: n.id,
      name: n.data.label || 'Unnamed',
      type: (n.type === 'custom' && n.data?.nodeType === 'ai') ? 'ai'
        : (n.type === 'wait' || n.data?.nodeType === 'wait') ? 'wait'
          : (n.type === 'dataSheets' || n.data?.nodeType === 'dataSheets') ? 'dataSheets'
            : (n.type === 'ifElse' || n.data?.nodeType === 'ifElse') ? 'ifElse'
              : (n.type === 'continue' || n.data?.nodeType === 'continue') ? 'continue'
                : (n.type === 'custom' && n.data?.nodeType === 'imap') ? 'imap'
                  : (n.type === 'custom' && n.data?.nodeType === 'smtp') ? 'smtp'
                    : (n.type === 'custom' && n.data?.nodeType === 'telegram') ? 'telegram'
                      : (n.type === 'custom' && n.data?.nodeType === 'sendgrid') ? 'sendgrid'
                        : 'mcp'
    }))

    setOrderedToolsRaw(allTools)
  }, [ui.showWhileToolsModal, activeWhileNode, workflow.edges, workflow.nodes])

  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (ui.showWhileToolsModal && !wasOpenRef.current) setModalDirty(false)
    wasOpenRef.current = ui.showWhileToolsModal
  }, [ui.showWhileToolsModal])

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showWhileToolsModal })

  if (!ui.showWhileToolsModal) return null

  const totalCount = orderedTools.length

  // Drag end handler
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setOrderedTools((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id)
        const newIndex = items.findIndex(item => item.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  // Add tool
  function addTool(type: ToolItem['type']) {
    if (totalCount >= 10) {
      toast.error(t.max_tools_error)
      return
    }

    const newId = `${type}-loop-${Date.now()}`
    const typeCount = orderedTools.filter(t => t.type === type).length
    const typeNames: Record<ToolItem['type'], string> = {
      ai: 'AI',
      mcp: 'MCP',
      wait: 'Wait',
      dataSheets: 'Data Sheets',
      ifElse: 'If / Else',
      continue: 'Continue',
      imap: 'IMAP',
      smtp: 'SMTP',
      telegram: 'Telegram',
      sendgrid: 'SendGrid'
    }
    const name = `${typeNames[type]} ${typeCount + 1}`

    setOrderedTools(prev => [...prev, { id: newId, name, type }])
  }

  // Remove tool
  function removeTool(id: string) {
    setOrderedTools(prev => prev.filter(t => t.id !== id))
  }

  // Update tool name
  function updateToolName(id: string, name: string) {
    setOrderedTools(prev =>
      prev.map(t => (t.id === id ? { ...t, name } : t))
    )
  }

  const handleSave = () => {
    if (!activeWhileNode) {
      toast.error('Please select a While node')
      return
    }

    // Remove existing loop tool nodes connected to this While node
    const existingLoopToolNodeIds = new Set<string>()
    const existingNodeDataMap = new Map<string, any>()
    const existingNodePositionMap = new Map<string, { x: number; y: number }>()
    const loopEdges = workflow.edges.filter(e => e.source === activeWhileNode.id && e.sourceHandle === 'loop')
    const queue = loopEdges.map(e => e.target)

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (existingLoopToolNodeIds.has(nodeId)) continue

      const node = workflow.nodes.find(n => n.id === nodeId)
      if (node?.data?.isLoopTool) {
        existingLoopToolNodeIds.add(nodeId)
        existingNodeDataMap.set(nodeId, node.data)
        existingNodePositionMap.set(nodeId, node.position)

        const nextEdges = workflow.edges.filter(e => e.source === nodeId)
        nextEdges.forEach(e => {
          if (!existingLoopToolNodeIds.has(e.target)) {
            queue.push(e.target)
          }
        })
      }
    }

    const idsToRemove = Array.from(existingLoopToolNodeIds)

    const outgoingEdgesToRestore = workflow.edges.filter(e =>
      idsToRemove.includes(e.source) &&
      !(e.source === activeWhileNode.id && e.sourceHandle === 'loop')
    )

    workflow.setNodes(nds => nds.filter(n => !idsToRemove.includes(n.id)))
    workflow.setEdges(eds => eds.filter(e =>
      !idsToRemove.includes(e.source) &&
      !idsToRemove.includes(e.target)
    ))

    const toolConfig: Record<ToolItem['type'], { icon: any, color: string }> = {
      ai: { icon: Bot, color: 'bg-blue-500' },
      mcp: { icon: MCPLogo, color: 'bg-black' },
      wait: { icon: Pause, color: 'bg-orange-400' },
      dataSheets: { icon: Database, color: 'bg-indigo-500' },
      ifElse: { icon: GitBranch, color: 'bg-yellow-500' },
      continue: { icon: RotateCw, color: 'bg-green-500' },
      imap: { icon: Mail, color: 'bg-blue-600' },
      smtp: { icon: Send, color: 'bg-purple-500' },
      telegram: { icon: MessageCircle, color: 'bg-sky-500' },
      sendgrid: { icon: Mail, color: 'bg-blue-400' }
    }

    const positions = [
      { x: 150, y: 220 },   // 0: right bottom
      { x: -150, y: 220 },  // 1: left bottom
      { x: 150, y: 320 },   // 2
      { x: -150, y: 320 },  // 3
      { x: 150, y: 420 },   // 4
      { x: -150, y: 420 },  // 5
      { x: 150, y: 520 },   // 6
      { x: -150, y: 520 },  // 7
      { x: 150, y: 620 },   // 8
      { x: -150, y: 620 }   // 9
    ]

    const newToolNodes: Node[] = []
    const newToolEdges: any[] = []
    const nodeIdMap = new Map<string, string>()

    orderedTools.forEach((item, index) => {
      const config = toolConfig[item.type]
      const offset = positions[index] || { x: 0, y: 250 + (index * 100) }

      const isExistingLoopId = item.id.includes('-loop-')
      const nodeId = isExistingLoopId
        ? item.id
        : `${item.type}-loop-${Date.now()}-${index}`

      nodeIdMap.set(item.id, nodeId)

      const existingData = existingNodeDataMap.get(item.id)
      const existingPosition = existingNodePositionMap.get(item.id)

      if (item.type === 'ai') {
        newToolNodes.push({
          id: nodeId,
          type: 'custom',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'ai',
            isLoopTool: true,
            showTools: true,
            toolCount: 0,
            model: 'gpt-4.1-mini',
            temperature: 0.7,
            maxTokens: 2000,
            instructions: '',
            jsonSchema: null,
            hasToolsConnection: false,
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else if (item.type === 'wait') {
        newToolNodes.push({
          id: nodeId,
          type: 'wait',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'wait',
            isLoopTool: true,
            waitMessage: 'Waiting for user input...',
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else if (item.type === 'dataSheets') {
        newToolNodes.push({
          id: nodeId,
          type: 'dataSheets',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'dataSheets',
            isLoopTool: true,
            sheetId: null,
            sheetName: null,
            operation: 'read',
            filter: null,
            data: null,
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else if (item.type === 'ifElse') {
        newToolNodes.push({
          id: nodeId,
          type: 'ifElse',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'ifElse',
            isLoopTool: true,
            conditions: [{ id: 'if-0', type: 'if', condition: '', caseName: '' }],
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else if (item.type === 'continue') {
        newToolNodes.push({
          id: nodeId,
          type: 'continue',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'continue',
            isLoopTool: true,
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else if (item.type === 'imap') {
        // IMAP Loop Tool Node
        newToolNodes.push({
          id: nodeId,
          type: 'custom',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'imap',
            isLoopTool: true,
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else if (item.type === 'smtp') {
        // SMTP Loop Tool Node
        newToolNodes.push({
          id: nodeId,
          type: 'custom',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'smtp',
            isLoopTool: true,
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else if (item.type === 'telegram') {
        // Telegram Loop Tool Node
        newToolNodes.push({
          id: nodeId,
          type: 'custom',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'telegram',
            isLoopTool: true,
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else if (item.type === 'sendgrid') {
        // SendGrid Loop Tool Node
        newToolNodes.push({
          id: nodeId,
          type: 'custom',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            nodeType: 'sendgrid',
            isLoopTool: true,
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      } else {
        newToolNodes.push({
          id: nodeId,
          type: 'tool',
          data: existingData ? {
            ...existingData,
            label: item.name,
            loopOrder: index
          } : {
            label: item.name,
            icon: config.icon,
            color: config.color,
            toolType: 'mcp',
            isLoopTool: true,
            loopOrder: index
          },
          position: existingPosition || {
            x: activeWhileNode.position.x + offset.x,
            y: activeWhileNode.position.y + offset.y
          }
        })
      }
    })

    orderedTools.forEach((item, index) => {
      const currentNodeId = nodeIdMap.get(item.id)!

      newToolEdges.push({
        id: `e-${activeWhileNode.id}-${currentNodeId}`,
        source: activeWhileNode.id,
        sourceHandle: 'loop',
        target: currentNodeId,
        type: 'default',
        animated: false
      })
    })

    if (outgoingEdgesToRestore.length > 0) {
      const restoredEdges = outgoingEdgesToRestore.map(edge => {
        const newSourceId = nodeIdMap.get(edge.source) || edge.source
        const newTargetId = nodeIdMap.get(edge.target) || edge.target

        return {
          ...edge,
          id: `e-${newSourceId}-${edge.sourceHandle || 'default'}-${newTargetId}`,
          source: newSourceId,
          target: newTargetId
        }
      })

      newToolEdges.push(...restoredEdges)
    }

    // Add nodes and edges
    setTimeout(() => {
      workflow.setNodes(nds => [...nds, ...newToolNodes])
      setTimeout(() => {
        workflow.setEdges(eds => [...eds, ...newToolEdges])
      }, 100)
    }, 100)

    ui.setShowWhileToolsModal(false)
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
              <h2 className="text-lg font-semibold text-gray-200">{t.select_loop_tools}</h2>
              <p className="text-sm text-gray-400 mt-1">{workflowKind === 'sub' ? (t.select_loop_tools_desc_sub || t.select_loop_tools_desc) : t.select_loop_tools_desc}</p>
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
              onClick={() => ui.setShowWhileToolsModal(false)}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto system-message-scrollbar p-6 space-y-6">
          {/* Execution Order Section */}
          <div>
            <h3 className="text-sm font-medium text-gray-200 mb-3">{t.execution_order}</h3>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedTools}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {orderedTools.map((tool, index) => (
                    <SortableToolItem
                      key={tool.id}
                      tool={tool}
                      index={index}
                      onRemove={() => removeTool(tool.id)}
                      onNameChange={(name) => updateToolName(tool.id, name)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Add Tool Buttons */}
            <div className="grid grid-cols-5 gap-2 mt-4">
              {canAdd('ai') && (
                <button
                  onClick={() => addTool('ai')}
                  className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors"
                >
                  <Bot className="w-4 h-4" />
                  <span className="text-xs font-medium">AI</span>
                </button>
              )}
              {canAdd('wait') && (
                <button
                  onClick={() => addTool('wait')}
                  className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-orange-500 hover:text-orange-400 transition-colors"
                >
                  <Pause className="w-4 h-4" />
                  <span className="text-xs font-medium">Wait</span>
                </button>
              )}
              <button
                onClick={() => addTool('ifElse')}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-yellow-500 hover:text-yellow-400 transition-colors"
              >
                <GitBranch className="w-4 h-4" />
                <span className="text-xs font-medium">If/Else</span>
              </button>
              <button
                onClick={() => addTool('dataSheets')}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
              >
                <Database className="w-4 h-4" />
                <span className="text-xs font-medium">Data</span>
              </button>
              <button
                onClick={() => addTool('continue')}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-green-500 hover:text-green-400 transition-colors"
              >
                <RotateCw className="w-4 h-4" />
                <span className="text-xs font-medium">Continue</span>
              </button>
              <button
                onClick={() => addTool('imap')}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-blue-600 hover:text-blue-500 transition-colors"
              >
                <Mail className="w-4 h-4" />
                <span className="text-xs font-medium">IMAP</span>
              </button>
              <button
                onClick={() => addTool('smtp')}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-purple-500 hover:text-purple-400 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span className="text-xs font-medium">SMTP</span>
              </button>
              <button
                onClick={() => addTool('telegram')}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-sky-500 hover:text-sky-400 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span className="text-xs font-medium">Telegram</span>
              </button>
              <button
                onClick={() => addTool('sendgrid')}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-blue-400 hover:text-blue-300 transition-colors"
              >
                <Mail className="w-4 h-4" />
                <span className="text-xs font-medium">SendGrid</span>
              </button>
              {canAdd('mcp') && (
                <button
                  onClick={() => addTool('mcp')}
                  className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                >
                  <MCPLogo className="w-4 h-4" />
                  <span className="text-xs font-medium">MCP</span>
                </button>
              )}
            </div>
          </div>

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
            onClick={() => ui.setShowWhileToolsModal(false)}
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
