'use client'

import React, { useEffect, useState, useCallback } from 'react'
import type { Node } from 'reactflow'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Plus,
  Loader2,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Link2,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Server,
  Key,
  Pencil
} from 'lucide-react'
import { TelegramIcon } from '../../constants/components'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

// ========================================
// Provider Icons
// ========================================

const NotionIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6.017 4.313l55.333-4.087c6.797-.583 8.543-.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277-1.553 6.807-6.99 7.193L24.467 99.967c-4.08.193-6.023-.39-8.16-3.113L3.3 79.94c-2.333-3.113-3.3-5.443-3.3-8.167V11.113c0-3.497 1.553-6.413 6.017-6.8z" fill="#fff"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M61.35.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257-3.89c5.433-.387 6.99-2.917 6.99-7.193V20.64c0-2.21-.873-2.847-3.443-4.733L74.167 3.143c-4.273-3.107-6.02-3.5-12.817-2.917zM25.92 19.523c-5.247.353-6.437.433-9.417-1.99L8.927 11.507c-.77-.78-.383-1.753 1.557-1.947l53.193-3.887c4.467-.39 6.793 1.167 8.54 2.527l9.123 6.61c.39.197 1.36 1.36.193 1.36l-54.933 3.307-.68.047zM19.803 88.3V30.367c0-2.53.777-3.697 3.103-3.893L86 22.78c2.14-.193 3.107 1.167 3.107 3.693v57.547c0 2.53-.39 4.67-3.883 4.863l-60.377 3.5c-3.493.193-5.043-.97-5.043-4.083zm59.6-54.827c.387 1.75 0 3.5-1.75 3.7l-2.91.577v42.773c-2.527 1.36-4.853 2.137-6.797 2.137-3.107 0-3.883-.973-6.21-3.887l-19.03-29.94v28.967l6.02 1.363s0 3.5-4.857 3.5l-13.39.777c-.39-.78 0-2.723 1.357-3.11l3.497-.97v-38.3L30.48 40.667c-.39-1.75.58-4.277 3.3-4.473l14.357-.967 19.8 30.327v-26.83l-5.047-.58c-.39-2.143 1.163-3.7 3.103-3.89l13.41-.78z" fill="#000"/>
  </svg>
)

const renderProviderIcon = (icon: string, size: 'sm' | 'lg' = 'lg') => {
  const sizeClass = size === 'lg' ? 'w-8 h-8' : 'w-5 h-5'

  switch (icon) {
    case 'notion':
      return <NotionIcon className={sizeClass} />
    case 'telegram':
      return <TelegramIcon className={sizeClass} />
    default:
      // emoji fallback
      return <span className={size === 'lg' ? 'text-2xl' : 'text-xl'}>{icon}</span>
  }
}

// ========================================
// ========================================

interface ProviderConfig {
  id: string
  name: string
  icon: string  // 'notion' | emoji string
  description: string
  serverUrl: string
  authType: 'oauth' | 'bearer' | 'api_key' | 'none'
  category: 'supported' | 'custom'
  color: string
  supportsDCR?: boolean
  requiresChatId?: boolean
}

const SUPPORTED_PROVIDERS: ProviderConfig[] = [
  {
    id: 'notion',
    name: 'Notion',
    icon: 'notion',
    description: 'Connect to Notion workspaces',
    serverUrl: 'https://mcp.notion.com/mcp',
    authType: 'oauth',
    category: 'supported',
    color: 'bg-gray-700',
    supportsDCR: true,
  },
  {
    id: 'telegram_mcp',
    name: 'Telegram',
    icon: 'telegram',
    description: 'AI가 필요시 Telegram 메시지 발송',
    serverUrl: '/api/mcp/telegram/rpc',
    authType: 'api_key',
    category: 'supported',
    color: 'bg-blue-500',
    supportsDCR: false,
    requiresChatId: true,
  },
]

