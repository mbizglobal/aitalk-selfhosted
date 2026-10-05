
import type { Node, Edge } from 'reactflow'
import { MessageSquare, Bot, Circle, FileSearch } from 'lucide-react'

export const initialNodes: Node[] = [
  {
    id: '1',
    type: 'custom',
    data: {
      label: 'Chat Widget',
      icon: MessageSquare,
      color: 'bg-green-500',
      showLeftHandle: false,
      nodeType: 'start',
      accessMode: 'public' as 'public' | 'team'
    },
    position: { x: 100, y: 150 },
  },
  {
    id: '2',
    type: 'custom',
    data: {
      label: 'AI',
      icon: Bot,
      color: 'bg-blue-500',
      showTools: true,
      toolCount: 1,
      nodeType: 'ai',
      model: 'gpt-6-luna',
      temperature: 1.0,
      maxTokens: 2048,
      topP: 1.0,
      effort: 'medium',
      verbosity: 'medium',
      summary: 'auto',
      storeLogs: true,
      systemMessage: '',
      selectedTools: {
        source: true,
        mcp: false,
        webSearch: false,
        functionCalling: false
      }
    },
    position: { x: 400, y: 150 },
  },
  {
    id: '3',
    type: 'custom',
    data: {
      label: 'End',
      icon: Circle,
      color: 'bg-green-500',
      nodeType: 'end'
    },
    position: { x: 700, y: 150 },
  },
  {
    id: 'tool-2-source',
    type: 'tool',
    data: {
      label: 'Source',
      icon: FileSearch,
      color: 'bg-yellow-500',
      toolType: 'source',
      parentId: '2'
    },
    position: { x: 550, y: 300 },
  },
]

export const initialEdges: Edge[] = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    type: 'default',
    style: { stroke: '#666', strokeWidth: 2 },
    markerEnd: { type: 'arrowclosed', color: '#666' }
  },
  {
    id: 'e2-3',
    source: '2',
    target: '3',
    type: 'default',
    style: { stroke: '#666', strokeWidth: 2 },
    markerEnd: { type: 'arrowclosed', color: '#666' }
  },
  {
    id: 'e2-tool-source',
    source: '2',
    sourceHandle: 'tools',
    target: 'tool-2-source',
    type: 'default',
    style: { stroke: '#666', strokeWidth: 2, strokeDasharray: '5,5' }
  },
]

export const aiDefaultConfig = {
  model: 'gpt-6-luna',
  temperature: 1.0,
  maxTokens: 2048,
  topP: 1.0,
  effort: 'medium',
  verbosity: 'medium',
  summary: 'auto',
  storeLogs: true,
  includeChatHistory: true,
  outputFormat: 'text' as const,
  systemMessage: '',
  selectedTools: {
    source: false,
    mcp: false,
    webSearch: false,
    functionCalling: false,
    imageInput: false,
    pdfInput: false
  },
  imageInput: false,
  pdfInput: false
}