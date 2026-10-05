'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Edit, Trash2, Download, Database, Table, FileText } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Locale } from 'date-fns'
import type { DataSheet } from '../types'
import { formatSize, getColumnCount } from '../utils'

interface DataSheetCardProps {
  sheet: DataSheet
  agentId: string
  dateLocale: Locale
  isLoading: boolean
  isMobile: boolean
  onDownload: (sheet: DataSheet) => void
  onDelete: (sheetId: string, name: string) => void
  t: Record<string, string>
}

export function DataSheetCard({
  sheet,
  agentId,
  dateLocale,
  isLoading,
  isMobile,
  onDownload,
  onDelete,
  t,
}: DataSheetCardProps) {
  const router = useRouter()

  if (isMobile) {
    return (
      <Card className="p-3 overflow-hidden">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate max-w-[100px]">{sheet.name}</span>
              <Badge variant="outline" className="font-mono text-xs flex-shrink-0">
                {sheet.rowCount}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => router.push(`/app/agents/${agentId}/data-sheets/${sheet.id}`)}
            >
              <Edit className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => onDownload(sheet)}
            >
              <Download className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <Database className="w-5 h-5 text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg truncate">{sheet.name}</CardTitle>
              {sheet.description && (
                <CardDescription className="mt-1 line-clamp-2">
                  {sheet.description}
                </CardDescription>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Table className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {sheet.rowCount.toLocaleString()} {t.datasheet_rows}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {getColumnCount(sheet.schema)} {t.datasheet_columns}
              </span>
            </div>
          </div>

          <div className="text-sm">
            <Badge variant="outline" className="font-mono">
              {formatSize(sheet.sizeBytes)}
            </Badge>
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <div>
              {t.workflow_created}: {formatDistanceToNow(new Date(sheet.createdAt), { addSuffix: true, locale: dateLocale })}
            </div>
            <div>
              {t.workflow_updated}: {formatDistanceToNow(new Date(sheet.updatedAt), { addSuffix: true, locale: dateLocale })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              onClick={() => router.push(`/app/agents/${agentId}/data-sheets/${sheet.id}`)}
            >
              <Edit className="w-3 h-3 mr-1" />
              {t.datasheet_manage}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => onDownload(sheet)}
              disabled={isLoading}
              title="JSON 다운로드"
            >
              <Download className="w-3 h-3 mr-1" />
              JSON
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive opacity-40 hover:opacity-100 transition-opacity ml-auto"
              onClick={() => onDelete(sheet.id, sheet.name)}
              disabled={isLoading}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
