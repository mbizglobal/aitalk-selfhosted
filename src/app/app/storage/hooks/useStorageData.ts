
import { useState, useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import type { StorageData, StorageItem, StorageTab } from '../types'

interface UseStorageDataProps {
  currentAgentId: string | null
  activeTab: StorageTab
  selectedSpaceId?: number | null
  t: (key: string) => string
}

interface UseStorageDataReturn {
  storageData: StorageData | null
  isLoading: boolean
  progressStatus: Record<number, {
    progress?: string
    currentUrl?: string
    crawlCount?: number
  }>
  deletingItemIds: Set<number>

  hasProcessingWebsite: boolean

  loadStorageData: () => Promise<void>
  loadStorageDataWithType: (type: StorageTab | 'all') => Promise<void>
  loadOverallStats: () => Promise<void>
  handleDeleteItem: (itemId: number) => Promise<void>
  handleReload: () => Promise<void>
  showBackgroundMessage: boolean
  setShowBackgroundMessage: React.Dispatch<React.SetStateAction<boolean>>
  setStorageData: React.Dispatch<React.SetStateAction<StorageData | null>>
}

export function useStorageData({
  currentAgentId,
  activeTab,
  selectedSpaceId,
  t,
}: UseStorageDataProps): UseStorageDataReturn {
  const spaceParam = selectedSpaceId != null ? `&ragSpaceId=${selectedSpaceId}` : ''
  const [storageData, setStorageData] = useState<StorageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [progressStatus, setProgressStatus] = useState<Record<number, {
    progress?: string
    currentUrl?: string
    crawlCount?: number
  }>>({})
  const [deletingItemIds, setDeletingItemIds] = useState<Set<number>>(new Set())
  const [showBackgroundMessage, setShowBackgroundMessage] = useState(false)

  const hasProcessingWebsite = useMemo(() => {
    return storageData?.items?.some(item => item.type === 'website' && item.status === 'processing') || false
  }, [storageData])

  const loadOverallStats = useCallback(async () => {
    if (!currentAgentId) return

    try {
      const response = await fetch(`/api/storage?agentId=${currentAgentId}&limit=1&offset=0`)
      const data = await response.json()

      if (data.success) {
        setStorageData(prevData => {
          if (!prevData) {
            return data.data as StorageData
          }
          return {
            ...prevData,
            stats: data.data.stats,
          }
        })
      }
    } catch (error) {
      console.error('Failed to load overall stats:', error)
    }
  }, [currentAgentId])

  const loadStorageData = useCallback(async () => {
    if (!currentAgentId) return

    try {
      setIsLoading(true)
      const params = new URLSearchParams({
        limit: '50',
        offset: '0'
      })

      const apiType = activeTab === 'files' ? 'file' :
        activeTab === 'google-drive' ? 'google_drive' :
          activeTab === 'sharepoint' ? 'sharepoint' :
            activeTab
      params.set('type', apiType)

      const response = await fetch(`/api/storage?agentId=${currentAgentId}&${params}${spaceParam}`)
      const data = await response.json()

      if (data.success) {
        setStorageData(data.data)
        await loadOverallStats()
      } else {
        toast.error(t('storage_error_load_failed'))
      }
    } catch (error) {
      console.error('Failed to load storage data:', error)
      toast.error(t('storage_error_load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [currentAgentId, activeTab, spaceParam, t, loadOverallStats])

  const loadStorageDataWithType = useCallback(async (type: StorageTab | 'all') => {
    if (!currentAgentId) return

    try {
      setIsLoading(true)
      const params = new URLSearchParams({
        limit: '50',
        offset: '0'
      })

      if (type !== 'all') {
        const apiType = type === 'files' ? 'file' :
          type === 'google-drive' ? 'google_drive' :
            type
        params.set('type', apiType)
      }

      const response = await fetch(`/api/storage?agentId=${currentAgentId}&${params}${spaceParam}`)
      const data = await response.json()

      if (data.success) {
        setStorageData(data.data)
        if (type !== 'all') {
          await loadOverallStats()
        }
      } else {
        toast.error(t('storage_error_load_failed'))
      }
    } catch (error) {
      console.error('Failed to load storage data:', error)
      toast.error(t('storage_error_load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [currentAgentId, spaceParam, t, loadOverallStats])

  const handleDeleteItem = useCallback(async (itemId: number) => {
    if (!currentAgentId) return

    if (deletingItemIds.has(itemId)) return

    setDeletingItemIds(prev => new Set(prev).add(itemId))

    try {
      const response = await fetch(`/api/storage/items/${itemId}?agentId=${currentAgentId}`, {
        method: 'DELETE',
      })
      const data = await response.json()

      if (data.success) {
        toast.success(t('storage_delete_success'))
        await loadStorageDataWithType(activeTab)
      } else {
        toast.error(data.error || t('storage_delete_failed'))
      }
    } catch (error) {
      console.error('Failed to delete item:', error)
      toast.error(t('storage_delete_failed'))
    } finally {
      setDeletingItemIds(prev => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }, [currentAgentId, activeTab, t, loadStorageDataWithType, deletingItemIds])

  const handleReload = useCallback(async () => {
    if (!currentAgentId) {
      await loadStorageDataWithType(activeTab)
      toast.success(t('reload_button'))
      return
    }

    await loadStorageDataWithType(activeTab)

    try {
      const response = await fetch('/api/admin/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'fix-stuck-crawls',
          agentId: currentAgentId,
          dryRun: false
        }),
      })

      if (response.ok) {
        const result = await response.json()
        if (result.fixedCount && result.fixedCount > 0) {
          setTimeout(() => loadStorageDataWithType(activeTab), 1000)
          toast.success(`${t('reload_button')} - ${result.fixedCount}개 항목 자동 완료 처리`)
        } else {
          toast.success(t('reload_button'))
        }
      } else {
        toast.success(t('reload_button'))
      }
    } catch (error) {
      console.error('Auto cleanup during reload failed:', error)
      toast.success(t('reload_button'))
    }

    setShowBackgroundMessage(false)
  }, [currentAgentId, activeTab, t, loadStorageDataWithType])

  useEffect(() => {
    if (!storageData || !currentAgentId) return

    const processingItems = storageData.items.filter(
      item => item.status === 'processing' || item.status === 'deleting'
    )

    if (processingItems.length === 0) {
      return
    }

    const maxDuration = 30 * 60 * 1000
    const startTime = Date.now()

    const pollInterval = setInterval(async () => {
      if (Date.now() - startTime > maxDuration) {
        loadStorageDataWithType(activeTab)
        clearInterval(pollInterval)
        return
      }

      try {
        let hasChanges = false

        for (const item of processingItems) {
          try {
            const response = await fetch(`/api/storage/items/${item.id}/status?agentId=${currentAgentId}&t=${Date.now()}`)
            if (response.ok) {
              const statusData = await response.json()
              if (statusData.success && statusData.data.status !== 'processing') {
                hasChanges = true
                break
              }
            }
          } catch {
          }
        }

        if (hasChanges) {
          loadStorageDataWithType(activeTab)
        } else {
          const newProgressStatus: typeof progressStatus = {}

          for (const item of processingItems) {
            try {
              const response = await fetch(`/api/storage/items/${item.id}/status?agentId=${currentAgentId}&t=${Date.now()}`)
              if (response.ok) {
                const statusData = await response.json()
                if (statusData.success && statusData.data.realTimeStatus) {
                  newProgressStatus[item.id] = {
                    progress: statusData.data.realTimeStatus.progress,
                    currentUrl: statusData.data.realTimeStatus.currentUrl,
                    crawlCount: statusData.data.crawlCount
                  }
                }
              }
            } catch {
            }
          }

          setProgressStatus(prev => ({ ...prev, ...newProgressStatus }))
        }
      } catch {
      }
    }, 8000)

    return () => {
      clearInterval(pollInterval)
    }
  }, [storageData, currentAgentId, activeTab, loadStorageDataWithType])

  return {
    storageData,
    isLoading,
    progressStatus,
    deletingItemIds,
    hasProcessingWebsite,
    loadStorageData,
    loadStorageDataWithType,
    loadOverallStats,
    handleDeleteItem,
    handleReload,
    showBackgroundMessage,
    setShowBackgroundMessage,
    setStorageData,
  }
}
