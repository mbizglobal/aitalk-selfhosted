import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { ChatMessage, ExpandedLogView, UploadedFile } from '../types'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import { convertPdfToImages, isPdfFile } from '@/lib/pdf-to-image'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

export interface ContextVariables {
  message?: string
  aiResponse?: string
  finalAnswer?: string
  jsonData?: any
  searchResults?: any[]
  whileResult?: any
  ifElseResult?: {
    matchedCondition: string
    matchedHandle: string | null
    conditionType: string
  }
  mcpResult?: any
  mcpTools?: Array<{ name: string; description: string }>
  vectorStoreId?: string
  sourceVectorStoreName?: string
  geminiFiles?: Array<{ fileId: string; fileName: string }>
  [key: string]: any
}

interface WorkflowData {
  nodes: any[]
  edges: any[]
}

function checkIsTelegramStart(workflow: WorkflowData | null): boolean {
  if (!workflow?.nodes) return false
  const startNode = workflow.nodes.find(
    (node: any) => node.data?.nodeType === 'start' || node.data?.showLeftHandle === false
  )
  return startNode?.data?.triggerType === 'telegram'
}

function checkIsPstnStart(workflow: WorkflowData | null): boolean {
  if (!workflow?.nodes) return false
  const startNode = workflow.nodes.find(
    (node: any) => node.data?.nodeType === 'start' || node.data?.showLeftHandle === false
  )
  return startNode?.data?.triggerType === 'pstn'
}

