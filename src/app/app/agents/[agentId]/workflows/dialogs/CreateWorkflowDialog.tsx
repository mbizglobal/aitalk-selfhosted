'use client'

import { useState, useEffect } from 'react'
import { FileText, LayoutTemplate, Puzzle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDraggable } from '@/app/app/agent-studio/hooks/useDraggable'
import { useEdition } from '@/components/EditionProvider'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  BlankWorkflowForm,
  TemplateGrid,
  WorkAppTemplateGrid,
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
  workAppOnly?: boolean
}

export function CreateWorkflowDialog({
  isOpen,
  onOpenChange,
  isLoading,
  onCreate,
  t,
  workAppOnly = false,
}: CreateWorkflowDialogProps) {
  const [step, setStep] = useState<CreateStep>('workapp')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null)
  const [previewFrom, setPreviewFrom] = useState<'template' | 'workapp'>('template')
  const { handleDragStart, dragStyle } = useDraggable({ isOpen })
  const oneList = useEdition() === 'selfhosted'

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setStep('workapp')
      setName('')
      setDescription('')
      setSelectedTemplate(null)
      setPreviewFrom('template')
    }
  }, [isOpen])

  const handleSelectTemplate = (from: 'template' | 'workapp') => (template: WorkflowTemplate) => {
    setPreviewFrom(from)
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
      case 'blank':
        return t.workflow_step_blank_title || 'Blank Workflow'
      case 'sub':
        return t.workflow_step_sub_title || 'Sub-workflow'
      case 'template':
        return t.workflow_step_template_title || 'Choose Template'
      case 'workapp':
        return oneList ? (t.workflow_step_template_title || 'Choose Template') : (t.workflow_workapp_pick_title || 'Choose a Work App')
      case 'preview':
        return t.workflow_template_preview_title || 'Template Preview'
      default:
        return t.workflow_create_title
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent style={dragStyle} className={step === 'workapp' ? 'sm:max-w-3xl lg:max-w-5xl' : step === 'template' ? 'max-w-2xl' : ''}>
        <DialogHeader onMouseDown={handleDragStart} className="sm:flex-row sm:items-center sm:justify-between sm:pr-8 sm:cursor-move select-none">
          <DialogTitle>{getTitle()}</DialogTitle>
          {step === 'workapp' && !workAppOnly && (
            <div className="flex flex-wrap justify-center sm:justify-end gap-2">
              {!oneList && (
                <Button variant="outline" size="sm" onClick={() => setStep('template')}>
                  <LayoutTemplate className="w-4 h-4" />
                  {t.workflow_step_template_title || 'From Template'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setStep('sub')}>
                <Puzzle className="w-4 h-4 text-pink-500" />
                {t.workflow_step_sub_title || 'Sub-workflow'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setStep('blank')}>
                <FileText className="w-4 h-4" />
                {t.workflow_step_blank_title || 'Blank Workflow'}
              </Button>
            </div>
          )}
        </DialogHeader>

        {step === 'blank' && (
          <BlankWorkflowForm
            name={name}
            description={description}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onBack={() => setStep('workapp')}
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
              onBack={() => setStep('workapp')}
              onCreate={handleCreateSub}
              isLoading={isLoading}
              t={t}
            />
          </div>
        )}

        {step === 'template' && (
          <TemplateGrid
            onBack={() => setStep('workapp')}
            onSelectTemplate={handleSelectTemplate('template')}
            t={t}
          />
        )}

        {step === 'workapp' && (
          <WorkAppTemplateGrid
            onBack={workAppOnly ? () => onOpenChange(false) : undefined}
            onSelectTemplate={handleSelectTemplate('workapp')}
            withWorkflowTemplates={oneList && !workAppOnly}
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
            onBack={() => setStep(previewFrom)}
            onCreate={handleCreateFromTemplate}
            isLoading={isLoading}
            t={t}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
