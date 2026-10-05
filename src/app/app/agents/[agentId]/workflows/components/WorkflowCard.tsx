'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Edit, Copy, Trash2, Play, Archive, Settings, Download, Link } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Locale } from 'date-fns'
import type { Workflow } from '../types'

interface WorkflowCardProps {
  workflow: Workflow
  dateLocale: Locale
  isLoading: boolean
  isMobile: boolean
  onEdit: (workflowId: string) => void
  onOpenEditDialog: (workflow: Workflow) => void
  onSettings: (workflow: Workflow) => void
  onDownload: (workflow: Workflow) => void
  onClone: (workflowId: string) => void
  onDelete: (workflowId: string, name: string) => void
  onChangeStatus: (workflowId: string, status: string) => void
  onShowUrl: (workflow: Workflow) => void
  getStatusBadge: (status: string, kind?: string) => React.ReactNode
  t: Record<string, string>
}

export function WorkflowCard({
  workflow,
  dateLocale,
  isLoading,
  isMobile,
  onEdit,
  onOpenEditDialog,
  onSettings,
  onDownload,
  onClone,
  onDelete,
  onChangeStatus,
  onShowUrl,
  getStatusBadge,
  t,
}: WorkflowCardProps) {
  const isSub = workflow.kind === 'sub'
  if (isMobile) {
    return (
      <Card className="p-3 overflow-hidden">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate max-w-[120px]">{workflow.name}</span>
              {getStatusBadge(workflow.status, workflow.kind)}
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => onEdit(workflow.workflowId)}
            >
              <Edit className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => onSettings(workflow)}
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
            {workflow.status === 'production' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => onShowUrl(workflow)}
              >
                <Link className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => onDownload(workflow)}
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
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{workflow.name}</CardTitle>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => onOpenEditDialog(workflow)}
              >
                <Edit className="w-3 h-3" />
              </Button>
            </div>
            {workflow.description && (
              <CardDescription className="mt-1 line-clamp-2">
                {workflow.description}
              </CardDescription>
            )}
          </div>
          {getStatusBadge(workflow.status, workflow.kind)}
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground space-y-1">
            <div>
              {t.workflow_created}: {formatDistanceToNow(new Date(workflow.createdAt), { addSuffix: true, locale: dateLocale })}
            </div>
            <div>
              {t.workflow_updated}: {formatDistanceToNow(new Date(workflow.updatedAt), { addSuffix: true, locale: dateLocale })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              onClick={() => onEdit(workflow.workflowId)}
            >
              <Edit className="w-3 h-3 mr-1" />
              {t.workflow_edit}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => onSettings(workflow)}
              disabled={isLoading}
            >
              <Settings className="w-3 h-3 mr-1" />
              Settings
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => onDownload(workflow)}
              disabled={isLoading}
              title="JSON 다운로드"
            >
              <Download className="w-3 h-3 mr-1" />
              JSON
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => onClone(workflow.workflowId)}
              disabled={isLoading}
            >
              <Copy className="w-3 h-3 mr-1" />
              {t.workflow_clone}
            </Button>

            {!isSub && workflow.status !== 'production' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onChangeStatus(workflow.workflowId, 'production')}
                disabled={isLoading}
              >
                <Play className="w-3 h-3 mr-1" />
                {t.workflow_deploy}
              </Button>
            )}

            {workflow.status === 'production' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onChangeStatus(workflow.workflowId, 'draft')}
                disabled={isLoading}
              >
                <Archive className="w-3 h-3 mr-1" />
                {t.workflow_to_draft}
              </Button>
            )}

            {workflow.status === 'production' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onShowUrl(workflow)}
                disabled={isLoading}
                title={t.workflow_url || 'URL'}
              >
                <Link className="w-3 h-3 mr-1" />
                URL
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive opacity-40 hover:opacity-100 transition-opacity ml-auto"
              onClick={() => onDelete(workflow.workflowId, workflow.name)}
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
