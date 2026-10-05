'use client'

import { useState } from 'react'
import { useLanguage } from '@/hooks/useLanguage'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { useRagProvider } from '../../hooks/useRagProvider'
import { RagProviderDisplay } from '../shared/RagProviderDisplay'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Database, Loader2 } from 'lucide-react'

interface WebsiteTabProps {
  currentAgentId: string | null
  ragSpaceId?: number | null
  hasProcessingWebsite?: boolean
  onRefresh?: () => void
  setShowBackgroundMessage?: (show: boolean) => void
}

export function WebsiteTab({
  currentAgentId,
  ragSpaceId,
  hasProcessingWebsite = false,
  onRefresh,
  setShowBackgroundMessage,
}: WebsiteTabProps) {
  const { t } = useLanguage()

  const {
    selectedProvider,
    hasApiKey,
    isLoading: isLoadingProvider,
  } = useRagProvider()

  const [crawlUrl, setCrawlUrl] = useState('')
  const [maxDepth, setMaxDepth] = useState('3')
  const [maxPages, setMaxPages] = useState('25')
  const [isCrawling, setIsCrawling] = useState(false)

  const handleCrawlWebsite = async () => {
    if (!currentAgentId || !crawlUrl.trim()) {
      toast.error(t('agent_not_found'))
      return
    }

    if (!hasApiKey) {
      toast.error('API key is required to crawl websites')
      return
    }

    let url = crawlUrl.trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    try {
      new URL(url)
    } catch {
      toast.error(t('invalid_url'))
      return
    }

    setIsCrawling(true)
    try {
      const response = await fetch('/api/storage/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: currentAgentId,
          url,
          maxDepth: parseInt(maxDepth),
          maxPages: parseInt(maxPages),
          ragProvider: selectedProvider,
          ragSpaceId,
        }),
      })

      if (response.ok) {
        toast.success(t('crawl_started'))
        setCrawlUrl('')
        setShowBackgroundMessage?.(true)
        onRefresh?.()
      } else {
        const data = await response.json()
        toast.error(data.error || t('crawl_failed'))
      }
    } catch (error) {
      console.error('Failed to start crawl:', error)
      toast.error(t('crawl_failed'))
    } finally {
      setIsCrawling(false)
    }
  }

  if (isLoadingProvider) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  const isDisabled = isCrawling || hasProcessingWebsite

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage Provider</CardTitle>
          <CardDescription>
            Crawled content will be indexed using this RAG provider
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RagProviderDisplay
            selectedProvider={selectedProvider}
            hasApiKey={hasApiKey}
          />
        </CardContent>
      </Card>

      {hasApiKey && selectedProvider !== 'none' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Website Crawl
            </CardTitle>
            <CardDescription>
              Intelligent website crawling with directory discovery, multi-language support, and comprehensive content extraction
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Privacy Notice */}
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
                🔒 {selectedProvider === 'azure_ai_search' ? t('privacy_notice_managed') : t('privacy_notice')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="crawl-url">{t('website_url_label')}</Label>
              <Input
                id="crawl-url"
                placeholder={t('website_url_placeholder')}
                value={crawlUrl}
                onChange={(e) => setCrawlUrl(e.target.value)}
                disabled={isDisabled}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && crawlUrl.trim() && !isDisabled) {
                    handleCrawlWebsite()
                  }
                }}
                className={isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
              />
            </div>

            <details className="space-y-4">
              <summary className="cursor-pointer text-sm font-medium">
                {t('advanced_options')}
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                <div className="space-y-2">
                  <Label>{t('max_depth_label')}</Label>
                  <Select value={maxDepth} onValueChange={setMaxDepth} disabled={isDisabled}>
                    <SelectTrigger className={isDisabled ? 'opacity-50 cursor-not-allowed' : ''}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="3">3</SelectItem>
                      <SelectItem value="4">4</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t('max_depth_description')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>{t('max_pages_label')}</Label>
                  <Select value={maxPages} onValueChange={setMaxPages} disabled={isDisabled}>
                    <SelectTrigger className={isDisabled ? 'opacity-50 cursor-not-allowed' : ''}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="150">150</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t('max_pages_description')}
                  </p>
                </div>
              </div>
            </details>

            <Button
              onClick={handleCrawlWebsite}
              disabled={isDisabled || !crawlUrl.trim()}
              className="w-full"
            >
              {isDisabled ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('website_crawling_in_progress')}
                </>
              ) : (
                t('start_crawl_button')
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
