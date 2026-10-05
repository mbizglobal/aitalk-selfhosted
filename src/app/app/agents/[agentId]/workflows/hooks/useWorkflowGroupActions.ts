'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import type { WorkflowGroup } from '../types'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'

interface UseWorkflowGroupActionsProps {
  agentId: string
  workflowGroups: WorkflowGroup[]
  setWorkflowGroups: (groups: WorkflowGroup[]) => void
  setIsLoading: (loading: boolean) => void
  t: Record<string, string>
}

export function useWorkflowGroupActions({
  agentId,
  workflowGroups,
  setWorkflowGroups,
  setIsLoading,
  t,
}: UseWorkflowGroupActionsProps) {
  const router = useRouter()

  const refreshGroups = async () => {
    const groupsResponse = await fetch(`/api/agents/${agentId}/workflow-groups`)
    const groupsData = await groupsResponse.json()
    setWorkflowGroups(groupsData.groups)
  }

  const handleCreateGroup = async (
    name: string,
    description: string,
    color: string,
    onSuccess: () => void
  ) => {
    if (!name.trim()) {
      alert(t.workflow_group_name_required)
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/agents/${agentId}/workflow-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null, color })
      })

      if (!response.ok) {
        throw new Error('Failed to create group')
      }

      const data = await response.json()
      setWorkflowGroups([...workflowGroups, data.group])
      onSuccess()
      router.refresh()
    } catch (error) {
      console.error('Failed to create group:', error)
      alert(t.workflow_group_create_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteGroup = async (groupId: string, name: string) => {
    if (!confirm(t.workflow_group_delete_confirm.replace('{name}', name))) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/agents/${agentId}/workflow-groups/${groupId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to delete group')
      }

      setWorkflowGroups(workflowGroups.filter(g => g.id !== groupId))
      router.refresh()
    } catch (error) {
      console.error('Failed to delete group:', error)
      alert(t.workflow_group_delete_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggleGroupExpand = async (groupId: string) => {
    const group = workflowGroups.find(g => g.id === groupId)
    if (!group) return

    try {
      await fetch(`/api/agents/${agentId}/workflow-groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isExpanded: !group.isExpanded })
      })

      setWorkflowGroups(workflowGroups.map(g =>
        g.id === groupId ? { ...g, isExpanded: !g.isExpanded } : g
      ))
    } catch (error) {
      console.error('Failed to toggle group:', error)
    }
  }

  const handleAddWorkflowToGroup = async (groupId: string, workflowId: string, onSuccess: () => void) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/agents/${agentId}/workflow-groups/${groupId}/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId })
      })

      if (!response.ok) {
        throw new Error('Failed to add workflow to group')
      }

      router.refresh()
      await refreshGroups()
      onSuccess()
    } catch (error) {
      console.error('Failed to add workflow to group:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemoveWorkflowFromGroup = async (groupId: string, workflowId: string) => {
    setIsLoading(true)
    try {
      await fetch(`/api/agents/${agentId}/workflow-groups/${groupId}/workflows?workflowId=${workflowId}`, {
        method: 'DELETE'
      })

      router.refresh()
      await refreshGroups()
    } catch (error) {
      console.error('Failed to remove workflow from group:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddSheetToGroup = async (groupId: string, sheetId: string, onSuccess: () => void) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/agents/${agentId}/workflow-groups/${groupId}/data-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to add sheet to group')
      }

      router.refresh()
      await refreshGroups()
      onSuccess()
    } catch (error) {
      console.error('Failed to add sheet to group:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemoveSheetFromGroup = async (groupId: string, sheetId: string) => {
    setIsLoading(true)
    try {
      await fetch(`/api/agents/${agentId}/workflow-groups/${groupId}/data-sheets?sheetId=${sheetId}`, {
        method: 'DELETE'
      })

      router.refresh()
      await refreshGroups()
    } catch (error) {
      console.error('Failed to remove sheet from group:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDragEnd = async (event: DragEndEvent, groupId: string) => {
    const { active, over } = event

    if (!over || active.id === over.id) return

    const group = workflowGroups.find(g => g.id === groupId)
    if (!group) return

    const oldIndex = group.workflows.findIndex(item => item.workflowId === active.id)
    const newIndex = group.workflows.findIndex(item => item.workflowId === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    const newWorkflows = arrayMove(group.workflows, oldIndex, newIndex)
    setWorkflowGroups(workflowGroups.map(g =>
      g.id === groupId
        ? { ...g, workflows: newWorkflows.map((w, i) => ({ ...w, order: i })) }
        : g
    ))

    try {
      const workflowIds = newWorkflows.map(w => w.workflowId)
      const response = await fetch(`/api/agents/${agentId}/workflow-groups/${groupId}/workflows`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowIds })
      })

      if (!response.ok) {
        throw new Error('Failed to update workflow order')
      }
    } catch (error) {
      console.error('Failed to update workflow order:', error)
      await refreshGroups()
    }
  }

  const handleReorderWorkflows = async (groupId: string, workflowIds: string[]) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/workflow-groups/${groupId}/workflows`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowIds })
      })

      if (!response.ok) {
        throw new Error('Failed to update workflow order')
      }

      await refreshGroups()
    } catch (error) {
      console.error('Failed to update workflow order:', error)
      await refreshGroups()
    }
  }

  const handleHorizontalScroll = useCallback((e: React.WheelEvent<HTMLDivElement>, scrollRefs: React.MutableRefObject<{ [key: string]: HTMLDivElement | null }>, groupId: string) => {
    const container = scrollRefs.current[groupId]
    if (container) {
      e.preventDefault()
      container.scrollLeft += e.deltaY
    }
  }, [])

  return {
    handleCreateGroup,
    handleDeleteGroup,
    handleToggleGroupExpand,
    handleAddWorkflowToGroup,
    handleRemoveWorkflowFromGroup,
    handleAddSheetToGroup,
    handleRemoveSheetFromGroup,
    handleDragEnd,
    handleReorderWorkflows,
    handleHorizontalScroll,
  }
}