export function useWorkflowExecution(
  agentId: string | null,
  workflowId: string | null = null,
  currentWorkflow: WorkflowData | null = null,
  locale: string = 'en'
) {
  const t = getAgentStudioTranslation(locale)
  const isTelegramStart = checkIsTelegramStart(currentWorkflow)
  const isPstnStart = checkIsPstnStart(currentWorkflow)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [testMessage, setTestMessage] = useState('')
  const [executionLogs, setExecutionLogs] = useState<WorkflowDebugLogEntry[]>([])
  const [contextVariables, setContextVariables] = useState<ContextVariables>({})
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null)
  const [expandedLogView, setExpandedLogView] = useState<ExpandedLogView | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)

  const [currentRunningNode, setCurrentRunningNode] = useState<{
    nodeId: string
    nodeName: string
    nodeType: string
  } | null>(null)
  const [totalNodes, setTotalNodes] = useState<number>(0)

  const [isPaused, setIsPaused] = useState(false)
  const [pausedAtNodeId, setPausedAtNodeId] = useState<string | null>(null)
  const [pausedContext, setPausedContext] = useState<ContextVariables | null>(null)
  const [breakpointNodeIds, setBreakpointNodeIds] = useState<string[]>([])

  const clientIdRef = useRef<string>(`test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const updateBreakpointNodes = useCallback((nodeIds: string[]) => {
    setBreakpointNodeIds(nodeIds)
  }, [])

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = error => reject(error)
    })
  }, [])

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    setIsUploading(true)

    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) {
          toast.error(`${file.name}은(는) 크기가 너무 큽니다. (최대 20MB)`)
          continue
        }

        if (file.type.startsWith('image/')) {
          const base64 = await fileToBase64(file)
          const previewUrl = URL.createObjectURL(file)

          setUploadedFiles(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            name: file.name,
            type: 'image',
            base64: base64.split(',')[1],
            size: file.size,
            previewUrl
          }])
        }
        else if (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')) {
          const text = await file.text()

          setUploadedFiles(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            name: file.name,
            type: 'csv',
            text: text,
            size: file.size
          }])
        }
        else if (isPdfFile(file)) {
          try {
            const pdfImages = await convertPdfToImages(file, {
              scale: 2,
              maxPages: 10
            })

            for (const pdfImage of pdfImages) {
              setUploadedFiles(prev => [...prev, {
                id: Date.now().toString() + Math.random(),
                name: pdfImage.pageNumber === 1 ? file.name : `${file.name} (Page ${pdfImage.pageNumber})`,
                type: 'image',
                base64: pdfImage.base64,
                size: file.size / pdfImages.length,
                previewUrl: `data:image/jpeg;base64,${pdfImage.base64}`,
                isFirstPage: pdfImage.pageNumber === 1,
                totalPages: pdfImages.length
              }])
            }
          } catch (error) {
            console.error('PDF conversion error:', error)
            toast.error(`${file.name} PDF 변환에 실패했습니다.`)
          }
        }
        else {
          toast.error(`${file.name}은(는) 지원하지 않는 파일 형식입니다.`)
        }
      }
    } catch (error) {
      console.error('File upload error:', error)
      toast.error('파일 업로드 중 오류가 발생했습니다.')
    } finally {
      setIsUploading(false)
    }
  }, [fileToBase64])

  const removeFile = useCallback((fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  const removePdf = useCallback((fileName: string) => {
    setUploadedFiles(prev => prev.filter(f => {
      const baseName = f.name.replace(/\s*\(Page \d+\)$/, '')
      return baseName !== fileName
    }))
  }, [])

  const clearFiles = useCallback(() => {
    setUploadedFiles([])
  }, [])

  const handleExecuteWorkflow = useCallback(async (resumeFromBreakpoint = false, isScheduledTrigger = false) => {
    if (!resumeFromBreakpoint && !isScheduledTrigger) {
      if (!testMessage.trim()) {
        toast.error(t.please_enter_message)
        return
      }
    }

    if (!agentId) {
      toast.error(t.agent_id_not_found)
      return
    }

    setIsExecuting(true)
    setIsPaused(false)
    setPausedAtNodeId(null)

    if (!resumeFromBreakpoint) {
      setExecutionLogs([])
      setContextVariables({})
      setSelectedStepIndex(null)
      setExpandedLogView(null)
    }

    const userMessage = resumeFromBreakpoint ? '' : (isScheduledTrigger ? '[Scheduled Trigger]' : testMessage.trim())
    if (!resumeFromBreakpoint && !isScheduledTrigger) {
      setTestMessage('')
    }

    if (!resumeFromBreakpoint && userMessage) {
      const newUserMessage: ChatMessage = {
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      }
      setChatMessages(prev => [...prev, newUserMessage])
    }

    try {
      const requestBody: any = {
        message: userMessage,
        agentId: agentId,
        workflowId: workflowId,
        source: 'workflow-playground',
        clientId: clientIdRef.current,
        isScheduledTrigger,
        workflowJson: currentWorkflow ? JSON.stringify(currentWorkflow) : undefined,
        isTelegramTest: isTelegramStart,
        uploadedFiles: uploadedFiles.length > 0 ? uploadedFiles : undefined
      }

      if (breakpointNodeIds.length > 0) {
        requestBody.breakpointNodeIds = breakpointNodeIds
      }

      if (resumeFromBreakpoint && pausedContext) {
        requestBody.resumeFromBreakpoint = true
        requestBody.pausedContext = pausedContext
        requestBody.resumeFromNodeId = pausedAtNodeId
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        try {
          const errorData = await response.json()
          throw new Error(errorData.error || t.workflow_execution_failed)
        } catch (parseError) {
          if (parseError instanceof Error && parseError.message !== t.workflow_execution_failed) {
            throw parseError
          }
          throw new Error(t.workflow_execution_failed)
        }
      }

      if (!response.body) {
        throw new Error(t.workflow_execution_failed)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantMessage = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') break

          try {
            const parsed = JSON.parse(payload)

            if (parsed.type === 'debug-step-start') {
              setCurrentRunningNode({
                nodeId: parsed.nodeId,
                nodeName: parsed.nodeName,
                nodeType: parsed.nodeType
              })
              if (parsed.totalNodes) {
                setTotalNodes(parsed.totalNodes)
              }
              continue
            }

            if (parsed.type === 'debug-step' && parsed.log) {
              setExecutionLogs(prev => [...prev, parsed.log])
              setCurrentRunningNode(null)
              continue
            }

            if (parsed.type === 'debug-log' && Array.isArray(parsed.logs)) {
              setExecutionLogs(prev => prev.length > 0 ? prev : parsed.logs)
              if (parsed.context) {
                setContextVariables(parsed.context)
              }
              continue
            }

            if (parsed.type === 'paused') {
              setIsPaused(true)
              setPausedAtNodeId(parsed.nodeId)
              if (parsed.context) {
                setPausedContext(parsed.context)
                setContextVariables(parsed.context)
              }
              if (parsed.logs) {
                setExecutionLogs(parsed.logs)
              }
              setIsExecuting(false)
              return
            }

            if (parsed.type === 'error') {
              toast.error(parsed.error || t.workflow_execution_error)
              setChatMessages(prev => [
                ...prev,
                {
                  role: 'assistant',
                  content: `Error: ${parsed.error || 'Unknown error'}`,
                  timestamp: new Date().toISOString()
                }
              ])
              if (parsed.logs) {
                setExecutionLogs(parsed.logs)
              }
              setIsExecuting(false)
              return
            }

            if (parsed.type === 'debug-child' && parsed.child) {
              setExecutionLogs(prev => {
                const lastIndex = prev.length - 1
                if (lastIndex < 0) return prev

                const lastLog = prev[lastIndex]
                const updatedLog = {
                  ...lastLog,
                  children: [...(lastLog.children || []), parsed.child]
                }
                return [...prev.slice(0, lastIndex), updatedLog]
              })
              continue
            }

            if (parsed.content) {
              assistantMessage += parsed.content
              setChatMessages(prev => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, content: assistantMessage }]
                }
                return [
                  ...prev,
                  {
                    role: 'assistant',
                    content: assistantMessage,
                    timestamp: new Date().toISOString()
                  }
                ]
              })
            }
          } catch {
            // ignore streaming parse errors
          }
        }
      }
    } catch (error: any) {
      toast.error(error?.message || t.workflow_execution_error)
      setChatMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error?.message || 'Unknown error'}`,
          timestamp: new Date().toISOString()
        }
      ])

      setExecutionLogs(prev => [
        ...prev,
        {
          nodeId: 'error',
          nodeName: 'Execution Error',
          duration: 0,
          input: { message: userMessage },
          output: {},
          status: 'error',
          error: error?.message || 'Unknown error'
        }
      ])
    } finally {
      setIsExecuting(false)
      clearFiles()
    }
  }, [agentId, workflowId, testMessage, breakpointNodeIds, pausedContext, pausedAtNodeId, currentWorkflow, uploadedFiles, clearFiles, t])

  const handleResume = useCallback(() => {
    if (!isPaused) return
    handleExecuteWorkflow(true)
  }, [isPaused, handleExecuteWorkflow])

  const handleExecuteFromNode = useCallback(async (
    nodeId: string,
    _nodeInput?: any  // eslint-disable-line @typescript-eslint/no-unused-vars
  ) => {
    if (!agentId) {
      toast.error(t.agent_id_not_found)
      return
    }

    const prevExecutionLogs = executionLogs
    const prevContextVariables = contextVariables
    const prevSelectedStepIndex = selectedStepIndex

    const nodeIndex = executionLogs.findIndex(log => log.nodeId === nodeId)
    const logsToKeep = nodeIndex >= 0 ? executionLogs.slice(0, nodeIndex) : []

    setIsExecuting(true)
    setIsPaused(false)
    setPausedAtNodeId(null)
    setExecutionLogs(logsToKeep)
    setSelectedStepIndex(null)
    setExpandedLogView(null)

    try {
      const resolvedContext = contextVariables
      const requestBody: any = {
        message: resolvedContext?.message || '',
        agentId: agentId,
        source: 'workflow-playground',
        clientId: clientIdRef.current,
        startFromNodeId: nodeId,
        initialContext: resolvedContext,
        workflowJson: currentWorkflow ? JSON.stringify(currentWorkflow) : undefined
      }

      if (breakpointNodeIds.length > 0) {
        requestBody.breakpointNodeIds = breakpointNodeIds
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        try {
          const errorData = await response.json()
          throw new Error(errorData.error || t.workflow_execution_failed)
        } catch (parseError) {
          if (parseError instanceof Error && parseError.message !== t.workflow_execution_failed) {
            throw parseError
          }
          throw new Error(t.workflow_execution_failed)
        }
      }

      if (!response.body) {
        throw new Error(t.workflow_execution_failed)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantMessage = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') break

          try {
            const parsed = JSON.parse(payload)

            if (parsed.type === 'debug-step-start') {
              setCurrentRunningNode({
                nodeId: parsed.nodeId,
                nodeName: parsed.nodeName,
                nodeType: parsed.nodeType
              })
              if (parsed.totalNodes) {
                setTotalNodes(parsed.totalNodes)
              }
              continue
            }

            if (parsed.type === 'debug-step' && parsed.log) {
              setExecutionLogs(prev => [...prev, parsed.log])
              setCurrentRunningNode(null)
              continue
            }

            if (parsed.type === 'debug-log' && Array.isArray(parsed.logs)) {
              setExecutionLogs(prev => prev.length > 0 ? prev : parsed.logs)
              if (parsed.context) {
                setContextVariables(parsed.context)
              }
              continue
            }

            if (parsed.type === 'paused') {
              setIsPaused(true)
              setPausedAtNodeId(parsed.nodeId)
              if (parsed.context) {
                setPausedContext(parsed.context)
                setContextVariables(parsed.context)
              }
              if (parsed.logs) {
                setExecutionLogs(parsed.logs)
              }
              setIsExecuting(false)
              return
            }

            if (parsed.type === 'error') {
              toast.error(parsed.error || t.workflow_execution_error)
              setChatMessages(prev => [
                ...prev,
                {
                  role: 'assistant',
                  content: `Error: ${parsed.error || 'Unknown error'}`,
                  timestamp: new Date().toISOString()
                }
              ])
              if (parsed.logs) {
                setExecutionLogs(parsed.logs)
              }
              setIsExecuting(false)
              return
            }

            if (parsed.type === 'debug-child' && parsed.child) {
              setExecutionLogs(prev => {
                const lastIndex = prev.length - 1
                if (lastIndex < 0) return prev

                const lastLog = prev[lastIndex]
                const updatedLog = {
                  ...lastLog,
                  children: [...(lastLog.children || []), parsed.child]
                }
                return [...prev.slice(0, lastIndex), updatedLog]
              })
              continue
            }

            if (parsed.content) {
              assistantMessage += parsed.content
              setChatMessages(prev => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, content: assistantMessage }]
                }
                return [
                  ...prev,
                  {
                    role: 'assistant',
                    content: assistantMessage,
                    timestamp: new Date().toISOString()
                  }
                ]
              })
            }
          } catch {
            // ignore streaming parse errors
          }
        }
      }
    } catch (error: any) {
      toast.error(error?.message || t.workflow_execution_error)
      setExecutionLogs(prevExecutionLogs)
      setContextVariables(prevContextVariables)
      setSelectedStepIndex(prevSelectedStepIndex)
    } finally {
      setIsExecuting(false)
    }
  }, [agentId, breakpointNodeIds, currentWorkflow, executionLogs, contextVariables, selectedStepIndex, t])

  const handleLogBoxClick = useCallback(
    (type: 'input' | 'output') => {
      if (selectedStepIndex === null) return
      const log = executionLogs[selectedStepIndex]
      if (!log) return

      setExpandedLogView({
        type,
        title: `${log.nodeName} ${type === 'input' ? 'Input' : 'Output'}`,
        data: type === 'input' ? log.input : log.output
      })
    },
    [executionLogs, selectedStepIndex]
  )

  const canExpandPayload = selectedStepIndex !== null && !!executionLogs[selectedStepIndex]

  const handleResetTest = () => {
    setChatMessages([])
    setExecutionLogs([])
    setContextVariables({})
    setSelectedStepIndex(null)
    clientIdRef.current = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setTestMessage('')
    setExpandedLogView(null)
    setIsPaused(false)
    setPausedAtNodeId(null)
    setPausedContext(null)
    setCurrentRunningNode(null)
    setTotalNodes(0)
    clearFiles()
  }

  return {
    chatMessages,
    testMessage,
    setTestMessage,
    executionLogs,
    contextVariables,
    selectedStepIndex,
    setSelectedStepIndex,
    expandedLogView,
    setExpandedLogView,
    isExecuting,
    handleExecuteWorkflow,
    handleLogBoxClick,
    canExpandPayload,
    isPaused,
    pausedAtNodeId,
    handleResume,
    updateBreakpointNodes,
    handleExecuteFromNode,
    handleResetTest,
    currentRunningNode,
    totalNodes,
    isTelegramStart,
    isPstnStart,
    uploadedFiles,
    isUploading,
    handleFileSelect,
    removeFile,
    removePdf
  }
}
