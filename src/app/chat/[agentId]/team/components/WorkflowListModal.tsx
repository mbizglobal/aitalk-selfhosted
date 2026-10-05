'use client'

import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Globe, Users, Check } from 'lucide-react'
import type { WorkflowInfo } from './TeamSidebar'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface WorkflowListModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflows: WorkflowInfo[]
  currentWorkflowId: string | null
  lang?: SupportedLang
  onSelect: (workflowId: string) => void
}

export const WorkflowListModal: React.FC<WorkflowListModalProps> = ({
  open,
  onOpenChange,
  workflows,
  currentWorkflowId,
  lang,
  onSelect
}) => {
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1E1E1E] border-gray-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{t('team_sidebar_workflow_select')}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[400px] overflow-y-auto space-y-1 py-2">
          {workflows.map(wf => {
            const isSelected = wf.workflowId === currentWorkflowId
            return (
              <div
                key={wf.workflowId}
                onClick={() => onSelect(wf.workflowId)}
                className={`
                  flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors
                  ${isSelected
                    ? 'bg-[#E07B53]/20 border border-[#E07B53]/50'
                    : 'hover:bg-gray-800 border border-transparent'
                  }
                `}
              >
                {/* Access Mode Badge */}
                <AccessModeBadge mode={wf.accessMode} />

                {/* Workflow Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {wf.name}
                  </div>
                  {wf.description && (
                    <div className="text-xs text-gray-400 truncate mt-0.5">
                      {wf.description}
                    </div>
                  )}
                </div>

                {/* Selected Check */}
                {isSelected && (
                  <Check className="h-4 w-4 text-[#E07B53] flex-shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const AccessModeBadge: React.FC<{ mode: 'public' | 'team' }> = ({ mode }) => {
  if (mode === 'public') {
    return (
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center" title="Public">
        <Globe className="h-4 w-4 text-green-400" />
      </div>
    )
  }
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center" title="Team">
      <Users className="h-4 w-4 text-blue-400" />
    </div>
  )
}
