'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'

interface TeamChatHeaderProps {
  isMobile: boolean
  sidebarOpen: boolean
  onOpenSidebar: () => void
}

export const TeamChatHeader: React.FC<TeamChatHeaderProps> = ({
  isMobile,
  sidebarOpen,
  onOpenSidebar
}) => {
  const showMenuButton = isMobile || !sidebarOpen

  return (
    <header className={`h-14 flex items-center justify-between ${isMobile ? 'px-2' : 'px-4'} border-b border-gray-800`}>
      {showMenuButton && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenSidebar}
          className="text-gray-400 hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}
      <div className="flex-1"></div>
    </header>
  )
}
