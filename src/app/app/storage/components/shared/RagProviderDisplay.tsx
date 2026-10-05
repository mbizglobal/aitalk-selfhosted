'use client'

import { useEdition } from '@/components/EditionProvider'
import { useState, useEffect } from 'react'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { SUPPORTED_RAG_PROVIDERS } from '../../hooks/useRagProvider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, AlertTriangle, Settings, Loader2, Eye, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getRagProviderIcon } from '@/components/icons/ai-providers'
import { useLanguage } from '@/hooks/useLanguage'
import { getRegionById } from '@/lib/managed/regions'
import GeminiFilesModal from '../GeminiFilesModal'

interface RagProviderDisplayProps {
  selectedProvider: RAGProviderType
  hasApiKey: boolean | null
  isLoading?: boolean
  className?: string
}

export function RagProviderDisplay({
  selectedProvider,
  hasApiKey,
  isLoading = false,
  className,
}: RagProviderDisplayProps) {
  const { t } = useLanguage()
  const edition = useEdition()
  const [isGeminiFilesModalOpen, setIsGeminiFilesModalOpen] = useState(false)
  const [serviceVariant, setServiceVariant] = useState<'self' | 'managed' | null>(null)
  const [managedRegion, setManagedRegion] = useState<string | null>(null)
  const currentProvider = SUPPORTED_RAG_PROVIDERS.find(p => p.id === selectedProvider)

  useEffect(() => {
    const fetchServiceVariant = async () => {
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.settings) {
            setServiceVariant(data.settings.serviceVariant || 'self')
            if (data.settings.managedRegion) {
              setManagedRegion(data.settings.managedRegion)
            }
          } else {
            setServiceVariant('self')
          }
        } else {
          setServiceVariant('self')
        }
      } catch {
        setServiceVariant('self')
      }
    }
    fetchServiceVariant()
  }, [])

  const geminiFilesTranslations = {
    gemini_files_title: t('gemini_files_title') || 'Gemini Files (Live)',
    gemini_files_description: t('gemini_files_description') || 'Files uploaded to Gemini will be automatically deleted after 48 hours. This list shows files currently available in your Gemini account.',
    gemini_files_empty: t('gemini_files_empty') || 'No files uploaded to Gemini',
    gemini_files_loading: t('gemini_files_loading') || 'Loading files...',
    gemini_files_error: t('gemini_files_error') || 'Failed to load files',
    gemini_files_delete_confirm: t('gemini_files_delete_confirm') || 'Are you sure you want to delete "{name}"?',
    gemini_files_delete_success: t('gemini_files_delete_success') || 'File deleted successfully',
    gemini_files_delete_error: t('gemini_files_delete_error') || 'Failed to delete file',
    gemini_files_refresh: t('gemini_files_refresh') || 'Refresh',
    gemini_files_total: t('gemini_files_total') || 'Total',
    gemini_files_expires_in: t('gemini_files_expires_in') || 'Expires in {time}',
    gemini_files_expired: t('gemini_files_expired') || 'Expired',
    gemini_files_state_active: t('gemini_files_state_active') || 'Active',
    gemini_files_state_processing: t('gemini_files_state_processing') || 'Processing',
    gemini_files_state_failed: t('gemini_files_state_failed') || 'Failed',
  }

  const openSettings = () => {
    if (typeof window === 'undefined') return
    window.open('/app/settings?tab=ai-agent', '_blank')
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

  if (edition === 'selfhosted') {
    return (
      <div className={cn('rounded-lg border p-3', className)}>
        <div className="text-sm font-medium">{t('storage_installation_search')}</div>
        <div className="text-xs text-muted-foreground">{t('storage_installation_search_desc')}</div>
      </div>
    )
  }

  if (serviceVariant === null || isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">RAG PROVIDER</div>
        </div>
        <div className="flex items-center justify-center h-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  {
    const region = managedRegion ? getRegionById(managedRegion) : null

    if (serviceVariant === 'managed' && selectedProvider === 'none') {
      return (
        <div className={cn('space-y-3', className)}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">RAG PROVIDER</div>
          </div>
          <div className="p-3 border rounded-lg bg-yellow-500/10 border-yellow-500/30">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <div>
                <div className="font-medium text-sm">Vector DB is being prepared</div>
                {region && (
                  <div className="text-xs text-muted-foreground">{region.flag} {region.country}</div>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Vector DB is being prepared for your region. Chat is available without file search.
          </p>
        </div>
      )
    }

    return (
      <div className={cn('space-y-3', className)}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">RAG PROVIDER</div>
        </div>
        <div className="p-3 border rounded-lg bg-muted/30">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-blue-500" />
            <div>
              <div className="font-medium text-sm">Azure AI Search</div>
              {region && (
                <div className="text-xs text-muted-foreground">{region.flag} {region.country}</div>
              )}
            </div>
            <Badge variant="secondary" className="ml-auto text-xs">{t('managed_included')}</Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('managed_rag_description')}
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-muted-foreground">RAG PROVIDER</div>
        {currentProvider?.docsUrl && (
          <a
            href={currentProvider?.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
          >
            Docs
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Current Provider Display */}
      <div className="p-3 border rounded-lg bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 flex items-center justify-center">
              {getRagProviderIcon(selectedProvider, { size: 24, className: currentProvider?.iconType === 'openai' ? 'text-gray-700 dark:text-gray-300' : '' })}
            </div>
            <div>
              <div className="font-medium text-sm">{currentProvider?.name}</div>
              <div className="text-xs text-muted-foreground">{currentProvider?.description}</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={openSettings}
            className="text-muted-foreground hover:text-foreground"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Gemini 48-hour Auto-Delete Warning */}
      {selectedProvider === 'gemini_file_search' && (
        <div className="p-3 bg-muted/50 border border-border rounded-lg space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-medium text-foreground">
              48-Hour Auto-Delete Warning
            </span>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              All files uploaded to Gemini will be automatically deleted after 48 hours.
              This is a limitation of Google&apos;s Files API.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
              <li>Files are temporary and will expire automatically</li>
              <li>Gemini files are NOT counted in Total Items / Total Size statistics</li>
              <li>You must re-upload files after expiration if needed</li>
            </ul>
          </div>

          {/* View Gemini Files Button */}
          {hasApiKey && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">
                {t('gemini_files_banner_description') || 'View and manage files currently stored in Gemini. Only files that exist in Gemini are shown.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsGeminiFilesModalOpen(true)}
                className="flex items-center gap-2"
              >
                <Eye className="w-3 h-3" />
                {t('gemini_files_view_button') || 'View Gemini Files'}
              </Button>
            </div>
          )}

          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">
              Need permanent storage? Switch to OpenAI Vector Store for unlimited retention.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={openSettings}
              className="flex items-center gap-2"
            >
              <Settings className="w-3 h-3" />
              Switch to OpenAI Vector Store
              <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
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
            onClick={() => window.open('/app/settings?tab=api-key', '_blank')}
            className="flex items-center gap-2 text-red-600 border-red-500/30 hover:bg-red-500/10"
          >
            <Settings className="w-3 h-3" />
            Configure in Settings
            <ExternalLink className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Change Provider Link */}
      <div className="text-center">
        <button
          onClick={openSettings}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto"
        >
          Change RAG Provider in Settings
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Gemini Files Modal */}
      {selectedProvider === 'gemini_file_search' && (
        <GeminiFilesModal
          isOpen={isGeminiFilesModalOpen}
          onClose={() => setIsGeminiFilesModalOpen(false)}
          translations={geminiFilesTranslations}
        />
      )}
    </div>
  )
}
