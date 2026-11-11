'use client'

import React, { useState } from 'react'
import type { Node } from 'reactflow'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { Input } from '@/components/ui/input'
import {
  Info,
  Mail,
  Maximize2
} from 'lucide-react'
import { SendGridIcon } from '../../constants/components'
import { SendGridConnectionForm } from './SendGridConnectionForm'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { ToolFieldRole, ToolModeBanner } from './shared'
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

export const SendGridPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [showDevInfo, setShowDevInfo] = useState(false)

  const toEmail = node.data.toEmail || ''
  const isToolNode = (node as any)?.type === 'tool'
  const fromEmail = node.data.fromEmail || ''
  const fromName = node.data.fromName || ''
  const subject = node.data.subject || ''
  const bodyTemplate = node.data.bodyTemplate || '{{context.aiResponse}}'

  return (
    <div className="space-y-4">
      {/* Header with AI Assistant Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">SendGrid Email</h3>
      </div>

      {isToolNode && <ToolModeBanner text={t.tool_mode_banner} />}

      {agent.agentId && <SendGridConnectionForm agentId={agent.agentId} />}

      {/* Email Configuration */}
      <div className="space-y-4">
        {/* From Email */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm font-medium text-gray-200">{t.from_email}</label>
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                {t.from_email_tooltip}
              </div>
            </div>
          </div>
          <Input
            value={fromEmail}
            onChange={(e) => updateNodeData({ fromEmail: e.target.value })}
            placeholder="noreply@example.com"
            className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
          />
          {isToolNode && <p className="text-[11px] text-gray-500 mt-1">{t.sendgrid_from_node_wins}</p>}
        </div>

        {/* From Name */}
        <div>
          <label className="block text-sm font-medium text-gray-200 mb-1.5">
            {t.from_name} <span className="text-gray-500 text-xs">({t.optional})</span>
          </label>
          <Input
            value={fromName}
            onChange={(e) => updateNodeData({ fromName: e.target.value })}
            placeholder="My Company"
            className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
          />
        </div>

        {/* To Email */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm font-medium text-gray-200">{t.to_email}</label>
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                {t.to_email_tooltip}
              </div>
            </div>
            {isToolNode && (
              <ToolFieldRole role={toEmail ? 'pin' : 'ai'} label={toEmail ? t.tool_field_pinned : t.tool_field_ai} />
            )}
          </div>
          <Input
            value={toEmail}
            onChange={(e) => updateNodeData({ toEmail: e.target.value })}
            placeholder="{{context.email}} or user@example.com"
            className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
          />
          {isToolNode && (
            <p className="text-[11px] text-gray-500 mt-1">
              {toEmail ? t.tool_field_pinned_hint : t.tool_field_ai_hint}
            </p>
          )}
        </div>

        {/* Subject */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm font-medium text-gray-200">{t.subject}</label>
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                {t.subject_tooltip}
              </div>
            </div>
            {isToolNode && <ToolFieldRole role="ai" label={t.tool_field_ai} />}
          </div>
          <Input
            value={subject}
            onChange={(e) => updateNodeData({ subject: e.target.value })}
            placeholder="Your order confirmation"
            className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200"
            disabled={isToolNode}
          />
          {isToolNode && <p className="text-[11px] text-gray-500 mt-1">{t.tool_field_ai_hint}</p>}
        </div>

        {/* Body Template */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm font-medium text-gray-200">{t.body}</label>
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                {t.body_tooltip}
              </div>
            </div>
            {isToolNode && <ToolFieldRole role="ai" label={t.tool_field_ai} />}
          </div>
          <div
            className={`relative w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#1A1A1A] text-gray-200 min-h-[100px] overflow-hidden ${
              isToolNode ? 'opacity-50' : 'cursor-pointer hover:border-gray-500 transition-colors'
            }`}
            onClick={isToolNode ? undefined : () => ui.openModal('sendGridBody')}
          >
            <div className="text-sm font-mono whitespace-pre-wrap break-words line-clamp-4 pr-6">
              {bodyTemplate || '{{context.aiResponse}}'}
            </div>
            {!isToolNode && (
              <div className="absolute bottom-2 right-2 bg-[#1A1A1A] rounded p-0.5">
                <Maximize2 className="w-4 h-4 text-gray-400 hover:text-gray-200" />
              </div>
            )}
          </div>
          {isToolNode && <p className="text-[11px] text-gray-500 mt-1">{t.tool_field_ai_hint}</p>}
        </div>
      </div>

      {/* Info */}
      <div className="pt-3 border-t border-[#3A3A3A]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            <Mail className="w-4 h-4 text-[#00A9D1]" />
            <span>{t.sendgrid_result_info || 'You can use template variables to compose emails'}</span>
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
              <code className="block p-2 bg-[#2A2A2A] rounded text-indigo-400">context.sendGridResult</code>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.result_fields || 'Result Fields'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-green-400">success</span> - Send status (boolean)</p>
                <p><span className="text-green-400">messageId</span> - Email message ID</p>
                <p><span className="text-green-400">toEmail</span> - Recipient email</p>
                <p><span className="text-red-400">error</span> - Error message (if failed)</p>
              </div>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.template_variables || 'Template Variables'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-indigo-400">{`{{aiResponse}}`}</span> - AI response text</p>
                <p><span className="text-indigo-400">{`{{message}}`}</span> - User message</p>
                <p><span className="text-indigo-400">{`{{context.xxx}}`}</span> - Context variables</p>
                <p><span className="text-indigo-400">{`{{jsonData.xxx}}`}</span> - JSON data fields</p>
                <p><span className="text-indigo-400">{`{{context.currentItem.xxx}}`}</span> - ForEach item</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
