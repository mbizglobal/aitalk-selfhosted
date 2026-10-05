'use client'

import { cn } from '@/lib/utils'
import type { TranslationFn } from '../types'

interface TabNavigationProps {
  activeTab: string
  onTabChange: (tab: string) => void
  t: TranslationFn
}

export function TabNavigation({
  activeTab,
  onTabChange,
  t,
}: TabNavigationProps) {
  const tabs = [
    { id: 'general', label: t('chat_settings_tab_general') },
    { id: 'icons', label: t('chat_settings_tab_icons') },
    { id: 'experience', label: t('chat_settings_tab_experience') },
    { id: 'privacy', label: t('chat_settings_tab_privacy') },
    { id: 'chat-button', label: t('nav_chat_button') },
  ]

  return (
    <div className="w-full overflow-hidden">
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex flex-wrap gap-1 bg-muted rounded-lg p-1 w-full md:inline-flex md:flex-nowrap md:gap-0 md:w-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
