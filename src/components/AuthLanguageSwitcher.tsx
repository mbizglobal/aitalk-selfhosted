'use client'

import { useLanguage } from '@/hooks/useLanguage'
import type { Language } from '@/lib/translations'

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'ko', label: '한국어' },
]

export function AuthLanguageSwitcher() {
  const { t, currentLanguage, setLanguage } = useLanguage()
  const active = currentLanguage === 'de-ch' ? 'de' : currentLanguage

  return (
    <div className="w-full max-w-md mb-3 flex justify-end gap-1" role="group" aria-label={t('auth_language')}>
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={active === code}
          onClick={() => setLanguage(code)}
          className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
            active === code
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
