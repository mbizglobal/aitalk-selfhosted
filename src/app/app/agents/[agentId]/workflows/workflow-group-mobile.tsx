'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Plus,
  Edit,
  Trash2,
  Database,
  Settings,
  Download,
  Link,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  ArrowRight,
  GripVertical,
  Play,
  Archive,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Workflow {
  id: number
  workflowId: string
  name: string
  description: string | null
  status: string
  trafficWeight: number
  workflowJson: string
  createdAt: Date
  updatedAt: Date
  kind?: string
}

interface DataSheet {
  id: string
  agentId: string
  name: string
  description: string | null
  schema: string
  sizeBytes: bigint
  rowCount: number
  createdAt: Date
  updatedAt: Date
}

interface WorkflowGroupItem {
  id: string
  groupId: string
  workflowId: string
  order: number
  workflow: Workflow
}

interface WorkflowGroupDataSheet {
  id: string
  groupId: string
  sheetId: string
  dataSheet: DataSheet
}

interface WorkflowGroup {
  id: string
  agentId: string
  name: string
  description: string | null
  color: string | null
  isExpanded: boolean
  createdAt: Date
  updatedAt: Date
  workflows: WorkflowGroupItem[]
  dataSheets: WorkflowGroupDataSheet[]
}

interface Props {
  group: WorkflowGroup
  agentId: string
  isLoading: boolean
  ungroupedWorkflowsCount: number
  ungroupedDataSheetsCount: number
  onToggleExpand: (groupId: string) => void
  onDeleteGroup: (groupId: string, groupName: string) => void
  onAddWorkflow: (group: WorkflowGroup) => void
  onAddDataSheet: (group: WorkflowGroup) => void
  onRemoveWorkflow: (groupId: string, workflowId: string) => void
  onRemoveDataSheet: (groupId: string, sheetId: string) => void
  onReorderWorkflows: (groupId: string, workflowIds: string[]) => void
  onShowSettings: (workflow: Workflow) => void
  onShowUrl: (workflow: Workflow) => void
  onDownloadWorkflowJson: (workflow: Workflow) => void
  onDownloadSheetJson: (sheet: DataSheet) => void
  onEditWorkflow: (workflowId: string) => void
  onChangeStatus: (workflowId: string, status: string) => void
  getStatusBadge: (status: string, kind?: string) => React.ReactNode
  getGroupColorStyle: (color: string | null) => string
  getGroupIconColor: (color: string | null) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
}

interface MobileSortableWorkflowItemProps {
  item: WorkflowGroupItem
  index: number
  isLoading: boolean
  onEdit: (workflowId: string) => void
  onSettings: (workflow: Workflow) => void
  onShowUrl: (workflow: Workflow) => void
  onDownload: (workflow: Workflow) => void
  onRemove: (groupId: string, workflowId: string) => void
  onChangeStatus: (workflowId: string, status: string) => void
  getStatusBadge: (status: string, kind?: string) => React.ReactNode
}

