
import { WorkflowNode } from '../types'

export const SUPPORTED_NODE_TYPES: WorkflowNode['type'][] = [
  'start',
  'ai',
  'file_search',
  'source',
  'condition',
  'webhook',
  'while',
  'wait',
  'dataSheets',
  'end',
  'ifElse',
  'continue',
  'mcp',
  'sendgrid',
  'telegram',
  'sms',
  'sms_acs',
  'sms_infobip',
  'imap',
  'smtp',
  'httpRequest',
  'store',
  'pstn'
] as const

export const isSupportedNodeType = (value: any): value is WorkflowNode['type'] =>
  typeof value === 'string' && (SUPPORTED_NODE_TYPES as ReadonlyArray<string>).includes(value)

export const resolveNodeType = (node?: WorkflowNode | null): WorkflowNode['type'] | null => {
  if (!node) return null

  if (isSupportedNodeType(node.type)) {
    return node.type
  }

  const dataNodeType = node.data?.nodeType
  if (isSupportedNodeType(dataNodeType)) {
    return dataNodeType
  }

  if (node.type === 'tool') {
    if (node.data?.toolType === 'source') return 'source'
    if (node.data?.toolType === 'mcp') return 'mcp'
  }

  if (node.type === 'custom') {
    if (node.data?.nodeType === 'sendgrid') return 'sendgrid'
    if (node.data?.nodeType === 'telegram') return 'telegram'
    if (node.data?.nodeType === 'sms') return 'sms'
    if (node.data?.nodeType === 'sms_acs') return 'sms_acs'
    if (node.data?.nodeType === 'sms_infobip') return 'sms_infobip'
    if (node.data?.nodeType === 'imap') return 'imap'
    if (node.data?.nodeType === 'smtp') return 'smtp'
    if (node.data?.nodeType === 'httpRequest') return 'httpRequest'
    if (node.data?.nodeType === 'store') return 'store'
    if (node.data?.nodeType === 'pstn') return 'pstn'
  }

  const label = typeof node.data?.label === 'string' ? node.data.label.toLowerCase() : ''
  if (label === 'chat widget' || label === 'start') return 'start'
  if (label === 'ai') return 'ai'
  if (label === 'end') return 'end'
  if (label === 'source') return 'source'
  if (label === 'imap' || label.startsWith('imap')) return 'imap'
  if (label === 'smtp' || label.startsWith('smtp')) return 'smtp'
  if (label === 'sendgrid') return 'sendgrid'
  if (label === 'telegram') return 'telegram'
  if (label === 'store' || label.startsWith('store')) return 'store'

  return null
}
