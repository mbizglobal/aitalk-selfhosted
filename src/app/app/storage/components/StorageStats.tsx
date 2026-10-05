'use client'

import { useEdition } from '@/components/EditionProvider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Files, Globe, HardDrive, BarChart3, BookOpen, FileText } from 'lucide-react'
import type { StorageStats as StorageStatsType } from '../types'
import type { DocPagesInfo } from '../hooks/useRagProvider'

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

interface StorageStatsProps {
  stats: StorageStatsType
  t: (key: string) => string
  docPages?: DocPagesInfo | null
}

export function StorageStats({ stats, t, docPages }: StorageStatsProps) {
  const hasDocPages = docPages && docPages.limit !== null
  const selfHosted = useEdition() === 'selfhosted'
  const mdCols = selfHosted
    ? (hasDocPages ? 'md:grid-cols-4' : 'md:grid-cols-3')
    : (hasDocPages ? 'md:grid-cols-6' : 'md:grid-cols-5')

  return (
    <div className={`grid grid-cols-2 ${mdCols} gap-4`}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t('storage_stats_total_items')}</CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalItems}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t('storage_stats_total_size')}</CardTitle>
          <HardDrive className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatFileSize(stats.totalSize)}</div>
        </CardContent>
      </Card>

      {!selfHosted && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t('storage_stats_websites')}</CardTitle>
          <Globe className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(stats.byType.website?.completed || 0) +
             (stats.byType.website?.processing || 0) +
             (stats.byType.website?.failed || 0)}
          </div>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t('storage_stats_files')}</CardTitle>
          <Files className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(stats.byType.file?.completed || 0) +
             (stats.byType.file?.processing || 0) +
             (stats.byType.file?.failed || 0) +
             (stats.byType.google_drive?.completed || 0) +
             (stats.byType.google_drive?.processing || 0) +
             (stats.byType.google_drive?.failed || 0) +
             (stats.byType.sharepoint?.completed || 0) +
             (stats.byType.sharepoint?.processing || 0) +
             (stats.byType.sharepoint?.failed || 0)}
          </div>
          {!selfHosted && (
          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
            Files + Google Drive + SharePoint
          </p>
          )}
        </CardContent>
      </Card>

      {!selfHosted && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t('storage_stats_gitbook')}</CardTitle>
          <BookOpen className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(stats.byType.gitbook?.completed || 0) +
             (stats.byType.gitbook?.processing || 0) +
             (stats.byType.gitbook?.failed || 0)}
          </div>
        </CardContent>
      </Card>
      )}

      {hasDocPages && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Doc Pages</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <span className={
                docPages!.used / docPages!.limit! >= 0.9
                  ? 'text-red-500'
                  : docPages!.used / docPages!.limit! >= 0.7
                    ? 'text-amber-500'
                    : ''
              }>
                {docPages!.used.toLocaleString()}
              </span>
              <span className="text-sm font-normal text-muted-foreground"> / {docPages!.limit!.toLocaleString()}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
              PDF, DOCX, PPTX, XLSX, JPG, PNG only. Text files are free. Resets monthly.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
