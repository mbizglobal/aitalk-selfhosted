'use client'

import { useEdition } from '@/components/EditionProvider'
import React, { useMemo, useState, useEffect } from 'react'
import { X, ExternalLink, AlertTriangle, GripHorizontal, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { isAiNode, isSourceNode } from '../utils'
import { findFirstAiNodeFrom } from '../utils/nodeUtils'
import {
  LLM_PROVIDER_REGISTRY,
  getProviderList,
  getProviderModels,
} from '@/lib/ai-providers/core/registry'
import type { LLMProviderType } from '@/lib/ai-providers/core/types'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { isQuizAllowedModel, QUIZ_ALLOWED_MODELS } from '@/lib/workflow/validate-quiz-model'
import { useDraggable } from '../hooks/useDraggable'
import { MANAGED_REGIONS, getDataLocation } from '@/lib/managed/regions'
import { getOutputMultiplier, quizGenerationCPAFromSettings } from '@/lib/managed/cost'
import { isMiniAppNodeOfType } from '@/lib/workflow/mini-app-registry'
import { isGptReasoningFamily, replaceRetiredChatModel } from '@/lib/managed/model-lineup'

const MANAGED_MODEL_DISPLAY: Record<string, { name: string; cpaCost: number }> = {
  'gpt-4.1-mini': { name: 'GPT-4.1 Mini', cpaCost: 1 },
  'gpt-4.1': { name: 'GPT-4.1', cpaCost: 1 },
  'gpt-6-luna': { name: 'GPT-6 Luna', cpaCost: 1 },
  'gpt-6-sol': { name: 'GPT-6 Sol', cpaCost: 1 },
  'gpt-5.1': { name: 'GPT-5.1', cpaCost: 1 },
  'gpt-5.4-mini': { name: 'GPT-5.4 Mini', cpaCost: 1 },
  'gpt-5.4': { name: 'GPT-5.4', cpaCost: 2 },
  'gpt-realtime-2.1': { name: 'GPT Realtime 2.1 (Voice · EU / STT Global)', cpaCost: 15 },
  'gpt-realtime-2.1-mini': { name: 'GPT Realtime 2.1 Mini (Voice)', cpaCost: 5 },
}

const RAG_LLM_MAPPING: Record<RAGProviderType, LLMProviderType | null> = {
  'none': null,
  'openai_vector_store': 'openai',
  'gemini_file_search': 'gemini',
  'pinecone': null,
  'qdrant': null,
  'weaviate': null,
  'milvus': null,
  'chromadb': null,
}

export function ModelSettingsModal() {
  const { ui, agent, workflow, nodeHandlers, reloadWorkflow } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const selfHosted = useEdition() === 'selfhosted'

  const activeAiNode = useMemo(
    () =>
      workflow.nodes.find(node => node.id === workflow.selectedNode && isAiNode(node)) ||
      workflow.nodes.find(isAiNode),
    [workflow.nodes, workflow.selectedNode]
  )

  const providers = useMemo(() => getProviderList(), [])

  // Local state for model settings
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType>('openai')
  const [selectedModel, setSelectedModel] = useState('gpt-6-luna')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [topP, setTopP] = useState(1.0)
  const [topK, setTopK] = useState(40)
  const [effort, setEffort] = useState('medium')
  const [verbosity, setVerbosity] = useState('medium')
  const [summary, setSummary] = useState('auto')
  const [storeLogs, setStoreLogs] = useState(false)

  const [ragProvider, setRagProvider] = useState<RAGProviderType>('openai_vector_store')
  const [loadingRagProvider, setLoadingRagProvider] = useState(true)

  const [hasApiKey, setHasApiKey] = useState(true)
  const [checkingApiKey, setCheckingApiKey] = useState(false)

  const [isManaged, setIsManaged] = useState(false)
  const [managedRegion, setManagedRegion] = useState<string | null>(null)

  const hasSourceNode = useMemo(
    () => workflow.nodes.some(isSourceNode),
    [workflow.nodes]
  )

  const managedRegionInfo = useMemo(() => {
    if (!isManaged || !managedRegion) return null
    return MANAGED_REGIONS.find(r => r.id === managedRegion) || null
  }, [isManaged, managedRegion])

  const pstnStartNode = useMemo(
    () =>
      workflow.nodes.find(
        (n) => n.data?.nodeType === 'start' && n.data?.triggerType === 'pstn'
      ),
    [workflow.nodes]
  )
  const isPstnMode = !!pstnStartNode

  const attachedQuizNode = useMemo(() => {
    if (!activeAiNode) return null
    const quizNodes = workflow.nodes.filter(n => isMiniAppNodeOfType(n, 'quiz'))
    if (quizNodes.length === 0) return null
    const edge = workflow.edges.find(
      e => e.source === activeAiNode.id && e.sourceHandle === 'miniapps' && quizNodes.some(q => q.id === e.target)
    )
    return edge ? quizNodes.find(q => q.id === edge.target) ?? null : null
  }, [activeAiNode, workflow.nodes, workflow.edges])
  const hasQuizAttached = !!attachedQuizNode

  const managedModels = useMemo(() => {
    if (!managedRegionInfo) return []
    return (managedRegionInfo.models as readonly string[])
      .filter(modelId => !hasQuizAttached || isQuizAllowedModel(modelId))
      .map(modelId => ({
        id: modelId,
        name: MANAGED_MODEL_DISPLAY[modelId]?.name || modelId,
        cpaCost: MANAGED_MODEL_DISPLAY[modelId]?.cpaCost || 1,
      }))
  }, [managedRegionInfo, hasQuizAttached])

  const isPstnFirstAi = useMemo(() => {
    if (!activeAiNode) return false
    const allPstnStartNodes = workflow.nodes.filter(
      (n) => n.data?.nodeType === 'start' && n.data?.triggerType === 'pstn'
    )
    return allPstnStartNodes.some((pstn) => {
      const first = findFirstAiNodeFrom(pstn.id, workflow.nodes, workflow.edges)
      return first?.id === activeAiNode.id
    })
  }, [activeAiNode, workflow.nodes, workflow.edges])

  const isCurrentModelRealtime = /^gpt-realtime/i.test(selectedModel)

  const filteredManagedModels = useMemo(() => {
    return isCurrentModelRealtime
      ? managedModels.filter(m => /^gpt-realtime/i.test(m.id))
      : managedModels.filter(m => !/^gpt-realtime/i.test(m.id))
  }, [managedModels, isCurrentModelRealtime])

  const availableModels = useMemo(
    () => isManaged ? [] : getProviderModels(selectedProvider),
    [selectedProvider, isManaged]
  )

  const filteredAvailableModels = useMemo(() => {
    return isCurrentModelRealtime
      ? availableModels.filter(m => /^gpt-realtime/i.test(m.id))
      : availableModels.filter(m => !/^gpt-realtime/i.test(m.id))
  }, [availableModels, isCurrentModelRealtime])

  const providerCapabilities = useMemo(
    () => LLM_PROVIDER_REGISTRY[selectedProvider]?.capabilities,
    [selectedProvider]
  )

  const providerDocsUrl = useMemo(
    () => LLM_PROVIDER_REGISTRY[selectedProvider]?.docsUrl,
    [selectedProvider]
  )

  const getProviderFromModel = (modelId: string): LLMProviderType => {
    for (const [providerId, provider] of Object.entries(LLM_PROVIDER_REGISTRY)) {
      if (provider.models.some(m => m.id === modelId)) {
        return providerId as LLMProviderType
      }
    }
    return 'openai'
  }

  useEffect(() => {
    if (!ui.showModelSettingsModal) return

    const fetchUserInfo = async () => {
      try {
        const response = await fetch('/api/dashboard/user-info')
        if (response.ok) {
          const data = await response.json()
          const sv = data.data?.serviceVariant
          const region = data.data?.managedRegion
          setIsManaged(sv === 'managed')
          setManagedRegion(region || null)
        }
      } catch (error) {
        console.error('Failed to fetch user info:', error)
      }
    }

    fetchUserInfo()
  }, [ui.showModelSettingsModal])

  useEffect(() => {
    if (!ui.showModelSettingsModal) return

    const fetchRagProvider = async () => {
      setLoadingRagProvider(true)
      try {
        const response = await fetch('/api/storage/rag-provider')
        if (response.ok) {
          const data = await response.json()
          setRagProvider(data.defaultProvider || 'openai_vector_store')
        }
      } catch (error) {
        console.error('Failed to fetch RAG provider:', error)
      } finally {
        setLoadingRagProvider(false)
      }
    }

    fetchRagProvider()
  }, [ui.showModelSettingsModal])

  // Sync with active AI node data on modal open
  useEffect(() => {
    if (!ui.showModelSettingsModal || !activeAiNode) return
    if (isManaged && !managedRegionInfo) return

    const nodeData = activeAiNode.data

    if (isManaged && managedRegionInfo) {
      setSelectedProvider('openai')
      const regionModels = managedRegionInfo.models as readonly string[]
      const validModels: string[] = [...regionModels]
      const currentModel = replaceRetiredChatModel(nodeData.model || agent.aiModel || '')
      if (validModels.includes(currentModel)) {
        setSelectedModel(currentModel)
      } else {
        setSelectedModel(validModels.includes('gpt-6-luna') ? 'gpt-6-luna' : validModels[0])
      }
    } else {
      const model = nodeData.model || agent.aiModel || 'gpt-4o-mini'
      const provider = nodeData.provider || getProviderFromModel(model)
      setSelectedProvider(provider)
      setSelectedModel(model)
    }

    setTemperature(nodeData.temperature ?? agent.aiTemperature ?? 0.7)
    const storedMaxTokens = nodeData.maxTokens || agent.aiMaxTokens || 2048
    setMaxTokens(isManaged ? Math.min(storedMaxTokens, 4096) : storedMaxTokens)
    setTopP(nodeData.topP ?? 1.0)
    setTopK(nodeData.topK ?? 40)
    setEffort(nodeData.effort || 'medium')
    setVerbosity(nodeData.verbosity || 'medium')
    setSummary(nodeData.summary || 'auto')
    setStoreLogs(nodeData.storeLogs ?? false)
  }, [ui.showModelSettingsModal, activeAiNode, agent, isManaged, managedRegionInfo, isPstnMode])

  useEffect(() => {
    if (isManaged) return
    if (availableModels.length > 0) {
      const currentModelInProvider = availableModels.find(m => m.id === selectedModel)
      if (!currentModelInProvider) {
        setSelectedModel(availableModels[0].id)
      }
    }
  }, [selectedProvider, availableModels, selectedModel, isManaged])

  useEffect(() => {
    if (!ui.showModelSettingsModal) return

    if (isManaged) {
      setHasApiKey(true)
      setCheckingApiKey(false)
      return
    }

    const checkApiKeyStatus = async () => {
      setCheckingApiKey(true)
      try {
        const response = await fetch(`/api/storage/check-api-key?provider=${selectedProvider}`)
        if (response.ok) {
          const data = await response.json()
          setHasApiKey(data.hasApiKey)
        } else {
          setHasApiKey(false)
        }
      } catch (error) {
        console.error('Failed to check API key:', error)
        setHasApiKey(false)
      } finally {
        setCheckingApiKey(false)
      }
    }

    checkApiKeyStatus()
  }, [ui.showModelSettingsModal, selectedProvider, isManaged])

  const updateSelectedAiNodeData = (data: any) => {
    if (activeAiNode) {
      nodeHandlers.updateNodeData(activeAiNode.id, data)
    }
  }

  const handleSave = () => {
    const data: any = {
      provider: selectedProvider,
      model: selectedModel,
      storeLogs,
      maxTokens
    }

    if (selectedProvider === 'openai' && isGptReasoningFamily(selectedModel)) {
      data.effort = effort
      data.verbosity = verbosity
      data.summary = summary
    } else {
      data.temperature = temperature
      data.topP = topP
      if (selectedProvider === 'gemini') {
        data.topK = topK
      }
    }

    updateSelectedAiNodeData(data)
    agent.setAiModel(selectedModel)
    agent.setAiTemperature(temperature)
    agent.setAiMaxTokens(maxTokens)

    ui.setShowModelSettingsModal(false)
  }

  const isGpt5 = selectedProvider === 'openai' && isGptReasoningFamily(selectedModel)

  const isGemini = selectedProvider === 'gemini'

  const supportsStoreLogs = ['openai', 'gemini', 'grok'].includes(selectedProvider) && !isPstnMode

  const isProviderImplemented = ['openai', 'gemini', 'claude', 'deepseek', 'grok'].includes(selectedProvider)

  const ragLlmMismatch = useMemo(() => {
    if (!hasSourceNode) return null

    const requiredLlm = RAG_LLM_MAPPING[ragProvider]

    if (requiredLlm === null) return null

    if (selectedProvider !== requiredLlm) {
      return {
        ragProvider,
        selectedLlm: selectedProvider,
        requiredLlm,
        ragProviderName: ragProvider === 'openai_vector_store' ? 'OpenAI Vector Store' : 'Gemini File Search',
        requiredLlmName: requiredLlm === 'openai' ? 'OpenAI' : 'Google Gemini',
        selectedLlmName: LLM_PROVIDER_REGISTRY[selectedProvider]?.name || selectedProvider,
      }
    }

    return null
  }, [hasSourceNode, ragProvider, selectedProvider])

  const canSave = isManaged
    ? managedModels.length > 0
    : isProviderImplemented && !ragLlmMismatch && !loadingRagProvider && hasApiKey && !checkingApiKey

  const maxOutputTokensField = !isPstnMode ? (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-200">{t.max_output_tokens}</label>
        <span className="text-sm text-gray-400">{maxTokens.toLocaleString()}</span>
      </div>
      <input
        type="range"
        min="512"
        max={isManaged ? 4096 : 65536}
        step="512"
        value={Math.min(Math.max(maxTokens, 512), isManaged ? 4096 : 65536)}
        onChange={(e) => setMaxTokens(parseInt(e.target.value))}
        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
      />
      {(() => {
        const sliderMax = isManaged ? 4096 : 65536
        const ticks: Array<[number, string]> = isManaged
          ? [[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K']]
          : [[512, '512'], [8192, '8K'], [32768, '32K'], [65536, '66K']]
        return (
          <div className="relative h-4 mt-1 text-xs text-gray-400">
            {ticks.map(([value, label], i) => {
              if (i === 0) return <span key={label} className="absolute left-0">{label}</span>
              if (i === ticks.length - 1) return <span key={label} className="absolute right-0">{label}</span>
              const f = (value - 512) / (sliderMax - 512)
              return (
                <span
                  key={label}
                  className="absolute -translate-x-1/2"
                  style={{ left: `calc(${(f * 100).toFixed(2)}% - ${((f - 0.5) * 16).toFixed(2)}px)` }}
                >
                  {label}
                </span>
              )
            })}
          </div>
        )
      })()}
      {isManaged && (() => {
        const baseCpa = managedModels.find(m => m.id === selectedModel)?.cpaCost ?? 1
        const maxCpa = baseCpa * getOutputMultiplier(Math.min(maxTokens, 4096))
        return (
          <p className="text-xs text-gray-500 mt-1.5">
            {t.managed_cpa_cost_max?.replace('{max}', String(maxCpa))}
          </p>
        )
      })()}
    </div>
  ) : null

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showModelSettingsModal })

  if (!ui.showModelSettingsModal) return null

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
              <h2 className="text-lg font-semibold text-gray-200">{t.model_settings}</h2>
              <p className="text-sm text-gray-400 mt-1">{t.configure_model_desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (ui.hasChanges && !window.confirm(t.reload_discard_confirm || t.unsaved_changes_confirm)) return
                await reloadWorkflow()
              }}
              className="p-1.5 rounded transition-colors text-gray-400 hover:text-gray-200"
              title={t.reload_workflow || 'Reload from server'}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={() => ui.setShowModelSettingsModal(false)}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
          {isPstnMode && (() => {
            const isRealtimeSelected = /^gpt-realtime/i.test(selectedModel)
            const rtCpa = managedModels.find(m => m.id === selectedModel)?.cpaCost ?? 15
            const desc = isRealtimeSelected
              ? (t.pstn_voice_mode_desc_realtime || t.pstn_voice_mode_desc).replace('{cpa}', String(rtCpa))
              : t.pstn_voice_mode_desc
            return (
              <div className="flex items-start gap-2 p-3 rounded-lg border bg-emerald-500/10 border-emerald-500/30">
                <span className="text-base leading-none mt-0.5">📞</span>
                <div className="text-xs text-gray-300 space-y-1">
                  <div className="font-semibold text-gray-100">{t.pstn_voice_mode_title}</div>
                  <p className="whitespace-pre-line">{desc}</p>
                </div>
              </div>
            )
          })()}

          {selfHosted ? (
            <div className="p-3 bg-[#1A1A1A] rounded-lg border border-gray-700 text-sm text-gray-200">
              {t.model_installation_ai_connection || 'Installation AI connection'}
            </div>
          ) : (
          <>
          {/* Provider Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-200">{t.ai_provider}</label>
              {!isManaged && providerDocsUrl && (
                <a
                  href={providerDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  {t.docs} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            {isManaged ? (
              <>
                <div className="w-full px-4 py-3 border border-[#3A3A3A] rounded-md bg-[#2A2A2A] text-gray-200 cursor-not-allowed">
                  <div className="flex items-center justify-between">
                    <span>{t.managed_provider_label}</span>
                    <span className="text-sm text-gray-400">Managed</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">{t.managed_provider_desc}</p>
              </>
            ) : (
              <>
                <select
                  className="w-full px-4 py-3 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value as LLMProviderType)}
                >
                  {providers.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                {/* Provider Capabilities */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {providerCapabilities?.rag && (
                    <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">{t.rag}</span>
                  )}
                  {providerCapabilities?.webSearch && (
                    <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">{t.web_search}</span>
                  )}
                  {providerCapabilities?.vision && (
                    <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">{t.vision}</span>
                  )}
                  {providerCapabilities?.functionCalling && (
                    <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">{t.functions}</span>
                  )}
                  {!isProviderImplemented && (
                    <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded">{t.coming_soon}</span>
                  )}
                </div>
              </>
            )}
          </div>

          {!isManaged && !hasApiKey && !checkingApiKey && isProviderImplemented && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-yellow-400">
                    {t.api_key_not_configured?.replace('{provider}', LLM_PROVIDER_REGISTRY[selectedProvider]?.name || selectedProvider)}
                  </p>
                  <p className="text-sm text-yellow-300">
                    {t.api_key_not_configured_desc?.replace('{provider}', LLM_PROVIDER_REGISTRY[selectedProvider]?.name || selectedProvider)}
                    {' '}
                    <a
                      href="/app/settings?tab=api-key"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-yellow-400 hover:text-yellow-300 underline"
                    >
                      {t.configure_in_settings}
                    </a>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Model Selection */}
          <div>
            <label className="text-sm font-medium text-gray-200 mb-2 block">{t.model}</label>
            {isManaged ? (
              <>
                <select
                  className="w-full px-4 py-3 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {filteredManagedModels.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                {hasQuizAttached && !isQuizAllowedModel(selectedModel) && (
                  <p className="text-xs text-red-400 mt-1.5">
                    {t.quiz_model_not_supported
                      .replace('{model}', selectedModel || '(none)')
                      .replace('{allowed}', QUIZ_ALLOWED_MODELS.join(', '))}
                  </p>
                )}
                {isPstnFirstAi && (
                  <p className="text-xs text-gray-500 mt-1.5">
                    {isCurrentModelRealtime
                      ? 'Realtime mode — switch to Talk (STT+TTS) using the PSTN node Pipeline toggle.'
                      : 'Talk (STT+TTS) mode — switch to Realtime using the PSTN node Pipeline toggle.'}
                  </p>
                )}
                {(() => {
                  const modelInfo = managedModels.find(m => m.id === selectedModel)
                  if (!modelInfo) return null
                  const regionId = managedRegion || ''
                  const location = getDataLocation(regionId, modelInfo.id)
                  const colorClass = location.type === 'standard'
                    ? 'text-green-400'
                    : location.type === 'eu' || location.type === 'us'
                      ? 'text-yellow-400'
                      : 'text-sky-400'
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        {isPstnMode ? (
                          <span />
                        ) : (
                          <span className="text-gray-400">
                            {t.managed_cpa_cost?.replace('{cost}', String(modelInfo.cpaCost))}
                          </span>
                        )}
                        <span className={colorClass}>
                          {location.label}
                        </span>
                      </div>
                      {attachedQuizNode && (() => {
                        const qd = (attachedQuizNode.data || {}) as any
                        const count = Math.min(20, Math.max(1, parseInt(String(qd.questionCount), 10) || 5))
                        const studyKey = ['none', 'short', 'standard', 'deep'].includes(qd.studyLength)
                          ? qd.studyLength
                          : (qd.includeStudy === false ? 'none' : 'standard')
                        return (
                          <p className="text-xs text-amber-300">
                            {((t as any).quiz_cpa_model_line || 'Quiz: {cpa} credits per quiz generation ({count} questions, study material: {study})')
                              .replace('{cpa}', String(quizGenerationCPAFromSettings(qd, selectedModel)))
                              .replace('{count}', String(count))
                              .replace('{study}', (t as any)[`quiz_study_len_${studyKey}`] || studyKey)}
                          </p>
                        )
                      })()}
                      <p className={`text-xs ${colorClass}`}>
                        {location.description}
                      </p>
                    </div>
                  )
                })()}
              </>
            ) : (
              <>
                <select
                  className="w-full px-4 py-3 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {filteredAvailableModels.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                {isPstnFirstAi && (
                  <p className="text-xs text-gray-500 mt-1.5">
                    {isCurrentModelRealtime
                      ? 'Realtime mode — switch to Talk (STT+TTS) using the PSTN node Pipeline toggle.'
                      : 'Talk (STT+TTS) mode — switch to Realtime using the PSTN node Pipeline toggle.'}
                  </p>
                )}
                {/* Selected model info */}
                {(() => {
                  const modelInfo = availableModels.find(m => m.id === selectedModel)
                  if (!modelInfo) return null
                  return (
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
                      {modelInfo.pricing ? (
                        <>
                          <span>Input: ${modelInfo.pricing.input}/1M</span>
                          <span>• Output: ${modelInfo.pricing.output}/1M</span>
                        </>
                      ) : (
                        <>
                          {modelInfo.contextWindow && (
                            <span>{t.context} {(modelInfo.contextWindow / 1000).toFixed(0)}K</span>
                          )}
                          {modelInfo.maxOutputTokens && (
                            <span>• {t.max_output} {(modelInfo.maxOutputTokens / 1000).toFixed(0)}K</span>
                          )}
                        </>
                      )}
                      {selectedProvider === 'openai' && isGptReasoningFamily(selectedModel) && (
                        <a
                          href="https://help.openai.com/en/articles/10910291-api-organization-verification"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-500 hover:text-gray-400 transition-colors ml-auto"
                          title="OpenAI Organization Verification"
                        >
                          • {t.gpt5_kyc_required} ↗
                        </a>
                      )}
                    </div>
                  )
                })()}
              </>
            )}
          </div>
          </>
          )}

          {/* GPT-5 Settings */}
          {isGpt5 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-200 mb-2 block">{t.effort}</label>
                  <select
                    value={effort}
                    onChange={(e) => setEffort(e.target.value)}
                    className="w-full px-4 py-3 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="low">{t.low}</option>
                    <option value="medium">{t.medium}</option>
                    <option value="high">{t.high}</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-200 mb-2 block">{t.verbosity}</label>
                  <select
                    value={verbosity}
                    onChange={(e) => setVerbosity(e.target.value)}
                    className="w-full px-4 py-3 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="low">{t.low}</option>
                    <option value="medium">{t.medium}</option>
                    <option value="high">{t.high}</option>
                  </select>
                </div>
              </div>

              {maxOutputTokensField}

              {supportsStoreLogs && (
                <div className="flex items-center justify-between p-4 bg-[#1A1A1A] rounded-lg">
                  <label className="text-sm font-medium text-gray-200">{t.store_logs}</label>
                  <input
                    type="checkbox"
                    checked={storeLogs}
                    onChange={(e) => setStoreLogs(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#3A3A3A] border-[#3A3A3A]"
                  />
                </div>
              )}
            </>
          )}

          {/* GPT-4 Settings */}
          {!isGpt5 && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-200">{t.temperature}</label>
                  <span className="text-sm text-gray-400">{temperature.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>{t.precise} (0)</span>
                  <span>{t.balanced} (1)</span>
                  <span>{t.creative} (2)</span>
                </div>
              </div>

              {maxOutputTokensField}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-200">{t.top_p}</label>
                  <span className="text-sm text-gray-400">{topP.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={topP}
                  onChange={(e) => setTopP(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0</span>
                  <span>1</span>
                </div>
              </div>

              {isGemini && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-200">{t.top_k}</label>
                    <span className="text-sm text-gray-400">{topK}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>1</span>
                    <span>100</span>
                  </div>
                </div>
              )}

              {supportsStoreLogs && (
                <div className="flex items-center justify-between p-4 bg-[#1A1A1A] rounded-lg">
                  <label className="text-sm font-medium text-gray-200">{t.store_logs}</label>
                  <input
                    type="checkbox"
                    checked={storeLogs}
                    onChange={(e) => setStoreLogs(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#3A3A3A] border-[#3A3A3A]"
                  />
                </div>
              )}
            </>
          )}

          {!isManaged && !isProviderImplemented && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-sm text-yellow-400">
                {LLM_PROVIDER_REGISTRY[selectedProvider]?.name} {t.support_coming_soon}
              </p>
            </div>
          )}

          {!isManaged && ragLlmMismatch && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-red-400">
                    {t.rag_llm_mismatch}
                  </p>
                  <p className="text-sm text-red-300">
                    {t.rag_mismatch_desc.replace('{ragProvider}', ragLlmMismatch.ragProviderName).replace('{requiredLlm}', ragLlmMismatch.requiredLlmName)}
                  </p>
                  <p className="text-sm text-red-300">
                    {t.rag_mismatch_selected.replace('{selectedLlm}', ragLlmMismatch.selectedLlmName)}
                  </p>
                  <div className="pt-2 space-y-2">
                    <p className="text-xs text-gray-400">{t.rag_mismatch_fix}</p>
                    <ul className="text-xs text-gray-400 list-disc list-inside space-y-1">
                      <li>{t.rag_mismatch_option1.replace('{requiredLlm}', ragLlmMismatch.requiredLlmName)}</li>
                      <li>{t.rag_mismatch_option2}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[#3A3A3A] flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => ui.setShowModelSettingsModal(false)}
            className="border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A]"
          >
            {t.cancel}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className={!canSave ? 'opacity-50 cursor-not-allowed' : ''}
          >
            {t.save}
          </Button>
        </div>
      </div>
    </div>
  )
}
