'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Trash2, ChevronUp, ChevronDown, FolderOpen, ArrowRight, Database, Plus, Edit, Download } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { WorkflowGroup, Workflow, DataSheet } from '../types'
import { SortableWorkflowItem } from './SortableWorkflowItem'
import { getGroupColorStyle, getGroupIconColor } from '../utils'

interface WorkflowGroupCardProps {
  group: WorkflowGroup
  agentId: string
  isLoading: boolean
  ungroupedWorkflowsCount: number
  ungroupedDataSheetsCount: number
  scrollRefs: React.MutableRefObject<{ [key: string]: HTMLDivElement | null }>
  onToggleExpand: (groupId: string) => void
  onDeleteGroup: (groupId: string, name: string) => void
  onAddWorkflow: (group: WorkflowGroup) => void
  onAddDataSheet: (group: WorkflowGroup) => void
  onRemoveWorkflow: (groupId: string, workflowId: string) => void
  onRemoveDataSheet: (groupId: string, sheetId: string) => void
  onDragEnd: (event: DragEndEvent, groupId: string) => void
  onHorizontalScroll: (e: React.WheelEvent<HTMLDivElement>, groupId: string) => void
  onEditWorkflow: (workflowId: string) => void
  onShowSettings: (workflow: Workflow) => void
  onShowUrl: (workflow: Workflow) => void
  onDownloadWorkflowJson: (workflow: Workflow) => void
  onDownloadSheetJson: (sheet: DataSheet) => void
  onChangeStatus: (workflowId: string, status: string) => void
  getStatusBadge: (status: string, kind?: string) => React.ReactNode
  t: Record<string, string>
}

export function WorkflowGroupCard({
  group,
  agentId,
  isLoading,
  ungroupedWorkflowsCount,
  ungroupedDataSheetsCount,
  scrollRefs,
  onToggleExpand,
  onDeleteGroup,
  onAddWorkflow,
  onAddDataSheet,
  onRemoveWorkflow,
  onRemoveDataSheet,
  onDragEnd,
  onHorizontalScroll,
  onEditWorkflow,
  onShowSettings,
  onShowUrl,
  onDownloadWorkflowJson,
  onDownloadSheetJson,
  onChangeStatus,
  getStatusBadge,
  t,
}: WorkflowGroupCardProps) {
  const router = useRouter()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  return (
    <Card className="mb-6 overflow-hidden">
      <div
        className={`px-6 py-4 bg-gradient-to-r ${getGroupColorStyle(group.color)} border-b cursor-pointer hover:opacity-90 transition-opacity`}
        onClick={() => onToggleExpand(group.id)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${getGroupIconColor(group.color)} flex items-center justify-center`}>
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                {group.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {group.workflows.length} Workflows · {group.dataSheets.length} Data Sheets
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteGroup(group.id, group.name)
              }}
              disabled={isLoading}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
            {group.isExpanded ? (
              <ChevronUp className="w-5 h-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {group.isExpanded && (
        <CardContent className="p-6">
          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
              <ArrowRight className="w-4 h-4" />
              {t.workflow_group_execution_flow}
            </h3>
            {group.workflows.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => onDragEnd(event, group.id)}
              >
                <SortableContext
                  items={group.workflows.map(w => w.workflowId)}
                  strategy={horizontalListSortingStrategy}
                >
                  <div
                    ref={(el) => { scrollRefs.current[group.id] = el }}
                    onWheel={(e) => onHorizontalScroll(e, group.id)}
                    className="flex items-center gap-4 overflow-x-auto pb-2 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40"
                  >
                    {group.workflows.map((item, index) => (
                      <SortableWorkflowItem
                        key={item.id}
                        item={item}
                        index={index}
                        totalCount={group.workflows.length}
                        isLoading={isLoading}
                        onEdit={onEditWorkflow}
                        onSettings={onShowSettings}
                        onDownload={onDownloadWorkflowJson}
                        onShowUrl={onShowUrl}
                        onRemove={onRemoveWorkflow}
                        onChangeStatus={onChangeStatus}
                        getStatusBadge={getStatusBadge}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <p className="text-sm text-muted-foreground">{t.workflow_group_empty_workflows}</p>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => onAddWorkflow(group)}
              disabled={ungroupedWorkflowsCount === 0}
            >
              <Plus className="w-4 h-4 mr-1" />
              {t.workflow_group_add_workflow}
            </Button>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <Database className="w-4 h-4" />
              {t.workflow_group_connected_sheets}
            </h3>
            <div className="flex flex-wrap gap-3">
              {group.dataSheets.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg"
                >
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm font-medium">{item.dataSheet.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.dataSheet.rowCount} rows
                  </span>
                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      onClick={() => router.push(`/app/agents/${agentId}/data-sheets/${item.dataSheet.id}`)}
                      title="Manage"
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      onClick={() => onDownloadSheetJson(item.dataSheet)}
                      title="Download JSON"
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveDataSheet(group.id, item.sheetId)}
                      disabled={isLoading}
                      title="Remove from group"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {group.dataSheets.length === 0 && (
                <p className="text-sm text-muted-foreground">{t.workflow_group_empty_sheets}</p>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onAddDataSheet(group)}
                disabled={ungroupedDataSheetsCount === 0}
              >
                <Plus className="w-4 h-4 mr-1" />
                {t.workflow_group_add_sheet}
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
