'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { useEdition } from '@/components/EditionProvider'
import { offFeatureFor } from '@/lib/edition-features'
import type { Node } from 'reactflow'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { ImageIcon, FileSearch, Maximize2, FileJson, FileText, Settings2 } from 'lucide-react'
import { LLM_PROVIDER_REGISTRY } from '@/lib/ai-providers/core/registry'
import type { LLMProviderType } from '@/lib/ai-providers/core/types'
import { getNodeTypeEmoji, getNodeTypeColor, parseTextToTokens } from '../../utils/analyzeDependencies'
import { MANAGED_REGIONS } from '@/lib/managed/regions'
import { miniAppChannelOf, miniAppsForChannel } from '@/lib/workflow/mini-app-registry'
import { isGptReasoningFamily, replaceRetiredChatModel } from '@/lib/managed/model-lineup'

const MANAGED_MODEL_DISPLAY: Record<string, string> = {
  'gpt-6-luna': 'GPT-6 Luna',
  'gpt-6-sol': 'GPT-6 Sol',
  'gpt-realtime-2.1': 'GPT Realtime 2.1 (Voice · EU)',
  'gpt-realtime-2.1-mini': 'GPT Realtime 2.1 Mini (Voice)',
}

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

function renderTextWithChips(
  text: string,
  nodes: any[]
): React.ReactNode[] {
  const tokens = parseTextToTokens(text, nodes)
  return tokens.map((token, idx) =>
    token.type === 'text' ? (
      <span key={idx}>{token.value}</span>
    ) : (
      <span
        key={idx}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 text-xs rounded border align-middle ${getNodeTypeColor(token.nodeType || 'unknown')}`}
      >
        <span className="text-[10px]">{getNodeTypeEmoji(token.nodeType || 'unknown')}</span>
        <span className="truncate max-w-[80px]">{token.nodeName}</span>
      </span>
    )
  )
}

export const AiNodePanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { ui, workflow, agent } = useWorkflowContext()
  const { lang, t: mainT } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const data = node.data || {}
  const isLoopTool = data.isLoopTool === true

  const [isManaged, setIsManaged] = useState(false)
  const [managedRegion, setManagedRegion] = useState<string | null>(null)

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        const response = await fetch('/api/dashboard/user-info')
        if (response.ok) {
          const data = await response.json()
          setIsManaged(data.data?.serviceVariant === 'managed')
          setManagedRegion(data.data?.managedRegion || null)
        }
      } catch (error) {
        console.error('Failed to fetch user info:', error)
      }
    }
    fetchUserInfo()
  }, [])

  const managedRegionInfo = useMemo(() => {
    if (!isManaged || !managedRegion) return null
    return MANAGED_REGIONS.find(r => r.id === managedRegion) || null
  }, [isManaged, managedRegion])

  const managedDefaultModel = managedRegionInfo ? (managedRegionInfo.models as readonly string[])[0] : null

  const currentProvider = (data.provider || 'openai') as LLMProviderType
  const currentModel = data.model || ''

  const supportsVision = (() => {
    const providerDef = LLM_PROVIDER_REGISTRY[currentProvider]
    if (!providerDef?.capabilities?.vision) return false
    if (currentModel) {
      const modelDef = providerDef.models.find(m => m.id === currentModel)
      if (modelDef && !modelDef.vision) return false
    }
    return true
  })()

  const supportsTools = true

  const supportsJsonOutput = true

  const displaySystemMessage =
    data.systemMessage && data.systemMessage !== 'You are a helpful assistant'
      ? data.systemMessage
      : mainT.default_system_message || 'You are a helpful assistant'

  const connectedToolEdges = workflow.edges.filter(
    e => e.source === node.id && e.sourceHandle === 'tools'
  )
  const connectedToolNodeIds = connectedToolEdges.map(e => e.target)
  const connectedToolNodes = workflow.nodes.filter(n =>
    connectedToolNodeIds.includes(n.id) && n.type === 'tool'
  )

  const edition = useEdition()
  const isPstnMode = workflow.nodes.some(
    (n: any) => n.data?.nodeType === 'start' && n.data?.triggerType === 'pstn'
  )

  const miniAppChannel = miniAppChannelOf(workflow.nodes)
  const showMiniAppSection = !!miniAppChannel
    && miniAppsForChannel(miniAppChannel).filter((a) => !offFeatureFor('miniApps', a, edition)).length > 0
    && isManaged && !isLoopTool
  const connectedMiniAppEdges = workflow.edges.filter(
    e => e.source === node.id && e.sourceHandle === 'miniapps'
  )
  const connectedMiniAppNodeIds = connectedMiniAppEdges.map(e => e.target)
  const connectedMiniAppNodes = workflow.nodes.filter(n =>
    connectedMiniAppNodeIds.includes(n.id) && n.type === 'tool' && n.data?.nodeType === 'miniapp'
  )

  const calendarToolNodeCount = connectedToolNodes.filter(
    (n: any) => n.data?.toolType === 'google_calendar' || n.data?.toolType === 'microsoft_calendar'
  ).length
  const showRoutingMode = calendarToolNodeCount >= 2
  const calendarRoutingMode = (data.calendarRoutingMode as string) || 'ask'

  // Tool toggle handler
  const handleToolToggle = (toolKey: 'imageInput' | 'pdfInput' | 'csvInput') => {
    const currentValue = data[toolKey] || false
    updateNodeData({ [toolKey]: !currentValue })
  }

  return (
    <div className="space-y-4">
      {!isPstnMode && (
        <div>
          <label className="text-sm font-medium text-gray-200 mb-2 block">{t.output_format}</label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="aiOutputFormat"
                value="text"
                checked={(data.outputFormat || 'text') === 'text'}
                onChange={(e) => updateNodeData({ outputFormat: 'text' })}
                className="w-4 h-4 text-primary"
              />
              <span className="text-sm text-gray-200">{t.text}</span>
            </label>
            {supportsJsonOutput && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="aiOutputFormat"
                  value="json"
                  checked={data.outputFormat === 'json'}
                  onChange={(e) => updateNodeData({ outputFormat: 'json' })}
                  className="w-4 h-4 text-primary"
                />
                <span className="text-sm text-gray-200">{t.json_structured}</span>
              </label>
            )}
          </div>
        </div>
      )}

      {!isPstnMode && data.outputFormat === 'json' && (
        <div>
          <label className="text-sm font-medium text-gray-200 mb-2 block">{t.json_schema}</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-10"
              onClick={() => ui.setShowJsonSchemaModal(true)}
            >
              <FileJson className="w-4 h-4 mr-2 text-purple-400" />
              {data.schemaName || 'json_schema'}
            </Button>
            <span
              className="text-sm text-gray-400 cursor-pointer hover:text-gray-200"
              onClick={() => ui.setShowJsonSchemaModal(true)}
            >
              {t.edit}
            </span>
          </div>

          {/* JSON Options Button */}
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3 border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-between h-auto py-3"
            onClick={() => ui.openModal('jsonOptions')}
          >
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-gray-400" />
              <div className="flex flex-col items-start gap-0.5">
                <span className="text-sm font-medium">{t.output_options}</span>
                <span className="text-xs text-gray-400">
                  {data.saveAs ? `${t.save_as} ${data.saveAs}` : t.configure_save_load}
                  {(data.saveTempStorage || data.loadTempStorage) && (
                    <span className="ml-1">
                      {data.saveTempStorage && `• ${t.save}`}
                      {data.loadTempStorage && '• Load'}
                    </span>
                  )}
                </span>
              </div>
            </div>
            <span className="text-xs text-gray-400 hover:text-gray-200">{t.edit}</span>
          </Button>
        </div>
      )}


      {/* System Message */}
      <div>
        <label className="text-sm font-medium text-gray-200 mb-1 block">{t.system_message}</label>
        <div
          className="relative w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 min-h-[100px] cursor-pointer hover:border-gray-500 transition-colors overflow-hidden"
          onClick={() => ui.openModal('instructions')}
        >
          <div className="text-sm whitespace-pre-wrap break-words line-clamp-4 pr-6">
            {renderTextWithChips(displaySystemMessage, workflow.nodes)}
          </div>
          <div className="absolute bottom-2 right-2 bg-[#3A3A3A] rounded p-0.5">
            <Maximize2 className="w-4 h-4 text-gray-400 hover:text-gray-200" />
          </div>
        </div>
      </div>

      {!isPstnMode && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-200">{t.include_chat_history}</label>
            <input
              type="checkbox"
              className="w-4 h-4 rounded bg-[#3A3A3A] border-[#3A3A3A]"
              checked={data.includeChatHistory ?? true}
              onChange={(e) => updateNodeData({ includeChatHistory: e.target.checked })}
            />
          </div>
        </div>
      )}

      {/* Model Settings */}
      <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">{t.model}</label>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-between h-auto py-3"
          onClick={() => ui.openModal('modelSettings')}
        >
          <div className="flex flex-col items-start gap-1 flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 max-w-full">
              {edition === 'selfhosted' ? (
                <span className="text-sm font-medium truncate">{t.model_installation_ai_connection || 'Installation AI connection'}</span>
              ) : isManaged ? (
                <>
                  {/* Managed: Azure OpenAI */}
                  <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded flex-shrink-0">
                    Azure OpenAI
                  </span>
                  <span className="text-sm font-medium truncate">
                    {MANAGED_MODEL_DISPLAY[replaceRetiredChatModel(data.model || '')] || MANAGED_MODEL_DISPLAY[managedDefaultModel || ''] || data.model || managedDefaultModel || 'GPT-6 Luna'}
                  </span>
                </>
              ) : (
                <>
                  {/* Self: Provider Badge */}
                  {data.provider && data.provider !== 'openai' && (
                    <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded flex-shrink-0">
                      {LLM_PROVIDER_REGISTRY[data.provider as LLMProviderType]?.name || data.provider}
                    </span>
                  )}
                  <span className="text-sm font-medium truncate">{data.model || agent.aiModel || 'gpt-4o-mini'}</span>
                </>
              )}
            </div>
            <span className="text-xs text-gray-400">
              {isManaged
                ? `Effort: ${data.effort || 'medium'} • Tokens: ${data.maxTokens || 2048}`
                : (data.provider === 'openai' || !data.provider) && isGptReasoningFamily(data.model || agent.aiModel || '')
                  ? `Effort: ${data.effort || 'medium'} • Verbosity: ${data.verbosity || 'medium'}`
                  : data.provider === 'gemini'
                    ? `Temp: ${(data.temperature ?? 0.7).toFixed(2)} • TopK: ${data.topK || 40}`
                    : `Temp: ${(data.temperature ?? agent.aiTemperature ?? 0.7).toFixed(2)} • Tokens: ${data.maxTokens || agent.aiMaxTokens || 2048}`
              }
            </span>
          </div>
          <span className="text-xs text-gray-400 hover:text-gray-200 flex-shrink-0 ml-2">{t.edit}</span>
        </Button>
      </div>

      {supportsTools && (
        <div>
          <label className="text-sm font-medium text-gray-200 mb-2 block">{t.tools}</label>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-between h-auto py-3"
            onClick={() => ui.openModal('tools', node.id)}
          >
            <div className="flex flex-col items-start gap-1 flex-1 min-w-0">
              {connectedToolNodes.length === 0 ? (
                <span className="text-sm text-gray-400">{t.no_tools_selected}</span>
              ) : (
                <>
                  <span className="text-sm font-medium truncate max-w-full">
                    {connectedToolNodes.slice(0, 3).map(n => n.data.label).join(', ')}
                    {connectedToolNodes.length > 3 && `, +${connectedToolNodes.length - 3} ${t.more}`}
                  </span>
                  <span className="text-xs text-gray-400">{connectedToolNodes.length} {t.selected}</span>
                </>
              )}
            </div>
            <span className="text-xs text-gray-400 hover:text-gray-200 flex-shrink-0 ml-2">{t.edit}</span>
          </Button>
        </div>
      )}

      {showMiniAppSection && (
        <div>
          <label className="text-sm font-medium text-gray-200 mb-2 block">{t.mini_app}</label>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-between h-auto py-3"
            onClick={() => ui.openModal('miniapps', node.id)}
          >
            <div className="flex flex-col items-start gap-1 flex-1 min-w-0">
              {connectedMiniAppNodes.length === 0 ? (
                <span className="text-sm text-gray-400">{t.no_miniapp_selected}</span>
              ) : (
                <>
                  <span className="text-sm font-medium truncate max-w-full">
                    {connectedMiniAppNodes.map(n => n.data.label).join(', ')}
                  </span>
                  <span className="text-xs text-gray-400">{connectedMiniAppNodes.length} {t.selected}</span>
                </>
              )}
            </div>
            <span className="text-xs text-gray-400 hover:text-gray-200 flex-shrink-0 ml-2">{t.edit}</span>
          </Button>
        </div>
      )}

      {showRoutingMode && (
        <div>
          <label className="text-sm font-medium text-gray-200 mb-2 block">
            {t.calendar_routing_mode || 'Multi-Calendar Routing'}
          </label>
          <select
            value={calendarRoutingMode}
            onChange={(e) => updateNodeData({ calendarRoutingMode: e.target.value })}
            className="w-full bg-[#1F1F1F] border border-[#3A3A3A] rounded px-2 py-1.5 text-sm text-gray-200"
          >
            <option value="ask">{t.calendar_routing_mode_ask || 'Ask the caller (recommended)'}</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {t.calendar_routing_mode_ask_hint ||
              'When the caller does not name a calendar, the AI lists the available ones and asks which to use.'}
          </p>
        </div>
      )}

      {!isPstnMode && (
      <div>
        <label className="text-sm font-medium text-gray-200 mb-3 block">{t.file_input}</label>
        <div className="space-y-2">
          {/* Image Input */}
          <div
            className={`flex items-start gap-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A] transition-colors ${
              supportsVision ? 'hover:border-[#4A4A4A] cursor-pointer' : 'opacity-50 cursor-not-allowed'
            }`}
            onClick={() => supportsVision && handleToolToggle('imageInput')}
          >
            <div className="flex-shrink-0 mt-0.5">
              <div className="p-2 rounded bg-blue-500/10">
                <ImageIcon className="w-4 h-4 text-blue-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-200">{t.image_input}</span>
                {supportsVision ? (
                  <input
                    type="checkbox"
                    checked={data.imageInput || false}
                    onChange={() => handleToolToggle('imageInput')}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded bg-[#3A3A3A] border-[#3A3A3A]"
                  />
                ) : (
                  <span className="text-xs text-gray-500">{t.not_supported}</span>
                )}
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                {t.allow_image_upload}
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] text-gray-400 rounded">PNG</span>
                <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] text-gray-400 rounded">JPEG</span>
                <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] text-gray-400 rounded">WEBP</span>
                <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] text-gray-400 rounded">GIF</span>
              </div>
            </div>
          </div>

          {/* PDF Input */}
          <div
            className={`flex items-start gap-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A] transition-colors ${
              supportsVision ? 'hover:border-[#4A4A4A] cursor-pointer' : 'opacity-50 cursor-not-allowed'
            }`}
            onClick={() => supportsVision && handleToolToggle('pdfInput')}
          >
            <div className="flex-shrink-0 mt-0.5">
              <div className="p-2 rounded bg-red-500/10">
                <FileSearch className="w-4 h-4 text-red-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-200">{t.pdf_input}</span>
                {supportsVision ? (
                  <input
                    type="checkbox"
                    checked={data.pdfInput || false}
                    onChange={() => handleToolToggle('pdfInput')}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded bg-[#3A3A3A] border-[#3A3A3A]"
                  />
                ) : (
                  <span className="text-xs text-gray-500">{t.not_supported}</span>
                )}
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                {t.allow_pdf_upload}
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] text-gray-400 rounded">PDF</span>
                <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] text-purple-400 rounded">→ Image</span>
              </div>
            </div>
          </div>

          <div
            className="flex items-start gap-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A] hover:border-[#4A4A4A] transition-colors cursor-pointer"
            onClick={() => handleToolToggle('csvInput')}
          >
            <div className="flex-shrink-0 mt-0.5">
              <div className="p-2 rounded bg-green-500/10">
                <FileText className="w-4 h-4 text-green-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-200">{t.csv_input}</span>
                <input
                  type="checkbox"
                  checked={data.csvInput || false}
                  onChange={() => handleToolToggle('csvInput')}
                  onClick={(e) => e.stopPropagation()}
                  className="w-3.5 h-3.5 rounded bg-[#3A3A3A] border-[#3A3A3A]"
                />
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                {t.allow_csv_upload}
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] text-gray-400 rounded">CSV</span>
                <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] text-green-400 rounded">→ Text</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
