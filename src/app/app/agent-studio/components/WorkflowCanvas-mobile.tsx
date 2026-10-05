import React, { useCallback, useMemo, useEffect, useState, useRef } from 'react'
import ReactFlow, {
  NodeTypes,
  ReactFlowProvider,
  useReactFlow,
  MarkerType,
  OnSelectionChangeParams,
  Background,
  BackgroundVariant
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import type { Node, Edge } from 'reactflow'

import { CustomNode } from '../nodes/CustomNode'
import { ToolNode } from '../nodes/ToolNode'
import { NoteNode } from '../nodes/NoteNode'
import { IfElseNode } from '../nodes/IfElseNode'
import { WhileNode } from '../nodes/WhileNode'
import { WaitNode } from '../nodes/WaitNode'
import { ContinueNode } from '../nodes/ContinueNode'
import { ApiNode } from '../nodes/ApiNode'
import { FunctionCallingNode } from '../nodes/FunctionCallingNode'
import { DataSheetsNode } from '../nodes/DataSheetsNode'

import { LoopEdge } from '../edges/LoopEdge'
import { ToolEdge } from '../edges/ToolEdge'
import { DefaultEdge } from '../edges/DefaultEdge'

const nodeTypes: NodeTypes = {
  custom: CustomNode as any,
  tool: ToolNode as any,
  note: NoteNode as any,
  ifElse: IfElseNode as any,
  while: WhileNode as any,
  wait: WaitNode as any,
  continue: ContinueNode as any,
  api: ApiNode as any,
  functionCalling: FunctionCallingNode as any,
  dataSheets: DataSheetsNode as any
}

const edgeTypes = {
  default: DefaultEdge as any,
  loopEdge: LoopEdge as any,
  toolEdge: ToolEdge as any
}

const defaultMarker = {
  type: MarkerType.ArrowClosed,
  width: 20,
  height: 20,
  color: '#666'
}

const defaultEdgeOptions = {
  type: 'default',
  style: { stroke: '#666', strokeWidth: 2 },
  markerEnd: defaultMarker,
  interactionWidth: 80
}

interface WorkflowCanvasMobileProps {
  onZoomChange?: (zoom: number) => void
}

const WorkflowCanvasMobileContent: React.FC<WorkflowCanvasMobileProps> = ({
  onZoomChange
}) => {
  const { workflow, nodeHandlers, test, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const reactFlowInstance = useReactFlow()
  const { fitView, zoomIn, zoomOut, getZoom, setViewport, getViewport } = reactFlowInstance

  const [currentZoom, setCurrentZoom] = useState(100)
  const lastTapTimeRef = useRef<number>(0)
  const lastTapNodeIdRef = useRef<string | null>(null)

  useEffect(() => {
    const updateZoom = () => {
      const zoom = getZoom()
      const zoomPercent = Math.round(zoom * 100)
      setCurrentZoom(zoomPercent)
      onZoomChange?.(zoomPercent)
    }

    updateZoom()
    const interval = setInterval(updateZoom, 200)
    return () => clearInterval(interval)
  }, [getZoom, onZoomChange])

  const getNodeStyle = useCallback((nodeId: string) => {
    if (test.executingNodeId === nodeId) {
      return {
        boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.5)',
        animation: 'pulse 2s infinite'
      }
    }
    if (test.executionPath.includes(nodeId)) {
      return {
        opacity: 0.7
      }
    }
    return {}
  }, [test.executingNodeId, test.executionPath])

  // Reset view (center + 100%)
  const handleResetView = useCallback(() => {
    if (workflow.nodes.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 300 })
      return
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    workflow.nodes.forEach(node => {
      const pos = node.position || { x: 0, y: 0 }
      const x = pos.x
      const y = pos.y
      const width = (node.width || 200)
      const height = (node.height || 100)

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + width)
      maxY = Math.max(maxY, y + height)
    })

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    const rfWrapper = document.querySelector('.react-flow__renderer')
    if (!rfWrapper) {
      setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 300 })
      return
    }

    const rect = rfWrapper.getBoundingClientRect()
    const viewportWidth = rect.width
    const viewportHeight = rect.height

    const x = viewportWidth / 2 - centerX
    const y = viewportHeight / 2 - centerY

    setViewport({ x, y, zoom: 1 }, { duration: 300 })
  }, [workflow.nodes, setViewport])

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (nodeHandlers.isDragging() || nodeHandlers.didMove()) {
        return
      }

      if (!selectedNodes || selectedNodes.length === 0) {
        workflow.setSelectedNode(null)
        return
      }

      if (selectedNodes.length > 1) {
        workflow.setSelectedNode(null)
        return
      }

      const last = selectedNodes[selectedNodes.length - 1]

      if (last.type === 'note') {
        workflow.setSelectedNode(null)
        return
      }

      workflow.setSelectedNode(last.id)
    },
    [workflow, nodeHandlers]
  )

  const handleNodesDelete = useCallback(
    (nodes: Node[]) => {
      if (ui.isLocked) return
      nodeHandlers.onNodesDelete(nodes)
    },
    [ui.isLocked, nodeHandlers]
  )

  const handleEdgesDelete = useCallback(
    (edges: Edge[]) => {
      if (ui.isLocked) return
      nodeHandlers.onEdgesDelete(edges)
    },
    [ui.isLocked, nodeHandlers]
  )

  const handleNodesChange = useCallback(
    (changes: any[]) => {
      if (ui.isLocked) {
        const filteredChanges = changes.filter(change => change.type !== 'remove')
        if (filteredChanges.length > 0) {
          workflow.onNodesChange(filteredChanges)
        }
      } else {
        workflow.onNodesChange(changes)
      }
    },
    [ui.isLocked, workflow]
  )

  const handleEdgesChange = useCallback(
    (changes: any[]) => {
      if (ui.isLocked) {
        const filteredChanges = changes.filter(change => change.type !== 'remove')
        if (filteredChanges.length > 0) {
          workflow.onEdgesChange(filteredChanges)
        }
      } else {
        workflow.onEdgesChange(changes)
      }
    },
    [ui.isLocked, workflow]
  )

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const now = Date.now()
      const timeSinceLastTap = now - lastTapTimeRef.current

      if (timeSinceLastTap < 300 && lastTapNodeIdRef.current === node.id) {
        workflow.setSelectedNode(node.id)
        lastTapTimeRef.current = 0
        lastTapNodeIdRef.current = null
      } else {
        lastTapTimeRef.current = now
        lastTapNodeIdRef.current = node.id
        nodeHandlers.onNodeClick(event, node)
      }
    },
    [workflow, nodeHandlers]
  )

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (ui.isLocked) return

      if (confirm(t.delete_connection_confirm)) {
        workflow.setEdges(edges => edges.filter(e => e.id !== edge.id))
        workflow.saveToHistory()
      }
    },
    [ui.isLocked, workflow]
  )

  const customizedEdges = useMemo(
    () => customizeEdges(workflow.edges, workflow.nodes),
    [workflow.edges, workflow.nodes]
  )

  return (
    <div className="relative flex-1 w-full h-full touch-none">
      <style dangerouslySetInnerHTML={{
        __html: `
          .tool-edge-no-arrow .react-flow__edge-path {
            marker-end: none !important;
            marker-start: none !important;
          }
        `
      }} />
      <ReactFlow
        nodes={workflow.nodes.map(node => ({
          ...node,
          style: getNodeStyle(node.id),
          data: {
            ...node.data,
            onLabelChange: (nodeId: string, newLabel: string) => {
              workflow.setNodes((nds: Node[]) =>
                nds.map((n) =>
                  n.id === nodeId ? { ...n, data: { ...n.data, label: newLabel } } : n
                )
              )
            }
          }
        }))}
        edges={customizedEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={nodeHandlers.onConnect}
        isValidConnection={nodeHandlers.isValidConnection}
        onNodeClick={handleNodeClick}
        onNodeDragStart={nodeHandlers.onNodeDragStart}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        onEdgeClick={handleEdgeClick}
        onNodeDragStop={nodeHandlers.onNodeDragStop}
        onInit={(instance) => {
          workflow.setReactFlowInstance(instance)
          setTimeout(() => {
            handleResetView()
          }, 100)
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onSelectionChange={handleSelectionChange}
        onPaneClick={() => {
          workflow.deselectAll()
          if (ui.showAIAssistant) {
            ui.closeAIAssistant()
          }
        }}
        style={{ background: 'transparent' }}
        panOnDrag={true}
        zoomOnPinch={true}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={true}
        selectionOnDrag={false}
        nodeDragThreshold={5}
        nodesDraggable={!ui.isLocked}
        nodesConnectable={!ui.isLocked}
        elementsSelectable={!ui.isLocked}
        edgesFocusable={!ui.isLocked}
        multiSelectionKeyCode={null}
        proOptions={{ hideAttribution: true }}
        snapToGrid={true}
        snapGrid={[20, 20]}
        minZoom={0.1}
        maxZoom={4}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#3a3a3a"
        />
      </ReactFlow>
    </div>
  )
}

export const WorkflowCanvasMobile: React.FC<WorkflowCanvasMobileProps> = (props) => {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasMobileContent {...props} />
    </ReactFlowProvider>
  )
}

function customizeEdges(edges: Edge[], nodes: Node[]) {
  return edges.map((edge) => {
    const isLoopEdge = edge.sourceHandle === 'loop' || edge.type === 'loopEdge' || edge.data?.isLoopEdge

    if (isLoopEdge) {
      return {
        ...edge,
        type: 'loopEdge',
        animated: false,
        markerEnd: undefined,
        markerStart: undefined,
        interactionWidth: 80,
        style: edge.selected
          ? { stroke: '#10b981', strokeWidth: 2.5 }
          : undefined
      }
    }

    const isToolEdge = edge.sourceHandle === 'tools' || edge.sourceHandle === 'miniapps' || edge.className === 'tool-edge-no-arrow'

    if (isToolEdge) {
      return {
        ...edge,
        type: 'toolEdge',
        animated: false,
        markerEnd: undefined,
        markerStart: undefined,
        interactionWidth: 80,
        style: edge.selected
          ? { stroke: '#10b981', strokeWidth: 2.5 }
          : (edge.sourceHandle === 'miniapps' ? { stroke: '#a855f7' } : undefined)
      }
    }

    return {
      ...edge,
      type: 'default',
      animated: edge.animated ?? false,
      interactionWidth: 80,
      style: edge.selected
        ? { stroke: '#10b981', strokeWidth: 2.5 }
        : (edge.style || { stroke: '#666', strokeWidth: 2 })
    }
  })
}
