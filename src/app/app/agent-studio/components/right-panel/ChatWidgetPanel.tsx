'use client'

import React from 'react'
import type { Node } from 'reactflow'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import {
  ExternalLink,
  Wand2,
  ImageIcon,
  MessageCircle,
  Shield,
  MousePointerClick,
  Code,
  Mic,
  Settings2,
} from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const ChatWidgetPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const accessMode = (node.data.accessMode || agent.accessMode || 'public') as 'public' | 'team'

  const webVoiceEnabled = node.data.webVoice?.enabled === true

  const handleWidgetTypeChange = (type: 'public' | 'team') => {
    updateNodeData({ accessMode: type })
  }

  const handleWebVoiceToggle = (enabled: boolean) => {
    if (enabled) {
      updateNodeData({
        webVoice: { enabled: true, timeLimitMin: 10, iconStyle: 'classic', iconColor: '#FFFFFF', backgroundColor: '#14B8A6', animation: true },
        language: node.data.language || 'en-US',
        voiceName: node.data.voiceName || 'en-US-JennyNeural',
      })
    } else {
      updateNodeData({ webVoice: null })
    }
  }

  return (
    <div className="space-y-4">
      {/* Chat Widget Type Selection */}
      <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">{t.widget_type}</label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="widgetType"
              value="public"
              checked={accessMode === 'public'}
              onChange={(e) => handleWidgetTypeChange(e.target.value as 'public' | 'team')}
              className="w-4 h-4 text-primary"
            />
            <span className="text-sm text-gray-200">{t.public_service}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="widgetType"
              value="team"
              checked={accessMode === 'team'}
              onChange={(e) => handleWidgetTypeChange(e.target.value as 'public' | 'team')}
              className="w-4 h-4 text-primary"
            />
            <span className="text-sm text-gray-200">{t.team_member}</span>
          </label>
        </div>
      </div>

      {/* Team Welcome Message (only for Team) */}
      {accessMode === 'team' && (
        <div className="pt-4 border-t border-[#3A3A3A]">
          <label className="text-sm font-medium text-gray-200 mb-2 block">{t.team_welcome_message}</label>
          <Input
            value={node.data.teamWelcomeMessage || ''}
            onChange={(e) => updateNodeData({ teamWelcomeMessage: e.target.value })}
            placeholder={t.team_welcome_message_placeholder || 'Hello, how can I help you?'}
            className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm"
            autoComplete="off"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t.team_welcome_message_hint}
          </p>
        </div>
      )}

      {/* Chat Settings Buttons (only for Public) */}
      {accessMode === 'public' && (
        <div className="pt-4 border-t border-[#3A3A3A]">
          <label className="text-sm font-medium text-gray-200 mb-3 block">{t.chat_settings}</label>
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
              onClick={() => window.open('/app/chat-settings?tab=general', '_blank')}
            >
              <Wand2 className="w-4 h-4 mr-2" />
              {t.general}
              <ExternalLink className="w-3 h-3 ml-auto" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
              onClick={() => window.open('/app/chat-settings?tab=icons', '_blank')}
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              {t.icons}
              <ExternalLink className="w-3 h-3 ml-auto" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
              onClick={() => window.open('/app/chat-settings?tab=experience', '_blank')}
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              {t.experience}
              <ExternalLink className="w-3 h-3 ml-auto" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
              onClick={() => window.open('/app/chat-settings?tab=privacy', '_blank')}
            >
              <Shield className="w-4 h-4 mr-2" />
              {t.privacy}
              <ExternalLink className="w-3 h-3 ml-auto" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
              onClick={() => window.open('/app/chat-settings?tab=chat-button', '_blank')}
            >
              <MousePointerClick className="w-4 h-4 mr-2" />
              {t.chat_button}
              <ExternalLink className="w-3 h-3 ml-auto" />
            </Button>
          </div>
        </div>
      )}

      {/* Web Voice */}
      <div className="pt-4 border-t border-[#3A3A3A]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-teal-400" />
            <label className="text-sm font-medium text-gray-200">{t.chat_web_voice || 'Web Voice'}</label>
          </div>
          <Switch
            checked={webVoiceEnabled}
            onCheckedChange={handleWebVoiceToggle}
            className="data-[state=checked]:bg-teal-500 data-[state=checked]:border-[#5A5A5A]"
          />
        </div>
        <p className="text-xs text-gray-500 mb-3">
          {t.chat_web_voice_desc || 'Enable browser voice calling in your chat widget'}
        </p>

        {webVoiceEnabled && (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9 mt-2"
            onClick={() => ui.openModal('pstnAdvanced', node.id)}
          >
            <Settings2 className="w-4 h-4 mr-2" />
            {t.chat_web_voice_advanced || 'Voice Settings'}
            <ExternalLink className="w-3 h-3 ml-auto" />
          </Button>
        )}
      </div>

      {/* Widget Integration */}
      <div className="pt-4 border-t border-[#3A3A3A]">
        <label className="text-sm font-medium text-gray-200 mb-3 block">{t.widget_integration}</label>
        <div className="space-y-2">
          {agent.workflowStatus === 'production' ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
              onClick={() => ui.setShowWidgetModal('url')}
            >
              <Code className="w-4 h-4 mr-2" />
              {t.chat_widget_url}
              <ExternalLink className="w-3 h-3 ml-auto" />
            </Button>
          ) : (
            <p className="text-xs text-yellow-500 px-1">
              {t.url_requires_active || 'Set workflow to Active to get the URL.'}
            </p>
          )}
          {accessMode === 'public' && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
                onClick={() => ui.setShowWidgetModal('iframe')}
              >
                <Code className="w-4 h-4 mr-2" />
                {t.iframe_code}
                <ExternalLink className="w-3 h-3 ml-auto" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-start h-9"
                onClick={() => ui.setShowWidgetModal('embed')}
              >
                <Code className="w-4 h-4 mr-2" />
                {t.javascript_embed}
                <ExternalLink className="w-3 h-3 ml-auto" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
