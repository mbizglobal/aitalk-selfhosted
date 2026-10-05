'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  StepSelector,
  BlankWorkflowForm,
  TemplateGrid,
  TemplatePreview,
  type CreateStep,
  type WorkflowTemplate,
  type CreateWorkflowTranslations,
  type DataSheetSchema,
} from './create-workflow'

interface CreateWorkflowDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  isLoading: boolean
  onCreate: (name: string, description: string, workflowJson?: string, dataSheetSchema?: DataSheetSchema, kind?: 'main' | 'sub', bundleTemplateId?: string) => void
  t: CreateWorkflowTranslations
}

export function CreateWorkflowDialog({
  isOpen,
  onOpenChange,
  isLoading,
  onCreate,
  t,
}: CreateWorkflowDialogProps) {
  const [step, setStep] = useState<CreateStep>('select')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null)

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select')
      setName('')
      setDescription('')
      setSelectedTemplate(null)
    }
  }, [isOpen])

  const handleSelectTemplate = (template: WorkflowTemplate) => {
    setSelectedTemplate(template)
    setName(template.name)
    setDescription(template.description)
    setStep('preview')
  }

  const handleCreateBlank = () => {
    onCreate(name, description)
  }

  const handleCreateSub = () => {
    onCreate(name, description, undefined, undefined, 'sub')
  }

  const handleCreateFromTemplate = () => {
    if (!selectedTemplate) return
    if (selectedTemplate.bundleVersion) {
      onCreate(name, description, undefined, undefined, undefined, selectedTemplate.templateId)
      return
    }
    if (selectedTemplate.workflowJson) {
      onCreate(
        name,
        description,
        JSON.stringify(selectedTemplate.workflowJson),
        selectedTemplate.dataSheetSchema
      )
    }
  }

  const getTitle = () => {
    switch (step) {
      case 'select':
        return t.workflow_step_select_title || t.workflow_create_title
      case 'blank':
        return t.workflow_step_blank_title || 'Blank Workflow'
      case 'sub':
        return t.workflow_step_sub_title || 'Sub-workflow'
      case 'template':
        return t.workflow_step_template_title || 'Choose Template'
      case 'preview':
        return t.workflow_template_preview_title || 'Template Preview'
      default:
        return t.workflow_create_title
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={step === 'template' ? 'max-w-2xl' : ''}>
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        {step === 'select' && (
          <StepSelector onSelect={setStep} t={t} />
        )}

        {step === 'blank' && (
          <BlankWorkflowForm
            name={name}
            description={description}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onBack={() => setStep('select')}
            onCreate={handleCreateBlank}
            isLoading={isLoading}
            t={t}
          />
        )}

        {step === 'sub' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t.workflow_sub_form_hint || 'A Sub-workflow is called by the AI of other workflows as a function (no deploy — saving takes effect immediately). Build it from Data Sheets, HTTP, If/Else and similar nodes; AI nodes are not allowed inside.'}
            </p>
            <BlankWorkflowForm
              name={name}
              description={description}
              onNameChange={setName}
              onDescriptionChange={setDescription}
              onBack={() => setStep('select')}
              onCreate={handleCreateSub}
              isLoading={isLoading}
              t={t}
            />
          </div>
        )}

        {step === 'template' && (
          <TemplateGrid
            onBack={() => setStep('select')}
            onSelectTemplate={handleSelectTemplate}
            t={t}
          />
        )}

        {step === 'preview' && selectedTemplate && (
          <TemplatePreview
            template={selectedTemplate}
            name={name}
            description={description}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onBack={() => setStep('template')}
            onCreate={handleCreateFromTemplate}
            isLoading={isLoading}
            t={t}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
