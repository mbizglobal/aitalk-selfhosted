import React, { useCallback, useMemo } from 'react'
import ReactFlow, {
  NodeTypes,
  ReactFlowProvider,
  useReactFlow,
  Panel,
  MarkerType,
  OnSelectionChangeParams,
  Background,
  BackgroundVariant
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { Button } from '@/components/ui/button'
import {
  ZoomIn,
  Maximize2,
  Undo,
  Redo,
  Maximize,
  Minimize,
  Minimize2,
  Lock,
  Unlock,
  Minus,
  Plus
} from 'lucide-react'

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
import {
  basicComponents,
  toolComponents,
  inOutComponents,
  flowComponents,
  dataComponents,
  appsComponents,
  etcComponents,
  SendGridIcon,
  TelegramIcon
} from '../constants/components'
import { aiDefaultConfig } from '../constants/initialData'
import { findNonOverlappingPosition } from '../utils'
import { MCPLogo } from '../nodes/icons/MCPLogo'
import { v4 as uuidv4 } from 'uuid'
import type { Node, Edge } from 'reactflow'

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
  interactionWidth: 60
}

const WorkflowCanvasContent: React.FC = () => {
  const { workflow, nodeHandlers, test, ui } = useWorkflowContext()
  const reactFlowInstance = useReactFlow()
  const { fitView, zoomIn, zoomOut, getZoom, setViewport, getViewport } = reactFlowInstance

  const [currentZoom, setCurrentZoom] = React.useState(100)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
      const [controlledViewport, setControlledViewport] = React.useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 })
  const lastRightClickTimeRef = React.useRef<number>(0)

  const handleLockToggle = useCallback(() => {
    if (!ui.isLocked) {
      workflow.deselectAll()
    }
    ui.setIsLocked(!ui.isLocked)
  }, [ui.isLocked, ui.setIsLocked, workflow])

  const paletteItems = useMemo(
    () => [
      ...basicComponents,
      ...toolComponents,
      ...inOutComponents,
      ...flowComponents,
      ...dataComponents,
      ...appsComponents,
      ...etcComponents
    ],
    []
  )

  React.useEffect(() => {
    const updateZoom = () => {
      const zoom = getZoom()
      setCurrentZoom(Math.round(zoom * 100))
    }

    updateZoom()
    const interval = setInterval(updateZoom, 200)
    return () => clearInterval(interval)
  }, [getZoom])

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

  // Fullscreen toggle
  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }, [])

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

  // Fullscreen change listener
  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()

    const now = Date.now()
    const timeSinceLastClick = now - lastRightClickTimeRef.current

    if (timeSinceLastClick < 300) {
      const currentViewport = getViewport()
      const newZoom = Math.max(currentViewport.zoom * 0.7, 0.1)

      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const zoomRatio = newZoom / currentViewport.zoom
      const newX = x - (x - currentViewport.x) * zoomRatio
      const newY = y - (y - currentViewport.y) * zoomRatio

      setViewport({ x: newX, y: newY, zoom: newZoom }, { duration: 200 })
      setControlledViewport({ x: newX, y: newY, zoom: newZoom })

      lastRightClickTimeRef.current = 0
    } else {
      lastRightClickTimeRef.current = now
    }
  }, [getViewport, setViewport])

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

      if (last.type === 'while') {
        setTimeout(() => {
          const rfWrapper = document.querySelector('.react-flow__renderer')
          if (!rfWrapper) return

          const rect = rfWrapper.getBoundingClientRect()
          const viewportWidth = rect.width
          const rightPanelWidth = 400

          const nodePosition = last.position
          const viewport = reactFlowInstance.getViewport()
          const nodeScreenX = nodePosition.x * viewport.zoom + viewport.x

          const nodeRightEdge = nodeScreenX + 250 * viewport.zoom
          const panelLeftEdge = viewportWidth - rightPanelWidth

          if (nodeRightEdge > panelLeftEdge) {
            const shiftAmount = nodeRightEdge - panelLeftEdge + 50
            setViewport(
              {
                x: viewport.x - shiftAmount,
                y: viewport.y,
                zoom: viewport.zoom
              },
              { duration: 300 }
            )
          }
        }, 100)
      }
    },
    [workflow, reactFlowInstance, setViewport, nodeHandlers, getViewport]
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

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = ui.isLocked ? 'none' : 'move'
  }, [ui.isLocked])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (ui.isLocked) return
      if (!workflow.reactFlowInstance) return

      const componentId = event.dataTransfer.getData('application/reactflow')
      if (!componentId) return

      const component = paletteItems.find((item) => item.id === componentId)
      if (!component) return

      const bounds = event.currentTarget.getBoundingClientRect()
      const flowPosition = workflow.reactFlowInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      })

      const position = findNonOverlappingPosition(
        flowPosition.x,
        flowPosition.y,
        undefined,
        workflow.nodes
      )

      const icon =
        component.id === 'mcp' && !component.icon ? MCPLogo
        : component.id === 'sendgrid' && !component.icon ? SendGridIcon
        : component.id === 'telegram' && !component.icon ? TelegramIcon
        : component.id === 'telegram-start' && !component.icon ? TelegramIcon
        : component.icon

      const toolTypes = ['source', 'mcp', 'web-search', 'function-calling', 'subworkflow']
      if (toolTypes.includes(componentId)) {
        const aiNodeId = uuidv4()
        const toolNodeId = uuidv4()

        const aiPosition = position
        const toolPosition = {
          x: position.x + 30,
          y: position.y + 120
        }

        const aiNode: Node = {
          id: aiNodeId,
          type: 'custom',
          position: aiPosition,
          data: {
            label: 'AI',
            icon: paletteItems.find(p => p.id === 'ai')?.icon,
            color: 'bg-blue-500',
            nodeType: 'ai',
            showTools: true,
            toolCount: 1,
            ...aiDefaultConfig
          },
          selected: false
        }

        const toolNode: Node = {
          id: toolNodeId,
          type: 'tool',
          position: toolPosition,
          data: {
            label: component.name,
            icon,
            color: component.color,
            toolType:
              componentId === 'source'
                ? 'source'
                : componentId === 'mcp'
                  ? 'mcp'
                  : componentId === 'web-search'
                    ? 'webSearch'
                    : componentId === 'subworkflow'
                      ? 'subworkflow'
                      : 'functionCalling'
          },
          selected: false
        }

        const toolEdge: Edge = {
          id: `e-${aiNodeId}-${toolNodeId}`,
          source: aiNodeId,
          target: toolNodeId,
          sourceHandle: 'tools',
          type: 'toolEdge',
          className: 'tool-edge-no-arrow'
        }

        const newNodes = [...workflow.nodes, aiNode, toolNode]
        const newEdges = [...workflow.edges, toolEdge]

        workflow.setNodes(newNodes)
        workflow.setEdges(newEdges)
        workflow.saveToHistory(newNodes, newEdges)
        workflow.setSelectedNode(aiNodeId)
        return
      }

      const newNode = createPaletteNode(component.id, {
        label: component.name,
        icon,
        color: component.color,
        showLeftHandle: component.showLeftHandle
      }, position)

      if (!newNode) return

      workflow.setNodes((prev) => {
        const updated = [...prev, newNode]
        workflow.saveToHistory(updated, workflow.edges)
        return updated
      })
      workflow.setSelectedNode(newNode.id)
    },
    [ui.isLocked, paletteItems, workflow]
  )

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const isModalOpen = ui.showInstructionsModal || ui.showModelSettingsModal || ui.showToolsModal || ui.showJsonSchemaModal
        || ui.showVoiceQuizNoticeModal || ui.showVoiceQuizContentModal || ui.showVoiceQuizBankModal

      if (isInputField || isModalOpen) {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        workflow.undo()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        workflow.redo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        workflow.copySelection()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        workflow.paste()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        workflow.selectAll()
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !ui.isLocked) {
        e.preventDefault()
        const selectedNodes = workflow.nodes.filter(n => n.selected)
        const selectedEdges = workflow.edges.filter(edge => edge.selected)

        selectedNodes.forEach(node => nodeHandlers.deleteNode(node.id))

        if (selectedEdges.length > 0) {
          workflow.setEdges(edges => edges.filter(edge => !edge.selected))
        }
      }
      if (e.key === 'Escape') {
        workflow.deselectAll()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [workflow, nodeHandlers, ui.isLocked, ui.showInstructionsModal, ui.showModelSettingsModal, ui.showToolsModal, ui.showJsonSchemaModal,
      ui.showVoiceQuizNoticeModal, ui.showVoiceQuizContentModal, ui.showVoiceQuizBankModal])

  const customizedEdges = useMemo(
    () => customizeEdges(workflow.edges, workflow.nodes),
    [workflow.edges, workflow.nodes]
  )

  return (
    <div
      className="relative flex-1 w-full h-full"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onContextMenu={handleContextMenu}
    >
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
          position: node.position || { x: 0, y: 0 },
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
        onNodeClick={nodeHandlers.onNodeClick}
        onNodeDragStart={nodeHandlers.onNodeDragStart}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        onNodeDragStop={nodeHandlers.onNodeDragStop}
        onInit={(instance) => {
          workflow.setReactFlowInstance(instance)
          setTimeout(() => {
            handleResetView()
            setTimeout(() => {
              setControlledViewport(instance.getViewport())
            }, 250)
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
        onMoveEnd={(event, viewport) => {
          setControlledViewport(viewport)
        }}
        style={{ background: 'transparent' }}
        nodesDraggable={!ui.isLocked}
        nodesConnectable={!ui.isLocked}
        elementsSelectable={!ui.isLocked}
        edgesFocusable={!ui.isLocked}
        selectionOnDrag={!ui.isLocked}
        panOnScroll={true}
        panOnDrag={ui.isLocked ? true : [1, 2]}
        multiSelectionKeyCode={ui.isLocked ? null : "Control"}
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

        {!ui.showDebugPanel && (
          <Panel position="bottom-center" style={{ bottom: '20px' }}>
            <div className="flex items-center gap-1 bg-[#2A2A2A]/95 backdrop-blur-sm border border-[#3A3A3A] rounded-full px-4 py-2.5 shadow-xl">
            {/* Undo */}
            <Button
              variant="ghost"
              size="sm"
              onClick={workflow.undo}
              disabled={workflow.historyIndex <= 0}
              className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] disabled:opacity-30 rounded-full"
              title="Undo (Ctrl+Z)"
            >
              <Undo className="w-4 h-4" />
            </Button>

            {/* Redo */}
            <Button
              variant="ghost"
              size="sm"
              onClick={workflow.redo}
              disabled={workflow.historyIndex >= workflow.history.length - 1}
              className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] disabled:opacity-30 rounded-full"
              title="Redo (Ctrl+Y)"
            >
              <Redo className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-[#3A3A3A] mx-2" />

            {/* Zoom Out */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => zoomOut()}
              className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] rounded-full"
              title="Zoom Out"
            >
              <Minus className="w-4 h-4" />
            </Button>

            {/* Zoom Percentage */}
            <div className="px-3 min-w-[70px] text-center text-sm text-gray-200 font-medium">
              {currentZoom}%
            </div>

            {/* Zoom In */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => zoomIn()}
              className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] rounded-full"
              title="Zoom In"
            >
              <Plus className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-[#3A3A3A] mx-2" />

            <Button
              variant="ghost"
              size="sm"
              onClick={handleFullscreen}
              className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] rounded-full"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetView}
              className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] rounded-full"
              title="Fit View (100% + Center)"
            >
              <Maximize className="w-4 h-4" />
            </Button>

            {/* Lock/Unlock */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLockToggle}
              className={`h-9 w-9 p-0 hover:bg-[#3A3A3A] rounded-full ${
                ui.isLocked ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-300 hover:text-white'
              }`}
              title={ui.isLocked ? 'Unlock Canvas' : 'Lock Canvas'}
            >
              {ui.isLocked ? (
                <Lock className="w-4 h-4" />
              ) : (
                <Unlock className="w-4 h-4" />
              )}
            </Button>
          </div>
        </Panel>
        )}

        {ui.showDebugPanel && (
          <Panel position="top-right" style={{ top: '50%', right: '16px', transform: 'translateY(-50%)' }}>
            <div className="flex flex-col gap-1 bg-[#2A2A2A]/95 backdrop-blur-sm border border-[#3A3A3A] rounded-lg p-2 shadow-xl">
              {/* Zoom In */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => zoomIn()}
                className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] rounded"
                title="Zoom In"
              >
                <Plus className="w-4 h-4" />
              </Button>

              {/* Fit View */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetView}
                className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] rounded"
                title="Fit View (100% + Center)"
              >
                <Maximize className="w-4 h-4" />
              </Button>

              {/* Zoom Out */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => zoomOut()}
                className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-[#3A3A3A] rounded"
                title="Zoom Out"
              >
                <Minus className="w-4 h-4" />
              </Button>

              {/* Lock/Unlock */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLockToggle}
                className={`h-9 w-9 p-0 hover:bg-[#3A3A3A] rounded ${
                  ui.isLocked ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-300 hover:text-white'
                }`}
                title={ui.isLocked ? 'Unlock Canvas' : 'Lock Canvas'}
              >
                {ui.isLocked ? (
                  <Lock className="w-4 h-4" />
                ) : (
                  <Unlock className="w-4 h-4" />
                )}
              </Button>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}

export const WorkflowCanvas: React.FC = () => {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasContent />
    </ReactFlowProvider>
  )
}

