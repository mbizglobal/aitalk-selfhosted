'use client'

import { useMemo } from 'react'
import type { Workflow, DataSheet, WorkflowGroup } from '../types'

interface UseWorkflowStatsProps {
  workflows: Workflow[]
  dataSheets: DataSheet[]
  workflowGroups: WorkflowGroup[]
  maxWorkflowLimit: number | null
  maxDataSheetLimit: number | null
}

export function useWorkflowStats({
  workflows,
  dataSheets,
  workflowGroups,
  maxWorkflowLimit,
  maxDataSheetLimit,
}: UseWorkflowStatsProps) {
  return useMemo(() => {
    const productionCount = workflows.filter(w => w.status === 'production').length
    const workflowCount = workflows.length
    const dataSheetCount = dataSheets.length
    const isWorkflowLimitReached = maxWorkflowLimit !== null && workflowCount >= maxWorkflowLimit
    const isDataSheetLimitReached = maxDataSheetLimit !== null && dataSheetCount >= maxDataSheetLimit

    const groupedWorkflowIds = workflowGroups.flatMap(g => g.workflows.map(w => w.workflowId))
    const groupedSheetIds = workflowGroups.flatMap(g => g.dataSheets.map(s => s.sheetId))
    const ungroupedWorkflows = workflows.filter(w => !groupedWorkflowIds.includes(w.workflowId))
    const ungroupedDataSheets = dataSheets.filter(s => !groupedSheetIds.includes(s.id))

    return {
      productionCount,
      workflowCount,
      dataSheetCount,
      isWorkflowLimitReached,
      isDataSheetLimitReached,
      ungroupedWorkflows,
      ungroupedDataSheets,
    }
  }, [workflows, dataSheets, workflowGroups, maxWorkflowLimit, maxDataSheetLimit])
}
