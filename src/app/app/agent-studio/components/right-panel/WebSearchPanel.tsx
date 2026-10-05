'use client'

import React, { useEffect, useMemo, useState } from 'react'
import type { Node } from 'reactflow'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Info } from 'lucide-react'
import { useWebSearchTool } from '../../hooks/useWebSearchTool'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { MANAGED_MAX_OUTPUT_TOKENS } from '@/lib/managed/output-limit'
import { isGptReasoningFamily } from '@/lib/managed/model-lineup'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

const WEB_SEARCH_PRICING: Record<string, { price: string; note: string; supported: boolean }> = {
  openai: {
    price: 'Token cost only',
    note: 'Web search included in token pricing',
    supported: true
  },
  gemini: {
    price: 'Free',
    note: 'Google Search grounding at no additional cost',
    supported: true
  },
  claude: {
    price: '$10 / 1,000 searches',
    note: 'Plus standard token costs',
    supported: true
  },
  grok: {
    price: 'Token cost only',
    note: 'Web search included in token pricing',
    supported: true
  },
  deepseek: {
    price: 'Not supported',
    note: 'DeepSeek API does not support web search',
    supported: false
  }
}

function isOpenAIModelWebSearchSupported(model: string): boolean {
  if (!model) return false
  return !model.startsWith('gpt-4.1-nano')
}

