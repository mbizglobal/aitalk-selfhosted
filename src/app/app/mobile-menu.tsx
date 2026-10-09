'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Menu, X, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/hooks/useLanguage'
import { SelfHostedFooter } from '@/components/SelfHostedFooter'

function getMenuName(name: string, t: (key: string) => string): string {
  const menuTranslations: { [key: string]: string } = {
    'Dashboard': t('nav_dashboard'),
    'Playground': t('nav_playground'),
    'Workflows': t('nav_workflows'),
    'History': t('nav_history'),
    'Source': t('nav_source'),
    'Website': t('nav_website'),
    'Files': t('nav_files'),
    'Google Drive': t('nav_google_drive'),
    'SharePoint': t('nav_sharepoint'),
    'GitBook': t('nav_gitbook'),
    'Chat Settings': t('nav_chat_settings'),
    'General': t('nav_general'),
    'Icons': t('nav_icons'),
    'Experience': t('nav_experience'),
    'Privacy': t('nav_privacy'),
    'Chat Button': t('nav_chat_button'),
    'Settings': t('nav_settings'),
    'OpenAI API Key': t('nav_openai_api_key'),
    'AI Assistant': t('nav_ai_assistant'),
    'MCP Server': t('settings_tab_mcp'),
    'AI connections': t('settings_tab_ai_connections'),
    'License': t('settings_tab_license'),
    'Team': t('settings_tab_team'),
    'Profile': t('nav_profile'),
    'Other': t('nav_other'),
    'Advanced': t('nav_advanced'),
    'Subscription': t('nav_subscription'),
    'Voice Quiz': t('nav_voice_quiz'),
    'Projects': t('nav_projects')
  }
  return menuTranslations[name] || name
}

interface MobileMenuProps {
  navigation: Array<{
    name: string
    href: string
    icon: React.ComponentType<{ className?: string }>
    subItems?: Array<{
      name: string
      href: string
      icon: React.ComponentType<{ className?: string }>
    }>
  }>
}

export function MobileMenu({ navigation }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { t, currentLanguage } = useLanguage()

  // Helper function to add language parameter to URLs
  const addLangParam = (href: string) => {
    if (currentLanguage === 'en') return href // Default language, no param needed
    const url = new URL(href, window.location.origin)
    url.searchParams.set('lang', currentLanguage)
    return url.pathname + url.search
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  useEffect(() => {
    if (pathname.startsWith('/app/storage')) {
      setExpandedItems(['Source'])
    } else if (pathname.startsWith('/app/chat-settings')) {
      setExpandedItems(['Chat Settings'])
    } else if (pathname.startsWith('/app/settings')) {
      setExpandedItems(['Settings'])
    } else {
      setExpandedItems([])
    }
  }, [pathname])

  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  const toggleExpanded = (itemName: string) => {
    setExpandedItems(prev => {
      if (prev.includes(itemName)) {
        return prev.filter(name => name !== itemName)
      } else {
        return [itemName]
      }
    })
  }

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <Menu className="h-5 w-5" />
      </Button>
    )
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden"
      >
        {isOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
        <span className="sr-only">Toggle menu</span>
      </Button>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Mobile Menu */}
      <div
        className={cn(
          'fixed left-0 top-0 z-50 h-full w-72 bg-card border-r transform transition-transform duration-300 ease-in-out md:hidden',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-6">
          <h2 className="text-lg font-semibold">AI Talk App</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <nav className="p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = (item.name === 'Source' || item.name === 'Chat Settings' || item.name === 'Settings') ? false : pathname === item.href || (item.subItems && pathname.startsWith(item.href))
            const isExpanded = expandedItems.includes(item.name)

            return (
              <div key={item.name}>
                {item.subItems ? (
                  <div>
                    <button
                      onClick={() => toggleExpanded(item.name)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors w-full',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {getMenuName(item.name, t)}
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 ml-auto" />
                      ) : (
                        <ChevronRight className="h-4 w-4 ml-auto" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="ml-6 mt-1 space-y-1">
                        {item.subItems.map((subItem) => {
                          const currentTab = searchParams.get('tab')
                          const tabFromHref = subItem.href.split('=')[1]
                          const isSubActive = item.name === 'Source'
                            ? pathname.startsWith('/app/storage') && (!currentTab && tabFromHref === 'website' || currentTab === tabFromHref)
                            : item.name === 'Chat Settings'
                            ? pathname.startsWith('/app/chat-settings') && (!currentTab && tabFromHref === 'general' || currentTab === tabFromHref)
                            : item.name === 'Settings'
                            ? pathname.startsWith('/app/settings') && (!currentTab && tabFromHref === 'api-key' || currentTab === tabFromHref)
                            : false
                          return (
                            <Link
                              key={subItem.name}
                              href={addLangParam(subItem.href)}
                              onClick={() => setIsOpen(false)}
                              className={cn(
                                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                isSubActive
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                              )}
                            >
                              <subItem.icon className="h-4 w-4" />
                              {getMenuName(subItem.name, t)}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <Link
                    href={addLangParam(item.href)}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {getMenuName(item.name, t)}
                  </Link>
                )}
              </div>
            )
          })}
        </nav>
        <SelfHostedFooter layout="stack" className="border-t px-6 py-4" />
      </div>
    </>
  )
}