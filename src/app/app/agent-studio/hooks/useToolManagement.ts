
import { useState, useCallback, useRef, useEffect } from 'react'
import type { Node, Edge } from 'reactflow'
import { FileSearch, Globe, Zap } from 'lucide-react'
import { MCPLogo } from '../nodes/icons/MCPLogo'
import type { SelectedToolsState } from '../types'

interface UseToolManagementProps {
  nodes: Node[]
  edges: Edge[]
  selectedNode: string | null
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  updateNodeInternals: (nodeId: string) => void
}

interface UseToolManagementReturn {
  selectedTools: SelectedToolsState
  setSelectedTools: React.Dispatch<React.SetStateAction<SelectedToolsState>>
  handleToolToggle: (toolName: keyof SelectedToolsState) => void
  handleAddTool: (aiNodeId: string) => void
  syncToolModalStateFromCanvas: (aiNodeId: string) => SelectedToolsState
  tempSourceItems: Array<{id: string, name: string}>
  setTempSourceItems: React.Dispatch<React.SetStateAction<Array<{id: string, name: string}>>>
  tempMcpItems: Array<{id: string, name: string}>
  setTempMcpItems: React.Dispatch<React.SetStateAction<Array<{id: string, name: string}>>>
  tempWebSearchItems: Array<{id: string, name: string}>
  setTempWebSearchItems: React.Dispatch<React.SetStateAction<Array<{id: string, name: string}>>>
  tempFunctionCallingItems: Array<{id: string, name: string}>
  setTempFunctionCallingItems: React.Dispatch<React.SetStateAction<Array<{id: string, name: string}>>>
}

