'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { Node } from 'reactflow'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Eye,
  EyeOff,
  Info,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Key,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Wifi,
  WifiOff
} from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MessageSquare } from 'lucide-react'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const TelegramStartPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent, workflow } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [botToken, setBotToken] = useState('')
  const [showBotToken, setShowBotToken] = useState(false)
  const [hasStoredToken, setHasStoredToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [webhookStatus, setWebhookStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown')
  const [botUsername, setBotUsername] = useState<string | null>(null)

  const [showGuide, setShowGuide] = useState(false)

  const [showDevInfo, setShowDevInfo] = useState(false)

  const parseMode = node.data.parseMode || 'HTML'

  const webhookUrl = agent.workflowId
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/telegram/webhook/${agent.workflowId}`
    : ''

  const loadBotTokenStatus = useCallback(async () => {
    if (!agent.agentId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/agent-studio/telegram?agentId=${agent.agentId}&provider=telegram_webhook`)
      const data = await res.json()

      if (res.ok && data.hasBotToken) {
        setHasStoredToken(true)
        setBotUsername(data.botUsername || null)
        if (data.webhookSet) {
          setWebhookStatus('connected')
        } else {
          setWebhookStatus('disconnected')
        }
      } else {
        setHasStoredToken(false)
        setBotUsername(null)
        setWebhookStatus('unknown')
      }
    } catch (err) {
      console.error('Failed to load Bot Token status:', err)
    } finally {
      setLoading(false)
    }
  }, [agent.agentId])

  useEffect(() => {
    loadBotTokenStatus()
  }, [loadBotTokenStatus])

  const handleSaveBotToken = async () => {
    if (!agent.agentId || !botToken || !agent.workflowId) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/agent-studio/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          botToken: botToken,
          provider: 'telegram_webhook',
          workflowId: agent.workflowId
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save Bot Token')
      }

      const webhookRes = await fetch('/api/agent-studio/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          workflowId: agent.workflowId,
          webhookUrl: webhookUrl
        })
      })

      const webhookData = await webhookRes.json()

      if (!webhookRes.ok) {
        setHasStoredToken(true)
        setBotToken('')
        setBotUsername(data.botUsername || null)
        setWebhookStatus('disconnected')
        throw new Error(webhookData.error || 'Failed to set webhook')
      }

      setHasStoredToken(true)
      setBotToken('')
      setBotUsername(data.botUsername || null)
      setWebhookStatus('connected')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteBotToken = async () => {
    if (!agent.agentId) return
    if (!confirm(t.confirm_remove_api_key)) return

    try {
      const res = await fetch(`/api/agent-studio/telegram?agentId=${agent.agentId}&provider=telegram_webhook`, {
        method: 'DELETE'
      })

      if (res.ok) {
        setHasStoredToken(false)
        setBotUsername(null)
        setWebhookStatus('unknown')
      }
    } catch (err) {
      console.error('Failed to delete Bot Token:', err)
    }
  }

  return (
    <div className="space-y-4">
      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {/* How to Setup Guide (Collapsible) */}
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
            {/* Create Bot Guide */}
            <div>
              <ol className="list-decimal list-inside space-y-1">
                <li>{t.telegram_step1_1 || 'Open Telegram and search for @BotFather'}</li>
                <li>{t.telegram_step1_2 || 'Send /newbot command'}</li>
                <li>{t.telegram_step1_3 || 'Enter a name and username for your bot'}</li>
                <li>{t.telegram_step1_4 || 'Copy the Bot Token provided'}</li>
                <li>{t.telegram_step1_5 || 'Paste the Bot Token below and click Save'}</li>
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
          </div>
        )}
      </div>

      {/* Bot Token Section */}
      <div className="space-y-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-gray-400" />
          <label className="text-sm font-medium text-gray-200">{t.telegram_bot_token || 'Bot Token'}</label>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : hasStoredToken ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-sm text-green-400">{t.api_key_configured}</span>
            </div>
            <div className="flex items-center gap-2">
              {webhookStatus === 'connected' ? (
                <>
                  <Wifi className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-400">{t.telegram_status_connected || 'Connected'}</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm text-yellow-400">{t.telegram_status_disconnected || 'Disconnected'}</span>
                </>
              )}
            </div>
            {botUsername && (
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                t.me/{botUsername}
              </a>
            )}
            <button
              onClick={handleDeleteBotToken}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              {t.remove_api_key}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Input
                type={showBotToken ? 'text' : 'password'}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHI..."
                autoComplete="new-password"
                className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowBotToken(!showBotToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
              >
                {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button
              onClick={handleSaveBotToken}
              disabled={saving || !botToken}
              className="w-full"
              size="sm"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t.saving}
                </>
              ) : (
                t.save_api_key
              )}
            </Button>
            <p className="text-xs text-gray-500">
              {t.telegram_get_token || 'Get token from'}{' '}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                @BotFather
              </a>
            </p>
          </div>
        )}
      </div>

      {/* Response Settings */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-200">{t.telegram_response_settings || 'Response Settings'}</p>

        {/* Parse Mode */}
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">{t.telegram_parse_mode || 'Parse Mode'}</label>
          <Select
            value={parseMode}
            onValueChange={(value) => updateNodeData({ parseMode: value })}
          >
            <SelectTrigger className="w-32 bg-[#1A1A1A] border-[#3A3A3A] text-gray-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HTML">HTML</SelectItem>
              <SelectItem value="Markdown">Markdown</SelectItem>
              <SelectItem value="MarkdownV2">MarkdownV2</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Info */}
      <div className="pt-3 border-t border-[#3A3A3A]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <span>{t.telegram_start_result_info || 'User messages trigger this workflow'}</span>
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
              <p className="text-gray-400 mb-1">{t.telegram_start_user_message || 'User message available as'}:</p>
              <code className="block p-2 bg-[#2A2A2A] rounded text-indigo-400">{`{{message}}`}</code>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.available_context_variables || 'Available context variables'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-indigo-400">{`{{message}}`}</span> - {t.telegram_var_message || 'User message text'}</p>
                <p><span className="text-indigo-400">{`{{telegramChatId}}`}</span> - {t.telegram_var_chat_id || 'Telegram chat ID'}</p>
                <p><span className="text-indigo-400">{`{{telegramUserId}}`}</span> - {t.telegram_var_user_id || 'Telegram user ID'}</p>
                <p><span className="text-indigo-400">{`{{telegramUsername}}`}</span> - {t.telegram_var_username || 'Username or first name'}</p>
              </div>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.telegram_start_usage || 'Usage in AI node'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs">
                <p className="text-gray-300">System Message:</p>
                <p className="text-indigo-400 mt-1">{`You are chatting with {{telegramUsername}}`}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
