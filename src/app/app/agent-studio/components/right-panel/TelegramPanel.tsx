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
  Send,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  BellOff
} from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { ToolFieldRole, ToolModeBanner } from './shared'
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

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const TelegramPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [botToken, setBotToken] = useState('')
  const [showBotToken, setShowBotToken] = useState(false)
  const [hasStoredToken, setHasStoredToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showGuide, setShowGuide] = useState(false)

  const [showDevInfo, setShowDevInfo] = useState(false)

  const isToolNode = (node as any)?.type === 'tool'
  const chatId = node.data.chatId || ''
  const message = node.data.message || '{{context.aiResponse}}'
  const parseMode = node.data.parseMode || 'HTML'
  const disableNotification = node.data.disableNotification || false

  const loadBotTokenStatus = useCallback(async () => {
    if (!agent.agentId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/agent-studio/telegram?agentId=${agent.agentId}`)
      const data = await res.json()

      if (res.ok && data.hasBotToken) {
        setHasStoredToken(true)
      } else {
        setHasStoredToken(false)
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
    if (!agent.agentId || !botToken) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/agent-studio/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          botToken: botToken
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save Bot Token')
      }

      setHasStoredToken(true)
      setBotToken('')  // Clear input after saving
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
      const res = await fetch(`/api/agent-studio/telegram?agentId=${agent.agentId}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        setHasStoredToken(false)
      }
    } catch (err) {
      console.error('Failed to delete Bot Token:', err)
    }
  }

  return (
    <div className="space-y-4">
      {isToolNode && <ToolModeBanner text={t.tool_mode_banner} />}

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

      {/* Bot Token Section */}
      <div className="space-y-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-gray-400" />
            <label className="text-sm font-medium text-gray-200">{t.telegram_bot_token || 'Bot Token'}</label>
          </div>
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

      {/* Message Configuration */}
      <div className="space-y-4">
        {/* Chat ID */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm font-medium text-gray-200">{t.telegram_chat_id || 'Chat ID'}</label>
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                {t.telegram_chat_id_tooltip || 'User or group chat ID. Use numeric ID for individuals, or @username for public channels.'}
              </div>
            </div>
          </div>
          <Input
            value={chatId}
            onChange={(e) => updateNodeData({ chatId: e.target.value })}
            placeholder="123456789 or {{context.chatId}}"
            className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
          />
          {isToolNode && <p className="text-[11px] text-gray-500 mt-1">{t.tool_field_conn_wins}</p>}
        </div>

        {/* Message Template */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm font-medium text-gray-200">{t.telegram_message || 'Message'}</label>
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                {t.telegram_message_tooltip || 'Message to send. Supports template variables like {{context.aiResponse}}, {{message}}.'}
              </div>
            </div>
            {isToolNode && <ToolFieldRole role="ai" label={t.tool_field_ai} />}
          </div>
          <textarea
            value={message}
            onChange={(e) => updateNodeData({ message: e.target.value || '{{context.aiResponse}}' })}
            placeholder="{{context.aiResponse}}"
            rows={6}
            disabled={isToolNode}
            className="w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#1A1A1A] text-gray-200 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-gray-500">
            {isToolNode
              ? t.tool_field_ai_hint
              : `Variables: {{context.aiResponse}}, {{context.jsonData.xxx}}, {{message}}`}
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-200">{t.telegram_options || 'Options'}</p>

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

          {/* Disable Notification */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellOff className="w-4 h-4 text-gray-400" />
              <label className="text-sm text-gray-400">{t.telegram_disable_notification || 'Silent notification'}</label>
            </div>
            <input
              type="checkbox"
              checked={disableNotification}
              onChange={(e) => updateNodeData({ disableNotification: e.target.checked })}
              className="w-4 h-4 rounded border-gray-600 bg-[#1A1A1A] text-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="pt-3 border-t border-[#3A3A3A]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            <Send className="w-4 h-4 text-blue-400" />
            <span>{t.telegram_result_info || 'You can use the result in other nodes'}</span>
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
              <code className="block p-2 bg-[#2A2A2A] rounded text-indigo-400">context.telegramResult</code>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.available_fields || 'Available fields'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-indigo-400">success</span> - {t.telegram_field_success || 'Whether message was sent'}</p>
                <p><span className="text-indigo-400">messageId</span> - {t.telegram_field_message_id || 'Telegram message ID'}</p>
                <p><span className="text-indigo-400">chatId</span> - {t.telegram_field_chat_id || 'Target chat ID'}</p>
                <p><span className="text-indigo-400">error</span> - {t.telegram_field_error || 'Error message (if failed)'}</p>
              </div>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.template_variables || 'Template variables'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-indigo-400">{`{{context.aiResponse}}`}</span> - AI response</p>
                <p><span className="text-indigo-400">{`{{message}}`}</span> - User message</p>
                <p><span className="text-indigo-400">{`{{context.xxx}}`}</span> - Context data</p>
                <p><span className="text-indigo-400">{`{{jsonData.xxx}}`}</span> - JSON Schema data</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
