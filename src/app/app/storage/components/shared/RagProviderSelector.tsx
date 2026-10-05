'use client'

import { useState } from 'react'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { SUPPORTED_RAG_PROVIDERS } from '../../hooks/useRagProvider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, AlertTriangle, Check, Clock, Key } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RagProviderSelectorProps {
  selectedProvider: RAGProviderType
  onProviderChange: (provider: RAGProviderType) => void
  hasApiKey: boolean | null
  configuredProviders: string[]
  className?: string
}

export function RagProviderSelector({
  selectedProvider,
  onProviderChange,
  hasApiKey,
  configuredProviders,
  className,
}: RagProviderSelectorProps) {
  const [showComingSoon, setShowComingSoon] = useState(false)

  const currentProvider = SUPPORTED_RAG_PROVIDERS.find(p => p.id === selectedProvider)

  const handleProviderSelect = (providerId: string) => {
    const provider = SUPPORTED_RAG_PROVIDERS.find(p => p.id === providerId)

    if (!provider?.available) {
      setShowComingSoon(true)
      setTimeout(() => setShowComingSoon(false), 2000)
      return
    }

    onProviderChange(providerId as RAGProviderType)
  }

  const openApiKeySettings = () => {
    if (typeof window === 'undefined') return
    window.open('/app/settings?tab=api-key', '_blank')
  }

  const getRequiredApiKeyName = (provider: RAGProviderType): string => {
    switch (provider) {
      case 'openai_vector_store':
        return 'OpenAI'
      case 'gemini_file_search':
        return 'Gemini'
      case 'pinecone':
        return 'Pinecone'
      default:
        return 'API'
    }
  }

  const requiredApiKeyName = getRequiredApiKeyName(selectedProvider)

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-muted-foreground">
          RAG Provider
        </div>
        {currentProvider?.docsUrl && (
          <a
            href={currentProvider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
          >
            Docs
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Provider Dropdown */}
      <Select value={selectedProvider} onValueChange={handleProviderSelect}>
        <SelectTrigger className="w-full">
          <SelectValue>
            <div className="flex items-center gap-2">
              <span className="text-lg">{currentProvider?.icon}</span>
              <span>{currentProvider?.name}</span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_RAG_PROVIDERS.map(provider => (
            <SelectItem
              key={provider.id}
              value={provider.id}
              disabled={!provider.available}
              className={cn(!provider.available && 'opacity-60')}
            >
              <div className="flex items-center justify-between w-full gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{provider.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{provider.name}</span>
                      {!provider.available && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          Coming Soon
                        </Badge>
                      )}
                      {provider.available && configuredProviders.includes(provider.llmProvider) && (
                        <Check className="w-3 h-3 text-green-500" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{provider.description}</p>
                  </div>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Coming Soon Toast */}
      {showComingSoon && (
        <div className="flex items-center gap-2 p-2 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <Clock className="w-4 h-4 text-orange-500" />
          <span className="text-xs text-orange-600 dark:text-orange-400">
            This provider will be available soon.
          </span>
        </div>
      )}

      {false && hasApiKey === false && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-medium text-red-600 dark:text-red-400">
              API Key Required
            </span>
          </div>
          <p className="text-xs text-red-600 dark:text-red-400">
            {requiredApiKeyName} API key is required to use this RAG provider.
            Please configure your API key in Settings.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={openApiKeySettings}
            className="flex items-center gap-2 text-red-600 border-red-500/30 hover:bg-red-500/10"
          >
            <Key className="w-3 h-3" />
            Configure API Key
            <ExternalLink className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  )
}
