
import type { Node, Edge } from 'reactflow'
import { MessageSquare, Bot, Circle, Square, Globe, Workflow, FileSearch, Zap, RefreshCw, Pause, Database, DatabaseZap, Mail, SkipForward, Inbox, Send, GraduationCap, Puzzle, Briefcase } from 'lucide-react'
import { SendGridIcon, TelegramIcon } from '../constants/components'
import { isAiNodeRaw } from '@/lib/workflow/find-ai-node'
import { isMiniAppAllowedOn, miniAppChannelOf } from '@/lib/workflow/mini-app-registry'

export function isOutboundPstnStartNode(node: any | null | undefined): boolean {
  return node?.data?.callDirection === 'outbound'
}

export function isRealtimeAiNode(node: any | null | undefined): boolean {
  if (!node || !isAiNode(node)) return false
  return /^gpt-realtime/i.test(String(node?.data?.model || ''))
}

export function findFirstAiNodeFrom(
  startNodeId: string,
  nodes: any[] | undefined | null,
  edges: any[] | undefined | null
): any | null {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null
  const visited = new Set<string>()
  const queue: string[] = [startNodeId]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    const outgoing = edges.filter((e) => e?.source === currentId)
    for (const edge of outgoing) {
      const target = nodes.find((n) => n?.id === edge?.target)
      if (!target) continue
      if (isAiNode(target)) return target
      queue.push(target.id)
    }
  }
  return null
}

export const isAiNode = isAiNodeRaw

export function isSourceNode(node: any): boolean {
  if (node.type === 'tool' && node.data?.toolType === 'source') return true

  if (node.data?.label === 'Source') return true

  return false
}

const MCPLogo = null

export function hasMiniAppOnUnsupportedChannel(nodes: any[], edges: any[]): boolean {
  const miniAppEdges = edges.filter((e: any) => e.sourceHandle === 'miniapps')
  if (miniAppEdges.length === 0) return false
  const channel = miniAppChannelOf(nodes)
  if (!channel) return true
  return miniAppEdges.some((e: any) => {
    const target = nodes.find((n: any) => n.id === e.target)
    if (!target) return false
    return !isMiniAppAllowedOn(target.data?.miniAppType, channel)
  })
}

export const CANVAS_NODE_TYPE_BY_NODE_TYPE: Readonly<Record<string, string>> = {
  dataSheets: 'dataSheets',
  while: 'while',
  wait: 'wait',
  continue: 'continue',
  note: 'note',
  branch: 'ifElse',
  ifElse: 'ifElse',
  ifelse: 'ifElse',
  condition: 'ifElse',
  api: 'api',
}

export function canvasNodeTypeOf(node: any): any {
  if (node?.type === 'tool') return node.type
  const t = node?.type
  if (t !== undefined && t !== null && t !== '' && t !== 'custom') return t
  return CANVAS_NODE_TYPE_BY_NODE_TYPE[node?.data?.nodeType] ?? t
}

