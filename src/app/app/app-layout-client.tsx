'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useEdition } from '@/components/EditionProvider'
import { offFeatureFor, offFeatureForRoute } from '@/lib/edition-features'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  Home,
  MessageSquare,
  History,
  Settings,
  MessageCircle,
  CreditCard,
  Database,
  Files,
  ChevronDown,
  ChevronRight,
  Globe,
  FolderOpen,
  Cloud,
  Key,
  User,
  Brain,
  Layers2,
  Wrench,
  Bot,
  Users,
  Wand2,
  Image as ImageIcon,
  BarChart3,
  Shield,
  MousePointerClick,
  FileText,
  Workflow,
  BookOpen,
  Radio,
  Lock,
  Plug,
  Calendar,
  GraduationCap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserMenu } from '@/components/user-menu'
import { MobileMenu } from './mobile-menu'
import { DashboardAssistant } from './components/DashboardAssistant/DashboardAssistant'
import { OnboardingModal } from './components/OnboardingModal'
import { useLanguage } from '@/hooks/useLanguage'
import type { Language } from '@/lib/translations'

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
    'Team': t('settings_tab_team'),
    'Bots': t('settings_tab_bots'),
    'Profile': t('nav_profile'),
    'AI Configuration': t('nav_ai_configuration'),
    'Other': t('nav_other'),
    'Advanced': t('nav_advanced'),
    'Security': t('settings_tab_security'),
    'Analytics': t('nav_analytics'),
    'Subscription': t('nav_subscription'),
    'Bookings': t('nav_bookings'),
    'Voice Quiz': t('nav_voice_quiz'),
    'Projects': t('nav_projects')
  }
  return menuTranslations[name] || name
}

const STORAGE_TAB_SOURCE: Record<string, string | undefined> = {
  website: 'website',
  'google-drive': 'google_drive',
  sharepoint: 'sharepoint',
  gitbook: 'gitbook',
}

const navigation = [
  { name: 'Dashboard', href: '/app', icon: Home },
  { name: 'Workflows', href: '/app/workflows', icon: Workflow }, // ⭐ Agent Studio → Workflows
  // { name: 'Playground', href: '/app/playground', icon: MessageSquare },
  { name: 'History', href: '/app/history', icon: History },
  {
    name: 'Source',
    href: '/app/storage',
    icon: Database,
    subItems: [
      { name: 'Website', href: '/app/storage?tab=website', icon: Globe },
      { name: 'Files', href: '/app/storage?tab=files', icon: Files },
      { name: 'Google Drive', href: '/app/storage?tab=google-drive', icon: FolderOpen },
      { name: 'SharePoint', href: '/app/storage?tab=sharepoint', icon: Cloud },
      { name: 'GitBook', href: '/app/storage?tab=gitbook', icon: BookOpen },
    ]
  },
  {
    name: 'Chat Settings',
    href: '/app/chat-settings',
    icon: MessageCircle,
    subItems: [
      { name: 'General', href: '/app/chat-settings?tab=general', icon: Wand2 },
      { name: 'Icons', href: '/app/chat-settings?tab=icons', icon: ImageIcon },
      { name: 'Experience', href: '/app/chat-settings?tab=experience', icon: MessageCircle },
      { name: 'Privacy', href: '/app/chat-settings?tab=privacy', icon: Shield },
      { name: 'Chat Button', href: '/app/chat-settings?tab=chat-button', icon: MousePointerClick },
    ]
  },
  {
    name: 'Settings',
    href: '/app/settings',
    icon: Settings,
    subItems: [
      // { name: 'API Key', href: '/app/settings?tab=api-key', icon: Key },
      { name: 'AI Agent', href: '/app/settings?tab=ai-agent', icon: Bot },
      { name: 'Team', href: '/app/settings?tab=team', icon: Users },
      { name: 'MCP Server', href: '/app/settings?tab=mcp', icon: Plug },
      { name: 'Profile', href: '/app/settings?tab=profile', icon: User },
      { name: 'Security', href: '/app/settings?tab=security', icon: Lock },
      { name: 'Other', href: '/app/settings?tab=other', icon: Layers2 },
      { name: 'Advanced', href: '/app/settings?tab=advanced', icon: Wrench },
    ]
  },
  { name: 'Projects', href: '/app/work', icon: FolderOpen },
  { name: 'Bookings', href: '/app/bookings', icon: Calendar, requiresCalendar: true },
  { name: 'Voice Quiz', href: '/app/voice-quiz', icon: GraduationCap, requiresVoiceQuiz: true },
  { name: 'Analytics', href: '/app/analytics', icon: BarChart3 },
  { name: 'Subscription', href: '/app/subscription', icon: CreditCard },
]

