
'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatTimeOnlyWithUserSettings } from '@/lib/format-date-with-user-settings'
import {
  Globe,
  Files,
  Cloud,
  Loader2,
  RefreshCw,
  Eye,
  Trash2,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  Lock,
} from 'lucide-react'
import { getRagProviderIcon } from '@/components/icons/ai-providers'
import type { StorageItem } from '../types'

const BUSINESS_INFO_TITLE = 'Business Information.txt'
const isBusinessInfoItem = (item: StorageItem) => item.title === BUSINESS_INFO_TITLE

interface StorageListProps {
  items: StorageItem[]
  isLoading: boolean
  t: (key: string) => string
  userTimeFormat: string
  progressStatus: Record<number, {
    progress?: string
    currentUrl?: string
    crawlCount?: number
  }>
  showBackgroundMessage?: boolean
  deletingItemIds?: Set<number>
  onReload: () => void
  onDeleteItem: (itemId: number) => void
}

function parseProcessingLog(log: string | null): {
  status?: string
  substatus?: string
  progress?: {
    current: number
    total: number
    currentUrl?: string
  }
  retry?: {
    attempt: number
    maxAttempts: number
    failureType?: string
    nextRetryAt?: string
  }
} | null {
  if (!log) return null
  try {
    return JSON.parse(log)
  } catch {
    return null
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function StorageList({
  items,
  isLoading,
  t,
  userTimeFormat,
  progressStatus,
  showBackgroundMessage = false,
  deletingItemIds = new Set(),
  onReload,
  onDeleteItem,
}: StorageListProps) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())
  const [itemToDelete, setItemToDelete] = useState<StorageItem | null>(null)
  const [retryingItemIds, setRetryingItemIds] = useState<Set<number>>(new Set())

  const handleRetry = useCallback(async (item: StorageItem) => {
    setRetryingItemIds(prev => new Set(prev).add(item.id))
    try {
      const res = await fetch(`/api/storage/items/${item.id}/retry`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data?.error || t('storage_retry_failed'))
      } else {
        onReload?.()
      }
    } catch (err) {
      toast.error(t('storage_retry_failed'))
    } finally {
      setRetryingItemIds(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }, [t, onReload])

  const toggleItemExpansion = useCallback((itemId: number) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }, [])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 sm:h-4 sm:w-4 text-green-500" />
      case 'processing':
      case 'deleting':
        return <Clock className="h-5 w-5 sm:h-4 sm:w-4 text-yellow-500" />
      case 'failed':
        return <XCircle className="h-5 w-5 sm:h-4 sm:w-4 text-red-500" />
      default:
        return null
    }
  }

  const getStatusBadge = (item: StorageItem) => {
    switch (item.status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500">{t('status_completed')}</Badge>
      case 'processing':
      case 'deleting':
        return <Badge variant="default" className="bg-yellow-500">{t('status_processing')}</Badge>
      case 'failed':
        return (
          <Badge variant="destructive" title={item.errorMessage}>
            {t('status_failed')}
          </Badge>
        )
      default:
        return null
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('storage_items_title')}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onReload}
            className="ml-2"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('reload_button')}
          </Button>
        </div>
        {showBackgroundMessage && (
          <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>{t('background_processing_message')}</strong>
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !items.length ? (
          <div className="text-center py-8 text-muted-foreground">
            {t('storage_no_items')}
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 sm:p-4 border rounded-lg gap-4 touch-manipulation">
                <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 flex-1 min-w-0 gap-3 sm:gap-0">
                  <div className="flex items-center space-x-3 sm:space-x-2 flex-shrink-0">
                    {item.type === 'website' ? (
                      <Globe className="h-6 w-6 sm:h-5 sm:w-5 text-blue-500" />
                    ) : item.type === 'google_drive' ? (
                      <Cloud className="h-6 w-6 sm:h-5 sm:w-5 text-blue-500" />
                    ) : item.type === 'sharepoint' ? (
                      <Cloud className="h-6 w-6 sm:h-5 sm:w-5 text-purple-500" />
                    ) : (
                      <Files className="h-6 w-6 sm:h-5 sm:w-5 text-green-500" />
                    )}
                    {getStatusIcon(item.status)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-base sm:text-base break-words">{item.title}</p>
                    {item.sourceUrl && (
                      <p className="text-sm text-muted-foreground break-all">
                        {item.sourceUrl}
                      </p>
                    )}

                    {item.status === 'processing' && (
                      <div className="mt-3 sm:mt-2 p-3 sm:p-2 bg-blue-50 dark:bg-blue-950 rounded text-sm sm:text-xs">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 sm:h-3 sm:w-3 animate-spin text-blue-500 flex-shrink-0" />
                          <span className="text-blue-700 dark:text-blue-300 break-words flex-shrink-0">
                            {(() => {
                              const logData = parseProcessingLog(item.processingLog ?? null)

                              if (logData && logData.substatus) {
                                return logData.substatus
                              }

                              if (item.type === 'file') {
                                return progressStatus[item.id]?.progress ?
                                  t(progressStatus[item.id].progress as any) || progressStatus[item.id].progress :
                                  t('file_processing_uploading')
                              } else if (item.type === 'website') {
                                return progressStatus[item.id]?.progress || t('processing_status')
                              }
                              return t('processing_status')
                            })()}
                          </span>

                          {(() => {
                            const logData = parseProcessingLog(item.processingLog ?? null)
                            const progress = logData?.progress

                            if (progress && progress.total > 0) {
                              const percentage = (progress.current / progress.total) * 100
                              return (
                                <>
                                  <div className="flex-1 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-300"
                                      style={{ width: `${Math.min(percentage, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-blue-600 dark:text-blue-400 font-mono flex-shrink-0">
                                    {progress.current}/{progress.total}
                                  </span>
                                </>
                              )
                            } else {
                              return (
                                <div className="flex-1 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden relative">
                                  <div className="absolute top-0 h-full bg-gradient-to-r from-transparent via-blue-400 to-transparent rounded-full"
                                       style={{
                                         width: '30%',
                                         animation: 'slideProgress 2s ease-in-out infinite'
                                       }}>
                                  </div>
                                </div>
                              )
                            }
                          })()}
                        </div>

                        {(() => {
                          const logData = parseProcessingLog(item.processingLog ?? null)
                          const progress = logData?.progress
                          const retry = logData?.retry

                          return (
                            <div className="mt-1 space-y-1">
                              {progress?.currentUrl && (
                                <div className="text-blue-500 break-all">
                                  {(() => {
                                    try {
                                      return new URL(progress.currentUrl).pathname
                                    } catch {
                                      return progress.currentUrl
                                    }
                                  })()}
                                </div>
                              )}

                              {retry && logData?.status === 'retrying' && (
                                <div className="text-yellow-600 dark:text-yellow-400">
                                  {t('processing_retry_info')
                                    .replace('{current}', retry.attempt.toString())
                                    .replace('{max}', retry.maxAttempts.toString())
                                    .replace('{type}', retry.failureType || 'unknown')}
                                  {retry.nextRetryAt && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      ({t('processing_next_retry').replace('{time}', formatTimeOnlyWithUserSettings(retry.nextRetryAt, userTimeFormat))})
                                    </span>
                                  )}
                                </div>
                              )}

                              {!progress && item.type === 'website' && progressStatus[item.id]?.crawlCount && (
                                <div className="text-blue-600 dark:text-blue-400">
                                  {progressStatus[item.id].crawlCount} {progressStatus[item.id].crawlCount === 1 ? t('pages_processed_singular') : t('pages_processed')}
                                </div>
                              )}
                              {!progress?.currentUrl && item.type === 'website' && progressStatus[item.id]?.currentUrl && (
                                <div className="text-blue-500 break-all">
                                  {(() => {
                                    try {
                                      return new URL(progressStatus[item.id].currentUrl!).pathname
                                    } catch {
                                      return progressStatus[item.id].currentUrl
                                    }
                                  })()}
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-1">
                      {getStatusBadge(item)}
                      {isBusinessInfoItem(item) && (
                        <Badge variant="secondary" className="text-xs flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          {t('storage_business_info_badge')}
                        </Badge>
                      )}
                      <Badge variant="outline">
                        {t(`storage_type_${item.type}` as any)}
                      </Badge>
                      {item.ragProvider && (
                        <Badge variant="secondary" className="text-xs flex items-center gap-1">
                          {getRagProviderIcon(item.ragProvider, { size: 12 })}
                          {item.ragProvider === 'openai_vector_store' && 'OpenAI'}
                          {item.ragProvider === 'gemini_file_search' && 'Gemini'}
                          {item.ragProvider === 'pinecone' && 'Pinecone'}
                          {item.ragProvider === 'azure_ai_search' && 'Azure AI Search'}
                        </Badge>
                      )}
                      {item.fileSizeBytes && (
                        <span className="text-xs text-muted-foreground" title={item.ragProvider === 'azure_ai_search' ? t('storage_text_size_tooltip') : undefined}>
                          {formatFileSize(item.fileSizeBytes)}
                          {item.ragProvider === 'azure_ai_search' && ' (text)'}
                        </span>
                      )}
                      {item.type === 'website' && item.crawlCount && (
                        <span className="text-xs text-muted-foreground">
                          {item.crawlCount} {item.crawlCount === 1 ? t('storage_page_count_singular') : t('storage_page_count_plural')}
                        </span>
                      )}
                      {item.type === 'gitbook' && item.pageCount && item.pageCount > 1 && (
                        <span className="text-xs text-muted-foreground">
                          {item.pageCount} {t('storage_page_count_plural')}
                        </span>
                      )}
                      {item.blobPath && (
                        <a
                          href={`/api/storage/items/${item.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 hover:underline cursor-pointer"
                        >
                          <Download className="h-3 w-3" />
                          {t('storage_download_original')}
                        </a>
                      )}
                    </div>

                    {/* Content Preview - Website */}
                    {expandedItems.has(item.id) && item.type === 'website' && (
                      <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
                        <h4 className="text-sm font-medium mb-2">{t('content_label')}</h4>
                        <div className="text-xs text-muted-foreground max-h-32 overflow-y-auto">
                          <pre className="whitespace-pre-wrap">{item.content || t('no_content_available')}</pre>
                        </div>
                      </div>
                    )}

                    {/* Pages List - GitBook */}
                    {expandedItems.has(item.id) && item.type === 'gitbook' && item.pages && item.pages.length > 0 && (
                      <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
                        <h4 className="text-sm font-medium mb-2">{t('gitbook_included_pages')}</h4>
                        <ul className="text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                          {item.pages.map((page, idx) => (
                            <li key={idx} className="flex items-center gap-2">
                              <span className="text-muted-foreground/50">{idx + 1}.</span>
                              <span>{page.title}</span>
                              <span className="text-muted-foreground/50">({page.path})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end sm:justify-start space-x-2 sm:space-x-2 flex-shrink-0">
                  {(item.type === 'website' || (item.type === 'gitbook' && item.pages && item.pages.length > 0)) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleItemExpansion(item.id)}
                      className="p-3 sm:p-2 touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-[auto] sm:min-h-[auto]"
                    >
                      <Eye className="h-5 w-5 sm:h-4 sm:w-4" />
                    </Button>
                  )}
                  {item.blobPath && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        window.open(`/api/storage/items/${item.id}/download`, '_blank')
                      }}
                      className="p-3 sm:p-2 touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-[auto] sm:min-h-[auto] text-blue-600 hover:text-blue-700"
                      title={t('storage_download_original')}
                    >
                      <Download className="h-5 w-5 sm:h-4 sm:w-4" />
                    </Button>
                  )}
                  {item.status === 'failed' && item.type === 'website' && item.ragProvider !== 'azure_ai_search' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRetry(item)}
                      disabled={retryingItemIds.has(item.id)}
                      title={t('storage_retry_button')}
                      className="p-3 sm:p-2 touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-[auto] sm:min-h-[auto] text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      {retryingItemIds.has(item.id) ? (
                        <Loader2 className="h-5 w-5 sm:h-4 sm:w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-5 w-5 sm:h-4 sm:w-4" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setItemToDelete(item)}
                    disabled={deletingItemIds.has(item.id)}
                    className="p-3 sm:p-2 touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-[auto] sm:min-h-[auto] text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    {deletingItemIds.has(item.id) ? (
                      <Loader2 className="h-5 w-5 sm:h-4 sm:w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-5 w-5 sm:h-4 sm:w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('storage_delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('storage_delete_confirm_description')}
              <span className="block mt-2 font-medium text-foreground break-all">
                {itemToDelete?.title}
              </span>
              {itemToDelete?.type === 'gitbook' && itemToDelete?.pageCount && itemToDelete.pageCount > 1 && (
                <span className="block mt-1 text-xs">
                  ({itemToDelete.pageCount} {t('storage_page_count_plural')})
                </span>
              )}
              {itemToDelete && isBusinessInfoItem(itemToDelete) && (
                <span className="block mt-3 p-2 rounded-md text-sm bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  {t('storage_business_info_delete_warning')}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (itemToDelete) {
                  onDeleteItem(itemToDelete.id)
                  setItemToDelete(null)
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
