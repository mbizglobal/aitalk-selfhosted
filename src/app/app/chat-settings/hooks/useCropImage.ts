'use client'

import { useState, useRef, useCallback, useEffect, ChangeEvent } from 'react'
import type Cropper from 'cropperjs'
import { toast } from 'sonner'
import type { WidgetSettings } from '@/lib/widget-settings'
import { MAX_CUSTOM_ICON_SIZE_MB } from '../constants'
import type { TranslationFn } from '../types'

interface UseCropImageProps {
  settings: WidgetSettings
  agentId: string
  userPlan: string
  handleUpdate: (path: string, value: unknown) => void
  t: TranslationFn
}

export function useCropImage({
  settings,
  agentId,
  userPlan,
  handleUpdate,
  t,
}: UseCropImageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cropImageRef = useRef<HTMLImageElement | null>(null)
  const cropperRef = useRef<Cropper | null>(null)
  const cropObjectUrlRef = useRef<string | null>(null)

  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [isCropModalOpen, setIsCropModalOpen] = useState(false)
  const [isCropping, setIsCropping] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [customIconUploading, setCustomIconUploading] = useState(false)

  const cleanupCropperInstance = useCallback(() => {
    if (cropperRef.current) {
      cropperRef.current.destroy()
      cropperRef.current = null
    }
  }, [])

  const cleanupCropResources = useCallback(() => {
    cleanupCropperInstance()
    if (cropObjectUrlRef.current) {
      URL.revokeObjectURL(cropObjectUrlRef.current)
      cropObjectUrlRef.current = null
    }
  }, [cleanupCropperInstance])

  useEffect(() => {
    return () => {
      cleanupCropResources()
    }
  }, [cleanupCropResources])

  const handleCropImageLoad = useCallback(async () => {
    if (!cropImageRef.current) {
      return
    }

    try {
      const { default: CropperModule } = await import('cropperjs')
      cleanupCropperInstance()
      cropperRef.current = new CropperModule(cropImageRef.current, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        background: false,
        autoCropArea: 1,
        responsive: true,
        zoomable: true,
        movable: true,
      })
    } catch (error) {
      toast.error(t('crop_tool_load_failed'))
    }
  }, [cleanupCropperInstance, t])

  const closeCropModal = useCallback(() => {
    setIsCropModalOpen((prev) => (prev ? false : prev))
    setIsCropping(false)
    setCropImageSrc(null)
    cleanupCropResources()
  }, [cleanupCropResources])

  const handleCropCancel = () => {
    closeCropModal()
  }

  const handleCropConfirm = async () => {
    if (!cropperRef.current) {
      toast.error(t('image_load_failed'))
      return
    }

    setIsCropping(true)
    try {
      const canvas = cropperRef.current.getCroppedCanvas({
        width: 144,
        height: 144,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      })

      if (!canvas) {
        throw new Error('Failed to crop image')
      }

      const dataUrl = canvas.toDataURL('image/png')

      // Upload to S3
      const response = await fetch('/api/upload-icon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dataUrl, agentId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Upload failed')
      }

      const { url } = await response.json()

      // Delete existing icon if present
      if (
        settings.customIconData &&
        settings.customIconData.startsWith('https://')
      ) {
        try {
          await fetch('/api/upload-icon', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ iconUrl: settings.customIconData }),
          })
        } catch (deleteError) {
          // Ignore delete errors
        }
      }

      handleUpdate('customIconData', url)

      // Save to DB immediately
      const updatedSettings = { ...settings, customIconData: url }
      try {
        await fetch('/api/chat-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ settings: updatedSettings, agentId }),
        })
      } catch (saveError) {
        // Ignore save errors
      }

      toast.success(t('custom_icon_applied'))
      closeCropModal()
    } catch (error) {
      toast.error(t('icon_edit_failed'))
    } finally {
      setIsCropping(false)
    }
  }

  const handleFileProcessing = useCallback(
    (file: File) => {
      if (userPlan === 'free') {
        toast.error(t('free_version_not_supported'))
        return
      }

      if (!file.type.startsWith('image/')) {
        toast.error(t('image_files_only'))
        return
      }

      if (file.size > MAX_CUSTOM_ICON_SIZE_MB * 1024 * 1024) {
        toast.error(
          t('file_size_limit').replace(
            '{size}',
            MAX_CUSTOM_ICON_SIZE_MB.toString()
          )
        )
        return
      }

      cleanupCropResources()

      try {
        const objectUrl = URL.createObjectURL(file)
        cropObjectUrlRef.current = objectUrl
        setCropImageSrc(objectUrl)
        setIsCropping(false)
        setIsCropModalOpen(true)
      } catch (error) {
        toast.error(t('image_load_failed'))
        cleanupCropResources()
      }
    },
    [userPlan, t, cleanupCropResources]
  )

  const handleIconFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (userPlan === 'free') {
        event.target.value = ''
        toast.error(t('free_version_not_supported'))
        return
      }

      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      handleFileProcessing(file)
    },
    [userPlan, t, handleFileProcessing]
  )

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (userPlan === 'free') {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setIsDragOver(true)
    },
    [userPlan]
  )

  const handleDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (userPlan === 'free') {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setIsDragOver(false)
    },
    [userPlan]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (userPlan === 'free') {
        toast.error(t('free_version_not_supported'))
        return
      }

      setIsDragOver(false)

      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) {
        handleFileProcessing(files[0])
      }
    },
    [userPlan, t, handleFileProcessing]
  )

  const handleRemoveCustomIcon = useCallback(async () => {
    if (userPlan === 'free') {
      toast.error(t('free_version_not_supported'))
      return
    }

    // Delete from S3 if URL exists
    if (
      settings.customIconData &&
      settings.customIconData.startsWith('https://')
    ) {
      try {
        await fetch('/api/upload-icon', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ iconUrl: settings.customIconData }),
        })
      } catch (deleteError) {
        // Ignore delete errors
      }
    }

    // Update local state
    const updatedSettings = { ...settings, customIconData: null }
    handleUpdate('customIconData', null)

    // Save to DB immediately
    try {
      await fetch('/api/chat-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settings: updatedSettings, agentId }),
      })
    } catch (saveError) {
      // Ignore save errors
    }

    toast.success(t('icon_removed_successfully'))
  }, [userPlan, settings, agentId, handleUpdate, t])

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return {
    // Refs
    fileInputRef,
    cropImageRef,

    // State
    cropImageSrc,
    isCropModalOpen,
    isCropping,
    isDragOver,
    customIconUploading,

    // Handlers
    handleCropImageLoad,
    handleCropCancel,
    handleCropConfirm,
    handleIconFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleRemoveCustomIcon,
    openFileDialog,
  }
}
