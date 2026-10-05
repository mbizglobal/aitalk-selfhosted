'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useLanguage } from '@/hooks/useLanguage'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import { FilesTab, WebsiteTab, GoogleDriveTab, SharePointTab, GitBookTab, StorageList, StorageStats, SpaceSelector } from './components'
import type { GitBookTabRef } from './components'
import { useSharePointBrowser, useGoogleDriveBrowser, useStorageData, useRagProvider, useRagSpaces } from './hooks'
import { SharePointBrowserModal, GoogleDriveBrowserModal, FilePreviewModal } from './modals'
import type { StorageTab } from './types'
import { useEdition } from '@/components/EditionProvider'
import { offFeatureFor } from '@/lib/edition-features'

const TAB_KNOWLEDGE_SOURCE: Record<StorageTab, string | undefined> = {
  website: 'website',
  files: undefined,
  'google-drive': 'google_drive',
  sharepoint: 'sharepoint',
  gitbook: 'gitbook',
}

export default function StoragePage() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get('tab')

  const edition = useEdition()
  const validTabs: StorageTab[] = (['website', 'files', 'google-drive', 'sharepoint', 'gitbook'] as StorageTab[])
    .filter((tab) => !offFeatureFor('knowledgeSources', TAB_KNOWLEDGE_SOURCE[tab], edition))

  const [activeTab, setActiveTab] = useState<StorageTab>(() => {
    return validTabs.includes(tabParam as StorageTab) ? (tabParam as StorageTab) : validTabs[0]
  })

  const handleTabChange = useCallback((newTab: StorageTab) => {
    setActiveTab(newTab)
    router.push(`/app/storage?tab=${newTab}`, { scroll: false })
  }, [router])

  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null)
  const [agentTitle, setAgentTitle] = useState<string>('')

  const [userTimeFormat, setUserTimeFormat] = useState<string>('MM-DD-YYYY HH:mm')

  const gitBookTabRef = useRef<GitBookTabRef>(null)

  const { selectedProvider: ragProvider, docPages } = useRagProvider()

  const ragSpaces = useRagSpaces(currentAgentId, t)
  const { selectedSpaceId } = ragSpaces

  const storageDataHook = useStorageData({
    currentAgentId,
    activeTab,
    selectedSpaceId,
    t
  })

  const {
    storageData,
    isLoading,
    progressStatus,
    deletingItemIds,
    hasProcessingWebsite,
    loadStorageData,
    loadStorageDataWithType,
    handleDeleteItem,
    handleReload,
    showBackgroundMessage,
    setShowBackgroundMessage,
    setStorageData,
  } = storageDataHook

  const handleDeleteItemWithGitBookReload = useCallback(async (itemId: number) => {
    const item = storageData?.items.find(i => i.id === itemId)
    const isGitBookItem = item?.type === 'gitbook'

    await handleDeleteItem(itemId)

    if (isGitBookItem && gitBookTabRef.current) {
      setTimeout(() => {
        gitBookTabRef.current?.reloadPages()
      }, 500)
    }
  }, [handleDeleteItem, storageData?.items])

  const onSyncStarted = useCallback(() => {
    setShowBackgroundMessage(true)
    loadStorageData()
  }, [loadStorageData, setShowBackgroundMessage])

  const sharePoint = useSharePointBrowser({
    currentAgentId,
    ragProvider,
    ragSpaceId: selectedSpaceId,
    t,
    onSyncComplete: onSyncStarted
  })

  const googleDrive = useGoogleDriveBrowser({
    currentAgentId,
    ragSpaceId: selectedSpaceId,
    t,
    onSyncComplete: onSyncStarted
  })

  const {
    sharePointConnected,
    setSharePointConnected,
    isConnecting: isConnectingSharePoint,
    showBrowser: showSharePointBrowser,
    setShowBrowser: setShowSharePointBrowser,
    sites: sharePointSites,
    drives: sharePointDrives,
    items: sharePointItems,
    selectedItems: selectedSharePointItems,
    selectedSite: selectedSharePointSite,
    selectedDrive: selectedSharePointDrive,
    breadcrumb: sharePointBreadcrumb,
    checkConnection: checkSharePointConnection,
    handleBrowse: handleBrowseSharePoint,
    handleSelectSite: handleSelectSharePointSite,
    handleSelectDrive: handleSelectSharePointDrive,
    handleNavigateFolder: handleNavigateSharePointFolder,
    handleSync: handleSyncSharePoint,
    handleToggleItem: handleToggleSharePointItem,
    handleBackToSites: handleBackToSharePointSites,
    handleBackToDrives: handleBackToSharePointDrives,
  } = sharePoint

  const {
    setGoogleDriveConnected,
    isConnecting: isConnectingGoogleDrive,
    showBrowser: showGoogleDriveBrowser,
    setShowBrowser: setShowGoogleDriveBrowser,
    items: googleDriveItems,
    selectedItems: selectedGoogleDriveItems,
    selectedFileMap: selectedGoogleDriveFileMap,
    breadcrumb: googleDriveBreadcrumb,
    previewFile,
    previewContent,
    previewType,
    isLoadingPreview,
    checkConnection: checkGoogleDriveConnection,
    handleNavigateFolder: navigateToGoogleDriveFolder,
    handleSync: handleSyncSelectedItems,
    handleToggleItem: handleToggleGoogleDriveItem,
    handlePreview: handlePreviewFile,
    closePreview: closeGoogleDrivePreview,
    handleBreadcrumbClick: handleGoogleDriveBreadcrumbClick,
  } = googleDrive

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam as StorageTab) && tabParam !== activeTab) {
      setActiveTab(tabParam as StorageTab)
    }
  }, [tabParam, activeTab, validTabs])

  useEffect(() => {
    const fetchCurrentAgent = async () => {
      try {
        const storedAgentId = localStorage.getItem('activeAgentId')

        if (storedAgentId) {
          const response = await fetch('/api/agents')
          const data = await response.json()
          if (data.success && data.agents.length > 0) {
            const agent = data.agents.find((a: any) => a.agentId === storedAgentId)

            if (agent) {
              setCurrentAgentId(agent.agentId)
              setAgentTitle(agent.title || '')
            } else {
              setCurrentAgentId(data.agents[0].agentId)
              setAgentTitle(data.agents[0].title || '')
              localStorage.setItem('activeAgentId', data.agents[0].agentId)
            }
          }
        } else {
          const response = await fetch('/api/agents')
          const data = await response.json()
          if (data.success && data.agents.length > 0) {
            setCurrentAgentId(data.agents[0].agentId)
            setAgentTitle(data.agents[0].title || '')
            localStorage.setItem('activeAgentId', data.agents[0].agentId)
          }
        }
      } catch (error) {
        console.error('Failed to fetch agent:', error)
      }
    }

    fetchCurrentAgent()
  }, [])

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        const response = await fetch('/api/dashboard/user-info')
        const data = await response.json()
        if (data.success && data.data?.time_format) {
          setUserTimeFormat(data.data.time_format)
        }
      } catch (error) {
        console.error('Failed to fetch user info:', error)
      }
    }

    fetchUserInfo()
  }, [])

  useEffect(() => {
    if (currentAgentId && ragSpaces.ready) {
      loadStorageData()
      if (activeTab === 'google-drive') {
        checkGoogleDriveConnection()
      }
      if (activeTab === 'sharepoint') {
        checkSharePointConnection()
      }
    }
  }, [currentAgentId, activeTab, selectedSpaceId, ragSpaces.ready])

  const driveTabShown = validTabs.includes('google-drive')
  const sharePointTabShown = validTabs.includes('sharepoint')
  useEffect(() => {
    if (currentAgentId) {
      if (driveTabShown) checkGoogleDriveConnection()
      if (sharePointTabShown) checkSharePointConnection()
    }
  }, [currentAgentId, driveTabShown, sharePointTabShown])

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const success = urlParams.get('success')
    const error = urlParams.get('error')
    const tab = urlParams.get('tab')

    if (tab === 'google_drive' && driveTabShown) {
      setActiveTab('google-drive')
    }
    if (tab === 'sharepoint' && sharePointTabShown) {
      setActiveTab('sharepoint')
    }
    if ((success || error) && (tab === 'sharepoint' ? !sharePointTabShown : !driveTabShown)) return

    if (success === 'connected') {
      if (tab === 'sharepoint') {
        toast.success(t('sharepoint_connected'))
        setSharePointConnected(true)
      } else {
        toast.success(t('google_drive_connected_success'))
        setGoogleDriveConnected(true)
      }
      setTimeout(() => {
        const newUrl = window.location.pathname
        window.history.replaceState({}, '', newUrl)
      }, 100)
    }

    if (error) {
      let errorMessage = tab === 'sharepoint' ? t('storage_sharepoint_connect_failed') : t('storage_google_drive_connect_failed')
      switch (error) {
        case 'authorization_denied':
          errorMessage = t('authorization_denied')
          break
        case 'invalid_callback':
          errorMessage = t('invalid_callback_parameters')
          break
        case 'user_not_found':
          errorMessage = t('user_not_found')
          break
        case 'account_already_linked':
          errorMessage = t('storage_account_already_linked')
          break
        case 'link_retry':
          errorMessage = t('storage_link_retry')
          break
        case 'session_mismatch':
          errorMessage = t('storage_session_mismatch')
          break
        case 'invalid_state':
          errorMessage = t('storage_invalid_state')
          break
      }
      toast.error(errorMessage)
      setTimeout(() => {
        const newUrl = window.location.pathname
        window.history.replaceState({}, '', newUrl)
      }, 100)
    }
  }, [])


  if (isLoading && !storageData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('storage_title')}</h1>
        {agentTitle && (
          <p className="text-sm text-muted-foreground mt-1">
            {t('chat_settings_ai_assistant_label')} <span className="font-medium text-foreground">{agentTitle}</span>
          </p>
        )}
      </div>

      {ragSpaces.managed && ragSpaces.spaces.length > 0 && (
        <SpaceSelector
          spaces={ragSpaces.spaces}
          max={ragSpaces.max}
          selectedSpaceId={ragSpaces.selectedSpaceId}
          onSelect={ragSpaces.setSelectedSpaceId}
          onCreate={ragSpaces.createSpace}
          onRename={ragSpaces.renameSpace}
          onDelete={ragSpaces.deleteSpace}
          t={t}
        />
      )}

      {/* Tab Navigation - Mobile Optimized */}
      <div className="w-full overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex flex-wrap gap-1 bg-muted rounded-lg p-1 w-full md:inline-flex md:flex-nowrap md:gap-0 md:w-auto">
            {validTabs.includes('website') && (
              <button
                onClick={() => handleTabChange('website')}
                className={cn(
                  'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                  activeTab === 'website'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('storage_website_tab')}
              </button>
            )}
            <button
              onClick={() => handleTabChange('files')}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === 'files'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('storage_files_tab')}
            </button>
            {validTabs.includes('google-drive') && (
              <button
                onClick={() => handleTabChange('google-drive')}
                className={cn(
                  'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                  activeTab === 'google-drive'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('storage_google_drive_tab')}
              </button>
            )}
            {validTabs.includes('sharepoint') && (
              <button
                onClick={() => handleTabChange('sharepoint')}
                className={cn(
                  'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                  activeTab === 'sharepoint'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('storage_sharepoint_tab')}
              </button>
            )}
            {validTabs.includes('gitbook') && (
              <button
                onClick={() => handleTabChange('gitbook')}
                className={cn(
                  'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                  activeTab === 'gitbook'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('storage_gitbook_tab')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Storage Statistics */}
      {storageData && <StorageStats stats={storageData.stats} t={t} docPages={docPages} />}

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'website' && (
          <WebsiteTab
            currentAgentId={currentAgentId}
            ragSpaceId={selectedSpaceId}
            hasProcessingWebsite={hasProcessingWebsite}
            onRefresh={() => loadStorageDataWithType('website')}
            setShowBackgroundMessage={setShowBackgroundMessage}
          />
        )}

        {activeTab === 'files' && (
          <FilesTab
            currentAgentId={currentAgentId}
            ragSpaceId={selectedSpaceId}
            onTabChange={handleTabChange}
            onRefresh={() => loadStorageDataWithType('files')}
            setShowBackgroundMessage={setShowBackgroundMessage}
          />
        )}

        {activeTab === 'google-drive' && (
          <GoogleDriveTab
            currentAgentId={currentAgentId}
            ragSpaceId={selectedSpaceId}
            onRefresh={() => loadStorageDataWithType('google-drive')}
            setShowBackgroundMessage={setShowBackgroundMessage}
          />
        )}

        {activeTab === 'sharepoint' && (
          <SharePointTab
            currentAgentId={currentAgentId}
            sharePointConnected={sharePointConnected}
            isConnectingSharePoint={isConnectingSharePoint}
            onConnectSharePoint={sharePoint.handleConnect}
            onDisconnectSharePoint={sharePoint.handleDisconnect}
            onBrowseSharePoint={handleBrowseSharePoint}
            onRefresh={() => loadStorageDataWithType('sharepoint')}
          />
        )}

        {/* GitBook Tab */}
        {activeTab === 'gitbook' && (
          <GitBookTab
            ref={gitBookTabRef}
            currentAgentId={currentAgentId}
            ragSpaceId={selectedSpaceId}
            onRefresh={() => loadStorageDataWithType('gitbook')}
            setShowBackgroundMessage={setShowBackgroundMessage}
          />
        )}
      </div>

      {/* Storage Items List */}
      <StorageList
        items={storageData?.items || []}
        isLoading={isLoading}
        t={t}
        userTimeFormat={userTimeFormat}
        progressStatus={progressStatus}
        showBackgroundMessage={showBackgroundMessage}
        deletingItemIds={deletingItemIds}
        onReload={handleReload}
        onDeleteItem={handleDeleteItemWithGitBookReload}
      />

      {/* Google Drive File Browser Dialog */}
      <GoogleDriveBrowserModal
        open={showGoogleDriveBrowser}
        onOpenChange={setShowGoogleDriveBrowser}
        t={t}
        userTimeFormat={userTimeFormat}
        isConnecting={isConnectingGoogleDrive}
        items={googleDriveItems}
        selectedItems={selectedGoogleDriveItems}
        selectedFileMap={selectedGoogleDriveFileMap}
        breadcrumb={googleDriveBreadcrumb}
        onNavigateFolder={navigateToGoogleDriveFolder}
        onToggleItem={handleToggleGoogleDriveItem}
        onBreadcrumbClick={handleGoogleDriveBreadcrumbClick}
        onSync={handleSyncSelectedItems}
        onPreview={handlePreviewFile}
      />

      {/* SharePoint File Browser Dialog */}
      <SharePointBrowserModal
        open={showSharePointBrowser}
        onOpenChange={setShowSharePointBrowser}
        t={t}
        userTimeFormat={userTimeFormat}
        isConnecting={isConnectingSharePoint}
        sites={sharePointSites}
        drives={sharePointDrives}
        items={sharePointItems}
        selectedItems={selectedSharePointItems}
        selectedSite={selectedSharePointSite}
        selectedDrive={selectedSharePointDrive}
        breadcrumb={sharePointBreadcrumb}
        onSelectSite={handleSelectSharePointSite}
        onSelectDrive={handleSelectSharePointDrive}
        onNavigateFolder={handleNavigateSharePointFolder}
        onToggleItem={handleToggleSharePointItem}
        onSync={handleSyncSharePoint}
        onBackToSites={handleBackToSharePointSites}
        onBackToDrives={handleBackToSharePointDrives}
      />

      {/* File Preview Modal */}
      <FilePreviewModal
        file={previewFile}
        onClose={closeGoogleDrivePreview}
        t={t}
        currentAgentId={currentAgentId}
        isLoading={isLoadingPreview}
        previewContent={previewContent}
        previewType={previewType}
      />
    </div>
  )
}