export function restoreNodesWithIcons(nodes: any[]): any[] {
  return nodes.map((node: any) => {
    let icon = node.data?.icon

    const needsRestore = typeof icon !== 'function';

    if (needsRestore) {
      const nodeType = node.data?.nodeType || node.type
      const label = node.data?.label

      if (node.type === 'while') {
        icon = RefreshCw
      } else if (node.type === 'wait') {
        icon = Pause
      } else if (node.type === 'dataSheets') {
        icon = Database
      } else if (node.type === 'ifElse' || node.type === 'ifelse') {
        icon = Workflow
      } else if (node.type === 'note') {
        icon = Square
      } else if (node.type === 'tool') {
        const toolType = node.data?.toolType
        switch (toolType) {
          case 'miniapp':
            icon = GraduationCap
            break
          case 'source':
            icon = FileSearch
            break
          case 'mcp':
            icon = MCPLogo
            break
          case 'webSearch':
            icon = Globe
            break
          case 'functionCalling':
            icon = Zap
            break
          case 'sendgrid':
            icon = SendGridIcon
            break
          case 'telegram':
            icon = TelegramIcon
            break
          case 'smtp':
            icon = Send
            break
          case 'subworkflow':
            icon = Puzzle
            break
          case 'workApp':
            icon = Briefcase
            break
          default:
            if (label === 'Source') icon = FileSearch
            else if (label === 'MCP') icon = MCPLogo
            else if (label === 'Web search' || label === 'Web Search') icon = Globe
            else if (label === 'Function Calling') icon = Zap
        }
      }

      else {
        switch (nodeType) {
        case 'start':
          icon = node.data?.triggerType === 'subworkflow' ? Puzzle : MessageSquare
          break
        case 'ai':
          icon = Bot
          break
        case 'end':
          icon = Circle
          break
        case 'note':
          icon = Square
          break
        case 'condition':
          icon = Workflow
          break
        case 'ifelse':
        case 'branch':
          icon = Workflow
          break
        case 'while':
          icon = RefreshCw
          break
        case 'wait':
          icon = Pause
          break
        case 'dataSheets':
          icon = Database
          break
        case 'sendgrid':
          icon = SendGridIcon
          break
        case 'telegram':
          icon = TelegramIcon
          break
        case 'smtp':
          icon = Send
          break
        case 'imap':
          icon = Inbox
          break
        case 'mcp':
          icon = MCPLogo || Zap
          break
        case 'miniapp':
          icon = GraduationCap
          break
        case 'source':
          icon = FileSearch
          break
        case 'webhook':
          icon = Globe
          break
        case 'file_search':
          icon = FileSearch
          break
        case 'ifElse':
          icon = Workflow
          break
        case 'httpRequest':
          icon = Globe
          break
        case 'store':
          icon = DatabaseZap
          break
        case 'continue':
          icon = SkipForward
          break
        default:
            if (label === 'Chat Widget' || label === 'Start') {
              icon = MessageSquare
            } else if (label === 'AI') {
              icon = Bot
            } else if (label === 'End') {
              icon = Circle
            } else if (label === 'Note') {
              icon = Square
            } else if (label === 'While') {
              icon = RefreshCw
            } else if (label === 'Wait') {
              icon = Pause
            } else if (label === 'Data Sheets') {
              icon = Database
            } else if (label === 'If / else') {
              icon = Workflow
            } else if (label === 'SendGrid') {
              icon = SendGridIcon
            } else if (label === 'Telegram') {
              icon = TelegramIcon
            } else if (label?.includes('SMTP') || label?.includes('Send') || label?.includes('Reply')) {
              icon = Mail
            } else if (label?.includes('IMAP') || label?.includes('Inbox') || label?.includes('Read')) {
              icon = Mail
            }
        }
      }

      if (!icon) {
        icon = Bot;
      }
    }

    let color: string
    {
      const nodeType = node.type === 'tool'
        ? node.data?.toolType
        : (node.data?.nodeType || node.type)
      switch (nodeType) {
        case 'start':
          color = 'bg-green-500'
          break
        case 'ai':
          color = 'bg-blue-500'
          break
        case 'end':
          color = 'bg-green-500'
          break
        case 'imap':
          color = 'bg-indigo-500'
          break
        case 'smtp':
          color = 'bg-purple-500'
          break
        case 'sendgrid':
          color = 'bg-[#00A9D1]'
          break
        case 'telegram':
          color = 'bg-gray-200'
          break
        case 'while':
          color = 'bg-orange-600'
          break
        case 'wait':
          color = 'bg-orange-400'
          break
        case 'dataSheets':
          color = 'bg-indigo-500'
          break
        case 'ifElse':
        case 'ifelse':
        case 'condition':
        case 'branch':
          color = 'bg-orange-500'
          break
        case 'mcp':
          color = 'bg-black'
          break
        case 'miniapp':
          color = 'bg-purple-500'
          break
        case 'source':
        case 'file_search':
          color = 'bg-yellow-500'
          break
        case 'webhook':
          color = 'bg-orange-500'
          break
        case 'httpRequest':
          color = 'bg-orange-500'
          break
        case 'store':
          color = 'bg-emerald-500'
          break
        case 'workApp':
          color = 'bg-emerald-600'
          break
        case 'webSearch':
          color = 'bg-green-500'
          break
        case 'subworkflow':
          color = 'bg-pink-500'
          break
        case 'continue':
          color = 'bg-orange-400'
          break
        default:
          color = 'bg-blue-500'
      }
    }

    return {
      ...node,
      type: canvasNodeTypeOf(node),
      data: {
        ...node.data,
        icon,
        color
      }
    }
  })
}