const supportedLanguageCodes: Language[] = ['en', 'de', 'fr', 'es', 'ko']

function mapLocaleToLanguage(locale?: string): Language | null {
  if (!locale) {
    return null
  }

  const normalized = locale.toLowerCase()
  const explicitMap: Record<Language, string> = {
    en: 'en-us',
    de: 'de-de',
    fr: 'fr-fr',
    es: 'es-es',
    ko: 'ko-kr',
  }

  for (const [language, mappedLocale] of Object.entries(explicitMap)) {
    if (normalized === mappedLocale) {
      return language as Language
    }
  }

  const [languageCode] = normalized.split('-')
  return supportedLanguageCodes.includes(languageCode as Language)
    ? languageCode as Language
    : null
}

function Logo({ className }: { className?: string }) {
  const { currentLanguage } = useLanguage()
  const href = currentLanguage === 'en' ? '/app' : `/app?lang=${currentLanguage}`

  return (
    <Link
      href={href}
      className={cn("h-8 w-auto relative cursor-pointer hover:opacity-80 transition-opacity", className)}
    >
      <Image
        src="/aitalk01_b.png"
        alt="AITalk.ch"
        width={120}
        height={40}
        className="h-8 w-auto dark:hidden"
        priority
      />
      <Image
        src="/aitalk01_w.png"
        alt="AITalk.ch"
        width={120}
        height={40}
        className="h-8 w-auto hidden dark:block"
        priority
      />
    </Link>
  )
}

let appLayoutLanguageSynced = false

