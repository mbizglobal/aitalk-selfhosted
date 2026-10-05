'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import type { CreateWorkflowTranslations } from './types'

interface BlankWorkflowFormProps {
  name: string
  description: string
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onBack: () => void
  onCreate: () => void
  isLoading: boolean
  t: CreateWorkflowTranslations
}

export function BlankWorkflowForm({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onBack,
  onCreate,
  isLoading,
  t,
}: BlankWorkflowFormProps) {
  return (
    <div className="space-y-4 py-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {t.workflow_back || 'Back'}
      </button>

      <div className="space-y-2">
        <Label htmlFor="name">{t.workflow_name_label}</Label>
        <Input
          id="name"
          placeholder={t.workflow_name_placeholder}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{t.workflow_description_label}</Label>
        <Textarea
          id="description"
          placeholder={t.workflow_description_placeholder}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onBack} disabled={isLoading}>
          {t.workflow_cancel}
        </Button>
        <Button onClick={onCreate} disabled={isLoading || !name.trim()}>
          {isLoading ? t.workflow_creating : t.workflow_create}
        </Button>
      </div>
    </div>
  )
}
