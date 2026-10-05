'use client'

import { useRouter } from 'next/navigation'
import type { Workflow, LimitType, WorkflowGroup } from '../types'

interface UseWorkflowActionsProps {
  agentId: string
  workflows: Workflow[]
  setWorkflows: (workflows: Workflow[]) => void
  workflowGroups?: WorkflowGroup[]
  setWorkflowGroups?: (groups: WorkflowGroup[]) => void
  setIsLoading: (loading: boolean) => void
  setLimitType: (type: LimitType) => void
  setIsLimitDialogOpen: (open: boolean) => void
  t: Record<string, string>
}

export function useWorkflowActions({
  agentId,
  workflows,
  setWorkflows,
  workflowGroups,
  setWorkflowGroups,
  setIsLoading,
  setLimitType,
  setIsLimitDialogOpen,
  t,
}: UseWorkflowActionsProps) {
  const router = useRouter()

  const handleCreateWorkflow = async (
    name: string,
    description: string,
    onSuccess: () => void,
    workflowJson?: string,
    dataSheetSchema?: { name: string; description?: string; columns: Array<{ name: string; type: string; required?: boolean; description?: string }> },
    kind?: 'main' | 'sub',
    bundleTemplateId?: string
  ) => {
    if (!name.trim()) {
      alert(t.workflow_name_required)
      return
    }

    setIsLoading(true)
    const isBundle = !!bundleTemplateId
    try {
      const response = await fetch(
        isBundle ? `/api/agents/${agentId}/workflows/from-template` : `/api/agents/${agentId}/workflows`,
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isBundle ? {
          templateId: bundleTemplateId,
          name,
          ...(description ? { description } : {}),
        } : {
          name,
          description: description || null,
          status: 'draft',
          ...(workflowJson && { workflowJson }),
          ...(dataSheetSchema && { dataSheetSchema }),
          ...(kind === 'sub' && { kind: 'sub' }),
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        if (errorData.error === 'workflow_limit_reached') {
          setLimitType('workflow')
          setIsLimitDialogOpen(true)
          onSuccess()
          return
        }
        throw new Error(typeof errorData.error === 'string' && errorData.code ? errorData.error : 'Failed to create workflow')
      }

      const data = await response.json()
      const created = [data.workflow, ...(Array.isArray(data.subWorkflows) ? data.subWorkflows : [])]
      setWorkflows([...created, ...workflows])
      onSuccess()
      router.push(`/app/agent-studio?workflowId=${data.workflow.workflowId}`)
    } catch (error: any) {
      console.error('Failed to create workflow:', error)
      alert(error?.message && error.message !== 'Failed to create workflow' ? `${t.workflow_create_failed}\n${error.message}` : t.workflow_create_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateWorkflow = async (
    workflowId: string,
    name: string,
    description: string,
    onSuccess: () => void
  ) => {
    if (!name.trim()) {
      alert(t.workflow_name_required)
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update workflow')
      }

      const data = await response.json()
      setWorkflows(workflows.map(w =>
        w.workflowId === workflowId
          ? { ...w, name: data.workflow.name, description: data.workflow.description, updatedAt: new Date() }
          : w
      ))
      onSuccess()
      router.refresh()
    } catch (error) {
      console.error('Failed to update workflow:', error)
      alert(t.workflow_update_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCloneWorkflow = async (workflowId: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/workflows/${workflowId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        if (errorData.error === 'workflow_limit_reached') {
          setLimitType('workflow')
          setIsLimitDialogOpen(true)
          return
        }
        throw new Error(typeof errorData.error === 'string' && errorData.code ? errorData.error : 'Failed to clone workflow')
      }

      const data = await response.json()
      setWorkflows([data.workflow, ...workflows])
      router.refresh()
    } catch (error: any) {
      console.error('Failed to clone workflow:', error)
      alert(error?.message && error.message !== 'Failed to clone workflow' ? `${t.workflow_clone_failed}\n${error.message}` : t.workflow_clone_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteWorkflow = async (workflowId: string, name: string) => {
    if (!confirm(t.workflow_delete_confirm.replace('{name}', name))) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete workflow')
      }

      setWorkflows(workflows.filter(w => w.workflowId !== workflowId))
      router.refresh()
    } catch (error: any) {
      console.error('Failed to delete workflow:', error)
      alert(error.message || t.workflow_delete_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleChangeStatus = async (workflowId: string, newStatus: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/workflows/${workflowId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })

      if (!response.ok) {
        const errorData = await response.json()
        if (errorData.error === 'free_limit_reached') {
          setLimitType('free')
          setIsLimitDialogOpen(true)
          return
        } else if (errorData.error === 'paid_limit_reached') {
          setLimitType('paid')
          setIsLimitDialogOpen(true)
          return
        }
        throw new Error(typeof errorData.error === 'string' && errorData.code ? errorData.error : 'Failed to change status')
      }

      const data = await response.json()

      // Update ungrouped workflows
      setWorkflows(workflows.map(w =>
        w.workflowId === workflowId ? data.workflow : w
      ))

      // Update grouped workflows
      if (workflowGroups && setWorkflowGroups) {
        setWorkflowGroups(workflowGroups.map(group => ({
          ...group,
          workflows: group.workflows.map(item =>
            item.workflowId === workflowId
              ? { ...item, workflow: data.workflow }
              : item
          )
        })))
      }

      router.refresh()
    } catch (error: any) {
      console.error('Failed to change status:', error)
      alert(error?.message && error.message !== 'Failed to change status' ? `${t.workflow_status_change_failed}\n${error.message}` : t.workflow_status_change_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownloadWorkflowJson = (workflow: Workflow) => {
    try {
      const jsonData = JSON.parse(workflow.workflowJson)
      const formattedJson = JSON.stringify(jsonData, null, 2)
      const blob = new Blob([formattedJson], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = `${workflow.name.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${workflow.workflowId}.json`
      document.body.appendChild(link)
      link.click()

      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download workflow JSON:', error)
      alert(t.workflow_json_download_failed)
    }
  }

  return {
    handleCreateWorkflow,
    handleUpdateWorkflow,
    handleCloneWorkflow,
    handleDeleteWorkflow,
    handleChangeStatus,
    handleDownloadWorkflowJson,
  }
}
