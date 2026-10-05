'use client'

import { useEdition } from '@/components/EditionProvider'
import React, { useState, useEffect, useCallback } from 'react'
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
  FolderInput,
  Search,
  ArrowRight,
  CheckCheck,
  Copy,
  Trash2,
  Layers,
  Plus,
  X,
  ChevronDown,
  ExternalLink,
  Link2
} from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { EMAIL_PROVIDERS, getProviderById, getGroupedProviders, type EmailProviderConfig } from '@/lib/email/providers'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const ImapPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent, emailProviderId, setEmailProviderId, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const selfHosted = useEdition() === 'selfhosted'
  const searchParams = useSearchParams()

  const providerId = emailProviderId
  const setProviderId = setEmailProviderId
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [hasConnection, setHasConnection] = useState(false)
  const [storedConfig, setStoredConfig] = useState<{host: string; port: number; user: string; email?: string; providerId?: string; authType?: string} | null>(null)
  const [folders, setFolders] = useState<string[]>([])
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
      setHost(provider.imap.host)
      setPort(String(provider.imap.port))
    }
  }

  useEffect(() => {
    if (!hasConnection) {
      const provider = getProviderById(providerId)
      if (provider && providerId !== 'custom') {
        setHost(provider.imap.host)
        setPort(String(provider.imap.port))
      }
    }
  }, [providerId, hasConnection])

  const action = node.data.action || 'read'
  const folder = node.data.folder ?? ''
  const onlyUnseen = node.data.onlyUnseen !== false
  const maxEmails = node.data.maxEmails || 10
  const targetFolder = node.data.targetFolder || ''
  const emailUid = node.data.emailUid || ''
  const uidToMark = node.data.uidToMark || ''
  const uidToDelete = node.data.uidToDelete || ''
  const batchSource = node.data.batchSource || 'jsonData.classifications'
  const folderMapping = node.data.folderMapping || {
    spam: 'Spam',
    support: 'Support',
    invoice: 'Invoice',
    general: 'General',
    default: 'General'
  }

  const loadConnection = useCallback(async () => {
    if (!agent.agentId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/agent-studio/imap?agentId=${agent.agentId}`)
      const data = await res.json()

      if (res.ok && data.hasConnection) {
        setHasConnection(true)
        setStoredConfig(data.config)
        if (data.config?.providerId) {
          setProviderId(data.config.providerId)
          const provider = getProviderById(data.config.providerId)
          if (provider && data.config.providerId !== 'custom') {
            setHost(provider.imap.host)
            setPort(String(provider.imap.port))
          }
        }
      } else {
        setHasConnection(false)
        setStoredConfig(null)
      }
    } catch (err) {
      console.error('Failed to load IMAP connection:', err)
    } finally {
      setLoading(false)
    }
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
      const res = await fetch('/api/agent-studio/imap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          host,
          port: Number(port),
          user,
          password,
          testOnly: true
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Connection test failed')
      }

      setFolders(data.folders || [])
      setSuccessMessage(t.imap_test_success || 'Connection successful!')
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
      const res = await fetch('/api/agent-studio/imap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          host,
          port: Number(port),
          user,
          password,
          providerId,
          testOnly: false
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save connection')
      }

      setHasConnection(true)
      setStoredConfig({ host, port: Number(port), user, providerId })
      setFolders(data.folders || [])
      setPassword('')
      setSuccessMessage(
        data.smtpCreated
          ? (t.imap_smtp_save_success || 'IMAP and SMTP connections saved!')
          : (t.imap_save_success || 'Connection saved!')
      )
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!agent.agentId) return
    if (!confirm(t.confirm_remove_connection || 'Remove IMAP connection?')) return

    try {
      const res = await fetch(`/api/agent-studio/imap?agentId=${agent.agentId}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        setHasConnection(false)
        setStoredConfig(null)
        setFolders([])
      }
    } catch (err) {
      console.error('Failed to delete connection:', err)
    }
  }

  return (
    <div className="space-y-4">
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
            <label className="text-sm font-medium text-gray-200">{t.imap_connection || 'IMAP Connection'}</label>
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
                      placeholder="imap.example.com"
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
                      placeholder="993"
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

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleTest}
                    disabled={testing || !host || !port || !user || !password}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
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

      {/* Action Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">{t.action || 'Action'}</label>
        <div className="grid grid-cols-3 gap-1.5">
          {['read', 'move', 'copy', 'delete', 'markRead'].map((act) => (
            <button
              key={act}
              onClick={() => updateNodeData({ action: act })}
              className={`p-2 rounded-lg border text-[10px] font-medium transition-colors ${
                action === act
                  ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                  : 'bg-[#1A1A1A] border-[#3A3A3A] text-gray-400 hover:border-gray-500'
              }`}
            >
              {act === 'read' && <Search className="w-3.5 h-3.5 mx-auto mb-0.5" />}
              {act === 'move' && <ArrowRight className="w-3.5 h-3.5 mx-auto mb-0.5" />}
              {act === 'copy' && <Copy className="w-3.5 h-3.5 mx-auto mb-0.5" />}
              {act === 'delete' && <Trash2 className="w-3.5 h-3.5 mx-auto mb-0.5" />}
              {act === 'markRead' && <CheckCheck className="w-3.5 h-3.5 mx-auto mb-0.5" />}
              {act === 'read' ? (t.read || 'Read')
                : act === 'move' ? (t.move || 'Move')
                : act === 'copy' ? (t.copy || 'Copy')
                : act === 'delete' ? (t.delete || 'Delete')
                : (t.mark_read || 'Mark Read')}
            </button>
          ))}
        </div>
      </div>

      {/* Action-specific settings */}
      {action === 'read' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.folder || 'Folder'}</label>
            {folders.length > 0 ? (
              <select
                value={folder}
                onChange={(e) => updateNodeData({ folder: e.target.value || 'INBOX' })}
                className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-md text-gray-200 text-sm"
              >
                {folders.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            ) : (
              <Input
                value={folder}
                onChange={(e) => updateNodeData({ folder: e.target.value || 'INBOX' })}
                placeholder="INBOX"
                className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="onlyUnseen"
              checked={onlyUnseen}
              onChange={(e) => updateNodeData({ onlyUnseen: e.target.checked })}
              className="w-4 h-4 rounded border-gray-600 bg-[#1A1A1A] text-indigo-500"
            />
            <label htmlFor="onlyUnseen" className="text-sm text-gray-200">
              {t.only_unseen || 'Only unread emails'}
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.max_emails || 'Max emails'}</label>
            <Input
              type="number"
              value={maxEmails}
              onChange={(e) => updateNodeData({ maxEmails: Number(e.target.value) || 10 })}
              min={1}
              max={100}
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
        </div>
      )}

      {action === 'move' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.source_folder || 'Source folder'}</label>
            <Input
              value={folder}
              onChange={(e) => updateNodeData({ folder: e.target.value || 'INBOX' })}
              placeholder="INBOX"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.target_folder || 'Target folder'}</label>
            <Input
              value={targetFolder}
              onChange={(e) => updateNodeData({ targetFolder: e.target.value })}
              placeholder="Spam"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-200">{t.email_uid || 'Email UID'}</label>
              <div className="group relative">
                <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                  {t.email_uid_tooltip || 'Use {{imapResult.emails[0].uid}} to get UID from previous IMAP Read'}
                </div>
              </div>
            </div>
            <Input
              value={emailUid}
              onChange={(e) => updateNodeData({ emailUid: e.target.value })}
              placeholder="{{imapResult.emails[0].uid}}"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 font-mono text-sm"
            />
          </div>
        </div>
      )}

      {action === 'copy' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.source_folder || 'Source folder'}</label>
            <Input
              value={folder}
              onChange={(e) => updateNodeData({ folder: e.target.value || 'INBOX' })}
              placeholder="INBOX"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.target_folder || 'Target folder'}</label>
            <Input
              value={targetFolder}
              onChange={(e) => updateNodeData({ targetFolder: e.target.value })}
              placeholder="Archive"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-200">{t.email_uid || 'Email UID'}</label>
              <div className="group relative">
                <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                  {t.email_uid_tooltip || 'Use {{imapResult.emails[0].uid}} to get UID from previous IMAP Read'}
                </div>
              </div>
            </div>
            <Input
              value={emailUid}
              onChange={(e) => updateNodeData({ emailUid: e.target.value })}
              placeholder="{{imapResult.emails[0].uid}}"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 font-mono text-sm"
            />
          </div>
        </div>
      )}

      {action === 'delete' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.folder || 'Folder'}</label>
            <Input
              value={folder}
              onChange={(e) => updateNodeData({ folder: e.target.value || 'INBOX' })}
              placeholder="INBOX"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-200">{t.email_uid || 'Email UID'}</label>
              <div className="group relative">
                <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                  {t.email_uid_tooltip || 'Use {{imapResult.emails[0].uid}} to get UID from previous IMAP Read'}
                </div>
              </div>
            </div>
            <Input
              value={uidToDelete}
              onChange={(e) => updateNodeData({ uidToDelete: e.target.value })}
              placeholder="{{imapResult.emails[0].uid}}"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 font-mono text-sm"
            />
          </div>
          <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
            {t.delete_warning || '⚠️ This action permanently deletes the email.'}
          </div>
        </div>
      )}

      {action === 'markRead' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.folder || 'Folder'}</label>
            <Input
              value={folder}
              onChange={(e) => updateNodeData({ folder: e.target.value || 'INBOX' })}
              placeholder="INBOX"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-200">{t.email_uid || 'Email UID'}</label>
              <div className="group relative">
                <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                  {t.email_uid_mark_tooltip || 'ForEach: {{context.currentEmail.uid}}\nDirect: {{imapResult.emails[0].uid}}'}
                </div>
              </div>
            </div>
            <Input
              value={uidToMark}
              onChange={(e) => updateNodeData({ uidToMark: e.target.value })}
              placeholder="{{context.currentEmail.uid}}"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 font-mono text-sm"
            />
          </div>
        </div>
      )}

      {/* Info */}
      <div className="pt-3 border-t border-[#3A3A3A]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            <Mail className="w-4 h-4 text-indigo-400" />
            <span>{t.imap_result_info || 'You can use the retrieved emails in other nodes'}</span>
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
              <code className="block p-2 bg-[#2A2A2A] rounded text-indigo-400">context.imapResult</code>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.available_fields || 'Available fields'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-indigo-400">emails[].uid</span> - Email unique ID</p>
                <p><span className="text-indigo-400">emails[].subject</span> - Email subject</p>
                <p><span className="text-indigo-400">emails[].from</span> - Sender</p>
                <p><span className="text-indigo-400">emails[].date</span> - Received date</p>
                <p><span className="text-indigo-400">emails[].body</span> - Email body</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
