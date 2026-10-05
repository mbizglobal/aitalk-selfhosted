'use client'

import type { WorkflowTemplate, CreateWorkflowTranslations } from './types'

interface TemplateCardProps {
  template: WorkflowTemplate
  onClick: () => void
  t: CreateWorkflowTranslations
}

const complexityColors = {
  beginner: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

export function TemplateCard({ template, onClick, t }: TemplateCardProps) {
  const complexityLabel = {
    beginner: t.workflow_complexity_beginner || 'Beginner',
    intermediate: t.workflow_complexity_intermediate || 'Intermediate',
    advanced: t.workflow_complexity_advanced || 'Advanced',
  }

  return (
    <button
      onClick={onClick}
      className="w-full p-4 border rounded-lg hover:border-primary hover:bg-accent/50 transition-colors text-left"
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <h4 className="font-medium">{template.name}</h4>
        <span
          className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
            complexityColors[template.complexity]
          }`}
        >
          {complexityLabel[template.complexity]}
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        {template.description}
      </p>
      <div className="flex flex-wrap gap-1">
        {template.nodeTypes.map((type) => (
          <span
            key={type}
            className="text-xs px-1.5 py-0.5 bg-muted rounded"
          >
            {type}
          </span>
        ))}
      </div>
    </button>
  )
}
