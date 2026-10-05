export interface Workflow {
  id: number
  workflowId: string
  name: string
  description: string | null
  status: string
  trafficWeight: number
  workflowJson: string
  createdAt: Date
  updatedAt: Date
  kind?: string
}

export interface DataSheet {
  id: string
  agentId: string
  name: string
  description: string | null
  schema: string
  sizeBytes: bigint
  rowCount: number
  createdAt: Date
  updatedAt: Date
}

export interface Agent {
  id: string
  agentId: string
  title: string
  userId: string
  accessMode?: 'public' | 'team'
}

export interface WorkflowGroupItem {
  id: string
  groupId: string
  workflowId: string
  order: number
  workflow: Workflow
}

export interface WorkflowGroupDataSheet {
  id: string
  groupId: string
  sheetId: string
  dataSheet: DataSheet
}

export interface WorkflowGroup {
  id: string
  agentId: string
  name: string
  description: string | null
  color: string | null
  isExpanded: boolean
  createdAt: Date
  updatedAt: Date
  workflows: WorkflowGroupItem[]
  dataSheets: WorkflowGroupDataSheet[]
}

export interface WorkflowListClientProps {
  agent: Agent
  initialWorkflows: Workflow[]
  initialDataSheets: DataSheet[]
  initialWorkflowGroups?: WorkflowGroup[]
  maxProductionLimit: number
  maxWorkflowLimit: number | null
  maxDataSheetLimit: number | null
}

export type LimitType = 'free' | 'paid' | 'workflow' | 'datasheet'
export type AddType = 'workflow' | 'datasheet'
