'use client'

import { useEdition } from '@/components/EditionProvider'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { Node } from 'reactflow'
import { useSearchParams } from 'next/navigation'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Eye,
  EyeOff,
  Info,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  Server,
  Send,
  Forward,
  Maximize2,
  ExternalLink,
  Link2
} from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { ToolFieldRole, ToolModeBanner } from './shared'
import { EMAIL_PROVIDERS, getProviderById, getGroupedProviders, type EmailProviderConfig } from '@/lib/email/providers'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const SmtpPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent, ui, emailProviderId, setEmailProviderId } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const selfHosted = useEdition() === 'selfhosted'
  const searchParams = useSearchParams()

  const providerId = emailProviderId
  const setProviderId = setEmailProviderId
  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [secure, setSecure] = useState(false)
  const [hasConnection, setHasConnection] = useState(false)
  const [storedConfig, setStoredConfig] = useState<{host: string; port: number; user: string; email?: string; secure?: boolean; providerId?: string; authType?: string} | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [connectingOAuth, setConnectingOAuth] = useState(false)
  const [showDevInfo, setShowDevInfo] = useState(false)

  const selectedProvider = getProviderById(providerId)
  const groupedProviders = getGroupedProviders()

  const handleProviderChange = (newProviderId: string) => {
    setProviderId(newProviderId)
    const provider = getProviderById(newProviderId)
    if (provider && newProviderId !== 'custom') {
      setHost(provider.smtp.host)
      setPort(String(provider.smtp.port))
      setSecure(provider.smtp.secure)
    }
  }

  useEffect(() => {
    if (!hasConnection) {
      const provider = getProviderById(providerId)
      if (provider && providerId !== 'custom') {
        setHost(provider.smtp.host)
        setPort(String(provider.smtp.port))
        setSecure(provider.smtp.secure)
      }
    }
  }, [providerId, hasConnection])

  const isToolNode = (node as any)?.type === 'tool'
  const mode = node.data.mode || 'send'
  const to = node.data.to || ''
  const toEmail = node.data.toEmail || ''
  const subject = node.data.subject || ''
  const body = node.data.body || '{{context.aiResponse}}'
  const fromName = node.data.fromName || ''
  const addPrefix = node.data.addPrefix || '[FWD]'
  const includeOriginalHeaders = node.data.includeOriginalHeaders !== false
  const emailIndex = node.data.emailIndex || 0

  const updateNodeDataRef = useRef(updateNodeData)
  updateNodeDataRef.current = updateNodeData
  const nodeRef = useRef(node)
  nodeRef.current = node

  const loadConnection = useCallback(async () => {
    if (!agent.agentId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/agent-studio/smtp?agentId=${agent.agentId}`)
      const data = await res.json()

      if (res.ok && data.hasConnection) {
        setHasConnection(true)
        setStoredConfig(data.config)
        const cur = nodeRef.current
        if (cur.type === 'tool' && data.connectionId && !cur.data.connectionId) {
          updateNodeDataRef.current({ connectionId: data.connectionId })
        }
        if (data.config?.providerId) {
          setProviderId(data.config.providerId)
          const provider = getProviderById(data.config.providerId)
          if (provider && data.config.providerId !== 'custom') {
            setHost(provider.smtp.host)
            setPort(String(provider.smtp.port))
            setSecure(provider.smtp.secure)
          }
        }
      } else {
        setHasConnection(false)
        setStoredConfig(null)
      }
    } catch (err) {
      console.error('Failed to load SMTP connection:', err)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.agentId])

  useEffect(() => {
    loadConnection()
  }, [loadConnection])

  useEffect(() => {
    const oauth = searchParams.get('oauth')
    const connected = searchParams.get('connected')
    const email = searchParams.get('email')
    const oauthError = searchParams.get('error')

    if (oauth === 'microsoft-email') {
      if (connected === 'true' && email) {
        setSuccessMessage(t.microsoft_connected?.replace('{email}', email) || `Connected: ${email}`)
        loadConnection()
      } else if (oauthError) {
        const guided =
          oauthError === 'invalid_state' ? t.oauth_error_invalid_state
          : oauthError === 'session_mismatch' ? t.oauth_error_session_mismatch
          : undefined
        setError(guided || t.oauth_error?.replace('{error}', oauthError) || `OAuth error: ${oauthError}`)
      }

      const url = new URL(window.location.href)
      url.searchParams.delete('oauth')
      url.searchParams.delete('connected')
      url.searchParams.delete('email')
      url.searchParams.delete('error')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams, loadConnection, t])

  const handleConnectMicrosoft = async () => {
    if (!agent.agentId) return

    setConnectingOAuth(true)
    setError(null)

    try {
      const res = await fetch(`/api/auth/microsoft-email/connect?agentId=${agent.agentId}&type=both`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start OAuth')
      }

      window.location.href = data.authUrl
    } catch (err: any) {
      setError(err.message)
      setConnectingOAuth(false)
    }
  }

  const handleTest = async () => {
    if (!agent.agentId || !host || !port || !user || !password) return

    setTesting(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const res = await fetch('/api/agent-studio/smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          host,
          port: Number(port),
          user,
          password,
          secure,
          testOnly: true
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Connection test failed')
      }

      setSuccessMessage(t.smtp_test_success || 'Connection successful!')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!agent.agentId || !host || !port || !user || !password) return

    setSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const res = await fetch('/api/agent-studio/smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          host,
          port: Number(port),
          user,
          password,
          secure,
          providerId,
          testOnly: false
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save connection')
      }

      setHasConnection(true)
      setStoredConfig({ host, port: Number(port), user, secure, providerId })
      setPassword('')
      const cur = nodeRef.current
      if (cur.type === 'tool' && data.connectionId) {
        updateNodeDataRef.current({ connectionId: data.connectionId })
      }
      setSuccessMessage(
        data.imapCreated
          ? (t.smtp_imap_save_success || 'SMTP and IMAP connections saved!')
          : (t.smtp_save_success || 'Connection saved!')
      )
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!agent.agentId) return
    if (!confirm(t.confirm_remove_connection || 'Remove SMTP connection?')) return

    try {
      const res = await fetch(`/api/agent-studio/smtp?agentId=${agent.agentId}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        setHasConnection(false)
        setStoredConfig(null)
        const cur = nodeRef.current
        if (cur.type === 'tool' && cur.data.connectionId) {
          updateNodeDataRef.current({ connectionId: '' })
        }
      }
    } catch (err) {
      console.error('Failed to delete connection:', err)
    }
  }

  return (
    <div className="space-y-4">
      {isToolNode && <ToolModeBanner text={t.tool_mode_banner} />}

      {/* Error/Success Message */}
      {error && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
          {selectedProvider?.requiresAppPassword && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-sm text-yellow-400 mb-1">
                {t.app_password_error_hint || 'Make sure you are using an App Password, not your regular password.'}
              </p>
              {!selfHosted && (
              <a
                href={t.imap_smtp_help_url || 'https://support.aitalk.ch/english/3rd-party/imap-smtp'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-400 hover:text-indigo-300 underline"
              >
                {t.how_to_create || 'How to set up'} →
              </a>
              )}
            </div>
          )}
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
          <span className="text-sm text-green-400">{successMessage}</span>
        </div>
      )}

      {/* Connection Section */}
      <div className="space-y-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-gray-400" />
            <label className="text-sm font-medium text-gray-200">{t.smtp_connection || 'SMTP Connection'}</label>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : hasConnection && storedConfig ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-green-400 truncate block" title={storedConfig.email || storedConfig.user}>
                  {storedConfig.email || storedConfig.user}
                </span>
                {storedConfig.authType === 'oauth' && (
                  <span className="text-xs text-green-400/70">Microsoft OAuth2</span>
                )}
              </div>
            </div>
            <button
              onClick={handleDelete}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              {t.remove_connection || 'Remove connection'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Provider Selection */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t.email_provider || 'Email Provider'}</label>
              <select
                value={providerId}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#3A3A3A] rounded-md text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {groupedProviders.map(group => (
                  <optgroup key={group.label} label={group.label}>
                    {group.providers.map(provider => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* OAuth2 for Outlook/Microsoft - Show only OAuth button */}
            {selectedProvider?.authType === 'oauth2' ? (
              <div className="space-y-3">
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-400">
                      {t.oauth2_required || 'OAuth2 authentication required for Microsoft accounts'}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleConnectMicrosoft}
                  disabled={connectingOAuth}
                  className="w-full bg-[#0078d4] hover:bg-[#106ebe] text-white"
                >
                  {connectingOAuth ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4 mr-2" />
                  )}
                  {t.connect_with_microsoft || 'Connect with Microsoft'}
                </Button>
              </div>
            ) : (
              /* Non-OAuth2 providers: Show credential fields */
              <>
                {/* App Password Hint */}
                {selectedProvider?.requiresAppPassword && (
                  <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-blue-400">
                          {t.app_password_required || 'App Password required (not your regular password)'}
                        </p>
                        {!selfHosted && (
                        <a
                          href={t.imap_smtp_help_url || 'https://support.aitalk.ch/english/3rd-party/imap-smtp'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 mt-1"
                        >
                          {t.how_to_create || 'How to set up'} <ExternalLink className="w-3 h-3" />
                        </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Host/Port - Auto-filled or Custom */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t.host || 'Host'}</label>
                    <Input
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="smtp.example.com"
                      autoComplete="off"
                      disabled={providerId !== 'custom'}
                      className={`bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm ${
                        providerId !== 'custom' ? 'opacity-70' : ''
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t.port || 'Port'}</label>
                    <Input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="587"
                      autoComplete="off"
                      disabled={providerId !== 'custom'}
                      className={`bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm ${
                        providerId !== 'custom' ? 'opacity-70' : ''
                      }`}
                    />
                  </div>
                </div>

                {/* Username */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t.username || 'Username'}</label>
                  <Input
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder={selectedProvider?.id === 'gmail' ? 'user@gmail.com' : 'user@example.com'}
                    autoComplete="off"
                    className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    {selectedProvider?.requiresAppPassword
                      ? (t.app_password || 'App Password')
                      : (t.password || 'Password')}
                    {selectedProvider?.requiresAppPassword && (
                      <span className="ml-1 text-gray-500 normal-case">
                        {t.app_password_label_hint || '(not your regular password)'}
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value.replace(/\s/g, ''))}
                      placeholder={selectedProvider?.requiresAppPassword ? 'xxxx xxxx xxxx xxxx' : 'Password or App Password'}
                      autoComplete="new-password"
                      className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* SSL/TLS Option - Only for Custom */}
                {providerId === 'custom' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="secure"
                      checked={secure}
                      onChange={(e) => setSecure(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 bg-[#1A1A1A] text-indigo-500"
                    />
                    <label htmlFor="secure" className="text-sm text-gray-200">
                      {t.use_ssl || 'Use SSL/TLS (port 465)'}
                    </label>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleTest}
                    disabled={testing || !host || !port || !user || !password}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {t.test_connection || 'Test'}
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={saving || !host || !port || !user || !password}
                    size="sm"
                    className="flex-1"
                  >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {t.save || 'Save'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {!isToolNode && (
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">{t.mode || 'Mode'}</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => updateNodeData({ mode: 'send' })}
            className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'send'
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                : 'bg-[#1A1A1A] border-[#3A3A3A] text-gray-400 hover:border-gray-500'
            }`}
          >
            <Send className="w-5 h-5 mx-auto mb-1" />
            {t.send_email || 'Send'}
          </button>
          <button
            onClick={() => updateNodeData({ mode: 'forward' })}
            className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'forward'
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                : 'bg-[#1A1A1A] border-[#3A3A3A] text-gray-400 hover:border-gray-500'
            }`}
          >
            <Forward className="w-5 h-5 mx-auto mb-1" />
            {t.forward_email || 'Forward'}
          </button>
        </div>
      </div>
      )}

      {/* Common: To Email */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-sm font-medium text-gray-200">{t.to_email || 'To'}</label>
          <div className="group relative">
            <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
              {t.to_email_tooltip || 'Supports template variables like {{context.email}}'}
            </div>
          </div>
          {isToolNode && (
            <ToolFieldRole role={toEmail ? 'pin' : 'ai'} label={toEmail ? t.tool_field_pinned : t.tool_field_ai} />
          )}
        </div>
        <Input
          value={isToolNode ? toEmail : to}
          onChange={(e) => updateNodeData(isToolNode ? { toEmail: e.target.value } : { to: e.target.value })}
          placeholder="{{context.email}} or user@example.com"
          className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
        />
        {isToolNode && (
          <p className="text-[11px] text-gray-500 mt-1">
            {toEmail ? t.tool_field_pinned_hint : t.tool_field_ai_hint}
          </p>
        )}
      </div>

      {/* Mode-specific settings */}
      {!isToolNode && mode === 'send' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">
              {t.from_name || 'From name'} <span className="text-gray-500 text-xs">({t.optional || 'optional'})</span>
            </label>
            <Input
              value={fromName}
              onChange={(e) => updateNodeData({ fromName: e.target.value })}
              placeholder="My Company"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.subject || 'Subject'}</label>
            <Input
              value={subject}
              onChange={(e) => updateNodeData({ subject: e.target.value })}
              placeholder="Your notification"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-200">{t.body || 'Body'}</label>
              <div className="group relative">
                <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                  {t.body_tooltip || 'Supports Markdown and template variables'}
                </div>
              </div>
            </div>
            <div
              className="relative w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#1A1A1A] text-gray-200 min-h-[100px] cursor-pointer hover:border-gray-500 transition-colors overflow-hidden"
              onClick={() => ui.openModal('smtpBody')}
            >
              <div className="text-sm font-mono whitespace-pre-wrap break-words line-clamp-4 pr-6">
                {body || '{{context.aiResponse}}'}
              </div>
              <div className="absolute bottom-2 right-2 bg-[#1A1A1A] rounded p-0.5">
                <Maximize2 className="w-4 h-4 text-gray-400 hover:text-gray-200" />
              </div>
            </div>
          </div>
        </div>
      )}

      {!isToolNode && mode === 'forward' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">
              {t.from_name || 'From name'} <span className="text-gray-500 text-xs">({t.optional || 'optional'})</span>
            </label>
            <Input
              value={fromName}
              onChange={(e) => updateNodeData({ fromName: e.target.value })}
              placeholder="My Company"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.subject_prefix || 'Subject prefix'}</label>
            <Input
              value={addPrefix}
              onChange={(e) => updateNodeData({ addPrefix: e.target.value })}
              placeholder="[FWD]"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="includeHeaders"
              checked={includeOriginalHeaders}
              onChange={(e) => updateNodeData({ includeOriginalHeaders: e.target.checked })}
              className="w-4 h-4 rounded border-gray-600 bg-[#1A1A1A] text-indigo-500"
            />
            <label htmlFor="includeHeaders" className="text-sm text-gray-200">
              {t.include_original_headers || 'Include original headers'}
            </label>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-200">{t.email_index || 'Email index'}</label>
              <div className="group relative">
                <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                  {t.email_index_tooltip || 'Index of email to forward from IMAP Read result (0 = first)'}
                </div>
              </div>
            </div>
            <Input
              type="number"
              value={emailIndex}
              onChange={(e) => updateNodeData({ emailIndex: Number(e.target.value) || 0 })}
              min={0}
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
        </div>
      )}

      {/* Info */}
      <div className="pt-3 border-t border-[#3A3A3A]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            <Mail className="w-4 h-4 text-indigo-400" />
            <span>{t.smtp_result_info || 'You can use template variables to compose emails'}</span>
          </div>
          <button
            onClick={() => setShowDevInfo(true)}
            className="text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap ml-2"
          >
            {t.developer_info || 'Developer Info'}
          </button>
        </div>
      </div>

      {/* Developer Info Dialog */}
      <Dialog open={showDevInfo} onOpenChange={setShowDevInfo}>
        <DialogContent className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 max-w-md">
          <DialogHeader>
            <DialogTitle>{t.developer_info || 'Developer Info'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-400 mb-1">{t.result_stored_in || 'Result is stored in'}:</p>
              <code className="block p-2 bg-[#2A2A2A] rounded text-indigo-400">context.smtpResult</code>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.template_variables || 'Template Variables'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-indigo-400">{`{{aiResponse}}`}</span> - AI response text</p>
                <p><span className="text-indigo-400">{`{{message}}`}</span> - User message</p>
                <p><span className="text-indigo-400">{`{{context.xxx}}`}</span> - Context variables</p>
                <p><span className="text-indigo-400">{`{{imapResult.emails[0].subject}}`}</span> - Email subject</p>
                <p><span className="text-indigo-400">{`{{imapResult.emails[0].body}}`}</span> - Email body</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
