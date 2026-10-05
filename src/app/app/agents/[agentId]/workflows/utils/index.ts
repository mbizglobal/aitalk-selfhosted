import { Badge } from '@/components/ui/badge'
import type { Workflow } from '../types'

export const formatSize = (bytes: bigint | number) => {
  const numBytes = typeof bytes === 'bigint' ? Number(bytes) : bytes
  if (numBytes === 0) return '0 KB'
  if (numBytes < 1024) return '< 1 KB'
  if (numBytes < 1024 * 1024) return `${(numBytes / 1024).toFixed(1)} KB`
  return `${(numBytes / (1024 * 1024)).toFixed(2)} MB`
}

export const getColumnCount = (schemaJson: string) => {
  try {
    const schema = JSON.parse(schemaJson)
    return schema.columns?.length || 0
  } catch {
    return 0
  }
}

export const getGroupColorStyle = (color: string | null) => {
  switch (color) {
    case 'blue': return 'from-blue-500/10 to-purple-500/10 border-blue-500/30'
    case 'green': return 'from-green-500/10 to-emerald-500/10 border-green-500/30'
    case 'orange': return 'from-orange-500/10 to-amber-500/10 border-orange-500/30'
    case 'red': return 'from-red-500/10 to-pink-500/10 border-red-500/30'
    case 'purple': return 'from-purple-500/10 to-violet-500/10 border-purple-500/30'
    default: return 'from-blue-500/10 to-purple-500/10 border-blue-500/30'
  }
}

export const getGroupIconColor = (color: string | null) => {
  switch (color) {
    case 'blue': return 'bg-blue-500/20 text-blue-400'
    case 'green': return 'bg-green-500/20 text-green-400'
    case 'orange': return 'bg-orange-500/20 text-orange-400'
    case 'red': return 'bg-red-500/20 text-red-400'
    case 'purple': return 'bg-purple-500/20 text-purple-400'
    default: return 'bg-blue-500/20 text-blue-400'
  }
}

export const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case 'production':
      return { className: 'bg-green-500', label: 'Active' }
    case 'draft':
      return { variant: 'secondary' as const, label: 'Draft' }
    case 'archived':
      return { variant: 'outline' as const, label: 'Archived' }
    default:
      return { label: status }
  }
}

export const getStartNodeFromWorkflow = (workflow: Workflow) => {
  try {
    const workflowData = JSON.parse(workflow.workflowJson)
    const startNode = workflowData.nodes?.find((node: any) => node.data?.nodeType === 'start')
    return startNode
  } catch {
    return null
  }
}

export const GROUP_COLORS = ['blue', 'green', 'orange', 'red', 'purple'] as const

export const getColorHex = (color: string) => {
  switch (color) {
    case 'blue': return '#3b82f6'
    case 'green': return '#22c55e'
    case 'orange': return '#f97316'
    case 'red': return '#ef4444'
    case 'purple': return '#a855f7'
    default: return '#3b82f6'
  }
}
