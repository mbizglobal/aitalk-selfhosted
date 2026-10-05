'use client'

import { Button } from '@/components/ui/button'
import { Plus, FolderOpen } from 'lucide-react'
import type { Agent } from '../types'

interface WorkflowHeaderProps {
  agent: Agent
  productionCount: number
  maxProductionLimit: number
  workflowCount: number
  maxWorkflowLimit: number | null
  dataSheetCount: number
  maxDataSheetLimit: number | null
  isWorkflowLimitReached: boolean
  isDataSheetLimitReached: boolean
  isMobile: boolean
  showNewWorkflowButton: boolean
  onCreateWorkflow: () => void
  onCreateGroup: () => void
  t: Record<string, string>
}

export function WorkflowHeader({
  agent,
  productionCount,
  maxProductionLimit,
  workflowCount,
  maxWorkflowLimit,
  dataSheetCount,
  maxDataSheetLimit,
  isWorkflowLimitReached,
  isDataSheetLimitReached,
  isMobile,
  showNewWorkflowButton,
  onCreateWorkflow,
  onCreateGroup,
  t,
}: WorkflowHeaderProps) {
  if (isMobile) {
    return (
      <div className="mb-6">
        <div className="mb-3">
          <h1 className="text-xl font-bold truncate">{t.workflow_page_title}</h1>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {t.chat_settings_ai_assistant_label} <span className="font-medium text-foreground">{agent.title}</span>
            <span className="mx-2">·</span>
            <span className={productionCount >= maxProductionLimit ? 'text-red-500' : ''}>{t.workflow_production_count}: {productionCount}/{maxProductionLimit}</span>
            {maxWorkflowLimit !== null && (
              <>
                <span className="mx-2">·</span>
                <span className={isWorkflowLimitReached ? 'text-red-500' : ''}>Workflows: {workflowCount}/{maxWorkflowLimit}</span>
              </>
            )}
            {maxDataSheetLimit !== null && (
              <>
                <span className="mx-2">·</span>
                <span className={isDataSheetLimitReached ? 'text-red-500' : ''}>Data Sheets: {dataSheetCount}/{maxDataSheetLimit}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={onCreateGroup}>
            <FolderOpen className="w-4 h-4" />
          </Button>
          {showNewWorkflowButton && (
            <Button size="sm" onClick={onCreateWorkflow} disabled={isWorkflowLimitReached}>
              <Plus className="w-4 h-4 mr-1" />
              New
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.workflow_page_title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.chat_settings_ai_assistant_label} <span className="font-medium text-foreground">{agent.title}</span>
            <span className="mx-2">·</span>
            <span className={productionCount >= maxProductionLimit ? 'text-red-500' : ''}>{t.workflow_production_count}: {productionCount}/{maxProductionLimit}</span>
            {maxWorkflowLimit !== null && (
              <>
                <span className="mx-2">·</span>
                <span className={isWorkflowLimitReached ? 'text-red-500' : ''}>Workflows: {workflowCount}/{maxWorkflowLimit}</span>
              </>
            )}
            {maxDataSheetLimit !== null && (
              <>
                <span className="mx-2">·</span>
                <span className={isDataSheetLimitReached ? 'text-red-500' : ''}>Data Sheets: {dataSheetCount}/{maxDataSheetLimit}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onCreateGroup}>
            <FolderOpen className="w-4 h-4 mr-2" />
            {t.workflow_group_new}
          </Button>
          {showNewWorkflowButton && (
            <Button onClick={onCreateWorkflow} disabled={isWorkflowLimitReached}>
              <Plus className="w-4 h-4 mr-2" />
              {t.workflow_new_workflow}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
