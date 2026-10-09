'use client'

import { useEdition } from '@/components/EditionProvider'
import { offFeatureFor } from '@/lib/edition-features'
import React, { useMemo, useState, useEffect, useCallback } from 'react'
import type { Node } from 'reactflow'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import {
  Globe,
  Files as FilesIcon,
  Cloud,
  ExternalLink,
  Loader2,
  Settings,
  AlertTriangle,
  BookOpen,
  Database,
} from 'lucide-react'
import { getRagProviderIcon } from '@/components/icons/ai-providers'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { getRegionById } from '@/lib/managed/regions'

interface Props {
  node: Node
}

const LINK_KNOWLEDGE_SOURCE: Record<string, string | undefined> = {
  website: 'website',
  'google-drive': 'google_drive',
  sharepoint: 'sharepoint',
  gitbook: 'gitbook',
}

export const SourcePanel: React.FC<Props> = ({ node }) => {
  const { agent, workflow } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const edition = useEdition()
  const selfHosted = edition === 'selfhosted'

  const RAG_PROVIDERS = useMemo(() => [
    {
      id: 'none',
      name: t.not_configured,
      description: t.no_rag_selected,
      iconType: 'none' as const,
      linkedLlm: null,
      docsUrl: null
    },
    {
      id: 'openai_vector_store',
      name: t.openai_vector_store,
      description: t.openai_vector_store_desc,
      iconType: 'openai' as const,
      linkedLlm: 'openai',
      docsUrl: 'https://platform.openai.com/docs/assistants/tools/file-search'
    },
    {
      id: 'gemini_file_search',
      name: t.gemini_file_search,
      description: t.gemini_file_search_desc,
      iconType: 'gemini' as const,
      linkedLlm: 'gemini',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/files'
    },
    {
      id: 'pinecone',
      name: t.pinecone,
      description: t.pinecone_desc,
      iconType: 'pinecone' as const,
      linkedLlm: null,
      docsUrl: 'https://docs.pinecone.io'
    },
    {
      id: 'azure_ai_search',
      name: t.azure_ai_search,
      description: t.azure_ai_search_desc,
      iconType: 'azure_ai_search' as const,
      linkedLlm: null,
      docsUrl: 'https://learn.microsoft.com/en-us/azure/search/'
    }
  ], [t])

  const [isManaged, setIsManaged] = useState(false)
  const [managedRegion, setManagedRegion] = useState<string | null>(null)
  const [managedSearchReady, setManagedSearchReady] = useState(true)

  const [spaces, setSpaces] = useState<Array<{ id: number; name: string; isDefault: boolean }>>([])

  const [selectedProvider, setSelectedProvider] = useState<string>('openai_vector_store')
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [storageStats, setStorageStats] = useState<any>(null)

  const getSelectedAiProvider = useCallback((): string | null => {
    const sourceNodeId = node.id

    const isAiNode = (n: Node): boolean => {
      return n.data?.nodeType === 'ai' || n.data?.label === 'AI'
    }

    const toolEdge = workflow.edges.find(edge =>
      edge.target === sourceNodeId && edge.sourceHandle === 'tools'
    )

    let aiNode = null
    if (toolEdge) {
      aiNode = workflow.nodes.find(n => n.id === toolEdge.source && isAiNode(n))
    }

    if (!aiNode) {
      const connectedEdge = workflow.edges.find(edge => edge.target === sourceNodeId)
      if (connectedEdge) {
        aiNode = workflow.nodes.find(n => n.id === connectedEdge.source && isAiNode(n))
      }
    }

    if (!aiNode) {
      aiNode = workflow.nodes.find(n => isAiNode(n))
    }

    const modelId = aiNode?.data?.model || agent.aiModel || ''

    if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
      return 'openai'
    } else if (modelId.startsWith('gemini') || modelId.startsWith('models/gemini')) {
      return 'gemini'
    } else if (modelId.startsWith('claude')) {
      return 'anthropic'
    } else if (modelId.startsWith('deepseek')) {
      return 'deepseek'
    } else if (modelId.startsWith('grok')) {
      return 'grok'
    }
    return null
  }, [node.id, workflow.edges, workflow.nodes, agent.aiModel])

  const selectedAiProvider = getSelectedAiProvider()

  useEffect(() => {
    const fetchRagProvider = async () => {
      setIsLoading(true)
      try {
        const response = await fetch('/api/storage/rag-provider')
        if (response.ok) {
          const data = await response.json()
          const isManagedUser = !!data.managedRegion
          const settingsProvider = isManagedUser ? 'azure_ai_search' : (data.defaultProvider || 'openai_vector_store')
          setSelectedProvider(settingsProvider)
          setHasApiKey(data.hasApiKey)
          setIsManaged(isManagedUser)
          setManagedRegion(data.managedRegion || null)
          setManagedSearchReady(isManagedUser ? data.defaultProvider === 'azure_ai_search' : true)

          const currentNodeProvider = node.data?.ragProvider
          if (currentNodeProvider !== settingsProvider) {
            workflow.setNodes((nodes: Node[]) =>
              nodes.map((n: Node) =>
                n.id === node.id
                  ? { ...n, data: { ...n.data, ragProvider: settingsProvider } }
                  : n
              )
            )
          }
        }
      } catch (error) {
        console.error('Failed to fetch RAG provider:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchRagProvider()
  }, [node.id, node.data?.ragProvider, workflow])

  useEffect(() => {
    const fetchStorageStats = async () => {
      if (!agent.agentId) return

      try {
        const response = await fetch(`/api/storage/${agent.agentId}/stats`)
        if (response.ok) {
          const stats = await response.json()
          setStorageStats(stats)
        }
      } catch (error) {
        console.error('Failed to load storage stats:', error)
      }
    }

    fetchStorageStats()
  }, [agent.agentId])

  useEffect(() => {
    if (!isManaged || !agent.agentId) { setSpaces([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/storage/spaces?agentId=${agent.agentId}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setSpaces(data.spaces || [])
      } catch (e) {
        console.error('Failed to load RAG spaces:', e)
      }
    })()
    return () => { cancelled = true }
  }, [isManaged, agent.agentId])

  const handleSpaceChange = useCallback((val: string) => {
    const id = val ? Number(val) : undefined
    workflow.setNodes((nodes: Node[]) =>
      nodes.map((n: Node) => (n.id === node.id ? { ...n, data: { ...n.data, ragSpaceId: id } } : n))
    )
  }, [node.id, workflow])

  // Open Settings page
  const openSettings = useCallback(() => {
    if (typeof window === 'undefined') return
    window.open('/app/settings?tab=ai-agent', '_blank')
  }, [])

  const storageLinks = useMemo(
    () => [
      {
        label: t.website,
        icon: Globe,
        path: '/app/storage?tab=website',
        description: t.crawl_index_websites,
        color: 'bg-green-500/10',
        iconColor: 'text-green-500'
      },
      {
        label: t.files,
        icon: FilesIcon,
        path: '/app/storage?tab=files',
        description: t.upload_documents,
        color: 'bg-blue-500/10',
        iconColor: 'text-blue-500'
      },
      {
        label: t.google_drive,
        icon: Cloud,
        path: '/app/storage?tab=google-drive',
        description: t.connect_google_drive,
        color: 'bg-purple-500/10',
        iconColor: 'text-purple-500'
      },
      {
        label: t.sharepoint,
        icon: Cloud,
        path: '/app/storage?tab=sharepoint',
        description: t.connect_sharepoint,
        color: 'bg-cyan-500/10',
        iconColor: 'text-cyan-500'
      },
      {
        label: t.gitbook,
        icon: BookOpen,
        path: '/app/storage?tab=gitbook',
        description: t.connect_gitbook,
        color: 'bg-orange-500/10',
        iconColor: 'text-orange-500'
      }
    ].filter((link) => !offFeatureFor('knowledgeSources', LINK_KNOWLEDGE_SOURCE[new URLSearchParams(link.path.split('?')[1] ?? '').get('tab') ?? ''], edition)),
    [t, edition]
  )

  const openLink = (path: string) => {
    if (typeof window === 'undefined') return
    window.open(path, '_blank')
  }

  const currentProvider = RAG_PROVIDERS.find(p => p.id === selectedProvider)

  // Get required API key name for RAG Provider
  const getRequiredApiKeyName = (ragProvider: string): string => {
    switch (ragProvider) {
      case 'openai_vector_store':
        return 'OpenAI'
      case 'gemini_file_search':
        return 'Gemini'
      case 'pinecone':
        return 'Pinecone'
      default:
        return 'OpenAI'
    }
  }

  const requiredApiKeyName = getRequiredApiKeyName(selectedProvider)

  const getProviderMismatchWarning = (): { show: boolean; message: string; detailMessage: string; ragProviderId: string } | null => {
    if (!selectedAiProvider || selectedProvider === 'none' || selectedProvider === 'pinecone' || selectedProvider === 'azure_ai_search') {
      return null
    }

    const ragProviderLinkedLlm = currentProvider?.linkedLlm
    if (!ragProviderLinkedLlm) return null

    if (selectedAiProvider !== ragProviderLinkedLlm) {
      const detailMessage = selectedProvider === 'openai_vector_store'
        ? t.provider_mismatch_openai
        : t.provider_mismatch_gemini
      return {
        show: true,
        message: t.provider_mismatch_not_working,
        detailMessage,
        ragProviderId: selectedProvider
      }
    }
    return null
  }

  const providerMismatch = getProviderMismatchWarning()

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {t.rag_provider}
          </div>
          {currentProvider?.docsUrl && !selfHosted && (
            <a
              href={currentProvider.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              {t.docs}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {selfHosted ? (
          <div className="p-3 bg-[#1A1A1A] rounded-lg border border-gray-700">
            <div className="text-sm font-medium text-gray-200">{t.source_installation_search || 'Installation document search'}</div>
            <div className="text-xs text-gray-400">{t.source_installation_search_desc || ''}</div>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : isManaged && managedSearchReady ? (
          (() => {
            const region = managedRegion ? getRegionById(managedRegion) : null
            return (
              <div className="p-3 bg-[#1A1A1A] rounded-lg border border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Database className="w-5 h-5 text-blue-500" />
                    <div>
                      <div className="text-sm font-medium text-gray-200">
                        Azure AI Search
                      </div>
                      {region && (
                        <div className="text-xs text-gray-400">
                          {region.flag} {region.country}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded">
                    Included
                  </span>
                </div>
              </div>
            )
          })()
        ) : isManaged && !managedSearchReady ? (
          (() => {
            const region = managedRegion ? getRegionById(managedRegion) : null
            return (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">
                    Vector DB is being prepared
                  </span>
                </div>
                {region && (
                  <div className="text-xs text-amber-300">
                    {region.flag} {region.country}
                  </div>
                )}
                <p className="text-xs text-amber-300/80 leading-relaxed">
                  Chat is available without file search.
                </p>
              </div>
            )
          })()
        ) : (
          <div className="p-3 bg-[#1A1A1A] rounded-lg border border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 flex items-center justify-center">
                  {getRagProviderIcon(selectedProvider, {
                    size: 22,
                    className: currentProvider?.iconType === 'openai' ? 'text-gray-300' : ''
                  })}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-200">
                    {currentProvider?.name}
                  </div>
                  <div className="text-xs text-gray-400">
                    {currentProvider?.description}
                  </div>
                </div>
              </div>
              <button
                onClick={openSettings}
                className="p-2 hover:bg-[#252525] rounded transition-colors"
                title={t.change_in_settings}
              >
                <Settings className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>
        )}

        {/* Gemini 48-hour Auto-Delete Warning */}
        {selectedProvider === 'gemini_file_search' && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-amber-400">
                {t.storage_limit_48h}
              </span>
            </div>
            <p className="text-xs text-amber-300 leading-relaxed">
              {t.gemini_auto_delete_desc}
            </p>
            <p className="text-xs text-amber-300/80 leading-relaxed">
              {t.gemini_permanent_storage}
            </p>
          </div>
        )}

        {isManaged && managedSearchReady && (
          <p className="text-xs text-gray-400 leading-relaxed">
            Azure AI Search is included with your Managed plan. Your vector data is stored in Switzerland (Azure Zurich).
          </p>
        )}

        {isManaged && managedSearchReady && spaces.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300">{t.ragSpaceLabel}</label>
            <select
              value={
                node.data?.ragSpaceId != null
                  ? String(node.data.ragSpaceId)
                  : (spaces.find(s => s.isDefault)?.id != null ? String(spaces.find(s => s.isDefault)!.id) : '')
              }
              onChange={(e) => handleSpaceChange(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              {spaces.map(s => (
                <option key={s.id} value={String(s.id)}>{s.isDefault ? t.ragSpaceDefault : s.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 leading-relaxed">
              {t.ragSpaceSearchHint}
            </p>
          </div>
        )}

        {selectedProvider === 'none' && !isManaged && (
          <div className="p-3 bg-gray-500/10 border border-gray-500/30 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-400">
                {t.rag_not_configured}
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              {t.rag_not_configured_desc}
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">
              {t.rag_enable_desc}
            </p>
            <button
              onClick={openSettings}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-500/20 hover:bg-gray-500/30 text-gray-400 text-xs font-medium rounded transition-colors mt-2"
            >
              <Settings className="w-3 h-3" />
              {t.configure_rag_provider}
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Pinecone Configuration Info */}
        {selectedProvider === 'pinecone' && (
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-blue-400">
                {t.pinecone_configuration}
              </span>
            </div>
            <p className="text-xs text-blue-300 leading-relaxed">
              {t.pinecone_config_desc}
            </p>
            <ul className="text-xs text-blue-300/80 space-y-1 ml-4 list-disc">
              <li>{t.pinecone_api_key}</li>
              <li>{t.index_name}</li>
              <li>{t.namespace_optional}</li>
            </ul>
            <button
              onClick={() => window.open('/app/settings?tab=ai-agent', '_blank')}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-medium rounded transition-colors mt-2"
            >
              <Settings className="w-3 h-3" />
              {t.configure_pinecone}
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* API Key Required Warning */}
        {hasApiKey === false && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-red-400">
                {t.api_key_required}
              </span>
            </div>
            <p className="text-xs text-red-300">
              {t.api_key_required_desc.replace('{provider}', requiredApiKeyName)}
            </p>
            <button
              onClick={openSettings}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium rounded transition-colors"
            >
              <Settings className="w-3 h-3" />
              {t.configure_in_settings}
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Provider Mismatch Error - RAG will not work */}
        {providerMismatch && !selfHosted && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-red-400">
                {t.provider_mismatch}
              </span>
            </div>
            <p className="text-xs text-red-300 font-medium">
              {providerMismatch.message}
            </p>
            <p className="text-xs text-red-300/80">
              {providerMismatch.detailMessage}
            </p>
            <button
              onClick={openSettings}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium rounded transition-colors"
            >
              <Settings className="w-3 h-3" />
              {t.change_rag_provider}
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}

        {!isManaged && (
          <button
            onClick={openSettings}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-400 flex items-center justify-center gap-1"
          >
            {t.change_rag_in_settings}
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Storage Types */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          {t.storage_types}
        </div>
        <div className="space-y-2">
          {storageLinks.map(link => (
            <button
              key={link.label}
              onClick={() => openLink(link.path)}
              className="w-full flex items-center gap-3 p-3 bg-[#1A1A1A] hover:bg-[#252525] rounded-lg transition-colors"
            >
              <div className={`p-2 rounded ${link.color}`}>
                <link.icon className={`w-4 h-4 ${link.iconColor}`} />
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-medium text-gray-200">{link.label}</div>
                <div className="text-xs text-gray-400">{link.description}</div>
              </div>
              <ExternalLink className="w-4 h-4 text-gray-400" />
            </button>
          ))}
        </div>
      </div>

      {/* Storage Stats */}
      {storageStats && (
        <div className="space-y-3 pt-2">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {t.storage_overview}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#1A1A1A] rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">{t.total_items}</div>
              <div className="text-lg font-semibold text-gray-200">
                {storageStats.totalItems || 0}
              </div>
            </div>
            <div className="bg-[#1A1A1A] rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">{t.total_size}</div>
              <div className="text-lg font-semibold text-gray-200">
                {((storageStats.totalSize || 0) / (1024 * 1024)).toFixed(2)} MB
              </div>
            </div>
            <div className="bg-[#1A1A1A] rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">{t.websites}</div>
              <div className="text-lg font-semibold text-gray-200">
                {storageStats.byType?.website?.completed || 0}
              </div>
            </div>
            <div className="bg-[#1A1A1A] rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">{t.files}</div>
              <div className="text-lg font-semibold text-gray-200">
                {storageStats.byType?.file?.completed || 0}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
