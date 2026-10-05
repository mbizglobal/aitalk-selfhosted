'use client'

import { useState, useCallback } from 'react'
import { useLanguage } from '@/hooks/useLanguage'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { useRagProvider, getSupportedFileTypes } from '../../hooks/useRagProvider'
import { RagProviderDisplay } from '../shared/RagProviderDisplay'
import { UploadingFile, StorageTab } from '../../types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  Upload,
  Files,
  FileText,
  PenTool,
  Loader2,
  CheckCircle,
} from 'lucide-react'

interface FilesTabProps {
  currentAgentId: string | null
  ragSpaceId?: number | null
  onTabChange?: (tab: StorageTab) => void
  onRefresh?: () => void
  setShowBackgroundMessage?: (show: boolean) => void
}

export function FilesTab({
  currentAgentId,
  ragSpaceId,
  onTabChange,
  onRefresh,
  setShowBackgroundMessage,
}: FilesTabProps) {
  const { t } = useLanguage()

  const {
    selectedProvider,
    hasApiKey,
    isLoading: isLoadingProvider,
  } = useRagProvider()

  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, UploadingFile>>(new Map())

  const [isCreateTextModalOpen, setIsCreateTextModalOpen] = useState(false)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [isCreatingText, setIsCreatingText] = useState(false)

  const supportedTypes = getSupportedFileTypes(selectedProvider)

  const handleFileUpload = async (files: FileList) => {
    if (!currentAgentId) {
      toast.error(t('agent_not_found'))
      return
    }

    if (!hasApiKey) {
      toast.error('API key is required to upload files')
      return
    }

    for (const file of Array.from(files)) {
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()

      if (!supportedTypes.includes(fileExtension)) {
        const message = t('file_unsupported_type')
          .replace('{filename}', file.name)
          .replace('{types}', supportedTypes.join(', '))
        toast.error(message)
        continue
      }

      const MAX_FILE_SIZE = 20 * 1024 * 1024  // 20MB

      if (file.size > MAX_FILE_SIZE) {
        const sizeMB = Math.round(MAX_FILE_SIZE / (1024 * 1024))
        const message = t('file_size_exceeded')
          .replace('{filename}', file.name)
          .replace('{size}', sizeMB.toString())
        toast.error(message)
        continue
      }

      const fileKey = `${file.name}-${file.size}-${Date.now()}`
      setUploadingFiles(prev => {
        const newMap = new Map(prev)
        newMap.set(fileKey, {
          name: file.name,
          progress: 0,
          size: file.size,
          uploaded: 0,
        })
        return newMap
      })

      try {
        await uploadFileWithProgress(file, currentAgentId, fileKey, selectedProvider)
      } finally {
        setTimeout(() => {
          setUploadingFiles(prev => {
            const newMap = new Map(prev)
            newMap.delete(fileKey)
            return newMap
          })
        }, 3000)
      }
    }
  }

  const uploadFileWithProgress = (
    file: File,
    agentId: string,
    fileKey: string,
    ragProvider: RAGProviderType
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('agentId', agentId)
      formData.append('ragProvider', ragProvider)
      if (ragSpaceId != null) formData.append('ragSpaceId', String(ragSpaceId))

      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100)
          setUploadingFiles(prev => {
            const newMap = new Map(prev)
            const current = newMap.get(fileKey)
            if (current) {
              newMap.set(fileKey, {
                ...current,
                progress,
                uploaded: e.loaded,
              })
            }
            return newMap
          })
        }
      })

      xhr.addEventListener('load', () => {
        try {
          const response = JSON.parse(xhr.responseText)

          if (xhr.status === 200 && response.success) {
            const message = t('file_upload_started').replace('{filename}', file.name)
            toast.success(message)
            setUploadingFiles(prev => {
              const newMap = new Map(prev)
              const current = newMap.get(fileKey)
              if (current) {
                newMap.set(fileKey, {
                  ...current,
                  progress: 100,
                  uploaded: current.size,
                })
              }
              return newMap
            })
            onTabChange?.('files')
            setShowBackgroundMessage?.(true)
            onRefresh?.()
            resolve()
          } else {
            const errorMessage = response.error || 'Upload failed'
            const message = t('file_upload_failed')
              .replace('{filename}', file.name)
              .replace('{error}', errorMessage)
            toast.error(message)
            onTabChange?.('files')
            onRefresh?.()
            reject(new Error(errorMessage))
          }
        } catch (error) {
          const message = t('file_upload_parse_error').replace('{filename}', file.name)
          toast.error(message)
          onTabChange?.('files')
          onRefresh?.()
          reject(error)
        }
      })

      xhr.addEventListener('error', () => {
        const message = t('file_upload_failed_simple').replace('{filename}', file.name)
        toast.error(message)
        onTabChange?.('files')
        onRefresh?.()
        reject(new Error('Network error'))
      })

      xhr.open('POST', '/api/storage/upload')
      xhr.send(formData)
    })
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.currentTarget === e.target) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileUpload(files)
    }
  }, [currentAgentId, hasApiKey, selectedProvider, ragSpaceId])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFileUpload(files)
    }
    e.target.value = ''
  }

  const handleCreateText = async () => {
    if (!currentAgentId || !textTitle.trim() || !textContent.trim()) {
      toast.error(t('create_text_validation_error'))
      return
    }

    setIsCreatingText(true)
    try {
      const response = await fetch('/api/storage/create-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: currentAgentId,
          title: textTitle.trim(),
          content: textContent.trim(),
          ragProvider: selectedProvider,
          ragSpaceId,
        }),
      })

      if (response.ok) {
        toast.success(t('create_text_success'))
        setTextTitle('')
        setTextContent('')
        setIsCreateTextModalOpen(false)
        setShowBackgroundMessage?.(true)
        onRefresh?.()
      } else {
        const data = await response.json()
        toast.error(data.error || t('create_text_error'))
      }
    } catch (error) {
      console.error('Failed to create text:', error)
      toast.error(t('create_text_error'))
    } finally {
      setIsCreatingText(false)
    }
  }

  const handleCancelCreateText = () => {
    setTextTitle('')
    setTextContent('')
    setIsCreateTextModalOpen(false)
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
            Files will be indexed using this RAG provider
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
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  {t('file_upload_title')}
                </CardTitle>
                <CardDescription>
                  {t('file_upload_description')} {t('file_upload_supported_formats')} {supportedTypes.map(t => t.replace('.', '').toUpperCase()).join(', ')}
                </CardDescription>
              </div>
              <Dialog open={isCreateTextModalOpen} onOpenChange={setIsCreateTextModalOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="flex items-center gap-2">
                    <PenTool className="h-4 w-4" />
                    {t('create_text_button')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px]">
                  <DialogHeader>
                    <DialogTitle>{t('create_text_modal_title')}</DialogTitle>
                    <DialogDescription>
                      {t('create_text_description')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="text-title">{t('create_text_title_label')}</Label>
                      <Input
                        id="text-title"
                        placeholder={t('create_text_title_placeholder')}
                        value={textTitle}
                        onChange={(e) => setTextTitle(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="text-content">{t('create_text_content_label')}</Label>
                      <Textarea
                        id="text-content"
                        placeholder={t('create_text_content_placeholder')}
                        value={textContent}
                        onChange={(e) => setTextContent(e.target.value)}
                        rows={12}
                        className="min-h-[300px]"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={handleCancelCreateText}
                      disabled={isCreatingText}
                    >
                      {t('create_text_cancel')}
                    </Button>
                    <Button
                      onClick={handleCreateText}
                      disabled={isCreatingText}
                    >
                      {isCreatingText ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {t('create_text_save')}
                        </>
                      ) : (
                        t('create_text_save')
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
                🔒 {selectedProvider === 'azure_ai_search'
                  ? t('privacy_notice_managed')
                  : selectedProvider === 'pinecone'
                    ? t('privacy_notice_pinecone')
                    : selectedProvider === 'gemini_file_search'
                      ? t('privacy_notice_gemini')
                      : t('privacy_notice_openai')}
              </p>
            </div>

            {/* Drag and Drop Area */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragOver
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center gap-2">
                <Upload className={`h-10 w-10 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {t('drag_drop_text')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('upload_file_size_limit')}
                  </p>
                </div>

                {/* Hidden file input */}
                <input
                  type="file"
                  multiple
                  accept={supportedTypes.join(',')}
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />

                <Button
                  variant="outline"
                  onClick={() => document.getElementById('file-upload')?.click()}
                  className="mt-2"
                >
                  <Files className="h-4 w-4 mr-2" />
                  {t('select_files_button')}
                </Button>
              </div>
            </div>

            {/* Upload Progress */}
            {uploadingFiles.size > 0 && (
              <div className="space-y-3">
                <div className="text-sm font-medium">{t('uploading_files')}</div>
                {Array.from(uploadingFiles.entries()).map(([fileKey, uploadInfo]) => (
                  <div key={fileKey} className="space-y-2 p-3 bg-muted rounded">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {uploadInfo.progress === 100 ? (
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                        )}
                        <span className="text-sm font-medium break-all">
                          {uploadInfo.name}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {uploadInfo.progress}%
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadInfo.progress}%` }}
                      />
                    </div>

                    {/* Size Information */}
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-xs text-muted-foreground">
                      <span>
                        {(uploadInfo.uploaded / (1024 * 1024)).toFixed(1)} MB /
                        {(uploadInfo.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      <span>
                        {uploadInfo.progress === 100 ? t('upload_complete') : t('upload_uploading')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Supported Formats */}
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('supported_file_types')}</div>
              <div className="flex flex-wrap gap-2">
                {supportedTypes.map((ext) => (
                  <div
                    key={ext}
                    className="flex items-center justify-center gap-1 px-2 py-1 bg-muted rounded-md text-xs"
                  >
                    <FileText className="h-3 w-3" />
                    {ext.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
