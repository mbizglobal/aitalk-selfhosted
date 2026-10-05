import type { MouseEvent, MutableRefObject } from 'react'
import { Node, Edge, Connection } from 'reactflow'
import { v4 as uuidv4 } from 'uuid'
import { getNodeSize, findNonOverlappingPosition } from '../utils'

export const createNodeHandlers = (
  nodes: Node[],
  edges: Edge[],
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void,
  setEdges: (edges: Edge[] | ((edges: Edge[]) => Edge[])) => void,
  saveToHistory: (nextNodes?: Node[], nextEdges?: Edge[]) => void,
  setSelectedNode: (nodeId: string | null) => void,
  setSelectedEdge: (edgeId: string | null) => void,
  dragStateRef?: MutableRefObject<{ isDragging: boolean; startPosition: { x: number; y: number } | null; didMove: boolean }>
) => {
  const setDragState = (isDragging: boolean, startPosition?: { x: number; y: number } | null, didMove?: boolean) => {
    if (dragStateRef) {
      dragStateRef.current = {
        isDragging,
        startPosition: startPosition !== undefined ? startPosition : dragStateRef.current.startPosition,
        didMove: didMove !== undefined ? didMove : dragStateRef.current.didMove
      }
    }
  }

  const getDragState = () => dragStateRef?.current ?? { isDragging: false, startPosition: null, didMove: false }

  const isValidConnection = (connection: Connection) => {
    if (connection.sourceHandle === 'tools') {
      const targetNode = nodes.find(n => n.id === connection.target)
      if (targetNode?.type === 'tool' && targetNode?.data?.nodeType === 'miniapp') {
        return false
      }
    }

    if (connection.sourceHandle === 'miniapps') {
      const targetNode = nodes.find(n => n.id === connection.target)
      if (!(targetNode?.type === 'tool' && targetNode?.data?.nodeType === 'miniapp')) {
        return false
      }
      const sourceAlreadyHasMiniApp = edges.some(
        edge => edge.source === connection.source && edge.sourceHandle === 'miniapps'
      )
      if (sourceAlreadyHasMiniApp) {
        return false
      }
    }

    if (connection.sourceHandle === 'tools' || connection.sourceHandle === 'miniapps') {
      const targetAlreadyConnected = edges.some(
        edge =>
          edge.target === connection.target &&
          (edge.sourceHandle === 'tools' || edge.sourceHandle === 'miniapps') &&
          edge.source !== connection.source
      )

      if (targetAlreadyConnected) {
        return false
      }
    }

    if (connection.source && connection.sourceHandle) {
      const sourceNode = nodes.find(n => n.id === connection.source)
      if (sourceNode?.type === 'ifElse') {
        const handleAlreadyConnected = edges.some(
          edge =>
            edge.source === connection.source &&
            edge.sourceHandle === connection.sourceHandle
        )

        if (handleAlreadyConnected) {
          return false
        }
      }
    }

    return true
  }

  const onConnect = (params: Connection) => {
    if (!isValidConnection(params)) {
      return
    }
    const isToolEdge = params.sourceHandle === 'tools' || params.sourceHandle === 'miniapps'

    let targetHandle = params.targetHandle
    if (params.source && params.target) {
      const sourceNode = nodes.find(n => n.id === params.source)
      const targetNode = nodes.find(n => n.id === params.target)

      if (sourceNode?.type === 'ifElse' &&
          targetNode?.type === 'continue' &&
          targetNode?.data?.isLoopTool) {
        targetHandle = 'bottom'
      }
    }

    const newEdge: Edge = {
      id: uuidv4(),
      source: params.source!,
      target: params.target!,
      sourceHandle: params.sourceHandle || undefined,
      targetHandle: targetHandle || undefined,
      type: 'default',
      className: isToolEdge ? 'tool-edge-no-arrow' : undefined,
      style: isToolEdge
        ? { stroke: '#666', strokeWidth: 2, strokeDasharray: '5, 5' }
        : { stroke: '#666', strokeWidth: 2 },
      markerEnd: isToolEdge ? undefined : { type: 'arrowclosed', color: '#666' }
    }

    setEdges((eds) => [...eds, newEdge])
    saveToHistory(nodes, [...edges, newEdge])
  }

  const onNodeDragStart = (event: MouseEvent, node: Node) => {
    setDragState(true, { x: node.position.x, y: node.position.y }, false)
  }

  const onNodeClick = (event: MouseEvent, node: Node) => {
    const dragState = getDragState()

    if (dragState.didMove) {
      setDragState(false, null, false)
      return
    }

    setNodes((nodes) =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === node.id
      }))
    )
    setSelectedNode(node.id)
  }

  const onNodesDelete = (nodesToDelete: Node[]) => {
    const nodeIds = nodesToDelete.map((n) => n.id)

    setEdges((eds) =>
      eds.filter(
        (edge) => !nodeIds.includes(edge.source) && !nodeIds.includes(edge.target)
      )
    )
    setSelectedNode(null)
    saveToHistory()
  }

  const onEdgesDelete = (edgesToDelete: Edge[]) => {
    if (edgesToDelete.length) {
      setSelectedEdge(null)
    }
    saveToHistory()
  }

  const onNodeDragStop = (event: MouseEvent, node: Node) => {
    const dragState = getDragState()
    const startPos = dragState.startPosition

    const didActuallyMove = startPos && (
      Math.abs(node.position.x - startPos.x) > 5 ||
      Math.abs(node.position.y - startPos.y) > 5
    )

    setDragState(false, null, !!didActuallyMove)
    setTimeout(() => {
      setDragState(false, null, false)
    }, 100)

    const overlapAllowed = 25

    const hasOverlap = nodes.some(otherNode => {
      if (otherNode.id === node.id) return false

      const size1 = getNodeSize(node)
      const size2 = getNodeSize(otherNode)

      const box1 = {
        x1: node.position.x + overlapAllowed,
        y1: node.position.y + overlapAllowed,
        x2: node.position.x + size1.width - overlapAllowed,
        y2: node.position.y + size1.height - overlapAllowed
      }

      const box2 = {
        x1: otherNode.position.x + overlapAllowed,
        y1: otherNode.position.y + overlapAllowed,
        x2: otherNode.position.x + size2.width - overlapAllowed,
        y2: otherNode.position.y + size2.height - overlapAllowed
      }

      return !(box1.x2 <= box2.x1 || box1.x1 >= box2.x2 || box1.y2 <= box2.y1 || box1.y1 >= box2.y2)
    })

    if (hasOverlap) {
      const newPosition = findNonOverlappingPosition(
        node.position.x,
        node.position.y,
        node.id,
        nodes
      )

      setNodes((nds) => {
        const updated = nds.map((n) => {
          if (n.id === node.id) {
            return {
              ...n,
              position: newPosition
            }
          }
          return n
        })
        saveToHistory(updated, edges)
        return updated
      })
    } else {
      saveToHistory(nodes, edges)
    }
  }

  const addNode = (type: string, position?: { x: number; y: number }) => {
    const defaultPosition = position || { x: 250, y: 250 }
    const id = uuidv4()

    const nodeData = getNodeDataByType(type)

    const newNode: Node = {
      id,
      type,
      position: defaultPosition,
      data: nodeData,
      selected: false
    }

    setNodes((nds) => [...nds, newNode])
    saveToHistory([...nodes, newNode], edges)

    return id
  }

  const duplicateNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    const newId = uuidv4()
    const newNode: Node = {
      ...node,
      id: newId,
      position: {
        x: node.position.x + 50,
        y: node.position.y + 50
      },
      selected: false
    }

    setNodes((nds) => [...nds, newNode])

    const connectedEdges = edges.filter(
      (e) => e.source === nodeId || e.target === nodeId
    )

    const newEdges = connectedEdges.map((edge) => ({
      ...edge,
      id: uuidv4(),
      source: edge.source === nodeId ? newId : edge.source,
      target: edge.target === nodeId ? newId : edge.target
    }))

    setEdges((eds) => [...eds, ...newEdges])
    saveToHistory([...nodes, newNode], [...edges, ...newEdges])
  }

  const updateNodeData = (nodeId: string, data: any) => {
    setNodes((nds) => {
      const updated =
      nds.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: { ...node.data, ...data }
          }
        }
        return node
      })
      saveToHistory(updated, edges)
      return updated
    })
  }

  const getNodeDataByType = (type: string) => {
    switch (type) {
      case 'start':
        return {
          label: 'Start',
          description: '워크플로우 시작점',
          variables: []
        }
      case 'llm':
        return {
          label: 'AI Agent',
          model: 'gpt-4o',
          systemMessage: '',
          temperature: 0.7,
          maxTokens: 2048
        }
      case 'tool':
        return {
          label: 'Tool',
          toolType: 'custom',
          toolName: '',
          parameters: {}
        }
      case 'http':
        return {
          label: 'HTTP Request',
          url: '',
          method: 'GET',
          headers: {},
          body: ''
        }
      case 'branch':
        return {
          label: 'If / else',
          nodeType: 'branch',
          conditions: [
            { id: 'if-0', type: 'if', caseName: '', condition: '' },
            { id: 'else', type: 'else', caseName: '', condition: '' }
          ]
        }
      case 'loop':
        return {
          label: 'Loop',
          loopType: 'for',
          iterations: 10,
          collection: []
        }
      case 'code':
        return {
          label: 'Code',
          language: 'javascript',
          code: '',
          inputs: [],
          outputs: []
        }
      case 'end':
        return {
          label: 'End',
          output: '',
          status: 'success'
        }
      default:
        return {
          label: type,
          description: ''
        }
    }
  }

  const selectAllNodes = () => {
    setNodes((nds) =>
      nds.map((node) => ({ ...node, selected: true }))
    )
  }

  const getSelectedNodes = () => {
    return nodes.filter((node) => node.selected)
  }

  const updateNodePosition = (nodeId: string, position: { x: number; y: number }) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return { ...node, position }
        }
        return node
      })
    )
  }

  const deleteNode = (nodeId: string) => {
    const nodeToDelete = nodes.find((n) => n.id === nodeId)
    if (nodeToDelete) {
      onNodesDelete([nodeToDelete])
      setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    }
  }

  return {
    isValidConnection,
    onConnect,
    onNodeClick,
    onNodeDragStart,
    onNodesDelete,
    onEdgesDelete,
    onNodeDragStop,
    addNode,
    duplicateNode,
    updateNodeData,
    selectAllNodes,
    getSelectedNodes,
    updateNodePosition,
    deleteNode,
    isDragging: () => getDragState().isDragging,
    didMove: () => getDragState().didMove
  }
}
