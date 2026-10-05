
import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import type {
  GoogleDriveItem,
  GoogleDriveBreadcrumb,
  GoogleDriveFileInfo,
  PreviewFile,
  PreviewType,
} from '../types'

interface UseGoogleDriveBrowserProps {
  currentAgentId: string | null
  ragSpaceId?: number | null
  t: (key: string) => string
  onSyncComplete?: () => void
}

interface UseGoogleDriveBrowserReturn {
  googleDriveConnected: boolean
  setGoogleDriveConnected: (connected: boolean) => void
  googleDriveConsent: boolean
  setGoogleDriveConsent: (consent: boolean) => void
  isConnecting: boolean

  showBrowser: boolean
  setShowBrowser: (show: boolean) => void
  items: GoogleDriveItem[]
  selectedItems: Set<string>
  setSelectedItems: (items: Set<string>) => void
  selectedFileMap: Record<string, GoogleDriveFileInfo>
  setSelectedFileMap: (map: Record<string, GoogleDriveFileInfo>) => void

  currentFolder: string
  breadcrumb: GoogleDriveBreadcrumb[]
  history: string[]

  previewFile: PreviewFile | null
  previewContent: string
  previewType: PreviewType
  isLoadingPreview: boolean

  checkConnection: () => Promise<void>
  handleConnect: () => Promise<void>
  handleDisconnect: () => Promise<void>
  handleBrowse: () => Promise<void>
  handleNavigateFolder: (folderId: string, folderName: string, addToHistory?: boolean) => Promise<void>
  handleLoadItems: (folderId?: string) => Promise<void>
  handleSync: () => Promise<void>
  handleToggleItem: (item: GoogleDriveItem) => void
  handlePreview: (item: GoogleDriveItem) => Promise<void>
  closePreview: () => void
  handleBreadcrumbClick: (index: number) => void
}

const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/json',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-tex',
  'text/x-tex',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]

