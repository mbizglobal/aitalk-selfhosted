'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { MCPLogo } from '../nodes/icons/MCPLogo'
import { basicComponents, toolComponents, inOutComponents, flowComponents, dataComponents, appsComponents, etcComponents, SendGridIcon, TelegramIcon } from '../constants/components'
import { filterPaletteItems } from '../utils/palette-visibility'
import { useEdition } from '@/components/EditionProvider'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import type { WorkflowKind } from '@/lib/workflow/subworkflow'

interface LeftPaletteProps {
  isMobile: boolean
  onDragStart: (event: React.DragEvent, nodeData: any) => void
  onDragEnd?: () => void
  activeTab: string
  isLocked: boolean
  isOverlay?: boolean
}

export function LeftPalette({ isMobile, onDragStart, onDragEnd, activeTab, isLocked, isOverlay = false }: LeftPaletteProps) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { agent } = useWorkflowContext()

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    tools: false,
    inout: false,
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

  const renderComponents = (components: any[], sectionKey: string, sectionName: string, compact = false) => components.length === 0 ? null : (
    <div className={compact ? "mb-2" : "mb-3"}>
      <button
        onClick={() => toggleSection(sectionKey)}
        className={`w-full flex items-center justify-between ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} text-xs font-medium text-gray-400 hover:bg-[#3A3A3A] rounded transition-colors`}
      >
        <span className={compact ? 'text-[10px]' : ''}>{sectionName}</span>
        {expandedSections[sectionKey] ? <ChevronDown className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} /> : <ChevronRight className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />}
      </button>
      {expandedSections[sectionKey] && (
        <div className={compact ? "mt-0.5 space-y-0.5" : "mt-1 space-y-1"}>
          {components.map((comp) => {
            const IconComponent = comp.id === 'mcp' ? MCPLogo
              : comp.id === 'sendgrid' ? SendGridIcon
              : comp.id === 'telegram' ? TelegramIcon
              : comp.id === 'telegram-start' ? TelegramIcon
              : comp.icon
            return (
              <div
                key={comp.id}
                className={`flex items-center ${compact ? 'gap-1.5 px-2 py-1.5' : 'gap-2 px-3 py-2'} bg-[#3A3A3A] rounded transition-colors ${
                  isLocked
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-grab hover:bg-[#4A4A4A]'
                }`}
                draggable={!isLocked}
                onDragStart={(e) => !isLocked && onDragStart(e, comp)}
                onDragEnd={() => onDragEnd?.()}
              >
                {IconComponent && (
                  <div className={`${compact ? 'p-1' : 'p-1.5'} rounded ${comp.color} ${comp.textColor || ''} flex-shrink-0`}>
                    <IconComponent className={compact ? "w-3 h-3 text-white" : "w-3.5 h-3.5 text-white"} />
                  </div>
                )}
                <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-medium text-gray-200 truncate`}>
                  {comp.name.includes(' / ') ? (
                    <>
                      {comp.name.split(' / ')[0]}{compact ? '' : ' / '}{compact ? '' : <span className="text-[10px] text-gray-400">{comp.name.split(' / ')[1]}</span>}
                    </>
                  ) : comp.name}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const edition = useEdition()
  const kind: WorkflowKind = agent.workflowKind === 'sub' ? 'sub' : 'main'
  const forKind = <T extends { id: string }>(items: readonly T[]) => filterPaletteItems(items, kind, edition)
  const visibleComponents = activeTab === 'all'
    ? { basic: forKind(basicComponents), tools: forKind(toolComponents), inout: forKind(inOutComponents), flow: forKind(flowComponents), data: forKind(dataComponents), apps: forKind(appsComponents), etc: forKind(etcComponents) }
    : activeTab === 'basic' ? { basic: forKind(basicComponents) }
    : activeTab === 'tools' ? { tools: forKind(toolComponents) }
    : activeTab === 'inout' ? { inout: forKind(inOutComponents) }
    : activeTab === 'flow' ? { flow: forKind(flowComponents) }
    : activeTab === 'data' ? { data: forKind(dataComponents) }
    : activeTab === 'apps' ? { apps: forKind(appsComponents) }
    : activeTab === 'etc' ? { etc: forKind(etcComponents) }
    : {}

  if (isOverlay) {
    return (
      <div className="w-full">
        <div className="space-y-0.5">
          {activeTab === 'all' || activeTab === 'basic' ?
            renderComponents(visibleComponents.basic || [], 'basic', t.basic, true) : null}
          {activeTab === 'all' || activeTab === 'tools' ?
            renderComponents(visibleComponents.tools || [], 'tools', t.tools, true) : null}
          {activeTab === 'all' || activeTab === 'flow' ?
            renderComponents(visibleComponents.flow || [], 'flow', t.flow, true) : null}
          {activeTab === 'all' || activeTab === 'data' ?
            renderComponents(visibleComponents.data || [], 'data', t.data, true) : null}
          {activeTab === 'all' || activeTab === 'apps' ?
            renderComponents(visibleComponents.apps || [], 'apps', t.apps, true) : null}
          {activeTab === 'all' || activeTab === 'etc' ?
            renderComponents(visibleComponents.etc || [], 'etc', t.etc, true) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="absolute top-20 left-4 z-10 w-48">
      <div className="bg-[#2A2A2A]/95 backdrop-blur-sm rounded-t-lg border border-[#3A3A3A] border-b-0 px-3 py-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t.components}</h3>
      </div>
      <div
        className={`bg-[#2A2A2A]/95 backdrop-blur-sm rounded-b-lg border border-[#3A3A3A] border-t-0 ${
          isMobile ? '' : 'max-h-[calc(100vh-200px)] overflow-y-auto'
        }`}
        style={{
          maxHeight: isMobile ? 'none' : 'calc(100vh - 200px)',
          overflowY: isMobile ? 'visible' : 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: '#4B5563 transparent'
        }}
      >
        <div className="p-3">
          {activeTab === 'all' || activeTab === 'basic' ?
            renderComponents(visibleComponents.basic || [], 'basic', t.basic) : null}
          {activeTab === 'all' || activeTab === 'tools' ?
            renderComponents(visibleComponents.tools || [], 'tools', t.tools) : null}
          {activeTab === 'all' || activeTab === 'flow' ?
            renderComponents(visibleComponents.flow || [], 'flow', t.flow) : null}
          {activeTab === 'all' || activeTab === 'data' ?
            renderComponents(visibleComponents.data || [], 'data', t.data) : null}
          {activeTab === 'all' || activeTab === 'apps' ?
            renderComponents(visibleComponents.apps || [], 'apps', t.apps) : null}
          {activeTab === 'all' || activeTab === 'etc' ?
            renderComponents(visibleComponents.etc || [], 'etc', t.etc) : null}
        </div>
      </div>
    </div>
  )
}
