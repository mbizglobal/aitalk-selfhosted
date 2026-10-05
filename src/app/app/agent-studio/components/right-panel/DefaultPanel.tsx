'use client'

import React from 'react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

export const DefaultPanel: React.FC = () => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  return (
    <div className="text-sm text-gray-400">
      {t.default_panel_no_settings || 'This node has no settings of its own. Select a different node.'}
    </div>
  )
}
