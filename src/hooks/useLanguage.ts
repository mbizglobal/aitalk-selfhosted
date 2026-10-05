'use client';

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { usePathname } from 'next/navigation';
import { translations, type Language } from '@/lib/translations';

// de-ch must precede de in alternation (longer prefix wins)
const SUPPORTED_LANG_PATH_RE = /^\/(de-ch|en|de|fr|es|ko)(\/|$)/;

const SUPPORTED_UI_LANGS: Language[] = ['en', 'de', 'de-ch', 'fr', 'ko'];

interface LanguageContextType {
  currentLanguage: Language;
  lang: Language; // alias for agent-studio translations
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  supportedLanguages: Language[];
  getFontClass: () => string;
  isInitialized: boolean;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

export function useLanguageProvider(initialLanguage?: string) {
  const pathname = usePathname();
  const pathLang = (pathname?.match(SUPPORTED_LANG_PATH_RE)?.[1] as Language | undefined);

  const [currentLanguage, setCurrentLanguage] = useState<Language>(
    pathLang ?? (initialLanguage as Language) ?? 'en'
  );
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (pathLang && pathLang !== currentLanguage) {
      setCurrentLanguage(pathLang);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathLang]);

  useEffect(() => {
    const initializeLanguage = async () => {
      const pathLangMatch = window.location.pathname.match(SUPPORTED_LANG_PATH_RE);
      if (pathLangMatch) {
        const hasConsented = localStorage.getItem('cookie-consent') === 'true';
        if (hasConsented) {
          localStorage.setItem('preferred-language', pathLangMatch[1]);
          document.cookie = `preferred-language=${pathLangMatch[1]}; path=/; max-age=31536000; SameSite=Lax`;
        }
        setIsInitialized(true);
        return;
      }

      const currentPath = window.location.pathname;
      const isAppArea = currentPath.startsWith('/app') || currentPath.startsWith('/auth');
      if (isAppArea) {
        const storedJa = localStorage.getItem('preferred-language') === 'ja';
        if (initialLanguage === 'ja' || storedJa) {
          setCurrentLanguage('en');
        }
        setIsInitialized(true);
        return;
      }

      // Check URL query param for language
      const urlParams = new URLSearchParams(window.location.search);
      const urlLang = urlParams.get('lang') as Language;

      // Check localStorage only if cookie consent is given
      const hasConsented = localStorage.getItem('cookie-consent') === 'true';
      const storedLang = hasConsented ? localStorage.getItem('preferred-language') as Language : null;

      const serverLang = (initialLanguage as Language) || 'en';

      let selectedLang: Language = serverLang;
      let needsUpdate = false;

      // Priority: URL param > stored language > server language (cookie) > auto-detected
      if (urlLang && SUPPORTED_UI_LANGS.includes(urlLang)) {
        selectedLang = urlLang;
        needsUpdate = selectedLang !== serverLang;
      } else if (storedLang && SUPPORTED_UI_LANGS.includes(storedLang)) {
        selectedLang = storedLang;
        needsUpdate = selectedLang !== serverLang;

        if (needsUpdate && hasConsented) {
          document.cookie = `preferred-language=${selectedLang}; path=/; max-age=31536000; SameSite=Lax`;
        }
      } else if (!storedLang && serverLang === 'en') {
        try {
          const response = await fetch('/api/language');
          const data = await response.json();

          if (data.language && SUPPORTED_UI_LANGS.includes(data.language as Language)) {
            selectedLang = data.language as Language;
            needsUpdate = selectedLang !== serverLang;

            if (hasConsented) {
              localStorage.setItem('preferred-language', selectedLang);
              document.cookie = `preferred-language=${selectedLang}; path=/; max-age=31536000; SameSite=Lax`;
            }
          }
        } catch (error) {
          console.error('Language auto-detection failed:', error);
        }
      }

      if (needsUpdate) {
        setCurrentLanguage(selectedLang);
      }
      setIsInitialized(true);
    };

    initializeLanguage();
  }, [initialLanguage]);

  const setLanguage = useCallback((lang: Language) => {
    if (lang === currentLanguage) return;

    setCurrentLanguage(lang);

    const hasConsented = localStorage.getItem('cookie-consent') === 'true';
    if (hasConsented) {
      localStorage.setItem('preferred-language', lang);
      localStorage.setItem('language-manually-set', 'true');
      document.cookie = `preferred-language=${lang}; path=/; max-age=31536000; SameSite=Lax`;
    }

    // Only add ?lang= param when NOT on a path-based language route
    // (path-based routes handle language via URL path, not query param)
    const pathMatch = window.location.pathname.match(/^\/(de-ch|en|de|fr|es|ko)(\/|$)/);
    if (!pathMatch) {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', lang);
      window.history.replaceState({}, '', url.toString());
    }
  }, [currentLanguage]);

  const t = useCallback((key: string): string => {
    const keys = key.split('.');
    let value: unknown = translations[currentLanguage];

    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k];
    }

    return (value as string) || key;
  }, [currentLanguage]);

  const supportedLanguages: Language[] = SUPPORTED_UI_LANGS;

  const getFontClass = useCallback((): string => {
    switch (currentLanguage) {
      case 'ko':
        return 'font-noto-sans-kr';
      case 'en':
      case 'de':
      case 'de-ch':
      case 'fr':
      case 'es':
      default:
        return 'font-inter';
    }
  }, [currentLanguage]);

  return useMemo(() => ({
    currentLanguage,
    lang: currentLanguage, // alias for agent-studio translations
    setLanguage,
    t,
    supportedLanguages,
    getFontClass,
    isInitialized
  }), [currentLanguage, setLanguage, t, supportedLanguages, getFontClass, isInitialized]);
}