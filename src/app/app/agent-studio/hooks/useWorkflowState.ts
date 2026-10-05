import { useState, useCallback } from 'react'
import {
  Node,
  Edge,
  ReactFlowInstance,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges
} from 'reactflow'
import { v4 as uuidv4 } from 'uuid'

export const useWorkflowState = (initialNodes: Node[] = [], initialEdges: Edge[] = []) => {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)

  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)

  const [copiedNodes, setCopiedNodes] = useState<Node[]>([])
  const [copiedEdges, setCopiedEdges] = useState<Edge[]>([])
  const [pasteCount, setPasteCount] = useState<number>(0)

  const [history, setHistory] = useState<Array<{ nodes: Node[]; edges: Edge[] }>>(() => [
    {
      nodes: cloneState(initialNodes),
      edges: cloneState(initialEdges)
    }
  ])
  const [historyIndex, setHistoryIndex] = useState<number>(0)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)

  //

  const resetHistory = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
    setHistory([{ nodes: cloneState(nextNodes), edges: cloneState(nextEdges) }])
    setHistoryIndex(0)
  }, [])

  const saveToHistory = useCallback(
    (nextNodes?: Node[], nextEdges?: Edge[]) => {
      setHistory(prev => {
        const truncated = prev.slice(0, historyIndex + 1)
        const snapshot = {
          nodes: cloneState(nextNodes ?? nodes),
          edges: cloneState(nextEdges ?? edges)
        }
        const updated = [...truncated, snapshot]
        setHistoryIndex(updated.length - 1)
        return updated
      })
    },
    [nodes, edges, historyIndex]
  )

  const undo = useCallback(() => {
    setHistoryIndex(prevIndex => {
      if (prevIndex <= 0) return prevIndex
      const newIndex = prevIndex - 1
      const snapshot = history[newIndex]
      setNodes(cloneState(snapshot.nodes))
      setEdges(cloneState(snapshot.edges))
      return newIndex
    })
  }, [history])

  const redo = useCallback(() => {
    setHistoryIndex(prevIndex => {
      if (prevIndex >= history.length - 1) return prevIndex
      const newIndex = prevIndex + 1
      const snapshot = history[newIndex]
      setNodes(cloneState(snapshot.nodes))
      setEdges(cloneState(snapshot.edges))
      return newIndex
    })
  }, [history])

  const addNode = useCallback((node: Node) => {
    setNodes(prev => {
      const updated = [...prev, node]
      saveToHistory(updated, edges)
      return updated
    })
  }, [edges, saveToHistory])

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(prevNodes => {
      const updatedNodes = prevNodes.filter(n => n.id !== nodeId)
      setEdges(prevEdges => {
        const updatedEdges = prevEdges.filter(
          e => e.source !== nodeId && e.target !== nodeId
        )
        saveToHistory(updatedNodes, updatedEdges)
        return updatedEdges
      })
      return updatedNodes
    })
  }, [saveToHistory])

  const updateNode = useCallback((nodeId: string, data: any) => {
    setNodes(prev => {
      const updated = prev.map(node =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
      )
      saveToHistory(updated, edges)
      return updated
    })
  }, [edges, saveToHistory])

  const addEdge = useCallback((edge: Edge) => {
    setEdges(prev => {
      const updated = [...prev, edge]
      saveToHistory(nodes, updated)
      return updated
    })
  }, [nodes, saveToHistory])

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges(prev => {
      const updated = prev.filter(e => e.id !== edgeId)
      saveToHistory(nodes, updated)
      return updated
    })
  }, [nodes, saveToHistory])

  const copySelection = useCallback(() => {
    const selectedNodes = nodes.filter(n => n.selected)
    const selectedNodeIds = selectedNodes.map(n => n.id)
    const selectedEdges = edges.filter(e =>
      selectedNodeIds.includes(e.source) && selectedNodeIds.includes(e.target)
    )

    setCopiedNodes(selectedNodes)
    setCopiedEdges(selectedEdges)
    setPasteCount(0)
  }, [nodes, edges])

  const paste = useCallback(() => {
    if (copiedNodes.length === 0) return

    const offset = 50 + (pasteCount * 20)
    const idMap = new Map<string, string>()

    const newNodes = copiedNodes.map(node => {
      const newId = uuidv4()
      idMap.set(node.id, newId)
      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + offset,
          y: node.position.y + offset
        },
        selected: true
      }
    })

    const newEdges = copiedEdges.map(edge => ({
      ...edge,
      id: uuidv4(),
      source: idMap.get(edge.source) || edge.source,
      target: idMap.get(edge.target) || edge.target,
      selected: true
    }))

    setNodes(prev => [
      ...prev.map(node => ({ ...node, selected: false })),
      ...newNodes
    ])

    setEdges(prev => [
      ...prev.map(edge => ({ ...edge, selected: false })),
      ...newEdges
    ])

    setPasteCount(prev => prev + 1)

    const allNodes = [...nodes.map(n => ({ ...n, selected: false })), ...newNodes]
    const allEdges = [...edges.map(e => ({ ...e, selected: false })), ...newEdges]
    saveToHistory(allNodes, allEdges)
  }, [copiedNodes, copiedEdges, pasteCount, nodes, edges, saveToHistory])

  const selectAll = useCallback(() => {
    setNodes(prev => {
      const updated = prev.map(node => ({ ...node, selected: true }))
      saveToHistory(updated, edges)
      return updated
    })
  }, [edges, saveToHistory])

  const deselectAll = useCallback(() => {
    setNodes(prev => {
      const updated = prev.map(node => ({ ...node, selected: false }))
      saveToHistory(updated, edges)
      return updated
    })
    setSelectedNode(null)
    setSelectedEdge(null)
  }, [edges, saveToHistory])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes(nds => applyNodeChanges(changes, nds))
    },
    []
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges(eds => applyEdgeChanges(changes, eds))
    },
    []
  )

  return {
    nodes,
    edges,
    selectedNode,
    selectedEdge,
    copiedNodes,
    copiedEdges,
    history,
    historyIndex,
    reactFlowInstance,

    setNodes,
    setEdges,
    setSelectedNode,
    setSelectedEdge,
    setReactFlowInstance,
    onNodesChange,
    onEdgesChange,

    addNode,
    deleteNode,
    updateNode,
    addEdge,
    deleteEdge,
    copySelection,
    paste,
    selectAll,
    deselectAll,
    undo,
    redo,
    saveToHistory,
    resetHistory
  }
}

function cloneState<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneState(item)) as unknown as T
  }

  if (value && typeof value === 'object') {
    const cloned: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const current = (value as Record<string, unknown>)[key]
      cloned[key] =
        typeof current === 'function' || typeof current === 'symbol'
          ? current
          : cloneState(current as any)
    }
    return cloned as T
  }

  return value
}
