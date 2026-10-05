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
import { GROUP_COLORS, getColorHex } from '../utils'

interface CreateGroupDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  isLoading: boolean
  onCreate: (name: string, description: string, color: string) => void
  t: Record<string, string>
}

export function CreateGroupDialog({
  isOpen,
  onOpenChange,
  isLoading,
  onCreate,
  t,
}: CreateGroupDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('blue')

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setName('')
      setDescription('')
      setColor('blue')
    }
  }, [isOpen])

  const handleCreate = () => {
    onCreate(name, description, color)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.workflow_group_create_title}</DialogTitle>
          <DialogDescription>
            {t.workflow_group_create_description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">{t.workflow_group_name_label}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.workflow_group_name_placeholder}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="group-description">{t.workflow_group_description_label}</Label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.workflow_group_description_placeholder}
              rows={3}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.workflow_group_color_label}</Label>
            <div className="flex gap-2">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`w-8 h-8 rounded-full transition-all ${
                    color === c ? 'ring-2 ring-offset-2 ring-primary' : ''
                  }`}
                  style={{ backgroundColor: getColorHex(c) }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
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
            onClick={handleCreate}
            disabled={isLoading || !name.trim()}
          >
            {isLoading ? t.workflow_creating : t.workflow_create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
