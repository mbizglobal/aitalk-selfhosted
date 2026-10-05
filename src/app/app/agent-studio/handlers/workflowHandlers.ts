import { Node, Edge } from 'reactflow'
import { evaluateWhileCondition } from '../utils/conditionEvaluator'

export interface WorkflowExecutionContext {
  nodes: Node[]
  edges: Edge[]
  variables: Record<string, any>
  testMode: boolean
  onNodeStart?: (nodeId: string) => void
  onNodeComplete?: (nodeId: string, output: any) => void
  onNodeError?: (nodeId: string, error: string) => void
  onLog?: (message: string) => void
}

export const createWorkflowHandlers = (context: WorkflowExecutionContext) => {
  const { nodes, edges, variables, testMode, onNodeStart, onNodeComplete, onNodeError, onLog } = context

  const executeWorkflow = async (startNodeId?: string) => {
    try {
      onLog?.('워크플로우 실행 시작')

      const startNode = startNodeId
        ? nodes.find(n => n.id === startNodeId)
        : nodes.find(n => n.type === 'start')

      if (!startNode) {
        throw new Error('시작 노드를 찾을 수 없습니다')
      }

      const executionContext = {
        variables: { ...variables },
        results: new Map<string, any>()
      }

      const executionOrder = calculateExecutionOrder(startNode.id, nodes, edges)

      for (const nodeId of executionOrder) {
        const node = nodes.find(n => n.id === nodeId)
        if (!node) continue

        onNodeStart?.(nodeId)
        onLog?.(`노드 실행 중: ${node.data.label || node.type}`)

        try {
          const result = await executeNode(node, executionContext)
          executionContext.results.set(nodeId, result)
          onNodeComplete?.(nodeId, result)
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류'
          onNodeError?.(nodeId, errorMsg)

          if (!testMode) {
            throw error
          }
        }
      }

      onLog?.('워크플로우 실행 완료')
      return executionContext.results
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '워크플로우 실행 실패'
      onLog?.(`오류: ${errorMsg}`)
      throw error
    }
  }

  const calculateExecutionOrder = (startNodeId: string, nodes: Node[], edges: Edge[]): string[] => {
    const visited = new Set<string>()
    const order: string[] = []

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)

      const outgoingEdges = edges.filter(e => e.source === nodeId)

      for (const edge of outgoingEdges) {
        visit(edge.target)
      }

      order.push(nodeId)
    }

    visit(startNodeId)
    return order.reverse()
  }

  const executeNode = async (node: Node, context: any): Promise<any> => {
    switch (node.type) {
      case 'start':
        return executeStartNode(node, context)
      case 'llm':
        return executeLLMNode(node, context)
      case 'tool':
        return executeToolNode(node, context)
      case 'http':
        return executeHTTPNode(node, context)
      case 'branch':
        return executeBranchNode(node, context)
      case 'loop':
        return executeLoopNode(node, context)
      case 'while':
        return executeWhileNode(node, context)
      case 'code':
        return executeCodeNode(node, context)
      case 'end':
        return executeEndNode(node, context)
      default:
        throw new Error(`알 수 없는 노드 타입: ${node.type}`)
    }
  }

  const executeStartNode = async (node: Node, context: any) => {
    return {
      type: 'start',
      timestamp: Date.now(),
      variables: context.variables
    }
  }

  const executeLLMNode = async (node: Node, context: any) => {
    const { model, systemMessage, temperature, maxTokens } = node.data

    if (testMode) {
      return {
        type: 'llm',
        response: `[TEST] AI 응답 (model: ${model})`,
        model,
        tokens: 100
      }
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: context.variables.input || '' }
          ],
          temperature,
          max_tokens: maxTokens
        })
      })

      const data = await response.json()
      return {
        type: 'llm',
        response: data.content,
        model,
        tokens: data.usage?.total_tokens
      }
    } catch (error) {
      throw new Error(`LLM 호출 실패: ${error}`)
    }
  }

  const executeToolNode = async (node: Node, context: any) => {
    const { toolType, toolName, parameters } = node.data

    if (testMode) {
      return {
        type: 'tool',
        tool: toolName,
        result: `[TEST] Tool 실행 결과 (${toolName})`
      }
    }

    return {
      type: 'tool',
      tool: toolName,
      result: 'Tool execution result'
    }
  }

  const executeHTTPNode = async (node: Node, context: any) => {
    const { url, method, headers, body } = node.data

    if (testMode) {
      return {
        type: 'http',
        status: 200,
        response: { test: true, method, url }
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(body) : undefined
      })

      const data = await response.json()
      return {
        type: 'http',
        status: response.status,
        response: data
      }
    } catch (error) {
      throw new Error(`HTTP 요청 실패: ${error}`)
    }
  }

  const executeBranchNode = async (node: Node, context: any) => {
    const { condition, operator, value } = node.data
    const leftValue = context.variables[condition]

    let result = false
    switch (operator) {
      case '==':
        result = leftValue == value
        break
      case '!=':
        result = leftValue != value
        break
      case '>':
        result = leftValue > value
        break
      case '<':
        result = leftValue < value
        break
      case '>=':
        result = leftValue >= value
        break
      case '<=':
        result = leftValue <= value
        break
      case 'contains':
        result = String(leftValue).includes(String(value))
        break
      case 'startsWith':
        result = String(leftValue).startsWith(String(value))
        break
      case 'endsWith':
        result = String(leftValue).endsWith(String(value))
        break
    }

    return {
      type: 'branch',
      condition: `${condition} ${operator} ${value}`,
      result
    }
  }

  const executeLoopNode = async (node: Node, context: any) => {
    const { loopType, iterations, collection } = node.data
    const results = []

    if (loopType === 'for') {
      for (let i = 0; i < iterations; i++) {
        context.variables.loopIndex = i
        results.push({ iteration: i })
      }
    } else if (loopType === 'forEach') {
      for (let i = 0; i < collection.length; i++) {
        context.variables.loopIndex = i
        context.variables.loopItem = collection[i]
        results.push({ iteration: i, item: collection[i] })
      }
    }

    return {
      type: 'loop',
      loopType,
      iterations: results.length,
      results
    }
  }

  const executeWhileNode = async (node: Node, context: any) => {
    const maxIterations = node.data.maxIterations || 10
    const iterations: any[] = []
    let currentIteration = 0

    onLog?.(`While 루프 시작 (최대 ${maxIterations}회)`)

    while (currentIteration < maxIterations) {
      const conditionResult = evaluateWhileCondition(context.variables, node.data)

      onLog?.(
        `반복 ${currentIteration + 1}: 조건 = ${conditionResult ? 'TRUE (계속)' : 'FALSE (종료)'}`
      )

      if (!conditionResult) {
        onLog?.('While 조건이 false가 되어 루프 종료')
        break
      }

      const loopEdges = edges.filter(
        (e) => e.source === node.id && e.sourceHandle === 'loop'
      )

      if (loopEdges.length > 0) {
        const loopTargetNodeId = loopEdges[0].target
        const loopTargetNode = nodes.find((n) => n.id === loopTargetNodeId)

        if (loopTargetNode) {
          onLog?.(`  루프 내부 노드 실행: ${loopTargetNode.data.label || loopTargetNode.type}`)
          try {
            const result = await executeNode(loopTargetNode, context)

            if (result && typeof result === 'object') {
              Object.assign(context.variables, result)
            }

            iterations.push({
              iteration: currentIteration,
              result
            })
          } catch (error) {
            onLog?.(`  루프 내부 노드 실행 오류: ${error}`)
            if (!testMode) {
              throw error
            }
          }
        }
      }

      currentIteration++
    }

    if (currentIteration >= maxIterations) {
      onLog?.(`최대 반복 횟수(${maxIterations})에 도달하여 루프 종료`)
    }

    return {
      type: 'while',
      totalIterations: currentIteration,
      maxIterations,
      iterations,
      terminatedBy: currentIteration >= maxIterations ? 'max-iterations' : 'condition'
    }
  }

  const executeCodeNode = async (node: Node, context: any) => {
    const { language, code } = node.data

    if (testMode) {
      return {
        type: 'code',
        language,
        result: '[TEST] Code execution result'
      }
    }

    try {
      if (language === 'javascript') {
        // eslint-disable-next-line no-new-func
        const func = new Function('context', code)
        const result = func(context)
        return {
          type: 'code',
          language,
          result
        }
      }

      throw new Error(`지원하지 않는 언어: ${language}`)
    } catch (error) {
      throw new Error(`코드 실행 실패: ${error}`)
    }
  }

  const executeEndNode = async (node: Node, context: any) => {
    const { output, status } = node.data

    return {
      type: 'end',
      output: context.variables[output] || output,
      status,
      timestamp: Date.now()
    }
  }

  const validateWorkflow = (): { valid: boolean; errors: string[] } => {
    const errors: string[] = []

    const startNodes = nodes.filter(n => n.type === 'start')
    if (startNodes.length === 0) {
      errors.push('시작 노드가 없습니다')
    } else if (startNodes.length > 1) {
      errors.push('시작 노드가 여러 개입니다')
    }

    const endNodes = nodes.filter(n => n.type === 'end')
    if (endNodes.length === 0) {
      errors.push('종료 노드가 없습니다')
    }

    for (const node of nodes) {
      if (node.type === 'start') continue

      const incomingEdges = edges.filter(e => e.target === node.id)
      if (incomingEdges.length === 0) {
        errors.push(`"${node.data.label || node.id}" 노드가 연결되지 않았습니다`)
      }
    }

    if (hasCycles()) {
      errors.push('워크플로우에 순환 참조가 있습니다')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  const hasCycles = (): boolean => {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const hasCycleDFS = (nodeId: string): boolean => {
      visited.add(nodeId)
      recursionStack.add(nodeId)

      const outgoingEdges = edges.filter(e => e.source === nodeId)
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.target)) {
          if (hasCycleDFS(edge.target)) {
            return true
          }
        } else if (recursionStack.has(edge.target)) {
          return true
        }
      }

      recursionStack.delete(nodeId)
      return false
    }

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        if (hasCycleDFS(node.id)) {
          return true
        }
      }
    }

    return false
  }

  return {
    executeWorkflow,
    validateWorkflow,
    executeNode,
    calculateExecutionOrder
  }
}