function createPaletteNode(
  componentId: string,
  component: { label: string; icon: any; color?: string; showLeftHandle?: boolean },
  position: { x: number; y: number }
): Node | null {
  const id = uuidv4()
  const baseData = {
    label: component.label,
    icon: component.icon,
    color: component.color,
    showLeftHandle: component.showLeftHandle
  }

  switch (componentId) {
    case 'ai':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'ai',
          showTools: true,
          toolCount: 0,
          ...aiDefaultConfig
        },
        selected: false
      }
    case 'note':
      return {
        id,
        type: 'note',
        position,
        data: {
          noteText: '',
          backgroundColor: '#fef3c7',
          width: 200,
          height: 150
        },
        selected: false
      }
    case 'end':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'end'
        },
        selected: false
      }
    case 'condition':
      return {
        id,
        type: 'ifElse',
        position,
        data: {
          ...baseData,
          nodeType: 'branch',
          conditions: [
            { id: 'if-0', type: 'if', caseName: '', condition: '' },
            { id: 'else', type: 'else', caseName: '', condition: '' }
          ]
        },
        selected: false
      }
    case 'while':
      return {
        id,
        type: 'while',
        position,
        data: {
          ...baseData,
          nodeType: 'while',
          showTools: true,
          maxIterations: 10,
          conditionField: '',
          conditionOperator: '==',
          conditionValue: '',
          conditionMode: 'simple'
        },
        selected: false
      }
    case 'wait':
      return {
        id,
        type: 'wait',
        position,
        data: {
          ...baseData,
          nodeType: 'wait',
          waitMessage: 'Waiting for user input...'
        },
        selected: false
      }
    case 'data-sheets':
      return {
        id,
        type: 'dataSheets',
        position,
        data: {
          ...baseData,
          nodeType: 'dataSheets',
          sheetId: '',
          operation: 'read',
          outputVariable: 'sheetData'
        },
        selected: false
      }
    case 'sendgrid':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'sendgrid',
          toEmail: '',
          fromEmail: '',
          fromName: '',
          subject: '',
          bodyTemplate: '{{context.aiResponse}}',
        },
        selected: false
      }
    case 'source':
    case 'mcp':
    case 'web-search':
    case 'function-calling':
    case 'subworkflow':
      return {
        id,
        type: 'tool',
        position,
        data: {
          ...baseData,
          toolType:
            componentId === 'source'
              ? 'source'
              : componentId === 'mcp'
                ? 'mcp'
                : componentId === 'web-search'
                  ? 'webSearch'
                  : componentId === 'subworkflow'
                    ? 'subworkflow'
                    : 'functionCalling'
        },
        selected: false
      }
    case 'webhook':
      return {
        id,
        type: 'api',
        position,
        data: {
          ...baseData,
          nodeType: 'api'
        },
        selected: false
      }
    case 'chat-widget':
    case 'slack':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'chatWidget',
          showLeftHandle: false
        },
        selected: false
      }
    case 'telegram':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'telegram',
          botToken: '',
          chatId: '',
        },
        selected: false
      }
    case 'sms_infobip':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'sms_infobip',
          recipient: '',
          message: '{{context.aiResponse}}',
        },
        selected: false
      }
    case 'schedule':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'schedule',
          showLeftHandle: false
        },
        selected: false
      }
    case 'app-start':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'app',
          showLeftHandle: false
        },
        selected: false
      }
    case 'telegram-start':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'telegram',
          showLeftHandle: false
        },
        selected: false
      }
    case 'subworkflow-start':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'subworkflow',
          showLeftHandle: false,
          toolName: '',
          toolDescription: '',
          inputs: [],
        },
        selected: false
      }
    case 'pstn-start':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'start',
          triggerType: 'pstn',
          callDirection: 'inbound',
          showLeftHandle: false,
          greeting: '',
          language: 'de-CH',
          voiceName: 'de-CH-LeniNeural',
          endCallPhrase: 'goodbye',
          maxSilenceSeconds: 2,
          noResponseMessage: '',
          goodbyeMessage: '',
        },
        selected: false
      }
    case 'pstn':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'pstn',
          targetPhoneNumber: '',
          greeting: '',
          language: 'de-CH',
          voiceName: 'de-CH-LeniNeural',
          maxDurationMinutes: 10,
          callScript: '',
        },
        selected: false
      }
    case 'imap':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'imap',
          action: 'read',
          folder: 'INBOX',
          onlyUnseen: true,
          maxEmails: 10
        },
        selected: false
      }
    case 'smtp':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'smtp',
          mode: 'send',
          to: '',
          subject: '',
          body: '{{context.aiResponse}}'
        },
        selected: false
      }
    case 'httpRequest':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'httpRequest',
          method: 'GET',
          url: '',
          authType: 'none',
          headers: [],
          bodyType: 'json',
          body: '',
          timeout: 30
        },
        selected: false
      }
    case 'store':
      return {
        id,
        type: 'custom',
        position,
        data: {
          ...baseData,
          nodeType: 'store',
          content: '',
          documentIdMode: 'auto',
          documentIdTemplate: '',
          customMetadata: [],
        },
        selected: false
      }
    default:
      return {
        id,
        type: 'custom',
        position,
        data: baseData,
        selected: false
      }
  }
}

function customizeEdges(edges: Edge[], nodes: Node[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))

  return edges.map((edge) => {
    const isLoopEdge = edge.sourceHandle === 'loop' || edge.type === 'loopEdge' || edge.data?.isLoopEdge

    if (isLoopEdge) {
      return {
        ...edge,
        type: 'loopEdge',
        animated: false,
        markerEnd: undefined,
        markerStart: undefined,
        interactionWidth: 60,
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
        interactionWidth: 60,
        style: edge.selected
          ? { stroke: '#10b981', strokeWidth: 2.5 }
          : (edge.sourceHandle === 'miniapps' ? { stroke: '#a855f7' } : undefined)
      }
    }

    return {
      ...edge,
      type: 'default',
      animated: edge.animated ?? false,
      interactionWidth: 60,
      style: edge.selected
        ? { stroke: '#10b981', strokeWidth: 2.5 }
        : (edge.style || { stroke: '#666', strokeWidth: 2 })
    }
  })
}
