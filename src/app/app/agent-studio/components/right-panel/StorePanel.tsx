'use client'

import React, { useState, useEffect, useMemo } from 'react'
import type { Node } from 'reactflow'
import { Loader2, Settings, AlertTriangle, ExternalLink } from 'lucide-react'
import { getRagProviderIcon } from '@/components/icons/ai-providers'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useWorkflowContext } from '../../contexts/WorkflowContext'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const StorePanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { agent } = useWorkflowContext()

  const [selectedProvider, setSelectedProvider] = useState<string>('none')
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [spaces, setSpaces] = useState<Array<{ id: number; name: string; isDefault: boolean }>>([])

  const RAG_PROVIDERS = useMemo(() => [
    {
      id: 'none',
      name: t.not_configured || 'Not Configured',
      description: t.no_rag_selected || 'No RAG provider selected',
    },
    {
      id: 'openai_vector_store',
      name: t.openai_vector_store || 'OpenAI Vector Store',
      description: t.openai_vector_store_desc || 'Built-in vector store by OpenAI',
    },
    {
      id: 'gemini_file_search',
      name: t.gemini_file_search || 'Gemini File Search',
      description: t.gemini_file_search_desc || 'Google Gemini file search',
    },
    {
      id: 'pinecone',
      name: t.pinecone || 'Pinecone',
      description: t.pinecone_desc || 'Pinecone vector database',
    },
    {
      id: 'azure_ai_search',
      name: 'Azure AI Search',
      description: 'Microsoft Azure AI Search (Managed)',
    },
  ], [t])

  useEffect(() => {
    const fetchRagProvider = async () => {
      setIsLoading(true)
      try {
        const response = await fetch('/api/storage/rag-provider')
        if (response.ok) {
          const data = await response.json()
          setSelectedProvider(data.defaultProvider || 'none')
          setHasApiKey(data.hasApiKey)
        }
      } catch (error) {
        console.error('Failed to fetch RAG provider:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchRagProvider()
  }, [])

  useEffect(() => {
    if (selectedProvider !== 'azure_ai_search' || !agent?.agentId) { setSpaces([]); return }
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
  }, [selectedProvider, agent?.agentId])

  const currentProvider = RAG_PROVIDERS.find(p => p.id === selectedProvider)
  const isProviderConfigured = selectedProvider !== 'none'

  const content = node.data.content || ''

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-gray-300 mb-1.5 block">{t.storeDestination}</label>
        {isLoading ? (
          <div className="flex items-center gap-2 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            <span className="text-sm text-gray-400">{t.loading || 'Loading...'}</span>
          </div>
        ) : isProviderConfigured ? (
          <div className="p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                {getRagProviderIcon(selectedProvider, { className: 'w-5 h-5' })}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-200">{currentProvider?.name}</div>
                <div className="text-xs text-gray-500 truncate">{currentProvider?.description}</div>
              </div>
              {hasApiKey ? (
                <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded flex-shrink-0 whitespace-nowrap">
                  ✓ {t.storeConnected}
                </span>
              ) : (
                <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded flex-shrink-0 whitespace-nowrap">
                  {t.storeNoApiKey}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-amber-300">{t.storeNoProvider}</p>
                <p className="text-xs text-gray-500 mt-1">{t.storeNoProviderDesc}</p>
              </div>
            </div>
            <button
              onClick={() => window.open('/app/settings?tab=ai-agent', '_blank')}
              className="mt-2 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Settings className="w-3 h-3" />
              {t.storeGoToSettings}
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {selectedProvider === 'azure_ai_search' && spaces.length > 0 && (
        <div>
          <label className="text-sm text-gray-300 mb-1.5 block">{t.ragSpaceLabel}</label>
          <select
            value={
              node.data?.ragSpaceId != null
                ? String(node.data.ragSpaceId)
                : (spaces.find(s => s.isDefault)?.id != null ? String(spaces.find(s => s.isDefault)!.id) : '')
            }
            onChange={(e) => updateNodeData({ ragSpaceId: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full bg-[#1E1E1E] border border-[#3A3A3A] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          >
            {spaces.map(s => (
              <option key={s.id} value={String(s.id)}>{s.isDefault ? t.ragSpaceDefault : s.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">{t.ragSpaceWriteHint}</p>
        </div>
      )}

      <div>
        <label className="text-sm text-gray-300 mb-1.5 block">{t.storeDataToSave}</label>
        <textarea
          value={content}
          onChange={(e) => updateNodeData({ content: e.target.value })}
          placeholder={t.storeDataPlaceholder}
          rows={6}
          className="w-full bg-[#1E1E1E] border border-[#3A3A3A] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y font-mono"
          autoComplete="off"
        />
        <p className="text-xs text-gray-500 mt-1">
          {t.storeDataHint}
        </p>
      </div>

      {/* Result Info */}
      <div className="bg-[#1A1A2E] border border-[#2A2A4A] rounded-lg px-3 py-2">
        <p className="text-xs text-gray-400">{t.storeResultInfo}</p>
        <p className="text-xs text-gray-500 mt-0.5 font-mono">
          .success .provider .documentCount
        </p>
      </div>
    </div>
  )
}
