import { useState, useCallback } from 'react'
import type { Node, Edge } from 'reactflow'

export type AIAssistantContext =
  | 'general'
  | 'systemMessage'
  | 'modelSettings'
  | 'tools'
  | 'jsonSchema'
  | 'template'
  | 'team'
  | 'knowledge'
  | 'jsonOptions'
  | 'dataSheet'
  | 'whileLoop'
  | 'whileTools'
  | 'sendgridBody'
  | 'widget'
  | 'mcp'
  | 'webSearch'
  | 'source'
  | 'imap'
  | 'smtp'
  | 'telegram'
  | 'ifElse'
  | 'httpRequest';

export interface AIAssistantState {
  show: boolean;
  context: AIAssistantContext;
  nodeId?: string;
}

export interface UIState {
  showWidgetModal: 'url' | 'iframe' | 'embed' | null
  showJsonSchemaModal: boolean
  showInstructionsModal: boolean
  showModelSettingsModal: boolean
  showToolsModal: boolean
  showMiniAppModal: boolean
  showKnowledgeModal: boolean
  showAgentModal: boolean
  showTeamModal: boolean
  showSaveTemplateModal: boolean
  showLoadTemplateModal: boolean
  showTestModal: boolean
  showApiModal: boolean
  showMcpModal: boolean
  showWebSearchModal: boolean
  showDataSourcesModal: boolean
  showWebsiteModal: boolean
  showStorageModal: boolean
  showGoogleDriveModal: boolean
  showCustomJsonModal: boolean
  showVariableModal: boolean
  showFunctionCallingModal: boolean
  showWhileModal: boolean
  showWhileToolsModal: boolean
  showSendGridBodyModal: boolean
  showJsonOptionsModal: boolean
  showPstnAdvancedModal: boolean
  showAcsWizardModal: boolean
  showCalendarAdvancedModal: boolean
  showQuizStudyModal: boolean
  showVoiceQuizContentModal: boolean
  showVoiceQuizBankModal: boolean
  showVoiceQuizNoticeModal: boolean

  activeTab: string
  selectedVariableTab: string

  isExpanded: boolean
  rightPanelTab: string
  copiedField: string | null
  isPreview: boolean
  viewportFit: boolean
  isSaving: boolean
  saveSuccess: boolean | null
  isInitialized: boolean
  showDebugPanel: boolean
  showAIAssistant: boolean
  showLeftPalette: boolean
  isLocked: boolean
  hasChanges: boolean

  savedSnapshot: {
    nodes: Node[]
    edges: Edge[]
  }
}