export function AppLayoutClient({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { t, currentLanguage, setLanguage } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [expandedItems, setExpandedItems] = useState<string[]>([])

  const edition = useEdition()

  const [serviceVariant, setServiceVariant] = useState<'self' | 'managed'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('aitalk-service-variant')
        if (cached === 'managed') return 'managed'
      } catch {}
    }
    return 'self'
  })

  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [activeAgentTitle, setActiveAgentTitle] = useState<string>('Agent')
  const [agentsCache, setAgentsCache] = useState<Array<{ agentId: string; title: string }>>([])
  const [hasCalendarWorkflow, setHasCalendarWorkflow] = useState(false)
  const [hasVoiceQuizWorkflow, setHasVoiceQuizWorkflow] = useState(false)

  const loadAgents = useCallback(async () => {
    try {
      const response = await fetch('/api/agents')
      if (!response.ok) return
      const data = await response.json()
      const agents = data.agents || data
      if (!Array.isArray(agents) || agents.length === 0) return

      setAgentsCache(agents.map((a: any) => ({ agentId: a.agentId, title: a.title || 'Agent' })))

      const storedId = localStorage.getItem('activeAgentId')
      const found = storedId && agents.find((a: any) => a.agentId === storedId)
      const target = found || agents[0]
      setActiveAgentId(target.agentId)
      setActiveAgentTitle(target.title || 'Agent')
    } catch {
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    loadAgents()
  }, [mounted, loadAgents])

  useEffect(() => {
    if (!mounted) return
    let cancelled = false
    fetch('/api/dashboard/calendar-workflows')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.success && Array.isArray(data.workflows) && data.workflows.length > 0) {
          setHasCalendarWorkflow(true)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    let cancelled = false
    fetch('/api/dashboard/voice-quiz')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.success && data.hasVoiceQuiz) setHasVoiceQuizWorkflow(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mounted])

  useEffect(() => {
    const handleAgentChanged = (e: Event) => {
      const agentId = (e as CustomEvent).detail?.agentId
      if (!agentId) return
      setActiveAgentId(agentId)
      const found = agentsCache.find(a => a.agentId === agentId)
      if (found) setActiveAgentTitle(found.title)
    }
    window.addEventListener('activeAgentChanged', handleAgentChanged)
    return () => window.removeEventListener('activeAgentChanged', handleAgentChanged)
  }, [agentsCache])

  useEffect(() => {
    const handleTitleChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.agentId && detail?.title) {
        setAgentsCache(prev => prev.map(a =>
          a.agentId === detail.agentId ? { ...a, title: detail.title } : a
        ))
        if (detail.agentId === activeAgentId) {
          setActiveAgentTitle(detail.title)
        }
      }
    }
    window.addEventListener('agentTitleChanged', handleTitleChanged)
    return () => window.removeEventListener('agentTitleChanged', handleTitleChanged)
  }, [activeAgentId])

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
    if (!mounted || appLayoutLanguageSynced) return
    appLayoutLanguageSynced = true

    const syncLanguageFromSettings = async () => {
      try {
        const response = await fetch('/api/settings')
        if (!response.ok) return

        const data = await response.json()
        if (!(data.success && data.settings)) return

        if (data.settings.serviceVariant) {
          setServiceVariant(data.settings.serviceVariant)
          try { localStorage.setItem('aitalk-service-variant', data.settings.serviceVariant) } catch {}
        }

        if (!data.settings.locale) return

        const languageCode = mapLocaleToLanguage(data.settings.locale)
        if (!languageCode) return

        try {
          const storedLanguage = localStorage.getItem('preferred-language')
          if (storedLanguage !== languageCode) {
            localStorage.setItem('preferred-language', languageCode)
          }
        } catch {
          // Ignore localStorage write failures
        }

        if (currentLanguage !== languageCode) {
          setLanguage(languageCode)
        }
      } catch {
      }
    }

    syncLanguageFromSettings()
  }, [mounted, currentLanguage, setLanguage])

  const filteredNavigation = useMemo(() => {
    let base = navigation.filter(
      (item: any) =>
        !(item.requiresCalendar && !hasCalendarWorkflow) && !(item.requiresVoiceQuiz && !hasVoiceQuizWorkflow),
    )
    if (edition === 'selfhosted') {
      return base
        .filter((item) => !offFeatureForRoute(item.href, edition))
        .map((item) => item.subItems
          ? {
              ...item,
              subItems: item.subItems.filter((sub) => {
                const tab = new URLSearchParams(sub.href.split('?')[1] ?? '').get('tab') ?? ''
                if (item.name === 'Source') return !offFeatureFor('knowledgeSources', STORAGE_TAB_SOURCE[tab], edition)
                if (item.name === 'Settings') return sub.name !== 'Security' && sub.name !== 'API Key'
                return true
              }),
            }
          : item)
    }
    if (serviceVariant !== 'managed') return base
    return base.map(item => {
      if (item.name === 'Settings' && item.subItems) {
        return {
          ...item,
          subItems: item.subItems.filter(sub => sub.name !== 'Security' && sub.name !== 'API Key')
        }
      }
      return item
    })
  }, [serviceVariant, hasCalendarWorkflow, hasVoiceQuizWorkflow, edition])

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

  const toggleExpanded = (itemName: string) => {
    setExpandedItems(prev => {
      if (prev.includes(itemName)) {
        return prev.filter(name => name !== itemName)
      } else {
        const menuItemsWithSubItems = ['Source', 'Chat Settings', 'Settings']
        return [itemName]
      }
    })
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background">
        <div className="p-4 md:p-6">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <div className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b bg-background px-4 md:hidden">
        <MobileMenu navigation={filteredNavigation} />
        <div className="flex-1">
          <Logo />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
      
      {/* Mobile Menu Component handles its own rendering */}

      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0">
          <div className="flex flex-col flex-1 border-r bg-card">
            <div className="flex h-16 items-center px-6 border-b">
              <Logo />
            </div>
            <ScrollArea className="flex-1 px-3 py-4">
              <nav className="space-y-1">
                {filteredNavigation.map((item) => {
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
            </ScrollArea>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 md:ml-64 relative overflow-x-hidden">
          {/* Desktop Top Right User Menu */}
          <div className="hidden md:block absolute top-4 right-6 z-10">
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>

          <div className="p-4 md:p-6 md:pt-16 overflow-x-hidden max-w-full">
            {children}
          </div>
        </main>
      </div>

      {false && (
      <DashboardAssistant
        agentId={activeAgentId}
        agentTitle={activeAgentTitle}
        onAgentTitleChange={setActiveAgentTitle}
      />
      )}

      <OnboardingModal />
    </div>
  )
}
