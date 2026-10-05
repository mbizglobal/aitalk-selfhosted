'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { GripVertical, Edit, Settings, Download, Link, Trash2, ArrowRight, Play, Archive } from 'lucide-react'
import type { WorkflowGroupItem, Workflow } from '../types'

interface SortableWorkflowItemProps {
  item: WorkflowGroupItem
  index: number
  totalCount: number
  isLoading: boolean
  onEdit: (workflowId: string) => void
  onSettings: (workflow: Workflow) => void
  onDownload: (workflow: Workflow) => void
  onShowUrl: (workflow: Workflow) => void
  onRemove: (groupId: string, workflowId: string) => void
  onChangeStatus: (workflowId: string, status: string) => void
  getStatusBadge: (status: string, kind?: string) => React.ReactNode
}

export function SortableWorkflowItem({
  item,
  index,
  totalCount,
  isLoading,
  onEdit,
  onSettings,
  onDownload,
  onShowUrl,
  onRemove,
  onChangeStatus,
  getStatusBadge
}: SortableWorkflowItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.workflowId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <div className={`flex-shrink-0 w-48 p-4 bg-muted rounded-lg border hover:border-primary transition-colors ${isDragging ? 'shadow-lg ring-2 ring-primary' : ''}`}>
        <div className="flex items-center gap-2 mb-2">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 -ml-1 hover:bg-muted-foreground/10 rounded"
            title="드래그하여 순서 변경"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </button>
          <span className="w-6 h-6 bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center justify-center">
            {index + 1}
          </span>
          {getStatusBadge(item.workflow.status, item.workflow.kind)}
        </div>
        <h4 className="font-medium text-sm mb-1 truncate">{item.workflow.name}</h4>
        <div className="flex flex-wrap gap-0.5 mt-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onEdit(item.workflow.workflowId)}
            title="Edit"
          >
            <Edit className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onSettings(item.workflow)}
            title="Settings"
          >
            <Settings className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onDownload(item.workflow)}
            title="Download JSON"
          >
            <Download className="w-3 h-3" />
          </Button>
          {item.workflow.status === 'production' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => onShowUrl(item.workflow)}
              title="URL"
            >
              <Link className="w-3 h-3" />
            </Button>
          )}
          {item.workflow.kind !== 'sub' && item.workflow.status !== 'production' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-green-500 hover:text-green-600"
              onClick={() => onChangeStatus(item.workflow.workflowId, 'production')}
              disabled={isLoading}
              title="Deploy"
            >
              <Play className="w-3 h-3" />
            </Button>
          )}
          {item.workflow.status === 'production' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-orange-500 hover:text-orange-600"
              onClick={() => onChangeStatus(item.workflow.workflowId, 'draft')}
              disabled={isLoading}
              title="Move to Draft"
            >
              <Archive className="w-3 h-3" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(item.groupId, item.workflow.workflowId)}
            disabled={isLoading}
            title="Remove from group"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
      {index < totalCount - 1 && (
        <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
      )}
    </div>
  )
}
