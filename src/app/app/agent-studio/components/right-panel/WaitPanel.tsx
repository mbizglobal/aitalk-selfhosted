'use client'

import React from 'react'
import type { Node } from 'reactflow'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const WaitPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const waitMessage = node.data.waitMessage || t.waiting_for_user_input

  return (
    <div className="space-y-4">
      {/* Name */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-200 whitespace-nowrap">{t.wait_name}</label>
        <input
          type="text"
          className="flex-1 px-3 py-2 border-2 border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:border-primary text-sm"
          placeholder="Wait"
          value={node.data.label || ''}
          onChange={(e) => updateNodeData({ label: e.target.value })}
        />
      </div>

      {/* Wait Message */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.wait_message}</label>
        <Textarea
          className="w-full bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 placeholder-gray-500 min-h-[80px] text-sm"
          placeholder={t.wait_message_placeholder}
          value={waitMessage}
          onChange={(e) => updateNodeData({ waitMessage: e.target.value })}
        />
        <p className="text-xs text-gray-400 mt-1">
          {t.wait_message_help}
        </p>
      </div>

      {/* Info Box */}
      <div className="p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
        <div className="text-xs font-medium text-gray-200 mb-2">{t.how_wait_node_works}</div>
        <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
          <li>{t.wait_step_1}</li>
          <li>{t.wait_step_2}</li>
          <li>{t.wait_step_3}</li>
          <li>{t.wait_step_4}</li>
          <li>{t.wait_step_5}</li>
        </ul>
      </div>
    </div>
  )
}
