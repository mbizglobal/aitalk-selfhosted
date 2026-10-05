export type WorkflowSaveLabel = 'saving' | 'saved' | 'save'

export interface WorkflowSaveButtonState {
  disabled: boolean
  label: WorkflowSaveLabel
}

export function workflowSaveButtonState(o: {
  isSaving: boolean
  hasChanges: boolean
}): WorkflowSaveButtonState {
  if (o.isSaving) return { disabled: true, label: 'saving' }
  if (!o.hasChanges) return { disabled: true, label: 'saved' }
  return { disabled: false, label: 'save' }
}
