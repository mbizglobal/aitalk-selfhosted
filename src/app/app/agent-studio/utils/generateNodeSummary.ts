
interface NodeData {
  nodeType?: string
  label?: string
  systemMessage?: string
  model?: string
  conditionMode?: 'simple' | 'builder' | 'code'
  conditionField?: string
  conditionOperator?: string
  conditionValue?: string | number
  customExpression?: string
  conditions?: Array<{ condition?: string; caseName?: string }>
  maxIterations?: number
  operation?: string
  sheetName?: string
  waitMessage?: string
  toEmail?: string
  subject?: string
  mcpToolName?: string
  mcpServerName?: string
  // Sub-workflow tool
  subWorkflowId?: string
  vectorStoreName?: string
  content?: string
  searchQuery?: string
  toolType?: string
  connectionId?: string
  connectionLabel?: string
}

function removeVariables(text: string): string {
  return text.replace(/\{\{(?:context\.[a-zA-Z0-9_-]+|message)\}\}/g, '').trim()
}

function truncate(text: string | undefined | null, maxLength: number): string {
  if (!text) return ''
  const withoutVars = removeVariables(text)
  const trimmed = withoutVars.trim()
  if (!trimmed) return ''
  if (trimmed.length <= maxLength) return trimmed
  return trimmed.substring(0, maxLength - 3) + '...'
}

function formatCondition(data: NodeData): string {
  const { conditionMode, conditionField, conditionOperator, conditionValue, customExpression } = data

  if (conditionMode === 'code' && customExpression) {
    return truncate(customExpression, 40)
  }

  if (conditionField && conditionOperator) {
    const value = conditionValue !== undefined ? String(conditionValue) : ''
    return truncate(`${conditionField} ${conditionOperator} ${value}`, 40)
  }

  return ''
}

export function generateNodeSummary(nodeType: string, data: NodeData): string {
  switch (nodeType) {
    case 'ai': {
      return ''
    }

    case 'while': {
      const condition = formatCondition(data)
      const maxIter = data.maxIterations ? `max: ${data.maxIterations}` : ''
      if (condition && maxIter) {
        return `${truncate(condition, 30)} (${maxIter})`
      }
      return condition || maxIter || ''
    }

    case 'wait': {
      return truncate(data.waitMessage, 40)
    }

    case 'sendgrid': {
      const to = data.toEmail ? `To: ${truncate(data.toEmail, 20)}` : ''
      const subject = data.subject ? truncate(data.subject, 25) : ''
      if (to && subject) {
        return `${to} - ${subject}`
      }
      return to || subject || ''
    }

    case 'tool': {
      switch (data.toolType) {
        case 'source':
          return data.vectorStoreName ? truncate(data.vectorStoreName, 40) : ''
        case 'mcp':
          if (data.mcpToolName) {
            return truncate(data.mcpToolName, 40)
          }
          return data.mcpServerName ? truncate(data.mcpServerName, 40) : ''
        case 'web-search':
          return data.searchQuery ? truncate(data.searchQuery, 40) : 'Web Search'
        case 'sendgrid':
        case 'telegram':
        case 'smtp':
        case 'google_calendar':
        case 'microsoft_calendar':
          return data.connectionLabel ? truncate(data.connectionLabel, 40) : ''
        case 'subworkflow':
          return data.subWorkflowId ? truncate(String(data.subWorkflowId), 40) : ''
        default:
          return ''
      }
    }

    case 'dataSheets': {
      return ''
    }

    case 'ifelse': {
      if (data.conditions && data.conditions.length > 0) {
        const firstCond = data.conditions[0]
        return truncate(firstCond.caseName || firstCond.condition || '', 40)
      }
      return formatCondition(data)
    }

    case 'store': {
      if (data.content) {
        const firstLine = data.content.split('\n')[0]
        return truncate(firstLine, 40)
      }
      return ''
    }

    case 'start':
    case 'end':
    case 'continue':
    case 'note':
      return ''

    default:
      return ''
  }
}

export function getNodeSummary(node: { type?: string; data?: NodeData }): string {
  if (!node.type || !node.data) return ''

  const nodeType = node.data.nodeType || node.type
  return generateNodeSummary(nodeType, node.data)
}
