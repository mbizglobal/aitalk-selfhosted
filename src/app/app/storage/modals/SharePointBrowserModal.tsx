
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDateOnlyWithUserSettings } from '@/lib/format-date-with-user-settings'
import { Cloud, Database, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  SharePointSite,
  SharePointDrive,
  SharePointItem,
  SharePointBreadcrumb,
} from '../types'

interface SharePointBrowserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: (key: string) => string
  userTimeFormat: string

  isConnecting: boolean
  sites: SharePointSite[]
  drives: SharePointDrive[]
  items: SharePointItem[]
  selectedItems: Set<string>
  selectedSite: SharePointSite | null
  selectedDrive: SharePointDrive | null
  breadcrumb: SharePointBreadcrumb[]

  onSelectSite: (site: SharePointSite) => void
  onSelectDrive: (drive: SharePointDrive) => void
  onNavigateFolder: (folderId: string, folderName: string, isBack?: boolean) => void
  onToggleItem: (itemId: string) => void
  onSync: () => void
  onBackToSites: () => void
  onBackToDrives: () => void
}

export function SharePointBrowserModal({
  open,
  onOpenChange,
  t,
  userTimeFormat,
  isConnecting,
  sites,
  drives,
  items,
  selectedItems,
  selectedSite,
  selectedDrive,
  breadcrumb,
  onSelectSite,
  onSelectDrive,
  onNavigateFolder,
  onToggleItem,
  onSync,
  onBackToSites,
  onBackToDrives,
}: SharePointBrowserModalProps) {
  const getMimeTypeExtension = (mimeType?: string) => {
    if (!mimeType) return ''
    if (mimeType === 'application/pdf') return '.pdf'
    if (mimeType === 'application/msword') return '.doc'
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx'
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx'
    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx'
    if (mimeType === 'text/plain') return '.txt'
    if (mimeType === 'text/csv') return '.csv'
    if (mimeType === 'application/vnd.ms-excel') return '.xls'
    if (mimeType === 'application/vnd.ms-powerpoint') return '.ppt'
    return ''
  }

  const handleItemClick = (item: SharePointItem) => {
    if (item.type === 'folder') {
      onNavigateFolder(item.id, item.name)
    } else if (item.type === 'file' && item.supported) {
      onToggleItem(item.id)
    }
  }

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>, itemId: string) => {
    if (e.target.checked && selectedItems.size >= 20) {
      toast.error(t('maximum_files_error'))
      e.target.checked = false
      return
    }
    onToggleItem(itemId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[100vw] !h-[100vh] !max-w-full !max-h-full sm:!w-[95vw] sm:!h-[90vh] sm:!max-w-[1400px] sm:!max-h-[900px] md:!w-[90vw] md:!h-[85vh] lg:!w-[80vw] lg:!h-[80vh] xl:!w-[70vw] !p-0 sm:!p-6 overflow-hidden flex flex-col !rounded-none sm:!rounded-lg">
        <DialogHeader className="p-4 sm:p-0 border-b sm:border-0">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Cloud className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="truncate">{t('browse_sharepoint')}</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm mt-1 sm:mt-2">
            {t('sharepoint_select_files')}
          </DialogDescription>
        </DialogHeader>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto min-h-0 px-2 sm:px-0">
          {isConnecting ? (
            <div className="flex items-center justify-center h-full min-h-[300px] p-8">
              <div className="flex items-center">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading...
              </div>
            </div>
          ) : !selectedSite ? (
            /* Site Selection */
            <div className="p-4 sm:p-0">
              <h3 className="text-lg font-medium mb-4">{t('select_sharepoint_site')}</h3>
              <div className="space-y-2">
                {sites.map((site) => (
                  <div
                    key={site.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors"
                    onClick={() => onSelectSite(site)}
                  >
                    <div className="flex items-center gap-3">
                      <Cloud className="h-5 w-5 text-blue-500" />
                      <div>
                        <p className="font-medium">{site.name}</p>
                        {site.description && (
                          <p className="text-sm text-muted-foreground">{site.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {site.lastModifiedDateTime && formatDateOnlyWithUserSettings(site.lastModifiedDateTime, userTimeFormat)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !selectedDrive ? (
            /* Drive Selection */
            <div className="p-4 sm:p-0">
              <div className="flex items-center gap-2 mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBackToSites}
                >
                  {t('sharepoint_back_to_sites')}
                </Button>
              </div>
              <h3 className="text-lg font-medium mb-4">{t('select_drive_from_site').replace('{siteName}', selectedSite.name)}</h3>
              <div className="space-y-2">
                {drives.map((drive) => (
                  <div
                    key={drive.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors"
                    onClick={() => onSelectDrive(drive)}
                  >
                    <div className="flex items-center gap-3">
                      <Database className="h-5 w-5 text-blue-500" />
                      <div>
                        <p className="font-medium">{drive.name}</p>
                        {drive.description && (
                          <p className="text-sm text-muted-foreground">{drive.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {drive.driveType}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* File/Folder Browser */
            <div>
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm text-muted-foreground overflow-x-auto whitespace-nowrap px-4 sm:px-0 py-2 sm:pb-2 border-b shrink-0 scrollbar-hide">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBackToDrives}
                  className="shrink-0"
                >
                  {t('sharepoint_back_to_drives')}
                </Button>
                {breadcrumb.map((folder, index) => (
                  <div key={folder.id} className="flex items-center gap-1 sm:gap-2 shrink-0">
                    {index > 0 && <span className="text-gray-400">/</span>}
                    <button
                      onClick={() => {
                        if (index === 0) {
                          onSelectDrive(selectedDrive)
                        } else {
                          onNavigateFolder(folder.id, folder.name, true)
                        }
                      }}
                      className="hover:underline hover:text-blue-600 active:text-blue-700 transition-colors px-2 py-1.5 sm:px-1 sm:py-0.5 rounded text-sm sm:text-sm touch-manipulation min-h-[36px] sm:min-h-auto flex items-center"
                    >
                      {folder.name}
                    </button>
                  </div>
                ))}
              </div>

              {/* File/Folder List */}
              <div className="divide-y">
                {items.length === 0 ? (
                  <div className="flex items-center justify-center h-full min-h-[300px] p-8 text-gray-500 dark:text-gray-400">
                    <div className="text-center">
                      <Database className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                      <p>{t('no_files_or_folders_found')}</p>
                    </div>
                  </div>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-4 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 dark:active:bg-gray-800 transition-colors touch-manipulation rounded-lg sm:rounded-none min-h-[60px] sm:min-h-[auto]">
                      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        {item.type === 'file' && item.supported && (
                          <input
                            type="checkbox"
                            checked={selectedItems.has(item.id)}
                            onChange={(e) => handleCheckboxChange(e, item.id)}
                            className="shrink-0 w-6 h-6 sm:w-4 sm:h-4 touch-manipulation cursor-pointer"
                          />
                        )}
                        {(item.type === 'folder' || (item.type === 'file' && !item.supported)) && (
                          <div className="w-4 h-4 shrink-0"></div>
                        )}

                        <div
                          className="flex items-center gap-3 sm:gap-2 cursor-pointer flex-1 min-w-0 py-2 sm:py-1 touch-manipulation select-none"
                          onClick={() => handleItemClick(item)}
                        >
                          {item.type === 'folder' ? (
                            <Database className="h-6 w-6 sm:h-4 sm:w-4 text-blue-500 shrink-0" />
                          ) : (
                            <FileText className={`h-6 w-6 sm:h-4 sm:w-4 shrink-0 ${item.supported ? 'text-gray-500' : 'text-gray-300'}`} />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={`font-medium text-base sm:text-sm truncate ${item.supported ? '' : 'text-gray-400'}`} title={item.name}>
                              {item.name}
                              {item.type === 'file' && item.mimeType && (
                                <span className="text-[10px] sm:text-xs text-muted-foreground ml-1 hidden sm:inline">
                                  {getMimeTypeExtension(item.mimeType) || (item.supported ? '' : ' (not supported)')}
                                </span>
                              )}
                            </p>
                            {item.size && (
                              <p className="text-sm sm:text-xs text-muted-foreground">
                                {Math.round(parseInt(item.size) / 1024)}KB
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-[10px] sm:text-xs text-muted-foreground hidden md:block">
                          {item.lastModifiedDateTime && formatDateOnlyWithUserSettings(item.lastModifiedDateTime, userTimeFormat)}
                        </div>
                      </div>

                      {/* Mobile date */}
                      <div className="text-sm sm:text-xs text-muted-foreground shrink-0 ml-2 sm:hidden">
                        {item.lastModifiedDateTime && formatDateOnlyWithUserSettings(item.lastModifiedDateTime, userTimeFormat)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {selectedDrive && (
          <DialogFooter className="shrink-0 p-4 sm:p-6 bg-white dark:bg-gray-900 border-t sm:border-0 sm:bg-transparent">
            <div className="flex flex-col sm:flex-row items-center justify-between w-full gap-3 sm:gap-0">
              <div className="text-xs sm:text-sm text-muted-foreground order-2 sm:order-1 text-center sm:text-left">
                <span className="font-medium">{selectedItems.size}</span> file{selectedItems.size !== 1 ? 's' : ''} selected
              </div>
              <div className="flex gap-2 sm:gap-3 w-full sm:w-auto order-1 sm:order-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isConnecting}
                  className="flex-1 sm:flex-initial h-12 sm:h-9 text-base sm:text-sm touch-manipulation font-medium"
                >
                  {t('sharepoint_cancel')}
                </Button>
                <Button
                  onClick={onSync}
                  disabled={isConnecting || selectedItems.size === 0}
                  className="flex-1 sm:flex-initial h-12 sm:h-9 text-base sm:text-sm font-medium touch-manipulation"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      <span>{t('syncing_status')}</span>
                    </>
                  ) : (
                    <>
                      <span className="hidden sm:inline">
                        Sync {selectedItems.size} file{selectedItems.size !== 1 ? 's' : ''}
                      </span>
                      <span className="sm:hidden">
                        Sync ({selectedItems.size})
                      </span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
