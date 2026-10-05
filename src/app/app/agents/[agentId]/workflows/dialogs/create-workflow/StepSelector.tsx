'use client'

import { FileText, LayoutTemplate, Puzzle } from 'lucide-react'
import type { CreateStep, CreateWorkflowTranslations } from './types'

interface StepSelectorProps {
  onSelect: (step: CreateStep) => void
  t: CreateWorkflowTranslations
}

export function StepSelector({ onSelect, t }: StepSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-4 py-4">
      <button
        onClick={() => onSelect('blank')}
        className="flex flex-col items-center gap-3 p-6 border rounded-lg hover:border-primary hover:bg-accent transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <FileText className="w-6 h-6 text-primary" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold">
            {t.workflow_step_blank_title || 'Blank Workflow'}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t.workflow_step_blank_desc || 'Start from scratch'}
          </p>
        </div>
      </button>

      <button
        onClick={() => onSelect('template')}
        className="flex flex-col items-center gap-3 p-6 border rounded-lg hover:border-primary hover:bg-accent transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <LayoutTemplate className="w-6 h-6 text-primary" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold">
            {t.workflow_step_template_title || 'From Template'}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t.workflow_step_template_desc || 'Use a pre-built template'}
          </p>
        </div>
      </button>

      <button
        onClick={() => onSelect('sub')}
        className="flex flex-col items-center gap-3 p-6 border rounded-lg hover:border-primary hover:bg-accent transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-full bg-pink-500/10 flex items-center justify-center">
          <Puzzle className="w-6 h-6 text-pink-500" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold">
            {t.workflow_step_sub_title || 'Sub-workflow'}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t.workflow_step_sub_desc || 'A tool other workflows\' AI can call'}
          </p>
        </div>
      </button>
    </div>
  )
}
