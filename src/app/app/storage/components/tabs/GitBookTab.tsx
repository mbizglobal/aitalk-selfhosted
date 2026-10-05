'use client'

import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import { useLanguage } from '@/hooks/useLanguage'
import { useRagProvider } from '../../hooks/useRagProvider'
import { RagProviderDisplay } from '../shared/RagProviderDisplay'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { BookOpen, Loader2, CheckCircle2, XCircle, Save, Trash2, StopCircle, RefreshCw, Check, Download, ExternalLink } from 'lucide-react'

const MAX_IMPORT_PAGES = 50

const GITBOOK_HELP_URLS: Record<string, string> = {
  en: 'https://support.aitalk.ch/english/3rd-party/gitbook',
  de: 'https://support.aitalk.ch/german/drittanbieter/gitbook',
  fr: 'https://support.aitalk.ch/french/tiers/gitbook',
  es: 'https://support.aitalk.ch/spanish/terceros/gitbook',
  ko: 'https://support.aitalk.ch/korean/3rd/gitbook',
}

interface GitBookTabProps {
  currentAgentId: string | null
  ragSpaceId?: number | null
  onRefresh?: () => void
  setShowBackgroundMessage?: (show: boolean) => void
}

interface PageItem {
  id: string
  path: string
  title: string
  kind: string
  imported: boolean
  importedAt?: string
  noData?: boolean
}

export interface GitBookTabRef {
  reloadPages: () => void
}

