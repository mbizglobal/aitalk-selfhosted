'use client'

import { ArrowLeft, Database } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import type { WorkflowTemplate, CreateWorkflowTranslations } from './types'

interface TemplatePreviewProps {
  template: WorkflowTemplate
  name: string
  description: string
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onBack: () => void
  onCreate: () => void
  isLoading: boolean
  t: CreateWorkflowTranslations
}

const complexityColors = {
  beginner: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

export function TemplatePreview({
  template,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onBack,
  onCreate,
  isLoading,
  t,
}: TemplatePreviewProps) {
  const complexityLabel = {
    beginner: t.workflow_complexity_beginner || 'Beginner',
    intermediate: t.workflow_complexity_intermediate || 'Intermediate',
    advanced: t.workflow_complexity_advanced || 'Advanced',
  }

  return (
    <div className="flex flex-col max-h-[calc(100svh-10rem)]">
      {/* Header - Back button */}
      <div className="shrink-0 pt-4 pb-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.workflow_back || 'Back'}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1 scrollbar-thin">
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold">{template.name}</h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                complexityColors[template.complexity]
              }`}
            >
              {complexityLabel[template.complexity]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
          <div className="flex flex-wrap gap-1">
            {template.nodeTypes.map((type) => (
              <span key={type} className="text-xs px-2 py-0.5 bg-background rounded border">
                {type}
              </span>
            ))}
          </div>
          {template.explanation && (
            <p className="text-sm text-muted-foreground mt-3 pt-3 border-t whitespace-pre-line">
              {template.explanation}
            </p>
          )}

          {/* Data Sheet Auto-creation Info */}
          {template.dataSheetSchema && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-medium">
                  {t.workflow_template_datasheet_auto || 'Data Sheet (Auto-created)'}
                </span>
              </div>
              <div className="bg-indigo-500/10 rounded-md p-3 border border-indigo-500/20">
                <p className="text-sm font-medium text-indigo-400 mb-2">
                  {template.dataSheetSchema.name}
                </p>
                <div className="flex flex-wrap gap-1">
                  {template.dataSheetSchema.columns.map((col) => (
                    <span
                      key={col.name}
                      className="text-xs px-2 py-0.5 bg-background/50 rounded border border-indigo-500/30"
                      title={col.description || col.type}
                    >
                      {col.name}
                      {col.required && <span className="text-red-400 ml-0.5">*</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="preview-name">{t.workflow_name_label}</Label>
            <Input
              id="preview-name"
              placeholder={t.workflow_name_placeholder}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="preview-description">{t.workflow_description_label}</Label>
            <Textarea
              id="preview-description"
              placeholder={t.workflow_description_placeholder}
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              rows={2}
            />
          </div>
        </div>
      </div>

      {/* Footer - Buttons (always visible) */}
      <div className="shrink-0 flex justify-end gap-2 pt-4 border-t mt-4">
        <Button variant="outline" onClick={onBack} disabled={isLoading}>
          {t.workflow_cancel}
        </Button>
        <Button onClick={onCreate} disabled={isLoading || !name.trim()}>
          {isLoading ? t.workflow_creating : (t.workflow_template_use || 'Use Template')}
        </Button>
      </div>
    </div>
  )
}