export const WebSearchPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { workflow, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const {
    webSearchDomains,
    setWebSearchDomains,
    webSearchCountry,
    setWebSearchCountry,
    webSearchRegion,
    setWebSearchRegion,
    webSearchCity,
    setWebSearchCity,
    webSearchTimezone,
    setWebSearchTimezone,
    webSearchContextSize,
    setWebSearchContextSize
  } = useWebSearchTool()

  const connectedAiNode = useMemo(() => {
    const incomingEdge = workflow.edges.find(e => e.target === node.id)
    if (incomingEdge) {
      return workflow.nodes.find(n => n.id === incomingEdge.source)
    }
    return null
  }, [workflow.nodes, workflow.edges, node.id])

  const [isManaged, setIsManaged] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/dashboard/user-info')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setIsManaged(d.data?.serviceVariant === 'managed') })
      .catch(() => { })
    return () => { cancelled = true }
  }, [])

  const providerInfo = useMemo(() => {
    const provider = connectedAiNode?.data?.provider || 'openai'
    const model = connectedAiNode?.data?.model || ''
    const maxTokens = connectedAiNode?.data?.maxTokens || 2048
    const pricing = WEB_SEARCH_PRICING[provider] || WEB_SEARCH_PRICING.openai

    let modelSupported = true
    if (provider === 'openai' && model) {
      modelSupported = isOpenAIModelWebSearchSupported(model)
    }

    const isGpt4o = model.startsWith('gpt-4o')
    const isGpt5 = isGptReasoningFamily(model)
    const modelMaxOutputLimit = isGpt4o ? 4096 : (isGpt5 ? 65536 : 4096)

    const minRecommendedTokens = isManaged ? MANAGED_MAX_OUTPUT_TOKENS : 8192
    const lowMaxTokens = isManaged !== null && maxTokens < minRecommendedTokens

    const modelHasLowLimit = isManaged !== null && isGpt4o && modelMaxOutputLimit < minRecommendedTokens

    return {
      provider,
      model,
      maxTokens,
      pricing,
      modelSupported,
      lowMaxTokens,
      minRecommendedTokens,
      isGpt4o,
      isGpt5,
      modelMaxOutputLimit,
      modelHasLowLimit
    }
  }, [connectedAiNode, isManaged])

  useEffect(() => {
    setWebSearchDomains(node.data.webSearchDomains || '')
    setWebSearchCountry(node.data.webSearchCountry || '')
    setWebSearchRegion(node.data.webSearchRegion || '')
    setWebSearchCity(node.data.webSearchCity || '')
    setWebSearchTimezone(node.data.webSearchTimezone || '')
    setWebSearchContextSize(node.data.webSearchContextSize || 'medium')
  }, [
    node.id,
    node.data,
    setWebSearchDomains,
    setWebSearchCountry,
    setWebSearchRegion,
    setWebSearchCity,
    setWebSearchTimezone,
    setWebSearchContextSize
  ])

  const persist = (patch: Record<string, any>) => {
    updateNodeData(patch)
  }

  return (
    <div className="space-y-4">
      {/* Header with AI Assistant Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">Web Search</h3>
      </div>

      {providerInfo.provider === 'openai' && !providerInfo.modelSupported && (
        <div className="p-3 rounded-lg border bg-red-500/10 border-red-500/30">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-200">
                {t.web_search_not_supported}: {providerInfo.model}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {t.web_search_use_gpt}
              </p>
            </div>
          </div>
        </div>
      )}

      {providerInfo.modelHasLowLimit && (
        <div className="p-3 rounded-lg border bg-amber-500/10 border-amber-500/30">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-200">
                {t.model_output_limit}: {providerInfo.modelMaxOutputLimit.toLocaleString()} tokens
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {providerInfo.model} {t.model_max_output_note.replace('{tokens}', providerInfo.modelMaxOutputLimit.toLocaleString())}
              </p>
            </div>
          </div>
        </div>
      )}

      {providerInfo.isGpt5 && providerInfo.lowMaxTokens && (
        <div className="p-3 rounded-lg border bg-amber-500/10 border-amber-500/30">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-200">
                {t.low_max_output_tokens}: {providerInfo.maxTokens.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {t.web_search_token_recommendation.replace('{tokens}', providerInfo.minRecommendedTokens.toLocaleString())}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className={`p-3 rounded-lg border ${
        providerInfo.pricing.supported
          ? providerInfo.provider === 'claude'
            ? 'bg-amber-500/10 border-amber-500/30'
            : 'bg-green-500/10 border-green-500/30'
          : 'bg-red-500/10 border-red-500/30'
      }`}>
        <div className="flex items-start gap-2">
          <Info className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
            providerInfo.pricing.supported
              ? providerInfo.provider === 'claude'
                ? 'text-amber-400'
                : 'text-green-400'
              : 'text-red-400'
          }`} />
          <div>
            <p className={`text-sm font-medium ${
              providerInfo.pricing.supported
                ? providerInfo.provider === 'claude'
                  ? 'text-amber-200'
                  : 'text-green-200'
                : 'text-red-200'
            }`}>
              {providerInfo.provider.charAt(0).toUpperCase() + providerInfo.provider.slice(1)} Web Search: {providerInfo.pricing.price}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{providerInfo.pricing.note}</p>
          </div>
        </div>
      </div>

      {/* Search only in these websites - Optional */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm font-medium text-gray-200">{t.search_only_websites}</label>
          <span className="text-xs text-gray-400 bg-[#3A3A3A] px-2 py-0.5 rounded">{t.optional}</span>
        </div>
        <Textarea
          value={webSearchDomains}
          onChange={(e) => {
            setWebSearchDomains(e.target.value)
            persist({ webSearchDomains: e.target.value })
          }}
          placeholder={t.search_domains_placeholder}
          className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 min-h-[100px] resize-none"
        />
        <p className="text-xs text-gray-400 mt-2">
          {t.search_domains_desc}
        </p>
      </div>

      {/* User's location - Optional */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <label className="text-sm font-medium text-gray-200">{t.user_location}</label>
          <span className="text-xs text-gray-400 bg-[#3A3A3A] px-2 py-0.5 rounded">{t.optional}</span>
        </div>

        {/* Country */}
        <div className="space-y-2 mb-3">
          <label className="text-xs font-medium text-gray-400">{t.country}</label>
          <Input
            value={webSearchCountry}
            onChange={(e) => {
              setWebSearchCountry(e.target.value)
              persist({ webSearchCountry: e.target.value })
            }}
            placeholder={t.country}
            className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200"
          />
        </div>

        {/* Region */}
        <div className="space-y-2 mb-3">
          <label className="text-xs font-medium text-gray-400">{t.region}</label>
          <Input
            value={webSearchRegion}
            onChange={(e) => {
              setWebSearchRegion(e.target.value)
              persist({ webSearchRegion: e.target.value })
            }}
            placeholder={t.region}
            className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200"
          />
        </div>

        {/* City */}
        <div className="space-y-2 mb-3">
          <label className="text-xs font-medium text-gray-400">{t.city}</label>
          <Input
            value={webSearchCity}
            onChange={(e) => {
              setWebSearchCity(e.target.value)
              persist({ webSearchCity: e.target.value })
            }}
            placeholder={t.city}
            className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200"
          />
        </div>

        {/* Timezone */}
        <div className="space-y-2 mb-3">
          <label className="text-xs font-medium text-gray-400">{t.timezone}</label>
          <Input
            value={webSearchTimezone}
            onChange={(e) => {
              setWebSearchTimezone(e.target.value)
              persist({ webSearchTimezone: e.target.value })
            }}
            placeholder={t.timezone}
            className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200"
          />
        </div>
      </div>

      {/* Search context size */}
      <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">{t.search_context_size}</label>
        <select
          value={webSearchContextSize}
          onChange={(e) => {
            setWebSearchContextSize(e.target.value as 'high' | 'medium' | 'low')
            persist({ webSearchContextSize: e.target.value })
          }}
          className="w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
        >
          <option value="high">{t.high}</option>
          <option value="medium">{t.medium}</option>
          <option value="low">{t.low}</option>
        </select>
      </div>
    </div>
  )
}