export function useToolManagement({
  nodes,
  edges,
  selectedNode,
  setNodes,
  setEdges,
  updateNodeInternals
}: UseToolManagementProps): UseToolManagementReturn {
  const [selectedTools, setSelectedTools] = useState<SelectedToolsState>({
    source: false,
    mcp: false,
    webSearch: false,
    functionCalling: false,
    imageInput: false,
    pdfInput: false
  })

  const [tempSourceItems, setTempSourceItems] = useState<Array<{id: string, name: string}>>([])
  const [tempMcpItems, setTempMcpItems] = useState<Array<{id: string, name: string}>>([])
  const [tempWebSearchItems, setTempWebSearchItems] = useState<Array<{id: string, name: string}>>([])
  const [tempFunctionCallingItems, setTempFunctionCallingItems] = useState<Array<{id: string, name: string}>>([])

  // Refs for latest values
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)

  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])

  const toolConfig = {
    source: {
      label: 'Source',
      icon: FileSearch,
      color: 'bg-yellow-500'
    },
    mcp: {
      label: 'MCP',
      icon: MCPLogo,
      color: 'bg-black'
    },
    webSearch: {
      label: 'Web search',
      icon: Globe,
      color: 'bg-green-500'
    },
    functionCalling: {
      label: 'Function Calling',
      icon: Zap,
      color: 'bg-blue-500'
    }
  }

  const syncToolModalStateFromCanvas = useCallback((aiNodeId: string) => {
    const connectedToolEdges = edgesRef.current.filter(e =>
      e.source === aiNodeId && e.sourceHandle === 'tools'
    )
    const connectedToolNodeIds = connectedToolEdges.map(e => e.target)
    const connectedToolNodes = nodesRef.current.filter(n =>
      connectedToolNodeIds.includes(n.id) && n.type === 'tool' && n.data.toolType
    )

    const sourceNodes = connectedToolNodes.filter(n => n.data.toolType === 'source')
    const mcpNodes = connectedToolNodes.filter(n => n.data.toolType === 'mcp')
    const webSearchNodes = connectedToolNodes.filter(n => n.data.toolType === 'webSearch')
    const functionCallingNodes = connectedToolNodes.filter(n => n.data.toolType === 'functionCalling')

    setTempSourceItems(sourceNodes.map(n => ({ id: n.id, name: n.data.label || 'Source' })))
    setTempMcpItems(mcpNodes.map(n => ({ id: n.id, name: n.data.label || 'MCP' })))
    setTempWebSearchItems(webSearchNodes.map(n => ({ id: n.id, name: n.data.label || 'Web search' })))
    setTempFunctionCallingItems(functionCallingNodes.map(n => ({ id: n.id, name: n.data.label || 'Function Calling' })))

    const aiNode = nodesRef.current.find(n => n.id === aiNodeId)
    const actualSelectedTools = {
      source: sourceNodes.length > 0,
      mcp: mcpNodes.length > 0,
      webSearch: webSearchNodes.length > 0,
      functionCalling: functionCallingNodes.length > 0,
      imageInput: aiNode?.data.imageInput || false,
      pdfInput: aiNode?.data.pdfInput || false
    }

    setSelectedTools(actualSelectedTools)
    return actualSelectedTools
  }, [])

  const handleToolToggle = useCallback((toolName: keyof SelectedToolsState) => {
    const isChecked = selectedTools[toolName]

    const newSelectedTools = {
      ...selectedTools,
      [toolName]: !isChecked
    }
    setSelectedTools(newSelectedTools)

    const aiNode = nodes.find(n => n.id === selectedNode && (n.data.nodeType === 'ai' || n.data.label === 'AI'))
    if (!aiNode) return

    setNodes((nds) => nds.map(n => {
      if (n.id === aiNode.id) {
        return {
          ...n,
          data: {
            ...n.data,
            selectedTools: newSelectedTools,
            imageInput: newSelectedTools.imageInput,
            pdfInput: newSelectedTools.pdfInput
          }
        }
      }
      return n
    }))

    if (toolName === 'imageInput' || toolName === 'pdfInput') {
      return
    }

    const config = toolConfig[toolName as keyof typeof toolConfig]
    if (!config) return

    const existingToolNode = nodes.find(n => n.data.label === config.label)

    if (!isChecked) {
      const toolNodeId = `tool-${toolName}-${Date.now()}`

      const existingToolNodes = nodes.filter(n =>
        n.data.label === 'Source' ||
        n.data.label === 'MCP' ||
        n.data.label === 'Web search' ||
        n.data.label === 'Function Calling'
      )

      const toolIndex = existingToolNodes.length

      const positions = [
        { x: 150, y: 150 },
        { x: -150, y: 150 },
        { x: 150, y: 250 },
        { x: -150, y: 250 }
      ]

      const offset = positions[toolIndex] || { x: 0, y: 150 + (toolIndex * 100) }

      const newToolNode: Node = {
        id: toolNodeId,
        type: 'tool',
        data: {
          label: config.label,
          icon: config.icon,
          color: config.color,
          toolType: toolName,
          parentId: aiNode.id
        },
        position: {
          x: aiNode.position.x + offset.x,
          y: aiNode.position.y + offset.y
        }
      }

      setNodes((nds) => [...nds, newToolNode])

      setTimeout(() => {
        updateNodeInternals(aiNode.id)

        setEdges((eds) => [
          ...eds,
          {
            id: `e-${aiNode.id}-${toolNodeId}`,
            source: aiNode.id,
            sourceHandle: 'tools',
            target: toolNodeId,
            type: 'default',
            className: 'tool-edge-no-arrow',
            style: {
              stroke: '#666',
              strokeWidth: 2,
              strokeDasharray: '5, 5'
            }
          }
        ])
      }, 100)
    } else {
      if (existingToolNode) {
        setNodes((nds) => nds.filter(n => n.id !== existingToolNode.id))
        setEdges((eds) => eds.filter(e =>
          e.source !== existingToolNode.id &&
          e.target !== existingToolNode.id
        ))
      }
    }
  }, [selectedTools, nodes, selectedNode, setNodes, setEdges, updateNodeInternals])

  const handleAddTool = useCallback((aiNodeId: string) => {
    syncToolModalStateFromCanvas(aiNodeId)
  }, [syncToolModalStateFromCanvas])

  return {
    selectedTools,
    setSelectedTools,
    handleToolToggle,
    handleAddTool,
    syncToolModalStateFromCanvas,
    tempSourceItems,
    setTempSourceItems,
    tempMcpItems,
    setTempMcpItems,
    tempWebSearchItems,
    setTempWebSearchItems,
    tempFunctionCallingItems,
    setTempFunctionCallingItems
  }
}