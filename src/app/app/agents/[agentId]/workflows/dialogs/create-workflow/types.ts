export type CreateStep = 'select' | 'blank' | 'template' | 'preview' | 'sub'

export interface DataSheetColumn {
  name: string
  type: string
  required?: boolean
  description?: string
}

export interface DataSheetSchema {
  name: string
  description?: string
  columns: DataSheetColumn[]
}

export interface WorkflowTemplate {
  id?: string
  templateId: string
  name: string
  description: string
  categoryCode: string
  categoryName: string
  complexity: 'beginner' | 'intermediate' | 'advanced'
  keywords: string[]
  nodeTypes: string[]
  features: string[]
  workflowJson?: Record<string, unknown>
  explanation?: string
  sortOrder: number
  dataSheetSchema?: DataSheetSchema
  bundleVersion?: number
}

export interface Category {
  code: string
  name: string
  description?: string
}

export interface CreateWorkflowTranslations {
  // Existing keys
  workflow_create_title: string
  workflow_name_label: string
  workflow_name_placeholder: string
  workflow_description_label: string
  workflow_description_placeholder: string
  workflow_cancel: string
  workflow_create: string
  workflow_creating: string
  // Template dialog keys
  workflow_step_select_title: string
  workflow_step_blank_title: string
  workflow_step_blank_desc: string
  workflow_step_template_title: string
  workflow_step_template_desc: string
  workflow_template_search: string
  workflow_template_all_categories: string
  workflow_template_no_results: string
  workflow_template_preview_title: string
  workflow_template_use: string
  workflow_back: string
  workflow_complexity_beginner: string
  workflow_complexity_intermediate: string
  workflow_complexity_advanced: string
  workflow_template_datasheet_auto: string
  // Sub-workflow (docs/wf/subwf/subwf.md) — optional keys, callers fall back to English
  workflow_step_sub_title?: string
  workflow_step_sub_desc?: string
  workflow_sub_form_hint?: string
}
