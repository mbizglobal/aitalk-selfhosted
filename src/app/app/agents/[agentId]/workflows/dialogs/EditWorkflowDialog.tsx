'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import type { Workflow } from '../types'

interface EditWorkflowDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  workflow: Workflow | null
  isLoading: boolean
  onUpdate: (workflowId: string, name: string, description: string) => void
  t: Record<string, string>
}

export function EditWorkflowDialog({
  isOpen,
  onOpenChange,
  workflow,
  isLoading,
  onUpdate,
  t,
}: EditWorkflowDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Initialize form when workflow changes or dialog opens
  useEffect(() => {
    if (isOpen && workflow) {
      setName(workflow.name)
      setDescription(workflow.description || '')
    }
  }, [isOpen, workflow])

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setName('')
      setDescription('')
    }
  }, [isOpen])

  const handleUpdate = () => {
    if (workflow) {
      onUpdate(workflow.workflowId, name, description)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.workflow_edit_title}</DialogTitle>
          <DialogDescription>
            {t.workflow_edit_description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-workflow-name">{t.workflow_name_label}</Label>
            <Input
              id="edit-workflow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.workflow_name_placeholder}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-workflow-description">{t.workflow_description_label}</Label>
            <Textarea
              id="edit-workflow-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.workflow_description_placeholder}
              rows={3}
              disabled={isLoading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t.workflow_cancel}
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={isLoading || !name.trim()}
          >
            {isLoading ? t.workflow_saving : t.workflow_save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
