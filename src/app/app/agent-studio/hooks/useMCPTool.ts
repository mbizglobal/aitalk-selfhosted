
import { useState } from 'react'
import type { MCPToolConfig } from '../types'

export function useMCPTool() {
  const [mcpUrl, setMcpUrl] = useState<string>('')
  const [mcpLabel, setMcpLabel] = useState<string>('')
  const [mcpDescription, setMcpDescription] = useState<string>('')
  const [mcpAuthType, setMcpAuthType] = useState<'none' | 'token' | 'custom'>('token')
  const [mcpAuthToken, setMcpAuthToken] = useState<string>('')
  const [showMcpAuthToken, setShowMcpAuthToken] = useState<boolean>(false)
  const [mcpCustomHeaders, setMcpCustomHeaders] = useState<Array<{id: string, header: string, value: string}>>([
    { id: Date.now().toString(), header: '', value: '' }
  ])
  const [mcpConnected, setMcpConnected] = useState<boolean>(false)
  const [mcpApprovalType, setMcpApprovalType] = useState<'always' | 'never' | 'tool-specific'>('always')
  const [mcpTools, setMcpTools] = useState<Array<{id: string, name: string, description: string, enabled: boolean}>>([])
  const [mcpActiveTab, setMcpActiveTab] = useState<'tools' | 'widget'>('tools')
  const [mcpConfigStep, setMcpConfigStep] = useState<'initial' | 'final'>('initial')
  const [mcpServerName, setMcpServerName] = useState<string>('')
  const [showDescription, setShowDescription] = useState<boolean>(false)

  const testMCPConnection = async () => {
    setMcpConnected(true)
    // Mock tools for testing
    setMcpTools([
      { id: '1', name: 'Tool 1', description: 'Description 1', enabled: true },
      { id: '2', name: 'Tool 2', description: 'Description 2', enabled: false },
    ])
  }

  const resetMCPConfig = () => {
    setMcpUrl('')
    setMcpLabel('')
    setMcpDescription('')
    setMcpAuthType('token')
    setMcpAuthToken('')
    setShowMcpAuthToken(false)
    setMcpCustomHeaders([{ id: Date.now().toString(), header: '', value: '' }])
    setMcpConnected(false)
    setMcpApprovalType('always')
    setMcpTools([])
    setMcpActiveTab('tools')
    setMcpConfigStep('initial')
    setMcpServerName('')
    setShowDescription(false)
  }

  const getMCPConfig = (): MCPToolConfig => ({
    url: mcpUrl,
    label: mcpLabel,
    description: mcpDescription,
    authType: mcpAuthType,
    authToken: mcpAuthToken,
    customHeaders: mcpCustomHeaders,
    connected: mcpConnected,
    approvalType: mcpApprovalType,
    tools: mcpTools,
    serverName: mcpServerName
  })

  return {
    // State
    mcpUrl,
    setMcpUrl,
    mcpLabel,
    setMcpLabel,
    mcpDescription,
    setMcpDescription,
    mcpAuthType,
    setMcpAuthType,
    mcpAuthToken,
    setMcpAuthToken,
    showMcpAuthToken,
    setShowMcpAuthToken,
    mcpCustomHeaders,
    setMcpCustomHeaders,
    mcpConnected,
    setMcpConnected,
    mcpApprovalType,
    setMcpApprovalType,
    mcpTools,
    setMcpTools,
    mcpActiveTab,
    setMcpActiveTab,
    mcpConfigStep,
    setMcpConfigStep,
    mcpServerName,
    setMcpServerName,
    showDescription,
    setShowDescription,

    // Functions
    testMCPConnection,
    resetMCPConfig,
    getMCPConfig
  }
}