'use client'

import { useState, useEffect, useMemo } from 'react'
import { useLanguage } from '@/hooks/useLanguage'
import { useRagProvider } from '../../hooks/useRagProvider'
import { RagProviderDisplay } from '../shared/RagProviderDisplay'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Cloud, CloudOff, Loader2, AlertTriangle } from 'lucide-react'
import GooglePicker, { PickedFile } from '@/components/GooglePicker'

interface GoogleDriveTabProps {
  currentAgentId: string | null
  ragSpaceId?: number | null
  onRefresh?: () => void
  setShowBackgroundMessage?: (show: boolean) => void
}

export function GoogleDriveTab({
  currentAgentId,
  ragSpaceId,
  onRefresh,
  setShowBackgroundMessage,
}: GoogleDriveTabProps) {
  const { t } = useLanguage()

  const isMacChrome = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    return /Macintosh/.test(ua) && /Chrome\//.test(ua) && !/Edg\//.test(ua)
  }, [])

  const {
    selectedProvider,
    hasApiKey,
    isLoading: isLoadingProvider,
  } = useRagProvider()

  const [googleDriveConnected, setGoogleDriveConnected] = useState(false)
  const [isConnectingGoogleDrive, setIsConnectingGoogleDrive] = useState(false)

  useEffect(() => {
    if (currentAgentId) {
      checkGoogleDriveConnection()
    }
  }, [currentAgentId])

  const checkGoogleDriveConnection = async () => {
    if (!currentAgentId) return
    try {
      const response = await fetch(`/api/storage/google-drive/disconnect?agentId=${currentAgentId}`)
      if (response.ok) {
        const data = await response.json()
        setGoogleDriveConnected(data.data?.connected ?? false)
      }
    } catch (error) {
      console.error('Failed to check Google Drive connection:', error)
    }
  }

  const handleConnectGoogleDrive = async () => {
    if (!currentAgentId) {
      toast.error('Agent ID is required')
      return
    }
    setIsConnectingGoogleDrive(true)
    try {
      const response = await fetch(`/api/storage/google-drive/authorize?agentId=${currentAgentId}`)
      if (response.ok) {
        const data = await response.json()
        window.location.href = data.authUrl
      } else {
        toast.error(t('google_drive_connect_failed'))
      }
    } catch (error) {
      console.error('Failed to connect Google Drive:', error)
      toast.error(t('google_drive_connect_failed'))
    } finally {
      setIsConnectingGoogleDrive(false)
    }
  }

  const handleDisconnectGoogleDrive = async () => {
    if (!currentAgentId) {
      toast.error('Agent ID is required')
      return
    }
    try {
      const response = await fetch('/api/storage/google-drive/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: currentAgentId }),
      })
      if (response.ok) {
        setGoogleDriveConnected(false)
        toast.success(t('google_drive_disconnected'))
      } else {
        toast.error(t('google_drive_disconnect_failed'))
      }
    } catch (error) {
      console.error('Failed to disconnect Google Drive:', error)
      toast.error(t('google_drive_disconnect_failed'))
    }
  }

  const handlePickerFilesSelected = async (files: PickedFile[]) => {
    if (!currentAgentId || files.length === 0) return

    toast.info(t('google_drive_processing_files').replace('{count}', files.length.toString()))

    try {
      const response = await fetch('/api/storage/google-drive/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: currentAgentId,
          selectedFiles: files.map(f => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            resourceKey: f.resourceKey,
          })),
          ragProvider: selectedProvider,
          ragSpaceId,
        }),
      })

      if (response.ok) {
        toast.success(t('google_drive_import_started'))
        setShowBackgroundMessage?.(true)
        onRefresh?.()
      } else {
        const data = await response.json()
        toast.error(data.error || t('google_drive_import_failed'))
      }
    } catch (error) {
      console.error('Failed to import Google Drive files:', error)
      toast.error(t('google_drive_import_failed'))
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage Provider</CardTitle>
          <CardDescription>
            Google Drive files will be indexed using this RAG provider
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
              <Cloud className="h-4 w-4" />
              {t('google_drive_integration_title')}
            </CardTitle>
            <CardDescription>
              {t('google_drive_integration_description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isMacChrome ? (
              <div className="p-6 text-center border-2 border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 rounded-lg">
                <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
                <h3 className="text-base sm:text-lg font-medium mb-2 text-amber-700 dark:text-amber-300">
                  {t('google_drive_mac_chrome_unsupported_title')}
                </h3>
                <p className="text-sm sm:text-base text-amber-600 dark:text-amber-400">
                  {t('google_drive_mac_chrome_unsupported')}
                </p>
              </div>
            ) : (
              <>
                {/* Privacy Notice */}
                <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
                    🔒 {selectedProvider === 'azure_ai_search' ? t('privacy_notice_managed') : t('privacy_notice')}
                  </p>
                </div>

                {/* Google Drive Connection Status */}
                <div className="p-3 sm:p-4 border rounded-lg bg-gray-50 dark:bg-gray-900">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-0">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {googleDriveConnected ? (
                        <Cloud className="h-6 w-6 text-green-500" />
                      ) : (
                        <CloudOff className="h-6 w-6 text-gray-500" />
                      )}
                      <div>
                        <h3 className="font-medium text-sm sm:text-base">{t('google_drive_connection_status')}</h3>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          {googleDriveConnected ? 'Connected' : t('google_drive_not_connected')}
                        </p>
                      </div>
                    </div>
                    {!googleDriveConnected ? (
                      <Button
                        variant="default"
                        onClick={handleConnectGoogleDrive}
                        disabled={isConnectingGoogleDrive}
                        className="w-full sm:w-auto shrink-0 h-10 sm:h-9 text-sm"
                      >
                        {isConnectingGoogleDrive ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          t('connect_google_drive')
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* Connected State or Coming Soon Message */}
                {googleDriveConnected ? (
                  <div className="p-4 sm:p-6 text-center border-2 border-dashed border-green-200 bg-green-50 dark:bg-green-950 rounded-lg">
                    <Cloud className="h-12 w-12 mx-auto text-green-500 mb-4" />
                    <h3 className="text-base sm:text-lg font-medium mb-2 text-green-700 dark:text-green-300">{t('google_drive_connected_title')}</h3>
                    <p className="text-sm sm:text-base text-green-600 dark:text-green-400 mb-4">
                      {t('google_drive_connected_message')}
                    </p>

                    <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
                      <GooglePicker
                        onFilesSelected={handlePickerFilesSelected}
                        buttonText={t('google_drive_browse_select_files')}
                        disabled={isConnectingGoogleDrive}
                        agentId={currentAgentId ?? undefined}
                        ragProvider={selectedProvider}
                        variant="default"
                        className="w-full sm:w-auto h-10 sm:h-9 text-sm"
                      />
                      <Button
                        variant="outline"
                        onClick={handleDisconnectGoogleDrive}
                        disabled={isConnectingGoogleDrive}
                        className="w-full sm:w-auto h-10 sm:h-9 text-sm"
                      >
                        {t('google_drive_disconnect_button')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center border-2 border-dashed border-muted rounded-lg">
                    <CloudOff className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">{t('google_drive_coming_soon')}</h3>
                    <p className="text-muted-foreground mb-4">
                      {t('google_drive_feature_description')}
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-1 text-left max-w-md mx-auto">
                      <li>• {t('google_drive_feature_1')}</li>
                      <li>• {t('google_drive_feature_2')}</li>
                      <li>• {t('google_drive_feature_3')}</li>
                      <li>• {t('google_drive_feature_4')}</li>
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
