'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TranslationFn } from '../types'

interface CropModalProps {
  isOpen: boolean
  onClose: () => void
  imageSrc: string | null
  onCrop: () => void
  onCancel: () => void
  isCropping: boolean
  cropImageRef: React.RefObject<HTMLImageElement | null>
  onImageLoad: () => void
  t: TranslationFn
}

export function CropModal({
  isOpen,
  onClose,
  imageSrc,
  onCrop,
  onCancel,
  isCropping,
  cropImageRef,
  onImageLoad,
  t,
}: CropModalProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (isCropping) {
            return
          }
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={!isCropping}>
        <DialogHeader>
          <DialogTitle>{t('crop_image_title')}</DialogTitle>
          <DialogDescription>{t('crop_image_description')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center overflow-hidden rounded-md border bg-gray-100">
          {imageSrc ? (
            <img
              ref={cropImageRef}
              src={imageSrc}
              alt={t('widget_icon_alt')}
              className="max-h-[360px] w-full object-contain"
              onLoad={onImageLoad}
            />
          ) : (
            <div className="flex h-[360px] w-full items-center justify-center text-sm text-muted-foreground">
              {t('crop_image_loading')}
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {t('crop_recommended_size')}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={isCropping}>
              {t('cancel_button')}
            </Button>
            <Button onClick={onCrop} disabled={isCropping || !imageSrc}>
              {isCropping ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('saving_crop')}
                </>
              ) : (
                t('apply_crop_button')
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
