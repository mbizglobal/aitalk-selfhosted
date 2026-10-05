
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type {
  SharePointSite,
  SharePointDrive,
  SharePointItem,
  SharePointBreadcrumb,
} from '../types'

interface UseSharePointBrowserProps {
  currentAgentId: string | null
  ragProvider?: string
  ragSpaceId?: number | null
  t: (key: string) => string
  onSyncComplete?: () => void
}

interface UseSharePointBrowserReturn {
  sharePointConnected: boolean
  setSharePointConnected: (connected: boolean) => void
  isConnecting: boolean

  showBrowser: boolean
  setShowBrowser: (show: boolean) => void
  sites: SharePointSite[]
  drives: SharePointDrive[]
  items: SharePointItem[]
  selectedItems: Set<string>
  setSelectedItems: (items: Set<string>) => void

  selectedSite: SharePointSite | null
  selectedDrive: SharePointDrive | null
  breadcrumb: SharePointBreadcrumb[]
  currentFolder: string

  checkConnection: () => Promise<void>
  handleConnect: () => Promise<void>
  handleDisconnect: () => Promise<void>
  handleBrowse: () => Promise<void>
  handleSelectSite: (site: SharePointSite) => Promise<void>
  handleSelectDrive: (drive: SharePointDrive) => Promise<void>
  handleNavigateFolder: (folderId: string, folderName: string, isBack?: boolean) => Promise<void>
  handleSync: () => Promise<void>
  handleToggleItem: (itemId: string) => void
  handleBackToSites: () => void
  handleBackToDrives: () => void
}

