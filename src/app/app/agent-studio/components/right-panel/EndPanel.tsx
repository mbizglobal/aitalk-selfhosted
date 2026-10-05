'use client'

import React, { useMemo, useState, useEffect } from 'react'
import type { Node } from 'reactflow'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const EndPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { workflow } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [message, setMessage] = useState<string>(node.data?.message || '')

  useEffect(() => {
    setMessage(node.data?.message || '')
  }, [node.id, node.data?.message])

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newMessage = e.target.value
    setMessage(newMessage)
    updateNodeData({ message: newMessage })
  }

  const startNode = useMemo(
    () => workflow.nodes.find((n) => n.data?.nodeType === 'start' || n.data?.label === 'Chat Widget'),
    [workflow.nodes]
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        {t.end_node_desc}
      </p>

      {/* Custom Message */}
      <div className="space-y-2">
        <p className="text-xs text-gray-400">{t.end_message || 'Custom Message'}</p>
        <textarea
          value={message}
          onChange={handleMessageChange}
          placeholder={t.end_message_placeholder || 'Enter a custom message to display when this End node is reached (optional)'}
          className="w-full h-24 px-3 py-2 text-sm text-gray-100 bg-[#151515] border border-[#222] rounded-lg resize-none focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-gray-500">
          {t.end_message_hint || 'If set, this message will be shown instead of the default response.'}
        </p>
      </div>

      {/* Return to node */}
      <div className="space-y-2">
        <p className="text-xs text-gray-400">{t.return_to_node}</p>
        <div className="flex items-center gap-2 px-3 py-2 bg-[#151515] border border-[#222] rounded-lg">
          {startNode ? (
            <>
              <div className={`w-2 h-2 rounded-full bg-green-500`} />
              <span className="text-sm text-gray-100">{startNode.data?.label || startNode.id}</span>
            </>
          ) : (
            <span className="text-sm text-gray-500">{t.start_node_not_found}</span>
          )}
        </div>
      </div>
    </div>
  )
}
