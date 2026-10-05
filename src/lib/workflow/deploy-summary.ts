
export interface DeploySummary {
  egress: Array<{
    node: string
    kindKey: 'http' | 'smtp' | 'sendgrid' | 'telegram' | 'sms' | 'pstn' | 'aiTool' | 'mcpNode'
    target?: string
    toolKey?: string
  }>
  connections: Array<{ node: string; ref: string; connectionId: string }>
  triggers: Array<{ type: string; detail?: string }>
  nodeCount: number
  parseError: boolean
}

const EGRESS_FIELDS: Record<string, { kindKey: DeploySummary['egress'][number]['kindKey']; fields: string[] }> = {
  httpRequest: { kindKey: 'http', fields: ['url', 'baseUrl'] },
  smtp: { kindKey: 'smtp', fields: ['to'] },
  sendgrid: { kindKey: 'sendgrid', fields: ['toEmail'] },
  telegram: { kindKey: 'telegram', fields: ['chatId'] },
  sms: { kindKey: 'sms', fields: ['recipient'] },
  pstn: { kindKey: 'pstn', fields: ['targetPhoneNumber'] },
}

const EGRESS_TOOL_KEYS = new Set([
  'sendgrid', 'telegram', 'smtp', 'sms', 'functionCalling', 'mcp', 'google_calendar', 'microsoft_calendar',
  'subworkflow',
])

function nodeTypeOf(node: unknown): string {
  const n = node as { data?: { nodeType?: unknown }; type?: unknown }
  if (n?.data && typeof n.data.nodeType === 'string') return n.data.nodeType
  if (typeof n?.type === 'string') return n.type
  return 'unknown'
}

function nodeLabel(node: unknown): string {
  const n = node as { data?: { label?: unknown; name?: unknown }; id?: unknown }
  if (n?.data && typeof n.data.label === 'string' && n.data.label.trim()) return n.data.label
  if (n?.data && typeof n.data.name === 'string' && n.data.name.trim()) return n.data.name
  if (typeof n?.id === 'string') return n.id
  return nodeTypeOf(node)
}

function shorten(s: string, max = 140): string {
  const t = s.trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

export function summarizeDeployRisk(workflowJson: string): DeploySummary {
  const summary: DeploySummary = { egress: [], connections: [], triggers: [], nodeCount: 0, parseError: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(workflowJson)
  } catch {
    summary.parseError = true
    return summary
  }
  const nodes: unknown[] = Array.isArray((parsed as { nodes?: unknown })?.nodes)
    ? (parsed as { nodes: unknown[] }).nodes
    : []
  summary.nodeCount = nodes.length

  for (const node of nodes) {
    const type = nodeTypeOf(node)
    const raw = (node as { data?: unknown })?.data
    const data = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {}
    const label = nodeLabel(node)

    const eg = EGRESS_FIELDS[type]
    if (eg) {
      for (const f of eg.fields) {
        const v = data[f]
        if (typeof v === 'string' && v.trim()) summary.egress.push({ node: label, kindKey: eg.kindKey, target: shorten(v) })
      }
      if (type === 'httpRequest' && Array.isArray(data.requests)) {
        for (const r of data.requests) {
          const url = (r as { url?: unknown })?.url
          if (typeof url === 'string' && url.trim()) summary.egress.push({ node: label, kindKey: eg.kindKey, target: shorten(url) })
        }
      }
    }

    if (type === 'tool') {
      const tt = typeof data.toolType === 'string' ? data.toolType : ''
      if (EGRESS_TOOL_KEYS.has(tt)) summary.egress.push({ node: label, kindKey: 'aiTool', toolKey: tt })
    }

    if (type === 'mcp') {
      summary.egress.push({ node: label, kindKey: 'mcpNode' })
    }

    for (const [k, v] of Object.entries(data)) {
      if (/(^connectionId$|ConnectionId$)/.test(k) && typeof v === 'string' && v.trim()) {
        summary.connections.push({ node: label, ref: k, connectionId: v })
      }
    }

    if (type === 'start') {
      const tt = typeof data.triggerType === 'string' ? data.triggerType : 'chatWidget'
      let detail: string | undefined
      if (tt === 'schedule') {
        detail = [data.cronExpression, data.timezone].filter((x): x is string => typeof x === 'string' && !!x).join(' ') || undefined
      } else if (tt === 'pstn') {
        detail = typeof data.phoneNumber === 'string' && data.phoneNumber ? data.phoneNumber : undefined
      } else if (tt === 'telegram') {
        detail = typeof data.botUsername === 'string' && data.botUsername ? data.botUsername : undefined
      }
      summary.triggers.push({ type: tt, ...(detail ? { detail } : {}) })
    }
  }

  return summary
}