export function useSharePointBrowser({
  currentAgentId,
  ragProvider,
  ragSpaceId,
  t,
  onSyncComplete,
}: UseSharePointBrowserProps): UseSharePointBrowserReturn {
  const [sharePointConnected, setSharePointConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  const [showBrowser, setShowBrowser] = useState(false)
  const [sites, setSites] = useState<SharePointSite[]>([])
  const [drives, setDrives] = useState<SharePointDrive[]>([])
  const [items, setItems] = useState<SharePointItem[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  const [selectedSite, setSelectedSite] = useState<SharePointSite | null>(null)
  const [selectedDrive, setSelectedDrive] = useState<SharePointDrive | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<SharePointBreadcrumb[]>([])
  const [currentFolder, setCurrentFolder] = useState('root')

  const getStorageKey = useCallback((key: string) => {
    return `sharepoint${key}_${currentAgentId}`
  }, [currentAgentId])

  const checkConnection = useCallback(async () => {
    if (!currentAgentId) return
    try {
      const response = await fetch(`/api/storage/sharepoint/disconnect?agentId=${currentAgentId}`)
      const data = await response.json()
      if (data.success) {
        setSharePointConnected(data.data.connected)
      }
    } catch (error) {
      console.error('Failed to check SharePoint connection:', error)
      setSharePointConnected(false)
    }
  }, [currentAgentId])

  const handleConnect = useCallback(async () => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    setIsConnecting(true)

    try {
      const response = await fetch(`/api/storage/sharepoint/authorize?agentId=${currentAgentId}`)
      const data = await response.json()

      if (data.success && data.authUrl) {
        window.location.href = data.authUrl
      } else {
        toast.error(t('storage_sharepoint_auth_failed'))
      }
    } catch (error) {
      console.error('Failed to connect SharePoint:', error)
      toast.error(t('storage_sharepoint_connect_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, t])

  const handleDisconnect = useCallback(async () => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    setIsConnecting(true)

    try {
      const response = await fetch(`/api/storage/sharepoint/disconnect?agentId=${currentAgentId}`, {
        method: 'DELETE'
      })
      const data = await response.json()

      if (data.success) {
        toast.success(t('sharepoint_disconnected'))
        setSharePointConnected(false)
        onSyncComplete?.()
      } else {
        toast.error(data.error || t('storage_sharepoint_disconnect_failed'))
      }
    } catch (error) {
      console.error('Failed to disconnect SharePoint:', error)
      toast.error(t('storage_sharepoint_disconnect_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, t, onSyncComplete])

  const handleBrowse = useCallback(async () => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    setShowBrowser(true)
    setIsConnecting(true)

    try {
      const stateKeys = {
        site: getStorageKey('Site'),
        drive: getStorageKey('Drive'),
        breadcrumb: getStorageKey('Breadcrumb'),
        folder: getStorageKey('CurrentFolder'),
        items: getStorageKey('Items'),
      }

      const savedSite = localStorage.getItem(stateKeys.site)
      const savedDrive = localStorage.getItem(stateKeys.drive)
      const savedBreadcrumb = localStorage.getItem(stateKeys.breadcrumb)
      const savedFolder = localStorage.getItem(stateKeys.folder)
      const savedItems = localStorage.getItem(stateKeys.items)

      const sitesResponse = await fetch(`/api/storage/sharepoint/sites?agentId=${currentAgentId}`)
      const sitesData = await sitesResponse.json()

      if (!sitesData.success) {
        if (sitesData.error === 'NO_SPO_LICENSE') {
          toast.error(t('sharepoint_no_license'))
        } else {
          toast.error(sitesData.error || t('storage_sharepoint_sites_failed'))
        }
        setShowBrowser(false)
        return
      }

      setSites(sitesData.data.sites)

      if (savedSite) {
        try {
          const parsedSite = JSON.parse(savedSite)
          if (parsedSite?.id) {
            const siteMatch = sitesData.data.sites.find((site: SharePointSite) => site.id === parsedSite.id)
            if (siteMatch) {
              setSelectedSite(siteMatch)

              const drivesResponse = await fetch(`/api/storage/sharepoint/folders?agentId=${currentAgentId}&siteId=${parsedSite.id}`)
              const drivesData = await drivesResponse.json()

              if (drivesData.success) {
                setDrives(drivesData.data.drives)

                if (savedDrive) {
                  const parsedDrive = JSON.parse(savedDrive)
                  if (parsedDrive?.id) {
                    const driveMatch = drivesData.data.drives.find((drive: SharePointDrive) => drive.id === parsedDrive.id)
                    if (driveMatch) {
                      setSelectedDrive(driveMatch)

                      const folderId = savedFolder || 'root'
                      const itemsResponse = await fetch(`/api/storage/sharepoint/folders?agentId=${currentAgentId}&siteId=${parsedSite.id}&driveId=${parsedDrive.id}&parentId=${folderId}${ragProvider ? `&ragProvider=${ragProvider}` : ''}`)
                      const itemsData = await itemsResponse.json()

                      if (itemsData.success) {
                        const mergedItems = [
                          ...(itemsData.data.folders || []).map((item: any) => ({ ...item, type: 'folder' as const })),
                          ...(itemsData.data.files || []).map((item: any) => ({ ...item, type: 'file' as const }))
                        ]
                        setItems(mergedItems)
                        setCurrentFolder(folderId)
                        localStorage.setItem(stateKeys.items, JSON.stringify(mergedItems))
                        localStorage.setItem(stateKeys.folder, folderId)

                        if (savedBreadcrumb) {
                          try {
                            const parsedBreadcrumb = JSON.parse(savedBreadcrumb)
                            if (Array.isArray(parsedBreadcrumb) && parsedBreadcrumb.length > 0) {
                              setBreadcrumb(parsedBreadcrumb)
                              localStorage.setItem(stateKeys.breadcrumb, JSON.stringify(parsedBreadcrumb))
                            }
                          } catch {
                          }
                        } else {
                          const defaultBreadcrumb = [{ id: 'root', name: driveMatch.name }]
                          setBreadcrumb(defaultBreadcrumb)
                          localStorage.setItem(stateKeys.breadcrumb, JSON.stringify(defaultBreadcrumb))
                        }

                        if (savedItems) {
                          try {
                            const parsedItems = JSON.parse(savedItems)
                            if (Array.isArray(parsedItems)) {
                              setItems(parsedItems)
                              localStorage.setItem(stateKeys.items, JSON.stringify(parsedItems))
                              return
                            }
                          } catch {
                          }
                        }

                        return
                      }
                    }
                  }
                }
              }
            }
          }
        } catch {
        }
      }

      setSelectedSite(null)
      setDrives([])
      setItems([])
      setBreadcrumb([])
      setCurrentFolder('root')
      localStorage.removeItem(stateKeys.site)
      localStorage.removeItem(stateKeys.drive)
      localStorage.removeItem(stateKeys.breadcrumb)
      localStorage.removeItem(stateKeys.folder)
      localStorage.removeItem(stateKeys.items)
    } catch (error) {
      console.error('Failed to load SharePoint sites:', error)
      toast.error(t('storage_sharepoint_sites_failed'))
      setShowBrowser(false)
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, ragProvider, t, getStorageKey])

  const handleSelectSite = useCallback(async (site: SharePointSite) => {
    if (!currentAgentId) return

    setIsConnecting(true)
    setSelectedSite(site)
    localStorage.setItem(getStorageKey('Site'), JSON.stringify(site))
    localStorage.removeItem(getStorageKey('Drive'))
    localStorage.removeItem(getStorageKey('Breadcrumb'))
    localStorage.removeItem(getStorageKey('CurrentFolder'))
    localStorage.removeItem(getStorageKey('Items'))

    try {
      const response = await fetch(`/api/storage/sharepoint/folders?agentId=${currentAgentId}&siteId=${site.id}`)
      const data = await response.json()

      if (data.success) {
        setDrives(data.data.drives)
      } else {
        toast.error(data.error || t('storage_sharepoint_drives_failed'))
      }
    } catch (error) {
      console.error('Failed to load SharePoint drives:', error)
      toast.error(t('storage_sharepoint_drives_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, t, getStorageKey])

  const handleSelectDrive = useCallback(async (drive: SharePointDrive) => {
    if (!currentAgentId || !selectedSite) return

    setIsConnecting(true)
    setSelectedDrive(drive)
    localStorage.setItem(getStorageKey('Drive'), JSON.stringify(drive))
    localStorage.setItem(getStorageKey('Breadcrumb'), JSON.stringify([{ id: 'root', name: drive.name }]))
    localStorage.setItem(getStorageKey('CurrentFolder'), 'root')

    try {
      const response = await fetch(`/api/storage/sharepoint/folders?agentId=${currentAgentId}&siteId=${selectedSite.id}&driveId=${drive.id}&parentId=root${ragProvider ? `&ragProvider=${ragProvider}` : ''}`)
      const data = await response.json()

      if (data.success) {
        const allItems = [
          ...(data.data.folders || []).map((item: any) => ({ ...item, type: 'folder' as const })),
          ...(data.data.files || []).map((item: any) => ({ ...item, type: 'file' as const }))
        ]
        setItems(allItems)
        setBreadcrumb([{ id: 'root', name: drive.name }])
        setCurrentFolder('root')
        localStorage.setItem(getStorageKey('Items'), JSON.stringify(allItems))
      } else {
        toast.error(data.error || t('storage_sharepoint_load_failed'))
      }
    } catch (error) {
      console.error('Failed to load SharePoint items:', error)
      toast.error(t('storage_sharepoint_load_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, ragProvider, selectedSite, t, getStorageKey])

  const handleNavigateFolder = useCallback(async (folderId: string, folderName: string, isBack: boolean = false) => {
    if (!currentAgentId || !selectedSite || !selectedDrive) return

    setIsConnecting(true)

    try {
      const response = await fetch(`/api/storage/sharepoint/folders?agentId=${currentAgentId}&siteId=${selectedSite.id}&driveId=${selectedDrive.id}&parentId=${folderId}${ragProvider ? `&ragProvider=${ragProvider}` : ''}`)
      const data = await response.json()

      if (data.success) {
        const allItems = [
          ...(data.data.folders || []).map((item: any) => ({ ...item, type: 'folder' as const })),
          ...(data.data.files || []).map((item: any) => ({ ...item, type: 'file' as const }))
        ]
        setItems(allItems)
        setCurrentFolder(folderId)
        localStorage.setItem(getStorageKey('CurrentFolder'), folderId)
        localStorage.setItem(getStorageKey('Items'), JSON.stringify(allItems))

        if (!isBack) {
          setBreadcrumb(prev => {
            if (prev.some(b => b.id === folderId)) {
              return prev
            }
            const updated = [...prev, { id: folderId, name: folderName }]
            localStorage.setItem(getStorageKey('Breadcrumb'), JSON.stringify(updated))
            return updated
          })
        } else {
          setBreadcrumb(prev => {
            const targetIndex = prev.findIndex(b => b.id === folderId)
            if (targetIndex >= 0) {
              const trimmed = prev.slice(0, targetIndex + 1)
              localStorage.setItem(getStorageKey('Breadcrumb'), JSON.stringify(trimmed))
              return trimmed
            }
            localStorage.setItem(getStorageKey('Breadcrumb'), JSON.stringify(prev))
            return prev
          })
        }
      } else {
        toast.error(data.error || t('storage_sharepoint_load_failed'))
      }
    } catch (error) {
      console.error('Failed to navigate SharePoint folder:', error)
      toast.error(t('storage_sharepoint_load_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, ragProvider, selectedSite, selectedDrive, t, getStorageKey])

  const handleSync = useCallback(async () => {
    if (!currentAgentId || !selectedSite || !selectedDrive || selectedItems.size === 0) {
      toast.error(t('no_files_selected'))
      return
    }

    if (selectedItems.size > 20) {
      toast.error('Maximum 20 files can be selected')
      return
    }

    setIsConnecting(true)
    try {
      const response = await fetch('/api/storage/sharepoint/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: currentAgentId,
          selectedFiles: Array.from(selectedItems),
          siteId: selectedSite.id,
          driveId: selectedDrive.id,
          ragSpaceId,
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(t('files_queued_successfully').replace('{count}', data.syncedCount.toString()))
        setSelectedItems(new Set())
        setShowBrowser(false)
        onSyncComplete?.()
      } else {
        toast.error(data.error || t('storage_sharepoint_sync_failed'))
      }
    } catch (error) {
      console.error('Failed to sync SharePoint:', error)
      toast.error(t('storage_sharepoint_sync_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, ragSpaceId, selectedSite, selectedDrive, selectedItems, t, onSyncComplete])

  const handleToggleItem = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const newSelected = new Set(prev)
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId)
      } else {
        if (newSelected.size >= 20) {
          toast.error(t('maximum_files_error'))
          return prev
        }
        newSelected.add(itemId)
      }
      return newSelected
    })
  }, [t])

  const handleBackToSites = useCallback(() => {
    setSelectedSite(null)
    setDrives([])
  }, [])

  const handleBackToDrives = useCallback(() => {
    setSelectedDrive(null)
    setItems([])
    setBreadcrumb([])
    setSelectedItems(new Set())
  }, [])

  return {
    sharePointConnected,
    setSharePointConnected,
    isConnecting,

    showBrowser,
    setShowBrowser,
    sites,
    drives,
    items,
    selectedItems,
    setSelectedItems,

    selectedSite,
    selectedDrive,
    breadcrumb,
    currentFolder,

    checkConnection,
    handleConnect,
    handleDisconnect,
    handleBrowse,
    handleSelectSite,
    handleSelectDrive,
    handleNavigateFolder,
    handleSync,
    handleToggleItem,
    handleBackToSites,
    handleBackToDrives,
  }
}