export const useUIState = () => {
  const [showWidgetModal, setShowWidgetModal] = useState<'url' | 'iframe' | 'embed' | null>(null)
  const [showJsonSchemaModal, setShowJsonSchemaModal] = useState(false)
  const [showInstructionsModal, setShowInstructionsModal] = useState(false)
  const [showModelSettingsModal, setShowModelSettingsModal] = useState(false)
  const [showToolsModal, setShowToolsModal] = useState(false)
  const [showMiniAppModal, setShowMiniAppModal] = useState(false)
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false)
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false)
  const [showLoadTemplateModal, setShowLoadTemplateModal] = useState(false)
  const [showTestModal, setShowTestModal] = useState(false)
  const [showApiModal, setShowApiModal] = useState(false)
  const [showMcpModal, setShowMcpModal] = useState(false)
  const [showWebSearchModal, setShowWebSearchModal] = useState(false)
  const [showDataSourcesModal, setShowDataSourcesModal] = useState(false)
  const [showWebsiteModal, setShowWebsiteModal] = useState(false)
  const [showStorageModal, setShowStorageModal] = useState(false)
  const [showGoogleDriveModal, setShowGoogleDriveModal] = useState(false)
  const [showCustomJsonModal, setShowCustomJsonModal] = useState(false)
  const [showVariableModal, setShowVariableModal] = useState(false)
  const [showFunctionCallingModal, setShowFunctionCallingModal] = useState(false)
  const [showWhileModal, setShowWhileModal] = useState(false)
  const [showWhileToolsModal, setShowWhileToolsModal] = useState(false)
  const [showSendGridBodyModal, setShowSendGridBodyModal] = useState(false)
  const [showJsonOptionsModal, setShowJsonOptionsModal] = useState(false)
  const [showPstnAdvancedModal, setShowPstnAdvancedModal] = useState(false)
  const [pstnAdvancedModalNodeId, setPstnAdvancedModalNodeId] = useState<string | null>(null)
  const [showAcsWizardModal, setShowAcsWizardModal] = useState(false)
  const [acsWizardNodeId, setAcsWizardNodeId] = useState<string | null>(null)
  const [showCalendarAdvancedModal, setShowCalendarAdvancedModal] = useState(false)
  const [showQuizStudyModal, setShowQuizStudyModal] = useState(false)
  const [quizStudyModalNodeId, setQuizStudyModalNodeId] = useState<string | null>(null)
  const [showVoiceQuizContentModal, setShowVoiceQuizContentModal] = useState(false)
  const [voiceQuizContentModalNodeId, setVoiceQuizContentModalNodeId] = useState<string | null>(null)
  const [showVoiceQuizBankModal, setShowVoiceQuizBankModal] = useState(false)
  const [voiceQuizBankModalNodeId, setVoiceQuizBankModalNodeId] = useState<string | null>(null)
  const [showVoiceQuizNoticeModal, setShowVoiceQuizNoticeModal] = useState(false)
  const [voiceQuizNoticeModalNodeId, setVoiceQuizNoticeModalNodeId] = useState<string | null>(null)
  const [calendarAdvancedModalNodeId, setCalendarAdvancedModalNodeId] = useState<string | null>(null)
  const [showCalendarMonthlyPreviewModal, setShowCalendarMonthlyPreviewModal] = useState(false)
  const [calendarMonthlyPreviewNodeId, setCalendarMonthlyPreviewNodeId] = useState<string | null>(null)

  const [toolsModalAiNodeId, setToolsModalAiNodeId] = useState<string | null>(null)
  const [miniAppModalAiNodeId, setMiniAppModalAiNodeId] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState('all')
  const [selectedVariableTab, setSelectedVariableTab] = useState('input')
  const [rightPanelTab, setRightPanelTab] = useState('settings')

  const [isExpanded, setIsExpanded] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [isPreview, setIsPreview] = useState(false)
  const [viewportFit, setViewportFit] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState<boolean | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [showAIAssistant, setShowAIAssistant] = useState(false)
  const [aiAssistantContext, setAIAssistantContext] = useState<AIAssistantContext>('general')
  const [aiAssistantNodeId, setAIAssistantNodeId] = useState<string | undefined>(undefined)
  const [aiAssistantDataSheetId, setAIAssistantDataSheetId] = useState<string | undefined>(undefined)
  const [aiAssistantMcpConnectionId, setAIAssistantMcpConnectionId] = useState<string | undefined>(undefined)
  const [showLeftPalette, setShowLeftPalette] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [savedSnapshot, setSavedSnapshot] = useState<{ nodes: Node[], edges: Edge[] }>({
    nodes: [],
    edges: []
  })

  const closeAllModals = () => {
    setShowWidgetModal(null)
    setShowJsonSchemaModal(false)
    setShowInstructionsModal(false)
    setShowModelSettingsModal(false)
    setShowToolsModal(false)
    setShowMiniAppModal(false)
    setShowKnowledgeModal(false)
    setShowAgentModal(false)
    setShowTeamModal(false)
    setShowSaveTemplateModal(false)
    setShowLoadTemplateModal(false)
    setShowTestModal(false)
    setShowApiModal(false)
    setShowMcpModal(false)
    setShowWebSearchModal(false)
    setShowDataSourcesModal(false)
    setShowWebsiteModal(false)
    setShowStorageModal(false)
    setShowGoogleDriveModal(false)
    setShowCustomJsonModal(false)
    setShowVariableModal(false)
    setShowFunctionCallingModal(false)
    setShowWhileModal(false)
    setShowWhileToolsModal(false)
    setShowSendGridBodyModal(false)
    setShowJsonOptionsModal(false)
    setShowPstnAdvancedModal(false)
    setShowAcsWizardModal(false)
    setShowQuizStudyModal(false)
    setShowVoiceQuizContentModal(false)
    setShowVoiceQuizBankModal(false)
    setShowVoiceQuizNoticeModal(false)
  }

  const openAIAssistant = useCallback((context: AIAssistantContext = 'general', nodeId?: string, dataSheetId?: string, mcpConnectionId?: string) => {
    setAIAssistantContext(context)
    setAIAssistantNodeId(nodeId)
    setAIAssistantDataSheetId(dataSheetId)
    setAIAssistantMcpConnectionId(mcpConnectionId)
    setShowAIAssistant(true)
  }, [])

  const closeAIAssistant = useCallback(() => {
    setShowAIAssistant(false)
  }, [])

  const toggleAIAssistant = useCallback(() => {
    if (showAIAssistant) {
      closeAIAssistant()
    } else {
      openAIAssistant('general')
    }
  }, [showAIAssistant, openAIAssistant, closeAIAssistant])

  const openModal = (modalName: string, nodeId?: string) => {
    closeAllModals()
    switch (modalName) {
      case 'widget-url':
        setShowWidgetModal('url')
        break
      case 'widget-iframe':
        setShowWidgetModal('iframe')
        break
      case 'widget-embed':
        setShowWidgetModal('embed')
        break
      case 'jsonSchema':
        setShowJsonSchemaModal(true)
        break
      case 'instructions':
        setShowInstructionsModal(true)
        break
      case 'modelSettings':
        setShowModelSettingsModal(true)
        break
      case 'tools':
        if (nodeId) setToolsModalAiNodeId(nodeId)
        setShowToolsModal(true)
        break
      case 'miniapps':
        if (nodeId) setMiniAppModalAiNodeId(nodeId)
        setShowMiniAppModal(true)
        break
      case 'knowledge':
        setShowKnowledgeModal(true)
        break
      case 'agent':
        setShowAgentModal(true)
        break
      case 'team':
        setShowTeamModal(true)
        break
      case 'saveTemplate':
        setShowSaveTemplateModal(true)
        break
      case 'loadTemplate':
        setShowLoadTemplateModal(true)
        break
      case 'test':
        setShowTestModal(true)
        break
      case 'api':
        setShowApiModal(true)
        break
      case 'mcp':
        setShowMcpModal(true)
        break
      case 'webSearch':
        setShowWebSearchModal(true)
        break
      case 'dataSources':
        setShowDataSourcesModal(true)
        break
      case 'website':
        setShowWebsiteModal(true)
        break
      case 'storage':
        setShowStorageModal(true)
        break
      case 'googleDrive':
        setShowGoogleDriveModal(true)
        break
      case 'customJson':
        setShowCustomJsonModal(true)
        break
      case 'variable':
        setShowVariableModal(true)
        break
      case 'functionCalling':
        setShowFunctionCallingModal(true)
        break
      case 'while':
        setShowWhileModal(true)
        break
      case 'whileTools':
        setShowWhileToolsModal(true)
        break
      case 'sendGridBody':
        setShowSendGridBodyModal(true)
        break
      case 'jsonOptions':
        setShowJsonOptionsModal(true)
        break
      case 'pstnAdvanced':
        if (nodeId) setPstnAdvancedModalNodeId(nodeId)
        setShowPstnAdvancedModal(true)
        break
      case 'acsWizard':
        if (nodeId) setAcsWizardNodeId(nodeId)
        setShowAcsWizardModal(true)
        break
      case 'quizStudy':
        if (nodeId) setQuizStudyModalNodeId(nodeId)
        setShowQuizStudyModal(true)
        break
      case 'voiceQuizContent':
        if (nodeId) setVoiceQuizContentModalNodeId(nodeId)
        setShowVoiceQuizContentModal(true)
        break
      case 'voiceQuizBank':
        if (nodeId) setVoiceQuizBankModalNodeId(nodeId)
        setShowVoiceQuizBankModal(true)
        break
      case 'voiceQuizNotice':
        if (nodeId) setVoiceQuizNoticeModalNodeId(nodeId)
        setShowVoiceQuizNoticeModal(true)
        break
    }
  }

  return {
    showWidgetModal,
    showJsonSchemaModal,
    showInstructionsModal,
    showModelSettingsModal,
    showToolsModal,
    showMiniAppModal,
    showKnowledgeModal,
    showAgentModal,
    showTeamModal,
    showSaveTemplateModal,
    showLoadTemplateModal,
    showTestModal,
    showApiModal,
    showMcpModal,
    showWebSearchModal,
    showDataSourcesModal,
    showWebsiteModal,
    showStorageModal,
    showGoogleDriveModal,
    showCustomJsonModal,
    showVariableModal,
    showFunctionCallingModal,
    showWhileModal,
    showWhileToolsModal,
    showSendGridBodyModal,
    showJsonOptionsModal,
    showPstnAdvancedModal,
    pstnAdvancedModalNodeId,
    showAcsWizardModal,
    acsWizardNodeId,
    showCalendarAdvancedModal,
    calendarAdvancedModalNodeId,
    showQuizStudyModal,
    quizStudyModalNodeId,
    showVoiceQuizContentModal,
    voiceQuizContentModalNodeId,
    showVoiceQuizBankModal,
    voiceQuizBankModalNodeId,
    showVoiceQuizNoticeModal,
    voiceQuizNoticeModalNodeId,
    showCalendarMonthlyPreviewModal,
    calendarMonthlyPreviewNodeId,

    setShowWidgetModal,
    setShowJsonSchemaModal,
    setShowInstructionsModal,
    setShowModelSettingsModal,
    setShowToolsModal,
    setShowMiniAppModal,
    setShowKnowledgeModal,
    setShowAgentModal,
    setShowTeamModal,
    setShowSaveTemplateModal,
    setShowLoadTemplateModal,
    setShowTestModal,
    setShowApiModal,
    setShowMcpModal,
    setShowWebSearchModal,
    setShowDataSourcesModal,
    setShowWebsiteModal,
    setShowStorageModal,
    setShowGoogleDriveModal,
    setShowCustomJsonModal,
    setShowVariableModal,
    setShowFunctionCallingModal,
    setShowWhileModal,
    setShowWhileToolsModal,
    setShowSendGridBodyModal,
    setShowJsonOptionsModal,
    setShowPstnAdvancedModal,
    setPstnAdvancedModalNodeId,
    setShowAcsWizardModal,
    setAcsWizardNodeId,
    setShowCalendarAdvancedModal,
    setCalendarAdvancedModalNodeId,
    setShowQuizStudyModal,
    setQuizStudyModalNodeId,
    setShowVoiceQuizContentModal,
    setVoiceQuizContentModalNodeId,
    setShowVoiceQuizBankModal,
    setVoiceQuizBankModalNodeId,
    setShowVoiceQuizNoticeModal,
    setVoiceQuizNoticeModalNodeId,
    setShowCalendarMonthlyPreviewModal,
    setCalendarMonthlyPreviewNodeId,
    toolsModalAiNodeId,
    setToolsModalAiNodeId,
    miniAppModalAiNodeId,
    setMiniAppModalAiNodeId,

    activeTab,
    selectedVariableTab,
    rightPanelTab,
    setActiveTab,
    setSelectedVariableTab,
    setRightPanelTab,

    isExpanded,
    copiedField,
    isPreview,
    viewportFit,
    isSaving,
    saveSuccess,
    isInitialized,
    showDebugPanel,
    showAIAssistant,
    aiAssistantContext,
    aiAssistantNodeId,
    aiAssistantDataSheetId,
    aiAssistantMcpConnectionId,
    showLeftPalette,
    isLocked,
    hasChanges,
    savedSnapshot,
    setIsExpanded,
    setCopiedField,
    setIsPreview,
    setViewportFit,
    setIsSaving,
    setSaveSuccess,
    setIsInitialized,
    setShowDebugPanel,
    setShowAIAssistant,
    openAIAssistant,
    closeAIAssistant,
    toggleAIAssistant,
    setShowLeftPalette,
    setIsLocked,
    setHasChanges,
    setSavedSnapshot,

    closeAllModals,
    openModal
  }
}
