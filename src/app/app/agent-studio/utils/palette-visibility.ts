
import {
  MAIN_WORKFLOW_KIND,
  SUB_WORKFLOW_ALLOWED_NODE_KINDS,
  SUB_WORKFLOW_KIND,
  type WorkflowKind,
} from '@/lib/workflow/subworkflow'
import { offFeatureFor } from '@/lib/edition-features'
import type { Edition } from '@/lib/edition'

export const PALETTE_ITEM_NODE_KIND: Readonly<Record<string, string>> = {
  // Basic
  'chat-widget': 'start:channel',
  'telegram-start': 'start:channel',
  'pstn-start': 'start:channel',
  schedule: 'start:channel',
  'app-start': 'start:channel',
  'work-event-start': 'start:channel',
  'work-app': 'workApp',
  'subworkflow-start': 'start:sub',
  ai: 'ai',
  end: 'end',
  source: 'tool',
  mcp: 'tool',
  'web-search': 'tool',
  'function-calling': 'tool',
  subworkflow: 'tool',
  // Flow
  condition: 'ifElse',
  while: 'while',
  wait: 'wait',
  // Data
  'data-sheets': 'dataSheets',
  store: 'store',
  'work-app-step': 'workAppStep',
  // Apps
  sendgrid: 'sendgrid',
  telegram: 'telegram',
  sms_infobip: 'sms_infobip',
  sms_acs: 'sms_acs',
  imap: 'imap',
  smtp: 'smtp',
  httpRequest: 'httpRequest',
  pstn: 'pstn',
  // Etc
  note: 'note',
}

export function isPaletteItemVisible(id: string, kind: WorkflowKind): boolean {
  const nodeKind = PALETTE_ITEM_NODE_KIND[id]
  if (!nodeKind) return true
  if (nodeKind === 'note') return true
  if (kind === MAIN_WORKFLOW_KIND) return nodeKind !== 'start:sub'
  if (kind === SUB_WORKFLOW_KIND) {
    if (nodeKind === 'tool' || nodeKind === 'start:channel') return false
    if (nodeKind === 'start:sub') return true
    return SUB_WORKFLOW_ALLOWED_NODE_KINDS.has(nodeKind)
  }
  return true
}

const PALETTE_START_TRIGGER: Readonly<Record<string, string>> = {
  'chat-widget': 'chatWidget',
  'telegram-start': 'telegram',
  'pstn-start': 'pstn',
  schedule: 'schedule',
  'app-start': 'app',
  'work-event-start': 'workEvent',
}

export function isPaletteItemInEdition(id: string, edition: Edition): boolean {
  const trigger = PALETTE_START_TRIGGER[id]
  if (trigger) return !offFeatureFor('triggers', trigger, edition)
  const nodeKind = PALETTE_ITEM_NODE_KIND[id]
  return !nodeKind || !offFeatureFor('nodeKinds', nodeKind, edition)
}

export const APP_CANVAS_HIDDEN_PALETTE_ITEMS: ReadonlySet<string> = new Set([
  'chat-widget', 'telegram-start', 'pstn-start', 'schedule', 'app-start', 'work-event-start',
  'wait', 'pstn', 'work-app-step', 'subworkflow',
])

export function filterPaletteItems<T extends { id: string }>(items: readonly T[], kind: WorkflowKind, edition: Edition = 'cloud', opts: { appCanvas?: boolean; hasStart?: boolean } = {}): T[] {
  return items.filter((item) => isPaletteItemVisible(item.id, kind) && isPaletteItemInEdition(item.id, edition)
    && !(opts.appCanvas && APP_CANVAS_HIDDEN_PALETTE_ITEMS.has(item.id) && (item.id !== 'app-start' || opts.hasStart)))
}

export const LOOP_TOOL_NODE_KIND: Readonly<Record<string, string>> = {
  ai: 'ai',
  mcp: 'tool',
  wait: 'wait',
  dataSheets: 'dataSheets',
  ifElse: 'ifElse',
  continue: 'continue',
  imap: 'imap',
  smtp: 'smtp',
  telegram: 'telegram',
  sendgrid: 'sendgrid',
}

export function isLoopToolAllowedForKind(loopToolType: string, kind: WorkflowKind, opts: { appCanvas?: boolean } = {}): boolean {
  if (opts.appCanvas && LOOP_TOOL_NODE_KIND[loopToolType] === 'wait') return false
  if (kind !== SUB_WORKFLOW_KIND) return true
  const nodeKind = LOOP_TOOL_NODE_KIND[loopToolType]
  if (!nodeKind) return true
  if (nodeKind === 'tool') return false
  return SUB_WORKFLOW_ALLOWED_NODE_KINDS.has(nodeKind)
}
