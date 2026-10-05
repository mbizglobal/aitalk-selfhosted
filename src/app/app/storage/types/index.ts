
import { RAGProviderType } from '@/lib/rag-providers/types'

export type StorageTab = 'website' | 'files' | 'google-drive' | 'sharepoint' | 'gitbook'

export interface StorageItem {
  id: number
  type: 'website' | 'file' | 'google_drive' | 'sharepoint' | 'gitbook' | 'miniapp_image'
  status: 'processing' | 'completed' | 'failed' | 'deleting'
  title: string
  content?: string
  originalName?: string
  fileSizeBytes?: number
  sourceUrl?: string
  crawlCount?: number
  crawlDepth?: number
  processingLog?: string
  errorMessage?: string
  mimeType?: string
  ragProvider?: RAGProviderType | string
  ragStatus?: string | Record<string, any>
  blobPath?: string
  pageCount?: number
  pages?: { path: string; title: string }[]
  createdAt: string
  updatedAt: string
}

export interface StorageStats {
  byType: Record<string, Record<string, number>>
  totalSize: number
  totalItems: number
}

export interface StorageData {
  items: StorageItem[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
  stats: StorageStats
}

export interface UploadingFile {
  name: string
  progress: number
  size: number
  uploaded: number
}

export interface RAGProviderSelection {
  provider: RAGProviderType
  hasApiKey: boolean
  isChecking: boolean
}

export interface ApiKeyCheckResult {
  hasApiKey: boolean
  provider?: string
  ragProvider?: string
  configuredProviders: string[]
}

export interface FilesTabContext {
  currentAgentId: string | null
  selectedRagProvider: RAGProviderType
  hasApiKey: boolean
  isCheckingApiKey: boolean
  configuredProviders: string[]
}

export interface StorageHandlers {
  onFileUpload: (files: FileList) => Promise<void>
  onDeleteItem: (itemId: number) => Promise<void>
  onRefresh: () => Promise<void>
}

export interface SharePointSite {
  id: string
  name: string
  description?: string
  webUrl?: string
  lastModifiedDateTime?: string
}

export interface SharePointDrive {
  id: string
  name: string
  description?: string
  driveType?: string
}

export interface SharePointItem {
  id: string
  name: string
  type: 'file' | 'folder'
  mimeType?: string
  size?: string
  supported?: boolean
  lastModifiedDateTime?: string
}

export interface SharePointBreadcrumb {
  id: string
  name: string
}

export interface GoogleDriveItem {
  id: string
  name: string
  type?: 'file' | 'folder'
  mimeType?: string
  modifiedTime?: string
  size?: string
  resourceKey?: string
}

export interface GoogleDriveBreadcrumb {
  id: string
  name: string
}

export interface GoogleDriveFileInfo {
  id: string
  name: string
  mimeType?: string
  resourceKey?: string
}

export type PreviewType = 'text' | 'pdf' | 'image' | 'binary'

export interface PreviewFile {
  id: string
  name: string
  mimeType?: string
  resourceKey?: string
}
