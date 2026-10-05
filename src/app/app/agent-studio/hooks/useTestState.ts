import { useState, useCallback } from 'react'

export interface TestResult {
  id: string
  timestamp: number
  nodeId: string
  nodeName: string
  status: 'success' | 'error' | 'pending' | 'running'
  input?: any
  output?: any
  error?: string
  duration?: number
}

export interface ExecutionState {
  isRunning: boolean
  currentNodeId: string | null
  results: TestResult[]
  errors: string[]
  logs: string[]
}

export const useTestState = () => {
  const [testMode, setTestMode] = useState(false)
  const [testInput, setTestInput] = useState<string>('')
  const [testOutput, setTestOutput] = useState<string>('')
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [testError, setTestError] = useState<string | null>(null)

  const [isExecuting, setIsExecuting] = useState(false)
  const [executingNodeId, setExecutingNodeId] = useState<string | null>(null)
  const [executionPath, setExecutionPath] = useState<string[]>([])
  const [executionErrors, setExecutionErrors] = useState<string[]>([])
  const [executionLogs, setExecutionLogs] = useState<string[]>([])

  const [apiTestUrl, setApiTestUrl] = useState<string>('')
  const [apiTestMethod, setApiTestMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('POST')
  const [apiTestHeaders, setApiTestHeaders] = useState<Record<string, string>>({})
  const [apiTestBody, setApiTestBody] = useState<string>('')
  const [apiTestResponse, setApiTestResponse] = useState<any>(null)
  const [apiTestStatus, setApiTestStatus] = useState<number | null>(null)

  const [debugMode, setDebugMode] = useState(false)
  const [breakpoints, setBreakpoints] = useState<string[]>([])
  const [currentBreakpoint, setCurrentBreakpoint] = useState<string | null>(null)
  const [variableInspector, setVariableInspector] = useState<Record<string, any>>({})

  const startTest = useCallback((input?: string) => {
    setTestMode(true)
    setTestInput(input || '')
    setTestOutput('')
    setTestResults([])
    setTestError(null)
    setIsExecuting(true)
    setExecutionErrors([])
    setExecutionLogs([])
  }, [])

  const stopTest = useCallback(() => {
    setTestMode(false)
    setIsExecuting(false)
    setExecutingNodeId(null)
    setExecutionPath([])
  }, [])

  const addTestResult = useCallback((result: TestResult) => {
    setTestResults(prev => [...prev, result])

    if (result.status === 'error') {
      setTestError(result.error || 'Unknown error')
      setExecutionErrors(prev => [...prev, result.error || 'Unknown error'])
    }

    if (result.status === 'success' && result.output) {
      setTestOutput(JSON.stringify(result.output, null, 2))
    }
  }, [])

  const startNodeExecution = useCallback((nodeId: string) => {
    setExecutingNodeId(nodeId)
    setExecutionPath(prev => [...prev, nodeId])

    const result: TestResult = {
      id: `${nodeId}-${Date.now()}`,
      timestamp: Date.now(),
      nodeId,
      nodeName: nodeId,
      status: 'running'
    }

    addTestResult(result)
  }, [addTestResult])

  const completeNodeExecution = useCallback((nodeId: string, output?: any, error?: string) => {
    const existingResult = testResults.find(r => r.nodeId === nodeId && r.status === 'running')

    if (existingResult) {
      const updatedResult: TestResult = {
        ...existingResult,
        status: error ? 'error' : 'success',
        output,
        error,
        duration: Date.now() - existingResult.timestamp
      }

      setTestResults(prev =>
        prev.map(r => r.id === existingResult.id ? updatedResult : r)
      )
    }

    setExecutingNodeId(null)
  }, [testResults])

  const runApiTest = useCallback(async () => {
    try {
      const response = await fetch(apiTestUrl, {
        method: apiTestMethod,
        headers: apiTestHeaders,
        body: apiTestMethod !== 'GET' ? apiTestBody : undefined
      })

      const data = await response.json()
      setApiTestResponse(data)
      setApiTestStatus(response.status)

      return { success: true, data, status: response.status }
    } catch (error) {
      setApiTestResponse({ error: error instanceof Error ? error.message : 'Unknown error' })
      setApiTestStatus(500)

      return { success: false, error }
    }
  }, [apiTestUrl, apiTestMethod, apiTestHeaders, apiTestBody])

  const toggleBreakpoint = useCallback((nodeId: string) => {
    setBreakpoints(prev =>
      prev.includes(nodeId)
        ? prev.filter(id => id !== nodeId)
        : [...prev, nodeId]
    )
  }, [])

  const continueFromBreakpoint = useCallback(() => {
    setCurrentBreakpoint(null)
  }, [])

  const updateVariableInspector = useCallback((variables: Record<string, any>) => {
    setVariableInspector(prev => ({ ...prev, ...variables }))
  }, [])

  const resetTestState = useCallback(() => {
    setTestMode(false)
    setTestInput('')
    setTestOutput('')
    setTestResults([])
    setTestError(null)
    setIsExecuting(false)
    setExecutingNodeId(null)
    setExecutionPath([])
    setExecutionErrors([])
    setExecutionLogs([])
    setDebugMode(false)
    setBreakpoints([])
    setCurrentBreakpoint(null)
    setVariableInspector({})
  }, [])

  const addLog = useCallback((log: string) => {
    setExecutionLogs(prev => [...prev, `[${new Date().toISOString()}] ${log}`])
  }, [])

  return {
    testMode,
    testInput,
    testOutput,
    testResults,
    testError,
    setTestMode,
    setTestInput,
    setTestOutput,
    setTestResults,
    setTestError,

    isExecuting,
    executingNodeId,
    executionPath,
    executionErrors,
    executionLogs,
    setIsExecuting,
    setExecutingNodeId,
    setExecutionPath,

    apiTestUrl,
    apiTestMethod,
    apiTestHeaders,
    apiTestBody,
    apiTestResponse,
    apiTestStatus,
    setApiTestUrl,
    setApiTestMethod,
    setApiTestHeaders,
    setApiTestBody,
    runApiTest,

    debugMode,
    breakpoints,
    currentBreakpoint,
    variableInspector,
    setDebugMode,
    toggleBreakpoint,
    continueFromBreakpoint,
    updateVariableInspector,

    startTest,
    stopTest,
    addTestResult,
    startNodeExecution,
    completeNodeExecution,
    resetTestState,
    addLog
  }
}