import React, { useState } from 'react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  X,
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Terminal,
  Bug,
  Copy,
  Download,
  GripHorizontal
} from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'

export const TestModal: React.FC = () => {
  const { ui, test, workflowHandlers } = useWorkflowContext()
  const [testInput, setTestInput] = useState('')
  const [showDebugInfo, setShowDebugInfo] = useState(false)

  const handleRunTest = async () => {
    test.startTest(testInput)
    const validation = workflowHandlers.validateWorkflow()

    if (!validation.valid) {
      test.setTestError(validation.errors.join('\n'))
      return
    }

    try {
      await workflowHandlers.executeWorkflow()
    } catch (error) {
      test.setTestError(error instanceof Error ? error.message : '테스트 실행 실패')
    }
  }

  const handleStop = () => {
    test.stopTest()
  }

  const handleReset = () => {
    test.resetTestState()
    setTestInput('')
  }

  const handleCopyOutput = () => {
    if (test.testOutput) {
      navigator.clipboard.writeText(test.testOutput)
    }
  }

  const handleExportResults = () => {
    const results = {
      input: test.testInput,
      output: test.testOutput,
      results: test.testResults,
      errors: test.executionErrors,
      logs: test.executionLogs,
      timestamp: new Date().toISOString()
    }

    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `test-results-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'running':
        return <Clock className="w-4 h-4 text-blue-500 animate-spin" />
      default:
        return <AlertCircle className="w-4 h-4 text-gray-400" />
    }
  }

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showTestModal })

  if (!ui.showTestModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => e.stopPropagation()}>
      <div className="w-[800px] max-h-[90vh] bg-white rounded-lg shadow-lg overflow-hidden" style={dragStyle}>
        <div
          className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-400" />
            <Terminal className="w-5 h-5" />
            <h2 className="text-lg font-semibold">워크플로우 테스트</h2>
            {test.isExecuting && (
              <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                실행 중
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => ui.setShowTestModal(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex h-[600px]">
          {/* Left Panel - Input & Controls */}
          <div className="w-1/3 border-r p-4 space-y-4">
            <div>
              <Label>테스트 입력</Label>
              <Textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="테스트 입력 데이터를 입력하세요..."
                className="mt-2 h-32 font-mono text-sm"
                disabled={test.isExecuting}
              />
            </div>

            <div className="flex gap-2">
              {!test.isExecuting ? (
                <Button onClick={handleRunTest} className="flex-1">
                  <Play className="w-4 h-4 mr-1" />
                  테스트 실행
                </Button>
              ) : (
                <Button onClick={handleStop} variant="destructive" className="flex-1">
                  <Pause className="w-4 h-4 mr-1" />
                  중지
                </Button>
              )}
              <Button onClick={handleReset} variant="outline">
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>디버그 모드</Label>
                <input
                  type="checkbox"
                  checked={test.debugMode}
                  onChange={(e) => test.setDebugMode(e.target.checked)}
                  className="rounded"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>상세 로그</Label>
                <input
                  type="checkbox"
                  checked={showDebugInfo}
                  onChange={(e) => setShowDebugInfo(e.target.checked)}
                  className="rounded"
                />
              </div>
            </div>

            {/* Breakpoints */}
            {test.debugMode && test.breakpoints.length > 0 && (
              <div className="space-y-2">
                <Label>브레이크포인트</Label>
                <div className="space-y-1">
                  {test.breakpoints.map((nodeId) => (
                    <div key={nodeId} className="flex items-center justify-between p-2 bg-red-50 rounded text-sm">
                      <span className="text-red-700">{nodeId}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => test.toggleBreakpoint(nodeId)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Middle Panel - Execution Flow */}
          <div className="flex-1 p-4 overflow-y-auto scrollbar-thin">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">실행 결과</h3>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyOutput}
                    disabled={!test.testOutput}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExportResults}
                    disabled={test.testResults.length === 0}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Test Results */}
              {test.testResults.length > 0 ? (
                <div className="space-y-2">
                  {test.testResults.map((result, idx) => (
                    <div key={idx} className="border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(result.status)}
                          <span className="font-medium text-sm">{result.nodeName}</span>
                        </div>
                        {result.duration && (
                          <span className="text-xs text-gray-500">{result.duration}ms</span>
                        )}
                      </div>

                      {result.error && (
                        <div className="mt-2 p-2 bg-red-50 rounded text-sm text-red-700">
                          {result.error}
                        </div>
                      )}

                      {result.output && showDebugInfo && (
                        <div className="mt-2 p-2 bg-gray-50 rounded">
                          <pre className="text-xs font-mono overflow-x-auto">
                            {JSON.stringify(result.output, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Terminal className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>테스트를 실행하여 결과를 확인하세요</p>
                </div>
              )}

              {/* Error Display */}
              {test.testError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-5 h-5 text-red-500" />
                    <span className="font-medium text-red-700">오류 발생</span>
                  </div>
                  <pre className="text-sm text-red-600 whitespace-pre-wrap">{test.testError}</pre>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Output & Logs */}
          <div className="w-1/3 border-l p-4 space-y-4">
            <div>
              <h3 className="font-medium mb-2">출력</h3>
              <div className="h-64 p-3 bg-gray-50 rounded font-mono text-sm overflow-auto">
                {test.testOutput || <span className="text-gray-400">출력 없음</span>}
              </div>
            </div>

            {showDebugInfo && (
              <div>
                <h3 className="font-medium mb-2 flex items-center gap-2">
                  <Bug className="w-4 h-4" />
                  실행 로그
                </h3>
                <div className="h-48 p-3 bg-black text-green-400 rounded font-mono text-xs overflow-auto">
                  {test.executionLogs.length > 0 ? (
                    test.executionLogs.map((log, idx) => (
                      <div key={idx}>{log}</div>
                    ))
                  ) : (
                    <span className="text-gray-600">로그 없음</span>
                  )}
                </div>
              </div>
            )}

            {/* Variable Inspector */}
            {test.debugMode && Object.keys(test.variableInspector).length > 0 && (
              <div>
                <h3 className="font-medium mb-2">변수 상태</h3>
                <div className="p-3 bg-gray-50 rounded">
                  <pre className="text-xs font-mono overflow-auto">
                    {JSON.stringify(test.variableInspector, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-3 border-t bg-gray-50">
          <div className="text-sm text-gray-600">
            {test.testResults.length > 0 && (
              <span>
                실행 노드: {test.testResults.length} |
                성공: {test.testResults.filter(r => r.status === 'success').length} |
                실패: {test.testResults.filter(r => r.status === 'error').length}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => ui.setShowTestModal(false)}
          >
            닫기
          </Button>
        </div>
      </div>
    </div>
  )
}