export function getNodeSize(node: Node): { width: number, height: number } {
  if (node.width && node.height) {
    return { width: node.width, height: node.height }
  }

  return { width: 200, height: 80 }
}

export function findNonOverlappingPosition(
  originalX: number,
  originalY: number,
  excludeNodeId: string | undefined,
  currentNodes: Node[]
): { x: number, y: number } {
  const overlapAllowed = 25
  const baseOffset = 5
  let offset = 0
  let attempts = 0
  const maxAttempts = 100

  while (attempts < maxAttempts) {
    const newX = originalX + offset
    const newY = originalY + offset

    const hasOverlap = currentNodes.some(existingNode => {
      if (excludeNodeId && existingNode.id === excludeNodeId) {
        return false
      }

      const size1 = getNodeSize(existingNode)
      const size2 = getNodeSize(existingNode)

      const box1 = {
        x1: newX + overlapAllowed,
        y1: newY + overlapAllowed,
        x2: newX + size2.width - overlapAllowed,
        y2: newY + size2.height - overlapAllowed
      }

      const box2 = {
        x1: existingNode.position.x + overlapAllowed,
        y1: existingNode.position.y + overlapAllowed,
        x2: existingNode.position.x + size1.width - overlapAllowed,
        y2: existingNode.position.y + size1.height - overlapAllowed
      }

      const overlaps = !(box1.x2 <= box2.x1 || box1.x1 >= box2.x2 || box1.y2 <= box2.y1 || box1.y1 >= box2.y2)

      return overlaps
    })

    if (!hasOverlap) {
      return { x: newX, y: newY }
    }

    offset += baseOffset
    attempts++
  }

  return { x: originalX + offset, y: originalY + offset }
}

export function extractFieldsFromSchema(jsonSchema: any): Array<{ name: string, type: string }> {
  if (!jsonSchema) return []

  try {
    const schema = typeof jsonSchema === 'string' ? JSON.parse(jsonSchema) : jsonSchema

    const schemaObj = schema.schema || schema
    const properties = schemaObj?.properties

    if (!properties || typeof properties !== 'object') {
      return []
    }

    const fields: Array<{ name: string, type: string }> = []
    for (const [key, value] of Object.entries(properties)) {
      const fieldType = typeof value === 'object' && value !== null
        ? (value as any).type || 'unknown'
        : 'unknown'

      fields.push({
        name: key,
        type: fieldType
      })
    }

    return fields
  } catch (error) {
    console.error('[nodeUtils] Failed to extract fields from schema:', error)
    return []
  }
}

export function getAvailableContextFields(
  nodes: Node[],
  edges: Edge[],
  currentNodeId: string
): Array<{ name: string, type: string, source: string }> {
  const fields: Array<{ name: string, type: string, source: string }> = []

  fields.push(
    { name: 'message', type: 'string', source: 'System' },
    { name: 'aiResponse', type: 'string', source: 'System' },
    { name: 'finalAnswer', type: 'string', source: 'System' }
  )

  const precedingNodes = getPrecedingNodes(nodes, edges, currentNodeId)

  for (const node of precedingNodes) {
    if (isAiNode(node) && node.data?.outputFormat === 'json' && node.data?.jsonSchema) {
      const schemaFields = extractFieldsFromSchema(node.data.jsonSchema)
      const nodeLabel = node.data?.label || 'AI'

      for (const field of schemaFields) {
        fields.push({
          name: `jsonData.${field.name}`,
          type: field.type,
          source: nodeLabel
        })
      }
    }

  }

  return fields
}

function getPrecedingNodes(nodes: Node[], edges: Edge[], targetNodeId: string): Node[] {
  const visited = new Set<string>()
  const precedingNodeIds = new Set<string>()

  function traverse(nodeId: string) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const incomingEdges = edges.filter(e => e.target === nodeId)

    for (const edge of incomingEdges) {
      if (edge.source !== targetNodeId) {
        precedingNodeIds.add(edge.source)
      }
      traverse(edge.source)
    }
  }

  traverse(targetNodeId)

  return nodes.filter(n => precedingNodeIds.has(n.id))
}