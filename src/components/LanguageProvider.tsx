'use client';

import { ReactNode, useEffect } from 'react';
import { LanguageContext, useLanguageProvider } from '@/hooks/useLanguage';
import { DEFERRED_FONT_STYLESHEETS } from '@/app/fonts-preload';

const DEFERRED_FONT_LINK_ID = 'deferred-font-css';

interface LanguageProviderProps {
  children: ReactNode;
  initialLanguage?: string;
}

export function LanguageProvider({ children, initialLanguage }: LanguageProviderProps) {
  const languageProviderValue = useLanguageProvider(initialLanguage);
  
  useEffect(() => {
    // Remove all font classes
    document.body.classList.remove('font-inter', 'font-noto-sans-kr');
    // Add current language font class
    document.body.classList.add(languageProviderValue.getFontClass());
  }, [languageProviderValue.currentLanguage, languageProviderValue.getFontClass]);

  useEffect(() => {
    const href = DEFERRED_FONT_STYLESHEETS[languageProviderValue.currentLanguage];
    if (!href) return;
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.id = DEFERRED_FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }, [languageProviderValue.currentLanguage]);
  
  return (
    <LanguageContext.Provider value={languageProviderValue}>
      {children}
    </LanguageContext.Provider>
  );
}