export const GitBookTab = forwardRef<GitBookTabRef, GitBookTabProps>(function GitBookTab({
  currentAgentId,
  ragSpaceId,
  onRefresh,
  setShowBackgroundMessage,
}, ref) {
  const { t, currentLanguage } = useLanguage()

  const {
    selectedProvider,
    hasApiKey,
    isLoading: isLoadingProvider,
  } = useRagProvider()

  const [accessToken, setAccessToken] = useState('')
  const [spaceId, setSpaceId] = useState('')
  const [publishedBaseUrl, setPublishedBaseUrl] = useState('')

  const [savedSettings, setSavedSettings] = useState<{
    hasAccessToken: boolean
    spaceId: string
    publishedUrl: string
  } | null>(null)
  const [isLoadingSettings, setIsLoadingSettings] = useState(false)

  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [testMessage, setTestMessage] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const [isLoadingPages, setIsLoadingPages] = useState(false)
  const [pages, setPages] = useState<PageItem[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, title: '' })
  const abortControllerRef = useRef<AbortController | null>(null)

  const loadSettings = useCallback(async () => {
    if (!currentAgentId) return

    setIsLoadingSettings(true)
    try {
      const response = await fetch(`/api/integrations/gitbook/settings?agentId=${currentAgentId}`)
      const data = await response.json()

      if (response.ok && data.success) {
        setSavedSettings(data.settings)
        setSpaceId(data.settings.spaceId || '')
        setPublishedBaseUrl(data.settings.publishedUrl || '')
      }
    } catch (error) {
      console.error('Failed to load GitBook settings:', error)
    } finally {
      setIsLoadingSettings(false)
    }
  }, [currentAgentId])

  useEffect(() => {
    loadSettings()
    setPages([])
    setSelectedPaths(new Set())
  }, [loadSettings])

  const handleSaveSettings = async () => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    if (!spaceId.trim()) {
      toast.error(t('gitbook_space_id_required'))
      return
    }

    if (!publishedBaseUrl.trim()) {
      toast.error(t('gitbook_published_url_required'))
      return
    }

    if (!accessToken.trim() && !savedSettings?.hasAccessToken) {
      toast.error(t('gitbook_token_space_required'))
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/integrations/gitbook/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: currentAgentId,
          ...(accessToken.trim() && { accessToken: accessToken.trim() }),
          spaceId: spaceId.trim(),
          publishedUrl: publishedBaseUrl.trim() || null,
        }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        toast.success(t('gitbook_settings_saved'))
        setAccessToken('')
        loadSettings()
      } else {
        toast.error(data.error || t('gitbook_settings_save_failed'))
      }
    } catch (error) {
      console.error('Failed to save GitBook settings:', error)
      toast.error(t('gitbook_settings_save_failed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteSettings = async () => {
    if (!currentAgentId) return
    if (!confirm(t('gitbook_disconnect_confirm'))) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/integrations/gitbook/settings?agentId=${currentAgentId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok && data.success) {
        toast.success(t('gitbook_disconnected'))
        setSavedSettings(null)
        setAccessToken('')
        setSpaceId('')
        setPublishedBaseUrl('')
        setTestResult(null)
        setTestMessage('')
        setPages([])
        setSelectedPaths(new Set())
      } else {
        toast.error(data.error || t('gitbook_disconnect_failed'))
      }
    } catch (error) {
      console.error('Failed to delete GitBook settings:', error)
      toast.error(t('gitbook_disconnect_failed'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleTestConnection = async () => {
    const tokenToTest = accessToken.trim()

    if (!tokenToTest && !savedSettings?.hasAccessToken) {
      toast.error(t('gitbook_token_space_required'))
      return
    }

    if (!spaceId.trim()) {
      toast.error(t('gitbook_token_space_required'))
      return
    }

    setIsTesting(true)
    setTestResult(null)
    setTestMessage('')

    try {
      const response = await fetch('/api/integrations/gitbook/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: tokenToTest || undefined,
          spaceId: spaceId.trim(),
          agentId: currentAgentId,
        }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setTestResult('success')
        setTestMessage(t('gitbook_connection_success'))
        toast.success(t('gitbook_connection_success'))
      } else {
        setTestResult('error')
        setTestMessage(data.error || t('gitbook_connection_failed'))
        toast.error(data.error || t('gitbook_connection_failed'))
      }
    } catch (error) {
      console.error('Failed to test GitBook connection:', error)
      setTestResult('error')
      setTestMessage(t('gitbook_connection_failed'))
      toast.error(t('gitbook_connection_failed'))
    } finally {
      setIsTesting(false)
    }
  }

  const handleLoadPages = async () => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    setIsLoadingPages(true)
    try {
      const response = await fetch(`/api/integrations/gitbook/pages?agentId=${currentAgentId}`)
      const data = await response.json()

      if (response.ok && data.success) {
        setPages(data.pages)
        setSelectedPaths(new Set())
        toast.success(t('gitbook_pages_loaded').replace('{total}', data.total).replace('{imported}', data.importedCount))
      } else {
        toast.error(data.error || t('gitbook_pages_load_failed'))
      }
    } catch (error) {
      console.error('Failed to load pages:', error)
      toast.error(t('gitbook_pages_load_failed'))
    } finally {
      setIsLoadingPages(false)
    }
  }

  useImperativeHandle(ref, () => ({
    reloadPages: handleLoadPages,
  }), [handleLoadPages])

  const togglePageSelection = (path: string) => {
    const newSelected = new Set(selectedPaths)
    if (newSelected.has(path)) {
      newSelected.delete(path)
    } else {
      if (newSelected.size >= MAX_IMPORT_PAGES) {
        toast.warning(t('gitbook_max_pages_warning').replace('{max}', String(MAX_IMPORT_PAGES)))
        return
      }
      newSelected.add(path)
    }
    setSelectedPaths(newSelected)
  }

  const toggleSelectAll = () => {
    const selectablePages = pages.filter(p => !p.imported)
    if (selectedPaths.size === selectablePages.length || selectedPaths.size >= MAX_IMPORT_PAGES) {
      setSelectedPaths(new Set())
    } else {
      const pagesToSelect = selectablePages.slice(0, MAX_IMPORT_PAGES).map(p => p.path)
      setSelectedPaths(new Set(pagesToSelect))
      if (selectablePages.length > MAX_IMPORT_PAGES) {
        toast.warning(t('gitbook_max_pages_warning').replace('{max}', String(MAX_IMPORT_PAGES)))
      }
    }
  }

  const handleStopImport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  const handleImport = async () => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    if (selectedPaths.size === 0) {
      toast.error(t('gitbook_select_pages'))
      return
    }

    if (!hasApiKey) {
      toast.error(t('storage_api_key_required_description'))
      return
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setIsImporting(true)
    setImportProgress({ current: 0, total: selectedPaths.size, title: t('gitbook_starting') })

    try {
      const response = await fetch('/api/integrations/gitbook/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: currentAgentId,
          pagePaths: Array.from(selectedPaths),
          ragProvider: selectedProvider,
          ragSpaceId,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorData = await response.json()
        toast.error(errorData.error || 'Import 실패')
        setIsImporting(false)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        toast.error(t('gitbook_streaming_error'))
        setIsImporting(false)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))

              if (event.type === 'start') {
                setImportProgress({ current: 0, total: event.total, title: t('gitbook_starting') })
              } else if (event.type === 'progress') {
                setImportProgress({
                  current: event.current,
                  total: event.total,
                  title: event.title,
                })
              } else if (event.type === 'complete') {
                toast.success(t('gitbook_import_complete').replace('{count}', event.imported))
                if (event.errors?.length > 0) {
                  console.error('Import errors:', event.errors)
                }
                handleLoadPages()
                onRefresh?.()
              } else if (event.type === 'stopped') {
                toast.info(t('gitbook_import_stopped').replace('{count}', String(event.imported)))
                handleLoadPages()
                onRefresh?.()
              } else if (event.type === 'error') {
                toast.error(event.message)
              }
            } catch (e) {
              console.error('Failed to parse event:', e)
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast.info(t('gitbook_import_stopped').replace('{count}', String(importProgress.current)))
        handleLoadPages()
        onRefresh?.()
      } else {
        console.error('Failed to import GitBook:', error)
        toast.error(t('gitbook_import_failed'))
      }
    } finally {
      setIsImporting(false)
      setImportProgress({ current: 0, total: 0, title: '' })
      setSelectedPaths(new Set())
      abortControllerRef.current = null
    }
  }

  const handleCancelImport = async (deleteAll: boolean = false) => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    const confirmMessage = deleteAll
      ? t('gitbook_delete_all_confirm')
      : t('gitbook_delete_all_confirm')

    if (!confirm(confirmMessage)) return

    setIsCancelling(true)
    try {
      const url = deleteAll
        ? `/api/integrations/gitbook/cancel?agentId=${currentAgentId}&all=true`
        : `/api/integrations/gitbook/cancel?agentId=${currentAgentId}`

      const response = await fetch(url, { method: 'DELETE' })
      const data = await response.json()

      if (response.ok && data.success) {
        toast.success(data.message || t('gitbook_cancel_success'))
        handleLoadPages()
        onRefresh?.()
      } else {
        toast.error(data.error || t('gitbook_cancel_failed'))
      }
    } catch (error) {
      console.error('Failed to cancel import:', error)
      toast.error(t('gitbook_cancel_failed'))
    } finally {
      setIsCancelling(false)
    }
  }

  if (isLoadingProvider || isLoadingSettings) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  const isDisabled = isTesting || isImporting || isSaving || isDeleting || isCancelling || isLoadingPages
  const isConnected = savedSettings?.hasAccessToken && savedSettings?.spaceId
  const selectablePages = pages.filter(p => !p.imported)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage Provider</CardTitle>
          <CardDescription>
            {t('gitbook_storage_provider_description')}
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
              <BookOpen className="h-4 w-4" />
              {t('gitbook_import_title')}
              {isConnected && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full">
                  {t('connected')}
                </span>
              )}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 flex-wrap">
              <span>{t('gitbook_import_description')}</span>
              <a
                href={GITBOOK_HELP_URLS[currentLanguage] || GITBOOK_HELP_URLS.en}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
              >
                {t('gitbook_help_link')}
                <ExternalLink className="h-3 w-3" />
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Access Token */}
            <div className="space-y-2">
              <Label htmlFor="gitbook-token">
                {t('gitbook_access_token_label')}
                {savedSettings?.hasAccessToken && (
                  <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                    ({t('gitbook_token_saved')})
                  </span>
                )}
              </Label>
              <Input
                id="gitbook-token"
                type="password"
                placeholder={savedSettings?.hasAccessToken
                  ? t('gitbook_token_unchanged_placeholder')
                  : t('gitbook_access_token_placeholder')
                }
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                disabled={isDisabled}
              />
              <p className="text-xs text-muted-foreground">
                {t('gitbook_access_token_help')}
              </p>
            </div>

            {/* Space ID */}
            <div className="space-y-2">
              <Label htmlFor="gitbook-space">{t('gitbook_space_id_label')}</Label>
              <Input
                id="gitbook-space"
                placeholder={t('gitbook_space_id_placeholder')}
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                disabled={isDisabled}
              />
              <p className="text-xs text-muted-foreground">
                {t('gitbook_space_id_help')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gitbook-url">
                {t('gitbook_published_url_label')}
                <span className="text-red-500 ml-1">*</span>
              </Label>
              <Input
                id="gitbook-url"
                placeholder={t('gitbook_published_url_placeholder')}
                value={publishedBaseUrl}
                onChange={(e) => setPublishedBaseUrl(e.target.value)}
                disabled={isDisabled}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t('gitbook_published_url_help')}
              </p>
            </div>

            {testResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg ${
                testResult === 'success'
                  ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'
                  : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
              }`}>
                {testResult === 'success' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <span className="text-sm">{testMessage}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleSaveSettings}
                disabled={isDisabled || !spaceId.trim() || !publishedBaseUrl.trim() || (!accessToken.trim() && !savedSettings?.hasAccessToken)}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('saving')}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {t('gitbook_save_settings')}
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={isDisabled || !spaceId.trim() || (!accessToken.trim() && !savedSettings?.hasAccessToken)}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('testing')}
                  </>
                ) : (
                  t('gitbook_test_connection')
                )}
              </Button>

              {isConnected && (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={handleDeleteSettings}
                  disabled={isDisabled}
                  title={t('gitbook_disconnect')}
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isConnected && hasApiKey && selectedProvider !== 'none' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('gitbook_page_selection')}
            </CardTitle>
            <CardDescription>
              {t('gitbook_page_selection_description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isImporting && (
              <div className="space-y-2 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <div className="flex items-center justify-between text-sm">
                  <span>{t('gitbook_import_progress')} {importProgress.title}</span>
                  <span>{importProgress.current} / {importProgress.total}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={(importProgress.current / importProgress.total) * 100} className="flex-1" />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleStopImport}
                  >
                    <StopCircle className="h-4 w-4 mr-1" />
                    {t('gitbook_stop_import')}
                  </Button>
                </div>
              </div>
            )}

            {pages.length > 0 && (
              <>
                <div className="flex items-center justify-between pb-2 border-b">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="select-all"
                      checked={selectablePages.length > 0 && selectedPaths.size === selectablePages.length}
                      onCheckedChange={toggleSelectAll}
                      disabled={isImporting || selectablePages.length === 0}
                    />
                    <Label htmlFor="select-all" className="text-sm cursor-pointer">
                      {t('gitbook_select_all')} ({selectedPaths.size}/{selectablePages.length})
                    </Label>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t('gitbook_total_pages').replace('{count}', String(pages.length))}
                  </span>
                </div>

                {selectedPaths.size >= MAX_IMPORT_PAGES && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 px-1">
                    {t('gitbook_max_pages_info').replace('{max}', String(MAX_IMPORT_PAGES))}
                  </div>
                )}

                <div className="max-h-[400px] overflow-y-auto space-y-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--muted-foreground) transparent' }}>
                  {pages.map((page) => (
                    <div
                      key={page.id}
                      className={`flex items-center gap-2 p-2 rounded-lg ${
                        page.imported
                          ? 'bg-gray-50 dark:bg-gray-900 opacity-60'
                          : selectedPaths.has(page.path)
                          ? 'bg-blue-50 dark:bg-blue-950'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-900'
                      }`}
                    >
                      <Checkbox
                        id={`page-${page.id}`}
                        checked={page.imported || selectedPaths.has(page.path)}
                        onCheckedChange={() => togglePageSelection(page.path)}
                        disabled={page.imported || isImporting}
                      />
                      <Label
                        htmlFor={`page-${page.id}`}
                        className={`flex-1 text-sm cursor-pointer ${page.imported ? 'text-muted-foreground' : ''}`}
                      >
                        {page.title}
                      </Label>
                      {page.imported && (
                        page.noData ? (
                          <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-500">
                            {t('gitbook_no_data')}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" />
                            {t('gitbook_saved')}
                          </span>
                        )
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={handleImport}
                    disabled={isDisabled || selectedPaths.size === 0}
                    size="lg"
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold text-base py-6"
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        {t('gitbook_import_in_progress')}
                      </>
                    ) : (
                      <>
                        <Download className="h-5 w-5 mr-2" />
                        {t('gitbook_import_selected').replace('{count}', String(selectedPaths.size))}
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}

            {pages.length === 0 && !isLoadingPages && (
              <div className="text-center py-8 text-muted-foreground">
                {t('gitbook_click_load_pages')}
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCancelImport(true)}
                disabled={isCancelling}
                className="text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-950"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('gitbook_deleting')}
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('gitbook_delete_all')}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadPages}
                disabled={isDisabled}
                className="text-green-600 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-950"
              >
                {isLoadingPages ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('loading')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('gitbook_load_pages')}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
})
