'use client'

import React, { useState, useCallback } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { MCPLogo } from '../nodes/icons/MCPLogo'
import { MobileBottomSheet } from '../components/MobileBottomSheet'
import {
  basicComponents,
  toolComponents,
  inOutComponents,
  flowComponents,
  dataComponents,
  appsComponents,
  etcComponents,
  SendGridIcon,
  TelegramIcon
} from '../constants/components'
import { filterPaletteItems } from '../utils/palette-visibility'
import { useEdition } from '@/components/EditionProvider'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import type { WorkflowKind } from '@/lib/workflow/subworkflow'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { aiDefaultConfig } from '../constants/initialData'
import { findNonOverlappingPosition } from '../utils'
import { v4 as uuidv4 } from 'uuid'
import type { Node, Edge } from 'reactflow'

interface LeftPaletteMobileProps {
  isOpen: boolean
  onClose: () => void
}

export function LeftPaletteMobile({ isOpen, onClose }: LeftPaletteMobileProps) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { workflow, ui, agent } = useWorkflowContext()

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    tools: false,
    flow: false,
    data: false,
    apps: false,
    etc: false,
  })

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const handleAddNode = useCallback((component: any) => {
    if (ui.isLocked) return

    const rfWrapper = document.querySelector('.react-flow__renderer')
    if (!rfWrapper || !workflow.reactFlowInstance) {
      onClose()
      return
    }

    const rect = rfWrapper.getBoundingClientRect()
    const centerScreen = {
      x: rect.width / 2,
      y: rect.height / 2
    }

    const flowPosition = workflow.reactFlowInstance.project(centerScreen)

    const position = findNonOverlappingPosition(
      flowPosition.x,
      flowPosition.y,
      undefined,
      workflow.nodes
    )

    const icon =
      component.id === 'mcp' && !component.icon ? MCPLogo
      : component.id === 'sendgrid' && !component.icon ? SendGridIcon
      : component.id === 'telegram' && !component.icon ? TelegramIcon
      : component.id === 'telegram-start' && !component.icon ? TelegramIcon
      : component.icon

    const toolTypes = ['source', 'mcp', 'web-search', 'function-calling', 'subworkflow']
    if (toolTypes.includes(component.id)) {
      const aiNodeId = uuidv4()
      const toolNodeId = uuidv4()

      const aiPosition = position
      const toolPosition = {
        x: position.x + 30,
        y: position.y + 120
      }

      const paletteItems = [
        ...basicComponents,
        ...toolComponents,
        ...inOutComponents,
        ...flowComponents,
        ...dataComponents,
        ...appsComponents,
        ...etcComponents
      ]

      const aiNode: Node = {
        id: aiNodeId,
        type: 'custom',
        position: aiPosition,
        data: {
          label: 'AI',
          icon: paletteItems.find(p => p.id === 'ai')?.icon,
          color: 'bg-blue-500',
          nodeType: 'ai',
          showTools: true,
          toolCount: 1,
          ...aiDefaultConfig
        },
        selected: false
      }

      const toolNode: Node = {
        id: toolNodeId,
        type: 'tool',
        position: toolPosition,
        data: {
          label: component.name,
          icon,
          color: component.color,
          toolType:
            component.id === 'source'
              ? 'source'
              : component.id === 'mcp'
                ? 'mcp'
                : component.id === 'web-search'
                  ? 'webSearch'
                  : component.id === 'subworkflow'
                    ? 'subworkflow'
                    : 'functionCalling'
        },
        selected: false
      }

      const toolEdge: Edge = {
        id: `e-${aiNodeId}-${toolNodeId}`,
        source: aiNodeId,
        target: toolNodeId,
        sourceHandle: 'tools',
        type: 'toolEdge',
        className: 'tool-edge-no-arrow'
      }

      const newNodes = [...workflow.nodes, aiNode, toolNode]
      const newEdges = [...workflow.edges, toolEdge]

      workflow.setNodes(newNodes)
      workflow.setEdges(newEdges)
      workflow.saveToHistory(newNodes, newEdges)
      workflow.setSelectedNode(aiNodeId)
      onClose()
      return
    }

    const newNode = createPaletteNode(component.id, {
      label: component.name,
      icon,
      color: component.color,
      showLeftHandle: component.showLeftHandle
    }, position)

    if (!newNode) {
      onClose()
      return
    }

    workflow.setNodes((prev) => {
      const updated = [...prev, newNode]
      workflow.saveToHistory(updated, workflow.edges)
      return updated
    })
    workflow.setSelectedNode(newNode.id)
    onClose()
  }, [ui.isLocked, workflow, onClose])

  const edition = useEdition()
  const kind: WorkflowKind = agent.workflowKind === 'sub' ? 'sub' : 'main'
  const forKind = <T extends { id: string }>(items: readonly T[]) => filterPaletteItems(items, kind, edition)

  const renderComponents = (components: any[], sectionKey: string, sectionName: string) => components.length === 0 ? null : (
    <div className="mb-2">
      <button
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-400 hover:bg-[#3A3A3A] rounded-lg transition-colors"
      >
        <span>{sectionName}</span>
        {expandedSections[sectionKey] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {expandedSections[sectionKey] && (
        <div className="mt-1 grid grid-cols-2 gap-2 px-2">
          {components.map((comp) => {
            const IconComponent = comp.id === 'mcp' ? MCPLogo
              : comp.id === 'sendgrid' ? SendGridIcon
              : comp.id === 'telegram' ? TelegramIcon
              : comp.id === 'telegram-start' ? TelegramIcon
              : comp.icon
            return (
              <button
                key={comp.id}
                onClick={() => handleAddNode(comp)}
                disabled={ui.isLocked}
                className={`flex items-center gap-2 px-3 py-3 bg-[#2A2A2A] rounded-lg transition-colors ${
                  ui.isLocked
                    ? 'cursor-not-allowed opacity-50'
                    : 'active:bg-[#4A4A4A] hover:bg-[#3A3A3A]'
                }`}
              >
                {IconComponent && (
                  <div className={`p-1.5 rounded ${comp.color} ${comp.textColor || ''} flex-shrink-0`}>
                    <IconComponent className="w-4 h-4 text-white" />
                  </div>
                )}
                <span className="text-xs font-medium text-gray-200 truncate">
                  {comp.name.includes(' / ') ? comp.name.split(' / ')[0] : comp.name}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <MobileBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t.components}
      height="medium"
    >
      <div className="p-3">
        {renderComponents(forKind(basicComponents), 'basic', t.basic)}
        {renderComponents(forKind(toolComponents), 'tools', t.tools)}
        {renderComponents(forKind(flowComponents), 'flow', t.flow)}
        {renderComponents(forKind(dataComponents), 'data', t.data)}
        {renderComponents(forKind(appsComponents), 'apps', t.apps)}
        {renderComponents(forKind(etcComponents), 'etc', t.etc)}
      </div>
    </MobileBottomSheet>
  )
}

function createPaletteNode(
  componentId: string,
  component: { label: string; icon: any; color?: string; showLeftHandle?: boolean },
  position: { x: number; y: number }
): Node | null {
  const id = uuidv4()
  const baseData = {
    label: component.label,
    icon: component.icon,
    color: component.color,
    showLeftHandle: component.showLeftHandle
  }

  switch (componentId) {
    case 'ai':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'ai',
          showTools: true,
          toolCount: 0,
          ...aiDefaultConfig
        },
        selected: false
      }
    case 'note':
      return {
        id,
        type: 'note',
        position,
        data: {
          noteText: '',
          backgroundColor: '#fef3c7'
        },
        selected: false
      }
    case 'end':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'end'
        },
        selected: false
      }
    case 'condition':
      return {
        id,
        type: 'ifElse',
        position,
        data: {
          ...baseData,
          nodeType: 'branch',
          conditions: [
            { id: 'if-0', type: 'if', caseName: '', condition: '' },
            { id: 'else', type: 'else', caseName: '', condition: '' }
          ]
        },
        selected: false
      }
    case 'while':
      return {
        id,
        type: 'while',
        position,
        data: {
          ...baseData,
          nodeType: 'while',
          showTools: true,
          maxIterations: 10,
          conditionField: '',
          conditionOperator: '==',
          conditionValue: '',
          conditionMode: 'simple'
        },
        selected: false
      }
    case 'wait':
      return {
        id,
        type: 'wait',
        position,
        data: {
          ...baseData,
          nodeType: 'wait',
          waitMessage: 'Waiting for user input...'
        },
        selected: false
      }
    case 'data-sheets':
      return {
        id,
        type: 'dataSheets',
        position,
        data: {
          ...baseData,
          nodeType: 'dataSheets',
          sheetId: '',
          operation: 'read',
          outputVariable: 'sheetData'
        },
        selected: false
      }
    case 'sendgrid':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'sendgrid',
          toEmail: '',
          fromEmail: '',
          fromName: '',
          subject: '',
          bodyTemplate: '{{context.aiResponse}}',
        },
        selected: false
      }
    case 'webhook':
      return {
        id,
        type: 'api',
        position,
        data: {
          ...baseData,
          nodeType: 'api'
        },
        selected: false
      }
    case 'chat-widget':
    case 'slack':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'chatWidget',
          showLeftHandle: false
        },
        selected: false
      }
    case 'telegram':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'telegram',
          botToken: '',
          chatId: '',
        },
        selected: false
      }
    case 'schedule':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'schedule',
          showLeftHandle: false
        },
        selected: false
      }
    case 'app-start':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'app',
          showLeftHandle: false
        },
        selected: false
      }
    case 'telegram-start':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'telegram',
          showLeftHandle: false
        },
        selected: false
      }
    case 'subworkflow-start':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'subworkflow',
          showLeftHandle: false,
          toolName: '',
          toolDescription: '',
          inputs: [],
        },
        selected: false
      }
    case 'imap':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'imap',
          action: 'read',
          folder: 'INBOX',
          onlyUnseen: true,
          maxEmails: 10
        },
        selected: false
      }
    case 'smtp':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'smtp',
          mode: 'send',
          to: '',
          subject: '',
          body: '{{context.aiResponse}}'
        },
        selected: false
      }
    default:
      return {
        id,
        type: 'custom',
        position,
        data: baseData,
        selected: false
      }
  }
}
