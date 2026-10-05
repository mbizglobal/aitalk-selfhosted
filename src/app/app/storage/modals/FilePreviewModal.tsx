
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Eye, Loader2 } from 'lucide-react'
import type { PreviewFile, PreviewType } from '../types'

interface FilePreviewModalProps {
  file: PreviewFile | null
  onClose: () => void
  t: (key: string) => string
  currentAgentId: string | null

  isLoading: boolean
  previewContent: string
  previewType: PreviewType
}

export function FilePreviewModal({
  file,
  onClose,
  t,
  currentAgentId,
  isLoading,
  previewContent,
  previewType,
}: FilePreviewModalProps) {
  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[100vw] !h-[100vh] !max-w-full !max-h-full sm:!w-[95vw] sm:!h-[90vh] sm:!max-w-[1200px] sm:!max-h-[800px] md:!w-[90vw] md:!h-[85vh] lg:!w-[85vw] lg:!h-[80vh] !p-0 sm:!p-6 overflow-hidden flex flex-col !rounded-none sm:!rounded-lg">
        <DialogHeader className="p-4 sm:p-0 border-b sm:border-0 shrink-0">
          <DialogTitle className="flex items-center gap-3 sm:gap-2 text-lg sm:text-lg">
            <Eye className="h-5 w-5 sm:h-5 sm:w-5" />
            <span className="truncate">{file?.name || t('preview')}</span>
          </DialogTitle>
          <DialogDescription className="text-sm sm:text-sm mt-2 sm:mt-2 truncate">
            {file?.mimeType || ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-4 sm:p-4 bg-gray-50 dark:bg-gray-900 sm:rounded-lg min-h-0 touch-manipulation">
          {isLoading ? (
            <div className="flex items-center justify-center h-full min-h-[200px]">
              <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin" />
            </div>
          ) : previewType === 'text' ? (
            <pre className="whitespace-pre-wrap font-mono text-sm sm:text-sm leading-relaxed touch-manipulation select-text">{previewContent}</pre>
          ) : previewType === 'pdf' ? (
            <div className="h-full w-full">
              <iframe
                src={`/api/storage/google-drive/preview-pdf?agentId=${currentAgentId}&fileId=${file?.id}${file?.resourceKey ? `&resourceKey=${encodeURIComponent(file.resourceKey)}` : ''}`}
                className="w-full h-full min-h-[400px] sm:min-h-[600px] border-0 touch-manipulation"
                title={file?.name}
              />
            </div>
          ) : previewType === 'image' ? (
            <div className="flex items-center justify-center h-full">
              <img
                src={`data:${file?.mimeType};base64,${previewContent}`}
                alt={file?.name}
                className="max-w-full max-h-full h-auto object-contain touch-manipulation select-none"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[200px]">
              <p className="text-center text-muted-foreground text-base sm:text-sm">{t('preview_not_available')}</p>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 p-4 sm:p-6 bg-white dark:bg-gray-900 border-t sm:border-0 sm:bg-transparent">
          <Button
            variant="outline"
            onClick={onClose}
            className="w-full sm:w-auto h-12 sm:h-9 text-base sm:text-sm font-medium touch-manipulation"
          >
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
