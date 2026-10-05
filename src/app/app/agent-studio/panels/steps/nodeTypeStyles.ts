
export interface NodeTypeStyles {
  bg: string
  border: string
  dot: string
}

export const getNodeTypeStyles = (nodeType?: string, status?: string): NodeTypeStyles => {
  if (status === 'error') {
    return {
      bg: 'bg-red-500/10',
      border: 'border-l-red-500',
      dot: 'bg-red-500'
    }
  }

  switch (nodeType) {
    case 'start':
      return {
        bg: 'bg-yellow-500/10',
        border: 'border-l-yellow-500',
        dot: 'bg-yellow-500'
      }
    case 'ai':
      return {
        bg: 'bg-blue-500/10',
        border: 'border-l-blue-500',
        dot: 'bg-blue-500'
      }
    case 'source':
    case 'file_search':
    case 'mcp':
    case 'dataSheets':
    case 'tool':
      return {
        bg: 'bg-purple-500/10',
        border: 'border-l-purple-500',
        dot: 'bg-purple-500'
      }
    case 'webhook':
    case 'sendgrid':
      return {
        bg: 'bg-orange-500/10',
        border: 'border-l-orange-500',
        dot: 'bg-orange-500'
      }
    case 'condition':
    case 'ifElse':
    case 'while':
    case 'wait':
    case 'continue':
      return {
        bg: 'bg-slate-500/10',
        border: 'border-l-slate-500',
        dot: 'bg-slate-500'
      }
    case 'end':
      return {
        bg: 'bg-green-500/10',
        border: 'border-l-green-500',
        dot: 'bg-green-500'
      }
    default:
      return {
        bg: '',
        border: 'border-l-gray-500',
        dot: 'bg-green-500'
      }
  }
}

export const formatOutputPreview = (output: any): string => {
  if (output === null || output === undefined) return 'null'
  if (typeof output === 'string') {
    return output.length > 100 ? output.slice(0, 100) + '...' : output
  }
  try {
    const json = JSON.stringify(output, null, 2)
    const lines = json.split('\n')
    if (lines.length <= 3) return json
    return lines.slice(0, 3).join('\n') + '\n...'
  } catch {
    return String(output)
  }
}

export interface ChildTypeStyles {
  bg: string
  border: string
  icon: string
}

export const getChildTypeStyles = (
  type: 'llm_call' | 'tool_call' | 'mcp_call' | 'file_search' | 'web_search',
  status?: string
): ChildTypeStyles => {
  if (status === 'error') {
    return {
      bg: 'bg-red-500/5',
      border: 'border-l-red-400',
      icon: 'text-red-400'
    }
  }

  if (status === 'warning') {
    return {
      bg: 'bg-orange-500/5',
      border: 'border-l-orange-400',
      icon: 'text-orange-400'
    }
  }

  switch (type) {
    case 'llm_call':
      return {
        bg: 'bg-cyan-500/5',
        border: 'border-l-cyan-400',
        icon: 'text-cyan-400'
      }
    case 'tool_call':
    case 'mcp_call':
      return {
        bg: 'bg-violet-500/5',
        border: 'border-l-violet-400',
        icon: 'text-violet-400'
      }
    case 'file_search':
      return {
        bg: 'bg-amber-500/5',
        border: 'border-l-amber-400',
        icon: 'text-amber-400'
      }
    case 'web_search':
      return {
        bg: 'bg-teal-500/5',
        border: 'border-l-teal-400',
        icon: 'text-teal-400'
      }
    default:
      return {
        bg: 'bg-gray-500/5',
        border: 'border-l-gray-400',
        icon: 'text-gray-400'
      }
  }
}
