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

interface CreateDataSheetDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  isLoading: boolean
  onCreate: (name: string, description: string) => void
  t: Record<string, string>
}

export function CreateDataSheetDialog({
  isOpen,
  onOpenChange,
  isLoading,
  onCreate,
  t,
}: CreateDataSheetDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setName('')
      setDescription('')
    }
  }, [isOpen])

  const handleCreate = () => {
    onCreate(name, description)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.datasheet_create_title}</DialogTitle>
          <DialogDescription>
            {t.datasheet_create_description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="sheet-name">{t.datasheet_name_label}</Label>
            <Input
              id="sheet-name"
              placeholder={t.datasheet_name_placeholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sheet-description">{t.datasheet_description_label}</Label>
            <Textarea
              id="sheet-description"
              placeholder={t.datasheet_description_placeholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
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
          <Button onClick={handleCreate} disabled={isLoading || !name.trim()}>
            {isLoading ? t.workflow_creating : t.workflow_create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