function MobileSortableWorkflowItem({
  item,
  index,
  isLoading,
  onEdit,
  onSettings,
  onShowUrl,
  onDownload,
  onRemove,
  onChangeStatus,
  getStatusBadge
}: MobileSortableWorkflowItemProps) {
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
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 p-2 bg-muted rounded-lg border overflow-hidden ${isDragging ? 'shadow-lg ring-2 ring-primary' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-muted-foreground/10 rounded touch-none flex-shrink-0"
      >
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      <span className="w-5 h-5 bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center justify-center flex-shrink-0">
        {index + 1}
      </span>

      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1">
          <span className="font-medium text-xs truncate max-w-[80px]">{item.workflow.name}</span>
          {getStatusBadge(item.workflow.status, item.workflow.kind)}
        </div>
      </div>

      <div className="flex items-center gap-0 flex-shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => onEdit(item.workflow.workflowId)}
        >
          <Edit className="w-3 h-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => onSettings(item.workflow)}
        >
          <Settings className="w-3 h-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => onDownload(item.workflow)}
        >
          <Download className="w-3 h-3" />
        </Button>
        {item.workflow.status === 'production' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onShowUrl(item.workflow)}
          >
            <Link className="w-3 h-3" />
          </Button>
        )}
        {item.workflow.kind !== 'sub' && item.workflow.status !== 'production' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-green-500"
            onClick={() => onChangeStatus(item.workflow.workflowId, 'production')}
            disabled={isLoading}
          >
            <Play className="w-3 h-3" />
          </Button>
        )}
        {item.workflow.status === 'production' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-orange-500"
            onClick={() => onChangeStatus(item.workflow.workflowId, 'draft')}
            disabled={isLoading}
          >
            <Archive className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

export default function WorkflowGroupMobile({
  group,
  agentId,
  isLoading,
  ungroupedWorkflowsCount,
  ungroupedDataSheetsCount,
  onToggleExpand,
  onDeleteGroup,
  onAddWorkflow,
  onAddDataSheet,
  onRemoveWorkflow,
  onRemoveDataSheet,
  onReorderWorkflows,
  onShowSettings,
  onShowUrl,
  onDownloadWorkflowJson,
  onDownloadSheetJson,
  onEditWorkflow,
  onChangeStatus,
  getStatusBadge,
  getGroupColorStyle,
  getGroupIconColor,
  t,
}: Props) {
  const router = useRouter()
  const [localWorkflows, setLocalWorkflows] = useState(group.workflows)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id) return

    const oldIndex = localWorkflows.findIndex(item => item.workflowId === active.id)
    const newIndex = localWorkflows.findIndex(item => item.workflowId === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    const newWorkflows = arrayMove(localWorkflows, oldIndex, newIndex)
    setLocalWorkflows(newWorkflows.map((w, i) => ({ ...w, order: i })))

    const workflowIds = newWorkflows.map(w => w.workflowId)
    onReorderWorkflows(group.id, workflowIds)
  }

  if (JSON.stringify(group.workflows.map(w => w.workflowId)) !== JSON.stringify(localWorkflows.map(w => w.workflowId))) {
    setLocalWorkflows(group.workflows)
  }

  return (
    <Card className="mb-4 overflow-hidden">
      {/* Group Header */}
      <div
        className={`px-3 py-2 bg-gradient-to-r ${getGroupColorStyle(group.color)} border-b cursor-pointer active:opacity-80 transition-opacity`}
        onClick={() => onToggleExpand(group.id)}
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <div className={`w-7 h-7 rounded-lg ${getGroupIconColor(group.color)} flex items-center justify-center flex-shrink-0`}>
              <FolderOpen className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <h2 className="text-sm font-bold truncate">
                {group.name}
              </h2>
              <p className="text-xs text-muted-foreground truncate">
                {group.workflows.length} WF · {group.dataSheets.length} DS
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteGroup(group.id, group.name)
              }}
              disabled={isLoading}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            {group.isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {/* Group Content (Expanded) */}
      {group.isExpanded && (
        <CardContent className="p-3">
          <div className="mb-3">
            <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <ArrowRight className="w-3.5 h-3.5" />
              <span className="truncate">Workflows</span>
            </h3>
            {localWorkflows.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={localWorkflows.map(w => w.workflowId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {localWorkflows.map((item, index) => (
                      <MobileSortableWorkflowItem
                        key={item.id}
                        item={item}
                        index={index}
                        isLoading={isLoading}
                        onEdit={onEditWorkflow}
                        onSettings={onShowSettings}
                        onShowUrl={onShowUrl}
                        onDownload={onDownloadWorkflowJson}
                        onRemove={onRemoveWorkflow}
                        onChangeStatus={onChangeStatus}
                        getStatusBadge={getStatusBadge}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <p className="text-xs text-muted-foreground">{t.workflow_group_empty_workflows}</p>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 text-xs"
              onClick={() => onAddWorkflow(group)}
              disabled={ungroupedWorkflowsCount === 0}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add
            </Button>
          </div>

          {/* Connected Data Sheets */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <Database className="w-3.5 h-3.5" />
              <span className="truncate">Data Sheets</span>
            </h3>
            <div className="flex flex-col gap-2">
              {group.dataSheets.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-1 p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg overflow-hidden"
                >
                  <Database className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <span className="text-xs font-medium truncate block max-w-[80px]">{item.dataSheet.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{item.dataSheet.rowCount}</span>
                  <div className="flex items-center gap-0 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => onEditWorkflow(item.dataSheet.id)}
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => onDownloadSheetJson(item.dataSheet)}
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {group.dataSheets.length === 0 && (
                <p className="text-xs text-muted-foreground">{t.workflow_group_empty_sheets}</p>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 text-xs"
                onClick={() => onAddDataSheet(group)}
                disabled={ungroupedDataSheetsCount === 0}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
