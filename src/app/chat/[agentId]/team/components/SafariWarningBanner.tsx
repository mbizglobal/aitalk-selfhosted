'use client'

import React from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface SafariWarningBannerProps {
  lang?: SupportedLang
  onDismiss: () => void
}

export const SafariWarningBanner: React.FC<SafariWarningBannerProps> = ({ lang, onDismiss }) => {
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-3">
      <div className="flex items-start gap-3 max-w-4xl mx-auto">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          <p className="text-amber-200 font-medium">{t('team_safari_warning_title')}</p>
          <p className="text-amber-200/80 mt-1">
            {t('team_safari_warning_message')}
            <span className="block mt-1 text-amber-200/60">
              {t('team_safari_warning_tip')}
            </span>
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-1 text-amber-400 hover:text-amber-300 rounded"
          aria-label={t('team_close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
