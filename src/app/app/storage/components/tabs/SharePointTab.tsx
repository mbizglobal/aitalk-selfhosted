'use client'

import { useLanguage } from '@/hooks/useLanguage'
import { useRagProvider } from '../../hooks/useRagProvider'
import { RagProviderDisplay } from '../shared/RagProviderDisplay'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Cloud, CloudOff, Loader2 } from 'lucide-react'

interface SharePointTabProps {
  currentAgentId: string | null
  sharePointConnected: boolean
  isConnectingSharePoint: boolean
  onConnectSharePoint: () => void
  onDisconnectSharePoint: () => void
  onBrowseSharePoint?: () => void
  onRefresh?: () => void
}

export function SharePointTab({
  currentAgentId,
  sharePointConnected,
  isConnectingSharePoint,
  onConnectSharePoint,
  onDisconnectSharePoint,
  onBrowseSharePoint,
  onRefresh,
}: SharePointTabProps) {
  const { t } = useLanguage()

  const {
    selectedProvider,
    hasApiKey,
    isLoading: isLoadingProvider,
  } = useRagProvider()

  const handleBrowseSharePoint = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sharepoint_rag_provider', selectedProvider)
    }
    onBrowseSharePoint?.()
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
            SharePoint files will be indexed using this RAG provider
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
              {t('sharepoint_integration_title')}
            </CardTitle>
            <CardDescription>
              {t('sharepoint_integration_description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Privacy Notice */}
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
                {t('sharepoint_security_notice')}
              </p>
            </div>

            {/* SharePoint Connection Status */}
            <div className="p-3 sm:p-4 border rounded-lg bg-gray-50 dark:bg-gray-900">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {sharePointConnected ? (
                    <Cloud className="h-6 w-6 text-green-500" />
                  ) : (
                    <CloudOff className="h-6 w-6 text-gray-500" />
                  )}
                  <div>
                    <h3 className="font-medium text-sm sm:text-base">{t('sharepoint_connection_status_title')}</h3>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {sharePointConnected ? t('sharepoint_status_connected') : t('sharepoint_status_not_connected')}
                    </p>
                  </div>
                </div>
                {!sharePointConnected ? (
                  <Button
                    variant="default"
                    onClick={onConnectSharePoint}
                    disabled={isConnectingSharePoint}
                    className="w-full sm:w-auto shrink-0 h-10 sm:h-9 text-sm"
                  >
                    {isConnectingSharePoint ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      t('connect_sharepoint')
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={onDisconnectSharePoint}
                    disabled={isConnectingSharePoint}
                    className="w-full sm:w-auto shrink-0 h-10 sm:h-9 text-sm"
                  >
                    {t('sharepoint_disconnect_button')}
                  </Button>
                )}
              </div>
            </div>

            {/* Connected State or Coming Soon Message */}
            {sharePointConnected ? (
              <div className="p-4 sm:p-6 text-center border-2 border-dashed border-green-200 bg-green-50 dark:bg-green-950 rounded-lg">
                <Cloud className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-base sm:text-lg font-medium mb-2 text-green-700 dark:text-green-300">{t('sharepoint_connected_title')}</h3>
                <p className="text-sm sm:text-base text-green-600 dark:text-green-400 mb-4">
                  {t('sharepoint_connected_message')}
                </p>
                <Button
                  onClick={handleBrowseSharePoint}
                  disabled={isConnectingSharePoint}
                  className="w-full sm:w-auto h-10 sm:h-9 text-sm"
                >
                  {isConnectingSharePoint ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    t('sharepoint_browse_files')
                  )}
                </Button>
              </div>
            ) : (
              <div className="p-6 text-center border-2 border-dashed border-muted rounded-lg">
                <CloudOff className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">{t('connect_sharepoint_title')}</h3>
                <p className="text-muted-foreground mb-4">
                  {t('sharepoint_feature_description')}
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 text-left max-w-md mx-auto">
                  <li>{t('sharepoint_feature_1')}</li>
                  <li>{t('sharepoint_feature_2')}</li>
                  <li>{t('sharepoint_feature_3')}</li>
                  <li>{t('sharepoint_feature_4')}</li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
