'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Loader2,
  Trash2,
  RefreshCw,
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react'

interface GeminiFile {
  name: string
  displayName: string
  mimeType: string
  sizeBytes: string
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED'
  uri?: string
  createTime?: string
  updateTime?: string
  expirationTime?: string
}

interface GeminiFilesModalProps {
  isOpen: boolean
  onClose: () => void
  translations: {
    gemini_files_title: string
    gemini_files_description: string
    gemini_files_empty: string
    gemini_files_loading: string
    gemini_files_error: string
    gemini_files_delete_confirm: string
    gemini_files_delete_success: string
    gemini_files_delete_error: string
    gemini_files_refresh: string
    gemini_files_total: string
    gemini_files_expires_in: string
    gemini_files_expired: string
    gemini_files_state_active: string
    gemini_files_state_processing: string
    gemini_files_state_failed: string
  }
}

export default function GeminiFilesModal({
  isOpen,
  onClose,
  translations: t,
}: GeminiFilesModalProps) {
  const [files, setFiles] = useState<GeminiFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingFiles, setDeletingFiles] = useState<Set<string>>(new Set())
  const [totalSizeBytes, setTotalSizeBytes] = useState(0)

  const fetchFiles = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/storage/gemini-files')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch files')
      }

      setFiles(data.files || [])
      setTotalSizeBytes(data.totalSizeBytes || 0)
    } catch (err: any) {
      setError(err.message)
      setFiles([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchFiles()
    }
  }, [isOpen, fetchFiles])

  const handleDelete = async (file: GeminiFile) => {
    if (!confirm(t.gemini_files_delete_confirm.replace('{name}', file.displayName))) {
      return
    }

    setDeletingFiles(prev => new Set(prev).add(file.name))

    try {
      const encodedName = encodeURIComponent(file.name)
      const response = await fetch(`/api/storage/gemini-files/${encodedName}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete file')
      }

      toast.success(t.gemini_files_delete_success)
      setFiles(prev => prev.filter(f => f.name !== file.name))
      setTotalSizeBytes(prev => prev - parseInt(file.sizeBytes || '0'))
    } catch (err: any) {
      toast.error(t.gemini_files_delete_error + ': ' + err.message)
    } finally {
      setDeletingFiles(prev => {
        const next = new Set(prev)
        next.delete(file.name)
        return next
      })
    }
  }

  const formatSize = (bytes: string | number) => {
    const size = typeof bytes === 'string' ? parseInt(bytes) : bytes
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const getExpirationInfo = (expirationTime?: string) => {
    if (!expirationTime) return null

    const expDate = new Date(expirationTime)
    const now = new Date()
    const diffMs = expDate.getTime() - now.getTime()

    if (diffMs <= 0) {
      return { expired: true, text: t.gemini_files_expired }
    }

    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 0) {
      return { expired: false, text: t.gemini_files_expires_in.replace('{time}', `${hours}h ${minutes}m`) }
    }
    return { expired: false, text: t.gemini_files_expires_in.replace('{time}', `${minutes}m`) }
  }

  const renderStateBadge = (state: string) => {
    switch (state) {
      case 'ACTIVE':
        return (
          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
            <CheckCircle className="w-3 h-3 mr-1" />
            {t.gemini_files_state_active}
          </Badge>
        )
      case 'PROCESSING':
        return (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            {t.gemini_files_state_processing}
          </Badge>
        )
      case 'FAILED':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            {t.gemini_files_state_failed}
          </Badge>
        )
      default:
        return null
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            {t.gemini_files_title}
          </DialogTitle>
          <DialogDescription className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <span>{t.gemini_files_description}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-muted-foreground">
              {t.gemini_files_total}: {files.length} ({formatSize(totalSizeBytes)})
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchFiles}
              disabled={isLoading}
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />
              {t.gemini_files_refresh}
            </Button>
          </div>

          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">{t.gemini_files_loading}</span>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-12 text-red-500">
                <XCircle className="w-5 h-5 mr-2" />
                {t.gemini_files_error}: {error}
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mb-2 opacity-50" />
                <span>{t.gemini_files_empty}</span>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => {
                  const expInfo = getExpirationInfo(file.expirationTime)
                  const isDeleting = deletingFiles.has(file.name)

                  return (
                    <div
                      key={file.name}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors",
                        expInfo?.expired && "opacity-60"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <FileText className="w-8 h-8 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{file.displayName}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span>{formatSize(file.sizeBytes)}</span>
                            <span>•</span>
                            <span>{file.mimeType}</span>
                          </div>
                          {expInfo && (
                            <div className={cn(
                              "flex items-center gap-1 text-xs mt-1",
                              expInfo.expired ? "text-red-500" : "text-yellow-500"
                            )}>
                              <Clock className="w-3 h-3" />
                              <span>{expInfo.text}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 ml-2">
                        {renderStateBadge(file.state)}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(file)}
                          disabled={isDeleting}
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        >
                          {isDeleting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
