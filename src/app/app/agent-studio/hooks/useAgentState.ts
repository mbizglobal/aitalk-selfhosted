import { useState, useCallback, useRef } from 'react'
import { VariableItem, WorkflowTemplate } from '../types'

export interface AgentSettings {
  model: string
  temperature: number
  maxTokens: number
  systemMessage: string
  outputFormat: 'text' | 'json'
  jsonSchema?: string
  tools: {
    source: Array<{id: string, name: string}>
    mcp: Array<{id: string, name: string}>
    webSearch: Array<{id: string, name: string}>
    functionCalling: Array<{id: string, name: string}>
  }
  knowledge: {
    sources: Array<{id: string, name: string, type: string}>
    files: Array<{id: string, name: string}>
  }
}

export interface AgentInfo {
  id: string | null
  name: string
  description: string
  accessMode: 'public' | 'team'
  teamMembers: string[]
  teamAgents: Array<{id: string, name: string}>
}

export const useAgentState = (initialAgent?: any) => {
  const [agentId, setAgentId] = useState<string | null>(initialAgent?.id || null)
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [workflowName, setWorkflowName] = useState<string>('')
  const [workflowStatus, setWorkflowStatus] = useState<string>('draft')
  const [workflowKind, setWorkflowKind] = useState<'main' | 'sub'>('main')
  const workflowVersionRef = useRef<number>(1)
  const [agentName, setAgentName] = useState<string>(initialAgent?.title || '')
  const [agentDescription, setAgentDescription] = useState<string>(initialAgent?.description || '')
  const [accessMode, setAccessMode] = useState<'public' | 'team'>(initialAgent?.accessMode || 'public')
  const [teamMembers, setTeamMembers] = useState<string[]>([])
  const [teamAgents, setTeamAgents] = useState<Array<{id: string, name: string}>>([])

  const [aiModel, setAiModel] = useState<string>(initialAgent?.settings?.model || 'gpt-4o')
  const [aiTemperature, setAiTemperature] = useState<number>(initialAgent?.settings?.temperature || 0.7)
  const [aiMaxTokens, setAiMaxTokens] = useState<number>(initialAgent?.settings?.maxTokens || 2048)
  const [aiSystemMessage, setAiSystemMessage] = useState<string>(initialAgent?.settings?.systemMessage || '')
  const [aiOutputFormat, setAiOutputFormat] = useState<'text' | 'json'>(initialAgent?.settings?.outputFormat || 'text')
  const [aiJsonSchema, setAiJsonSchema] = useState<string>(initialAgent?.settings?.jsonSchema || '')

  const [selectedSourceTools, setSelectedSourceTools] = useState<Array<{id: string, name: string}>>([])
  const [selectedMcpTools, setSelectedMcpTools] = useState<Array<{id: string, name: string}>>([])
  const [selectedWebSearchTools, setSelectedWebSearchTools] = useState<Array<{id: string, name: string}>>([])
  const [selectedFunctionCallingTools, setSelectedFunctionCallingTools] = useState<Array<{id: string, name: string}>>([])

  const [knowledgeSources, setKnowledgeSources] = useState<Array<{id: string, name: string, type: string}>>([])
  const [knowledgeFiles, setKnowledgeFiles] = useState<Array<{id: string, name: string}>>([])

  const [variables, setVariables] = useState<VariableItem[]>([])
  const [inputVariables, setInputVariables] = useState<VariableItem[]>([])
  const [outputVariables, setOutputVariables] = useState<VariableItem[]>([])

  // Templates
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  const updateAgentInfo = useCallback((info: Partial<AgentInfo>) => {
    if (info.id !== undefined) setAgentId(info.id)
    if (info.name !== undefined) setAgentName(info.name)
    if (info.description !== undefined) setAgentDescription(info.description)
    if (info.accessMode !== undefined) setAccessMode(info.accessMode)
    if (info.teamMembers !== undefined) setTeamMembers(info.teamMembers)
    if (info.teamAgents !== undefined) setTeamAgents(info.teamAgents)
  }, [])

  const updateAiSettings = useCallback((settings: Partial<AgentSettings>) => {
    if (settings.model !== undefined) setAiModel(settings.model)
    if (settings.temperature !== undefined) setAiTemperature(settings.temperature)
    if (settings.maxTokens !== undefined) setAiMaxTokens(settings.maxTokens)
    if (settings.systemMessage !== undefined) setAiSystemMessage(settings.systemMessage)
    if (settings.outputFormat !== undefined) setAiOutputFormat(settings.outputFormat)
    if (settings.jsonSchema !== undefined) setAiJsonSchema(settings.jsonSchema)
  }, [])

  const updateTools = useCallback((tools: Partial<AgentSettings['tools']>) => {
    if (tools.source !== undefined) setSelectedSourceTools(tools.source)
    if (tools.mcp !== undefined) setSelectedMcpTools(tools.mcp)
    if (tools.webSearch !== undefined) setSelectedWebSearchTools(tools.webSearch)
    if (tools.functionCalling !== undefined) setSelectedFunctionCallingTools(tools.functionCalling)
  }, [])

  const updateKnowledge = useCallback((knowledge: Partial<AgentSettings['knowledge']>) => {
    if (knowledge.sources !== undefined) setKnowledgeSources(knowledge.sources)
    if (knowledge.files !== undefined) setKnowledgeFiles(knowledge.files)
  }, [])

  const addVariable = useCallback((type: 'input' | 'output', variable: VariableItem) => {
    if (type === 'input') {
      setInputVariables(prev => [...prev, variable])
    } else {
      setOutputVariables(prev => [...prev, variable])
    }
    setVariables(prev => [...prev, variable])
  }, [])

  const removeVariable = useCallback((id: string) => {
    setVariables(prev => prev.filter(v => v.id !== id))
    setInputVariables(prev => prev.filter(v => v.id !== id))
    setOutputVariables(prev => prev.filter(v => v.id !== id))
  }, [])

  const updateVariable = useCallback((id: string, updates: Partial<VariableItem>) => {
    const updateFn = (v: VariableItem) => v.id === id ? { ...v, ...updates } : v
    setVariables(prev => prev.map(updateFn))
    setInputVariables(prev => prev.map(updateFn))
    setOutputVariables(prev => prev.map(updateFn))
  }, [])

  const saveTemplate = useCallback((template: WorkflowTemplate) => {
    setTemplates(prev => [...prev, template])
  }, [])

  const loadTemplate = useCallback((templateId: string) => {
    const template = templates.find(t => t.id === templateId)
    if (template) {
      setSelectedTemplate(templateId)
      return template
    }
    return null
  }, [templates])

  const deleteTemplate = useCallback((templateId: string) => {
    setTemplates(prev => prev.filter(t => t.id !== templateId))
    if (selectedTemplate === templateId) {
      setSelectedTemplate(null)
    }
  }, [selectedTemplate])

  const getAgentSettings = useCallback((): AgentSettings => {
    return {
      model: aiModel,
      temperature: aiTemperature,
      maxTokens: aiMaxTokens,
      systemMessage: aiSystemMessage,
      outputFormat: aiOutputFormat,
      jsonSchema: aiJsonSchema,
      tools: {
        source: selectedSourceTools,
        mcp: selectedMcpTools,
        webSearch: selectedWebSearchTools,
        functionCalling: selectedFunctionCallingTools
      },
      knowledge: {
        sources: knowledgeSources,
        files: knowledgeFiles
      }
    }
  }, [
    aiModel, aiTemperature, aiMaxTokens, aiSystemMessage, aiOutputFormat, aiJsonSchema,
    selectedSourceTools, selectedMcpTools, selectedWebSearchTools, selectedFunctionCallingTools,
    knowledgeSources, knowledgeFiles
  ])

  const getAgentInfo = useCallback((): AgentInfo => {
    return {
      id: agentId,
      name: agentName,
      description: agentDescription,
      accessMode,
      teamMembers,
      teamAgents
    }
  }, [agentId, agentName, agentDescription, accessMode, teamMembers, teamAgents])

  return {
    agentId,
    workflowId,
    workflowName,
    workflowStatus,
    workflowKind,
    workflowVersionRef,
    agentName,
    agentDescription,
    accessMode,
    teamMembers,
    teamAgents,
    setAgentId,
    setWorkflowId,
    setWorkflowName,
    setWorkflowStatus,
    setWorkflowKind,
    setAgentName,
    setAgentDescription,
    setAccessMode,
    setTeamMembers,
    setTeamAgents,

    aiModel,
    aiTemperature,
    aiMaxTokens,
    aiSystemMessage,
    aiOutputFormat,
    aiJsonSchema,
    setAiModel,
    setAiTemperature,
    setAiMaxTokens,
    setAiSystemMessage,
    setAiOutputFormat,
    setAiJsonSchema,

    // Tools
    selectedSourceTools,
    selectedMcpTools,
    selectedWebSearchTools,
    selectedFunctionCallingTools,
    setSelectedSourceTools,
    setSelectedMcpTools,
    setSelectedWebSearchTools,
    setSelectedFunctionCallingTools,

    // Knowledge
    knowledgeSources,
    knowledgeFiles,
    setKnowledgeSources,
    setKnowledgeFiles,

    // Variables
    variables,
    inputVariables,
    outputVariables,
    addVariable,
    removeVariable,
    updateVariable,

    // Templates
    templates,
    selectedTemplate,
    saveTemplate,
    loadTemplate,
    deleteTemplate,

    updateAgentInfo,
    updateAiSettings,
    updateTools,
    updateKnowledge,
    getAgentSettings,
    getAgentInfo
  }
}