export function useGoogleDriveBrowser({
  currentAgentId,
  ragSpaceId,
  t,
  onSyncComplete,
}: UseGoogleDriveBrowserProps): UseGoogleDriveBrowserReturn {
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false)
  const [googleDriveConsent, setGoogleDriveConsent] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)

  const [showBrowser, setShowBrowser] = useState(false)
  const [items, setItems] = useState<GoogleDriveItem[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectedFileMap, setSelectedFileMap] = useState<Record<string, GoogleDriveFileInfo>>({})

  const [currentFolder, setCurrentFolder] = useState('root')
  const [breadcrumb, setBreadcrumb] = useState<GoogleDriveBreadcrumb[]>([{ id: 'root', name: 'My Drive' }])
  const [history, setHistory] = useState<string[]>(['root'])

  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [previewContent, setPreviewContent] = useState<string>('')
  const [previewType, setPreviewType] = useState<PreviewType>('text')
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)

  const checkConnection = useCallback(async () => {
    if (!currentAgentId) return
    try {
      const response = await fetch(`/api/storage/google-drive/disconnect?agentId=${currentAgentId}`)
      const data = await response.json()
      if (data.success) {
        setGoogleDriveConnected(data.data.connected)
      }
    } catch (error) {
      console.error('Failed to check Google Drive connection:', error)
      setGoogleDriveConnected(false)
    }
  }, [currentAgentId])

  const handleConnect = useCallback(async () => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    setIsConnecting(true)

    try {
      const response = await fetch(`/api/storage/google-drive/authorize?agentId=${currentAgentId}`)
      const data = await response.json()

      if (data.success && data.authUrl) {
        window.location.href = data.authUrl
      } else {
        toast.error(t('storage_google_drive_auth_failed'))
        setIsConnecting(false)
      }
    } catch (error) {
      console.error('Failed to connect Google Drive:', error)
      toast.error(t('storage_google_drive_connect_failed'))
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
      const response = await fetch(`/api/storage/google-drive/disconnect?agentId=${currentAgentId}`, {
        method: 'DELETE'
      })
      const data = await response.json()

      if (data.success) {
        toast.success(t('google_drive_disconnected'))
        setGoogleDriveConnected(false)
        onSyncComplete?.()
      } else {
        toast.error(data.error || t('storage_google_drive_disconnect_failed'))
      }
    } catch (error) {
      console.error('Failed to disconnect Google Drive:', error)
      toast.error(t('storage_google_drive_disconnect_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, t, onSyncComplete])

  const handleLoadItems = useCallback(async (folderId: string = 'root') => {
    if (!currentAgentId) return

    setIsConnecting(true)
    try {
      const response = await fetch(`/api/storage/google-drive/folders?agentId=${currentAgentId}&parentId=${folderId}`)
      const data = await response.json()

      if (data.success) {
        const filteredFiles = data.data.files.filter((file: any) => {
          if (!file.mimeType || !SUPPORTED_MIME_TYPES.includes(file.mimeType)) {
            return false
          }

          if (file.size) {
            const fileSizeBytes = parseInt(file.size)
            const isPdfOrPptx = file.mimeType === 'application/pdf' ||
                                file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            const sizeLimit = isPdfOrPptx ? 50 * 1024 * 1024 : 25 * 1024 * 1024
            if (fileSizeBytes > sizeLimit) {
              return false
            }
          }

          return true
        })

        const allItems = [
          ...data.data.folders.map((item: any) => ({ ...item, type: 'folder' })),
          ...filteredFiles.map((item: any) => ({ ...item, type: 'file' }))
        ]
        setItems(allItems)
        setCurrentFolder(folderId)
      } else {
        toast.error(data.error || t('storage_google_drive_load_failed'))
      }
    } catch (error) {
      console.error('Failed to load Google Drive items:', error)
      toast.error(t('storage_google_drive_load_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, t])

  const handleBrowse = useCallback(async () => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    setShowBrowser(true)

    const savedCurrentFolder = localStorage.getItem(`googleDriveCurrentFolder_${currentAgentId}`)
    const savedBreadcrumb = localStorage.getItem(`googleDriveBreadcrumb_${currentAgentId}`)
    const savedHistory = localStorage.getItem(`googleDriveHistory_${currentAgentId}`)

    let startFolderId = 'root'
    let startBreadcrumb = [{ id: 'root', name: t('google_drive_my_drive') }]
    let startHistory = ['root']

    try {
      if (savedCurrentFolder && savedCurrentFolder !== 'root') {
        startFolderId = savedCurrentFolder
      }

      if (savedBreadcrumb) {
        const parsedBreadcrumb = JSON.parse(savedBreadcrumb)
        if (parsedBreadcrumb && parsedBreadcrumb.length > 0) {
          startBreadcrumb = parsedBreadcrumb
        }
      }

      if (savedHistory) {
        const parsedHistory = JSON.parse(savedHistory)
        if (parsedHistory && parsedHistory.length > 0) {
          startHistory = parsedHistory
        }
      }
    } catch {
      startFolderId = 'root'
      startBreadcrumb = [{ id: 'root', name: t('google_drive_my_drive') }]
      startHistory = ['root']
    }

    setHistory(startHistory)
    setBreadcrumb(startBreadcrumb)
    setCurrentFolder(startFolderId)

    const lastBreadcrumb = startBreadcrumb[startBreadcrumb.length - 1]
    const initialState = { folderId: startFolderId, folderName: lastBreadcrumb?.name || t('google_drive_my_drive'), isGoogleDriveNav: true, isInitial: true }
    window.history.pushState(initialState, '', window.location.href)

    await handleLoadItems(startFolderId)
  }, [currentAgentId, t, handleLoadItems])

  const handleNavigateFolder = useCallback(async (folderId: string, folderName: string, addToHistory: boolean = true) => {
    if (!currentAgentId) return

    if (addToHistory) {
      const newHistory = [...history, folderId]
      setHistory(newHistory)
      localStorage.setItem(`googleDriveHistory_${currentAgentId}`, JSON.stringify(newHistory))

      const state = { folderId, folderName, isGoogleDriveNav: true }
      window.history.pushState(state, '', window.location.href)

      setBreadcrumb(prev => {
        const newBreadcrumb = [...prev, { id: folderId, name: folderName }]
        localStorage.setItem(`googleDriveBreadcrumb_${currentAgentId}`, JSON.stringify(newBreadcrumb))
        return newBreadcrumb
      })
    }

    localStorage.setItem(`googleDriveCurrentFolder_${currentAgentId}`, folderId)

    await handleLoadItems(folderId)
  }, [currentAgentId, history, handleLoadItems])

  const handleBreadcrumbClick = useCallback((index: number) => {
    if (!currentAgentId) return

    const folder = breadcrumb[index]
    if (!folder) return

    const newBreadcrumb = breadcrumb.slice(0, index + 1)
    setBreadcrumb(newBreadcrumb)
    localStorage.setItem(`googleDriveBreadcrumb_${currentAgentId}`, JSON.stringify(newBreadcrumb))

    const newHistory = history.slice(0, history.indexOf(folder.id) + 1)
    setHistory(newHistory.length > 0 ? newHistory : ['root'])
    localStorage.setItem(`googleDriveHistory_${currentAgentId}`, JSON.stringify(newHistory.length > 0 ? newHistory : ['root']))

    handleLoadItems(folder.id)
  }, [currentAgentId, breadcrumb, history, handleLoadItems])

  const handleToggleItem = useCallback((item: GoogleDriveItem) => {
    if (item.mimeType?.includes('folder')) {
      handleNavigateFolder(item.id, item.name)
      return
    }

    setSelectedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(item.id)) {
        newSet.delete(item.id)
        setSelectedFileMap(prevMap => {
          const newMap = { ...prevMap }
          delete newMap[item.id]
          return newMap
        })
      } else {
        if (newSet.size >= 20) {
          toast.error(t('maximum_files_error'))
          return prev
        }
        newSet.add(item.id)
        setSelectedFileMap(prevMap => ({
          ...prevMap,
          [item.id]: {
            id: item.id,
            name: item.name,
            mimeType: item.mimeType,
            resourceKey: item.resourceKey,
          }
        }))
      }
      return newSet
    })
  }, [t, handleNavigateFolder])

  const handleSync = useCallback(async () => {
    if (!currentAgentId || selectedItems.size === 0) {
      toast.error(t('google_drive_select_files_error'))
      return
    }

    if (selectedItems.size > 20) {
      toast.error(t('google_drive_max_files_error'))
      return
    }

    setIsConnecting(true)
    try {
      const selectedFilesArray = Array.from(selectedItems).map((fileId) => {
        const info = selectedFileMap[fileId] || items.find((item) => item.id === fileId)
        return {
          id: fileId,
          name: info?.name,
          mimeType: info?.mimeType,
          resourceKey: info?.resourceKey,
        }
      })

      const response = await fetch('/api/storage/google-drive/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: currentAgentId,
          selectedFiles: selectedFilesArray,
          ragSpaceId,
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(t('google_drive_sync_success').replace('{count}', (data.syncedCount || 0).toString()))
        setSelectedItems(new Set())
        setSelectedFileMap({})
        setShowBrowser(false)
        onSyncComplete?.()
      } else {
        toast.error(data.error || t('storage_google_drive_sync_failed'))
      }
    } catch (error) {
      console.error('Failed to sync Google Drive:', error)
      toast.error(t('storage_google_drive_sync_failed'))
    } finally {
      setIsConnecting(false)
    }
  }, [currentAgentId, ragSpaceId, selectedItems, selectedFileMap, items, t, onSyncComplete])

  const handlePreview = useCallback(async (item: GoogleDriveItem) => {
    if (!currentAgentId || !item.mimeType) return

    setIsLoadingPreview(true)
    setPreviewFile({
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      resourceKey: item.resourceKey,
    })

    if (item.mimeType === 'application/pdf') {
      setPreviewType('pdf')
      setPreviewContent('')
      setIsLoadingPreview(false)
      return
    }

    if (item.mimeType.startsWith('image/')) {
      try {
        const response = await fetch(`/api/storage/google-drive/preview?agentId=${currentAgentId}&fileId=${item.id}${item.resourceKey ? `&resourceKey=${encodeURIComponent(item.resourceKey)}` : ''}`)
        const data = await response.json()
        if (data.success && data.content) {
          setPreviewType('image')
          setPreviewContent(data.content)
        } else {
          setPreviewType('binary')
          setPreviewContent('')
        }
      } catch {
        setPreviewType('binary')
        setPreviewContent('')
      }
      setIsLoadingPreview(false)
      return
    }

    try {
      const response = await fetch(`/api/storage/google-drive/preview?agentId=${currentAgentId}&fileId=${item.id}${item.resourceKey ? `&resourceKey=${encodeURIComponent(item.resourceKey)}` : ''}`)
      const data = await response.json()
      if (data.success && data.content) {
        setPreviewType('text')
        setPreviewContent(data.content)
      } else {
        setPreviewType('binary')
        setPreviewContent('')
      }
    } catch {
      setPreviewType('binary')
      setPreviewContent('')
    }
    setIsLoadingPreview(false)
  }, [currentAgentId])

  const closePreview = useCallback(() => {
    setPreviewFile(null)
    setPreviewContent('')
    setPreviewType('text')
  }, [])

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (showBrowser && event.state?.isGoogleDriveNav) {
        const { folderId } = event.state

        const newHistory = history.slice(0, -1)
        setHistory(newHistory)

        const folderIndex = breadcrumb.findIndex(f => f.id === folderId)
        if (folderIndex >= 0) {
          const newBreadcrumb = breadcrumb.slice(0, folderIndex + 1)
          setBreadcrumb(newBreadcrumb)
        }

        handleLoadItems(folderId)
      } else if (showBrowser && !event.state?.isGoogleDriveNav) {
        const currentState = {
          folderId: currentFolder,
          folderName: breadcrumb[breadcrumb.length - 1]?.name || t('google_drive_my_drive'),
          isGoogleDriveNav: true
        }
        window.history.pushState(currentState, '', window.location.href)
      } else if (showBrowser && currentFolder === 'root') {
        const currentState = {
          folderId: 'root',
          folderName: t('google_drive_my_drive'),
          isGoogleDriveNav: true
        }
        window.history.pushState(currentState, '', window.location.href)
      }
    }

    if (showBrowser) {
      window.addEventListener('popstate', handlePopState)
      return () => window.removeEventListener('popstate', handlePopState)
    }
  }, [showBrowser, history, breadcrumb, currentFolder, handleLoadItems, t])

  return {
    googleDriveConnected,
    setGoogleDriveConnected,
    googleDriveConsent,
    setGoogleDriveConsent,
    isConnecting,

    showBrowser,
    setShowBrowser,
    items,
    selectedItems,
    setSelectedItems,
    selectedFileMap,
    setSelectedFileMap,

    currentFolder,
    breadcrumb,
    history,

    previewFile,
    previewContent,
    previewType,
    isLoadingPreview,

    checkConnection,
    handleConnect,
    handleDisconnect,
    handleBrowse,
    handleNavigateFolder,
    handleLoadItems,
    handleSync,
    handleToggleItem,
    handlePreview,
    closePreview,
    handleBreadcrumbClick,
  }
}
