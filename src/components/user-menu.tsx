'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { User, LogOut, Globe, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useLanguage } from '@/hooks/useLanguage'

type LanguageCode = 'en' | 'de' | 'fr' | 'es' | 'ko'

function localeToLanguage(locale?: string): LanguageCode | null {
  if (!locale) {
    return null
  }

  const normalized = locale.toLowerCase()
  const explicitMap: Record<LanguageCode, string> = {
    en: 'en-us',
    de: 'de-de',
    fr: 'fr-fr',
    es: 'es-es',
    ko: 'ko-kr',
  }

  for (const [language, mappedLocale] of Object.entries(explicitMap)) {
    if (normalized === mappedLocale) {
      return language as LanguageCode
    }
  }

  const [languageCode] = normalized.split('-')
  return (Object.keys(explicitMap) as LanguageCode[]).includes(languageCode as LanguageCode)
    ? (languageCode as LanguageCode)
    : null
}

const languageToLocale: Record<LanguageCode, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  ko: 'ko-KR',
}

let userMenuLanguageSynced = false

export function UserMenu() {
  const { data: session } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const { currentLanguage, setLanguage, t } = useLanguage()
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(currentLanguage as LanguageCode)

  if (!session) {
    return null
  }

  useEffect(() => {
    setSelectedLanguage(currentLanguage as LanguageCode)
  }, [currentLanguage])

  useEffect(() => {
    if (userMenuLanguageSynced) return
    userMenuLanguageSynced = true

    const syncLanguageWithSettings = async () => {
      try {
        const response = await fetch('/api/settings')
        if (!response.ok) return

        const data = await response.json()
        if (!(data.success && data.settings?.locale)) return

        const languageCode = localeToLanguage(data.settings.locale)
        if (!languageCode) return

        try {
          localStorage.setItem('preferred-language', languageCode)
        } catch {
        }

        setSelectedLanguage(languageCode)

        if (currentLanguage !== languageCode) {
          setLanguage(languageCode)
        }
      } catch {
      }
    }

    syncLanguageWithSettings()
  }, [currentLanguage, setLanguage])

  const handleSignOut = async () => {
    setIsLoading(true)
    await signOut({ callbackUrl: '/auth' })
  }

  const handleLanguageChange = async (newLanguage: LanguageCode) => {
    if (selectedLanguage === newLanguage) {
      return
    }

    const newLocale = languageToLocale[newLanguage]

    try {
      const settingsResponse = await fetch('/api/settings')
      if (!settingsResponse.ok) {
        return
      }

      const settingsData = await settingsResponse.json()
      if (!(settingsData.success && settingsData.settings)) {
        return
      }

      const updateResponse = await fetch('/api/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: settingsData.settings.timezone || 'UTC',
          locale: newLocale,
          timeFormat: settingsData.settings.time_format || 'DD.MM.YYYY HH:mm',
        }),
      })

      if (!updateResponse.ok) {
        return
      }

      try {
        localStorage.setItem('preferred-language', newLanguage)
      } catch (error) {
      }

      setSelectedLanguage(newLanguage)
      setLanguage(newLanguage)
    } catch (error) {
    }
  }

  const languageOptions: Array<{ code: LanguageCode; name: string; domain: string }> = [
    { code: 'en', name: 'English', domain: 'English' },
    { code: 'de', name: 'Deutsch', domain: 'Deutsch' },
    { code: 'fr', name: 'Français', domain: 'Français' },
    { code: 'ko', name: '한국어', domain: '한국어' }
  ]

  const userInitials = session.user?.name
    ? session.user.name.split(' ').map(n => n[0]).join('').toUpperCase()
    : session.user?.email?.[0].toUpperCase() || 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarImage src={session.user?.image || ''} alt={session.user?.name || ''} />
            <AvatarFallback>{userInitials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {session.user?.name || 'User'}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {session.user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/app/settings?tab=profile">
            <User className="mr-2 h-4 w-4" />
            <span>Profile</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Globe className="mr-2 h-4 w-4" />
            <span>Language</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {languageOptions.map((option) => (
              <DropdownMenuItem
                key={option.code}
                onClick={() => handleLanguageChange(option.code)}
                className="cursor-pointer"
              >
                <span className="mr-2 w-4 h-4 flex items-center justify-center">
                  {selectedLanguage === option.code && <Check className="h-3 w-3" />}
                </span>
                <span>{option.domain}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={handleSignOut}
          disabled={isLoading}
          className="text-red-600 focus:text-red-600"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>{isLoading ? t('signing_out') : t('sign_out')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
