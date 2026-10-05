'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FileText, Database } from 'lucide-react'
import type { Workflow, DataSheet, WorkflowGroup, AddType } from '../types'
import { getColumnCount } from '../utils'

interface AddToGroupDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  addType: AddType
  selectedGroup: WorkflowGroup | null
  ungroupedWorkflows: Workflow[]
  ungroupedDataSheets: DataSheet[]
  onAddWorkflow: (groupId: string, workflowId: string) => void
  onAddSheet: (groupId: string, sheetId: string) => void
  getStatusBadge: (status: string) => React.ReactNode
  t: Record<string, string>
}

export function AddToGroupDialog({
  isOpen,
  onOpenChange,
  addType,
  selectedGroup,
  ungroupedWorkflows,
  ungroupedDataSheets,
  onAddWorkflow,
  onAddSheet,
  getStatusBadge,
  t,
}: AddToGroupDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {addType === 'workflow' ? t.workflow_group_add_workflow : t.workflow_group_add_sheet}
          </DialogTitle>
          <DialogDescription>
            {selectedGroup?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4 max-h-[300px] overflow-y-auto">
          {addType === 'workflow' ? (
            ungroupedWorkflows.map((workflow) => (
              <div
                key={workflow.workflowId}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted cursor-pointer"
                onClick={() => selectedGroup && onAddWorkflow(selectedGroup.id, workflow.workflowId)}
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{workflow.name}</div>
                    {workflow.description && (
                      <div className="text-sm text-muted-foreground line-clamp-1">
                        {workflow.description}
                      </div>
                    )}
                  </div>
                </div>
                {getStatusBadge(workflow.status)}
              </div>
            ))
          ) : (
            ungroupedDataSheets.map((sheet) => (
              <div
                key={sheet.id}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted cursor-pointer"
                onClick={() => selectedGroup && onAddSheet(selectedGroup.id, sheet.id)}
              >
                <div className="flex items-center gap-3">
                  <Database className="w-4 h-4 text-indigo-500" />
                  <div>
                    <div className="font-medium">{sheet.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {sheet.rowCount} rows · {getColumnCount(sheet.schema)} columns
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}

          {addType === 'workflow' && ungroupedWorkflows.length === 0 && (
            <p className="text-center text-muted-foreground py-4">
              {t.workflow_group_empty_workflows}
            </p>
          )}
          {addType === 'datasheet' && ungroupedDataSheets.length === 0 && (
            <p className="text-center text-muted-foreground py-4">
              {t.workflow_group_empty_sheets}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.workflow_cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