// ========================================
// Types
// ========================================

interface McpConnection {
  id: string
  provider: string
  label: string
  description: string | null
  serverUrl: string
  transport: string
  authType: string
  status: string
  hasToken: boolean
  maskedToken: string | null
  lastUsedAt: string | null
  errorMessage: string | null
  createdAt: string
  serviceConfig: string | null  // JSON: { chatId: "123" }
}

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

type Step = 'list' | 'select-provider' | 'configure'

// ========================================
// Component
// ========================================

export const McpPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent, saveWorkflow, workflow, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [connections, setConnections] = useState<McpConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [step, setStep] = useState<Step>('list')
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig | null>(null)

  const [formData, setFormData] = useState({
    label: '',
    description: '',
    serverUrl: '',
    authType: 'none' as string,
    accessToken: '',
    oauthClientId: '',
    oauthClientSecret: '',
    oauthScope: '',
    chatId: '',
  })
  const [showToken, setShowToken] = useState(false)
  const [showOAuthSecret, setShowOAuthSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)
  const [editingMaskedToken, setEditingMaskedToken] = useState<string | null>(null)

  const selectedConnectionId = node.data.mcpConnectionId || ''

  const loadConnections = useCallback(async () => {
    if (!agent.agentId) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/mcp/connections?agentId=${agent.agentId}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load connections')
      }

      const loadedConnections = data.connections || []
      setConnections(loadedConnections)

      if (loadedConnections.length === 0 && step === 'list') {
        setStep('select-provider')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [agent.agentId, step])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  const handleSelectConnection = (connectionId: string) => {
    updateNodeData({ mcpConnectionId: connectionId })
  }

  const handleSelectProvider = (provider: ProviderConfig) => {
    setSelectedProvider(provider)
    setFormData({
      label: provider.id === 'custom' ? '' : `My ${provider.name}`,
      description: '',
      serverUrl: provider.serverUrl,
      authType: provider.authType,
      accessToken: '',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthScope: '',
      chatId: '',
    })
    setStep('configure')
  }

  const handleSelectCustom = () => {
    const customProvider: ProviderConfig = {
      id: 'custom',
      name: 'Custom Server',
      icon: '🔗',
      description: 'Connect to any MCP server',
      serverUrl: '',
      authType: 'bearer',
      category: 'custom',
      color: 'bg-gray-600/20',
    }
    handleSelectProvider(customProvider)
  }

  const handleCreateConnection = async () => {
    if (!formData.label || !formData.serverUrl) {
      setError('Label and Server URL are required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/mcp/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          provider: selectedProvider?.id || 'custom',
          ...formData,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create connection')
      }

      await loadConnections()
      handleSelectConnection(data.connection.id)

      resetForm()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setStep('list')
    setSelectedProvider(null)
    setEditingConnectionId(null)
    setEditingMaskedToken(null)
    setFormData({
      label: '',
      description: '',
      serverUrl: '',
      authType: 'none',
      accessToken: '',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthScope: '',
      chatId: '',
    })
    setShowToken(false)
    setShowOAuthSecret(false)
  }

  const handleEditConnection = (conn: McpConnection) => {
    const foundProvider = SUPPORTED_PROVIDERS.find(p => p.id === conn.provider)
    const provider = foundProvider || {
      id: conn.provider || 'custom',
      name: conn.provider === 'telegram_mcp' ? 'Telegram' : 'Custom Server',
      icon: conn.provider === 'telegram_mcp' ? 'telegram' : '🔗',
      description: 'Connect to any MCP server',
      serverUrl: conn.serverUrl,
      authType: conn.authType as any,
      category: 'custom' as const,
      color: 'bg-gray-600/20',
      requiresChatId: conn.provider === 'telegram_mcp',
    }

    let chatId = ''
    if (conn.serviceConfig) {
      try {
        const config = JSON.parse(conn.serviceConfig)
        chatId = config.chatId || ''
      } catch {
      }
    }

    const newFormData = {
      label: conn.label,
      description: conn.description || '',
      serverUrl: conn.serverUrl,
      authType: conn.authType,
      accessToken: '',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthScope: '',
      chatId,
    }

    setSelectedProvider(provider)
    setEditingConnectionId(conn.id)
    setEditingMaskedToken(conn.hasToken ? conn.maskedToken : null)
    setFormData(newFormData)

    setTimeout(() => {
      setStep('configure')
    }, 0)
  }

  const handleUpdateConnection = async () => {
    if (!editingConnectionId || !formData.label) {
      setError('Label is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const updateData: any = {
        id: editingConnectionId,
        label: formData.label,
        description: formData.description,
      }

      if (formData.accessToken) {
        updateData.accessToken = formData.accessToken
      }

      if (formData.chatId) {
        updateData.chatId = formData.chatId
      }

      const res = await fetch('/api/mcp/connections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update connection')
      }

      await loadConnections()
      resetForm()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteConnection = async (connectionId: string) => {
    if (!confirm('Are you sure you want to delete this connection?')) return

    try {
      const res = await fetch(`/api/mcp/connections?id=${connectionId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete connection')
      }

      if (selectedConnectionId === connectionId) {
        updateNodeData({ mcpConnectionId: '' })
      }

      await loadConnections()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const selectedConnection = connections.find(c => c.id === selectedConnectionId)

  // ========================================
  // Render: Provider Selection Grid (Step 1)
  // ========================================
  const renderProviderSelection = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-200">Add MCP Server</h4>
        {connections.length > 0 && (
          <button
            onClick={resetForm}
            className="text-xs text-gray-400 hover:text-gray-300"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Supported Providers */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Supported
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SUPPORTED_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              onClick={() => handleSelectProvider(provider)}
              className="flex flex-col items-center gap-2 p-4 bg-[#1A1A1A] hover:bg-[#252525] rounded-lg border border-[#3A3A3A] hover:border-[#4A4A4A] transition-all"
            >
              {renderProviderIcon(provider.icon, 'lg')}
              <span className="text-sm font-medium text-gray-200">{provider.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Server */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Custom
        </div>
        <button
          onClick={handleSelectCustom}
          className="w-full flex items-center gap-3 p-4 bg-[#1A1A1A] hover:bg-[#252525] rounded-lg border border-dashed border-[#3A3A3A] hover:border-[#4A4A4A] transition-all"
        >
          <div className="p-2 rounded bg-gray-600/20">
            <Server className="w-5 h-5 text-gray-400" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-gray-200">Custom Server</div>
            <div className="text-xs text-gray-400">Connect to any MCP server</div>
          </div>
          <Plus className="w-4 h-4 text-gray-400 ml-auto" />
        </button>
      </div>
    </div>
  )

  // ========================================
  // Render: Configuration Form (Step 2)
  // ========================================
  const renderConfigurationForm = () => {
    if (!selectedProvider) return null

    const isCustom = selectedProvider.id === 'custom'
    const isOAuth = formData.authType === 'oauth'

    return (
      <div className="space-y-4">
        {/* Header with Back button */}
        <div className="flex items-center gap-3">
          <button
            onClick={resetForm}
            className="p-1.5 rounded hover:bg-[#2A2A2A] transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-400" />
          </button>
          <div className="flex items-center gap-2">
            {renderProviderIcon(selectedProvider.icon, 'sm')}
            <h4 className="text-sm font-medium text-gray-200">
              {editingConnectionId ? `Edit ${selectedProvider.name}` : `Connect to ${selectedProvider.name}`}
            </h4>
          </div>
        </div>

        {/* How to Setup Guide (Telegram MCP only) */}
        {selectedProvider.id === 'telegram_mcp' && (
          <div className="border border-[#3A3A3A] rounded-lg overflow-hidden">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className="w-full flex items-center justify-between p-3 bg-[#1A1A1A] hover:bg-[#252525] transition-colors"
            >
              <span className="text-sm font-medium text-gray-200">{t.telegram_how_to_setup || 'How to Setup'}</span>
              {showGuide ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
            </button>

            {showGuide && (
              <div className="p-3 bg-[#1A1A1A]/50 space-y-4 text-xs text-gray-400">
                {/* Step 1: Create Bot */}
                <div>
                  <p className="font-medium text-gray-300 mb-2">{t.telegram_step1_title || 'Step 1: Create a Telegram Bot'}</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>{t.telegram_step1_1 || 'Open Telegram and search for @BotFather'}</li>
                    <li>{t.telegram_step1_2 || 'Send /newbot command'}</li>
                    <li>{t.telegram_step1_3 || 'Enter a name and username for your bot'}</li>
                    <li>{t.telegram_step1_4 || 'Copy the Bot Token provided'}</li>
                  </ol>
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-blue-400 hover:underline"
                  >
                    {t.telegram_open_botfather || 'Open @BotFather'}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Step 2: Get Chat ID */}
                <div>
                  <p className="font-medium text-gray-300 mb-2">{t.telegram_step2_title || 'Step 2: Get Chat ID'}</p>
                  <p className="mb-2">{t.telegram_step2_personal || 'For Personal Chat:'}</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2 mb-2">
                    <li>{t.telegram_step2_personal_1 || 'Search for @userinfobot in Telegram'}</li>
                    <li>{t.telegram_step2_personal_2 || 'Start the bot to get your Chat ID'}</li>
                  </ol>
                  <p className="mb-2">{t.telegram_step2_group || 'For Group Chat:'}</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>{t.telegram_step2_group_1 || 'Add your bot to the group'}</li>
                    <li>{t.telegram_step2_group_2 || 'Send a message in the group'}</li>
                    <li>{t.telegram_step2_group_3 || 'Visit: https://api.telegram.org/bot<TOKEN>/getUpdates'}</li>
                  </ol>
                  <a
                    href="https://t.me/userinfobot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-blue-400 hover:underline"
                  >
                    {t.telegram_open_userinfobot || 'Open @userinfobot'}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Label */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-400">Label</label>
          <Input
            value={formData.label}
            onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
            placeholder="my_mcp_server"
            className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200"
          />
        </div>

        {/* Server URL (Custom only or editable) */}
        {(isCustom || !selectedProvider.serverUrl) && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">
              URL
              <span className="text-gray-500 font-normal ml-2">
                Only use MCP servers you trust and verify
              </span>
            </label>
            <Input
              value={formData.serverUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, serverUrl: e.target.value }))}
              placeholder="https://mcp.example.com"
              className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200"
            />
          </div>
        )}

        {/* Description */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-400">Description (optional)</label>
          <Input
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="My MCP Server"
            autoComplete="off"
            className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200"
          />
        </div>

        {/* Authentication Type (Custom only) */}
        {isCustom && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 flex items-center gap-1">
              Authentication
              <span className="text-gray-500 cursor-help" title="Choose how to authenticate with this server">ⓘ</span>
            </label>
            <select
              value={formData.authType}
              onChange={(e) => setFormData(prev => ({ ...prev, authType: e.target.value }))}
              className="w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#2A2A2A] text-gray-200 text-sm"
            >
              <option value="bearer">Access token / API key</option>
              <option value="oauth">OAuth</option>
              <option value="none">No authentication</option>
            </select>
          </div>
        )}

        {/* Access Token (Bearer / API Key) */}
        {(formData.authType === 'bearer' || formData.authType === 'api_key') && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 flex items-center gap-2">
              <Key className="w-3 h-3" />
              {selectedProvider?.id === 'telegram_mcp' ? 'Bot Token' : 'Add your access token'}
            </label>

            {editingConnectionId && editingMaskedToken && (
              <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-green-400">Current: {editingMaskedToken}</span>
              </div>
            )}

            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={formData.accessToken}
                onChange={(e) => setFormData(prev => ({ ...prev, accessToken: e.target.value }))}
                placeholder={
                  editingConnectionId && editingMaskedToken
                    ? 'Enter new token to replace...'
                    : selectedProvider?.id === 'telegram_mcp'
                      ? '123456789:ABCdefGHI...'
                      : 'Enter token...'
                }
                autoComplete="new-password"
                className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {selectedProvider?.id === 'telegram_mcp' && !editingConnectionId && (
              <p className="text-xs text-gray-500">
                Get token from{' '}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  @BotFather
                </a>
              </p>
            )}
          </div>
        )}

        {/* Chat ID (Telegram MCP) */}
        {selectedProvider?.requiresChatId && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">
              Default Chat ID *
            </label>
            <Input
              value={formData.chatId}
              onChange={(e) => setFormData(prev => ({ ...prev, chatId: e.target.value }))}
              placeholder="123456789 or -1001234567890"
              className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200"
            />
            <p className="text-xs text-gray-500">
              AI can override this in function calls.{' '}
              <a
                href="https://t.me/userinfobot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Get your Chat ID
              </a>
            </p>
          </div>
        )}

        {isOAuth && selectedProvider.supportsDCR && (
          <div className="space-y-3 p-3 bg-green-500/5 border border-green-500/20 rounded-lg">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <p className="text-xs text-green-400">
                {selectedProvider.name} supports automatic OAuth connection.
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Click "Add" to create, then authorize with your {selectedProvider.name} account.
            </p>
          </div>
        )}

        {isOAuth && !selectedProvider.supportsDCR && (
          <div className="space-y-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
            <p className="text-xs text-blue-400">
              Enter your OAuth app credentials. These will be encrypted and stored securely.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">Client ID *</label>
              <Input
                value={formData.oauthClientId}
                onChange={(e) => setFormData(prev => ({ ...prev, oauthClientId: e.target.value }))}
                placeholder="Enter OAuth Client ID"
                autoComplete="off"
                className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">Client Secret *</label>
              <div className="relative">
                <Input
                  type={showOAuthSecret ? 'text' : 'password'}
                  value={formData.oauthClientSecret}
                  onChange={(e) => setFormData(prev => ({ ...prev, oauthClientSecret: e.target.value }))}
                  placeholder="Enter OAuth Client Secret"
                  autoComplete="new-password"
                  className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowOAuthSecret(!showOAuthSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                >
                  {showOAuthSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">Scope (optional)</label>
              <Input
                value={formData.oauthScope}
                onChange={(e) => setFormData(prev => ({ ...prev, oauthScope: e.target.value }))}
                placeholder="e.g., read:user,repo"
                autoComplete="off"
                className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200"
              />
            </div>

            <p className="text-xs text-gray-500">
              After creating, click "Connect" to authorize access.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="outline"
            onClick={resetForm}
            className="flex-1 border-[#3A3A3A] text-gray-300"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            {editingConnectionId ? 'Cancel' : 'Back'}
          </Button>
          {editingConnectionId ? (
            <Button
              onClick={handleUpdateConnection}
              disabled={saving || !formData.label}
              className="flex-1"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Update
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleCreateConnection}
              disabled={saving || !formData.label || !formData.serverUrl}
              className="flex-1"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Connect
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ========================================
  // Render: Main
  // ========================================
  return (
    <div className="space-y-4">
      {/* Header with AI Assistant Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">MCP Server</h3>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* Step: Provider Selection */}
          {step === 'select-provider' && renderProviderSelection()}

          {/* Step: Configuration Form */}
          {step === 'configure' && renderConfigurationForm()}

          {/* Step: List (Default) */}
          {step === 'list' && (
            <>
              {/* Selected Connection */}
              {selectedConnection ? (
                <div className="space-y-3">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Selected Connection
                  </div>
                  <div className={`bg-[#1A1A1A] rounded-lg p-4 border ${
                    selectedConnection.hasToken ? 'border-green-500/30' : 'border-yellow-500/30'
                  }`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded ${
                          selectedConnection.hasToken ? 'bg-green-500/10' : 'bg-yellow-500/10'
                        }`}>
                          {selectedConnection.hasToken ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-yellow-500" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-200">
                            {selectedConnection.label}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {selectedConnection.provider} • {selectedConnection.hasToken ? 'Connected' : 'Not connected'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleSelectConnection('')}
                        className="text-xs text-gray-400 hover:text-gray-300"
                      >
                        Change
                      </button>
                    </div>

                    {/* OAuth Connect Button */}
                    {selectedConnection.authType === 'oauth' && !selectedConnection.hasToken && (
                      <div className="mt-4 pt-4 border-t border-[#3A3A3A]">
                        <Button
                          onClick={async () => {
                            if (!(await saveWorkflow())) return

                            const urlParams = new URLSearchParams(window.location.search)
                            const workflowId = urlParams.get('workflowId') || ''
                            window.location.href = `/api/mcp/oauth?connectionId=${selectedConnection.id}&workflowId=${workflowId}`
                          }}
                          className="w-full"
                        >
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Connect to {selectedConnection.provider.charAt(0).toUpperCase() + selectedConnection.provider.slice(1)}
                        </Button>
                        <p className="text-xs text-gray-500 mt-2 text-center">
                          You'll be redirected to authorize access
                        </p>
                      </div>
                    )}

                    {/* Disconnect Button */}
                    {selectedConnection.authType === 'oauth' && selectedConnection.hasToken && (
                      <div className="mt-4 pt-4 border-t border-[#3A3A3A]">
                        <button
                          onClick={async () => {
                            if (!confirm('Disconnect this connection?')) return
                            try {
                              await fetch('/api/mcp/oauth', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ connectionId: selectedConnection.id }),
                              })
                              await loadConnections()
                            } catch (err) {
                              console.error('Disconnect error:', err)
                            }
                          }}
                          className="w-full text-xs text-gray-400 hover:text-red-400 transition-colors"
                        >
                          Disconnect
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Available Connections */}
                  {connections.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Available Connections
                      </div>
                      <div className="space-y-2">
                        {connections.map((conn) => (
                          <button
                            key={conn.id}
                            onClick={() => handleSelectConnection(conn.id)}
                            className="w-full flex items-center gap-3 p-3 bg-[#1A1A1A] hover:bg-[#252525] rounded-lg transition-colors group"
                          >
                            <div className={`p-2 rounded ${
                              conn.status === 'active' ? 'bg-green-500/10' : 'bg-red-500/10'
                            }`}>
                              <Link2 className={`w-4 h-4 ${
                                conn.status === 'active' ? 'text-green-500' : 'text-red-500'
                              }`} />
                            </div>
                            <div className="flex-1 text-left">
                              <div className="text-sm font-medium text-gray-200">
                                {conn.label}
                              </div>
                              <div className="text-xs text-gray-400">
                                {conn.provider} • {conn.hasToken ? 'Token configured' : 'No token'}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                              <Pencil
                                className="w-4 h-4 text-gray-500 hover:text-blue-400 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleEditConnection(conn)
                                }}
                              />
                              <Trash2
                                className="w-4 h-4 text-gray-500 hover:text-red-400 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteConnection(conn.id)
                                }}
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add Button */}
                  <Button
                    onClick={() => setStep('select-provider')}
                    variant="outline"
                    className="w-full border-dashed border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add MCP Connection
                  </Button>

                  {/* Empty State */}
                  {connections.length === 0 && (
                    <div className="text-center py-4">
                      <Link2 className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No MCP connections yet</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Add a connection to integrate external services
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
