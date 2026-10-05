'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { useCookieConsent } from '@/hooks/useCookieConsent';

export function Header() {
  const { t, currentLanguage, setLanguage, supportedLanguages } = useLanguage();
  const { hasConsented } = useCookieConsent();
  const router = useRouter();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const pathLangMatch = pathname?.match(/^\/(de-ch|en|de|fr|es|ko|ja)(\/|$)/);
  const pathLang = pathLangMatch?.[1] as typeof currentLanguage | undefined;

  useEffect(() => {
    if (!isLanguageOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-lang-dropdown]')) {
        setIsLanguageOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isLanguageOpen]);

  const languageNames: Record<string, string> = {
    en: 'English',
    de: 'Deutsch',
    'de-ch': 'Deutsch (Schweiz)',
    fr: 'Français',
    es: 'Español',
    ko: '한국어',
    ja: '日本語'
  };

  const lang = pathLang ?? (mounted ? currentLanguage : 'en');

  const getBlogUrl = () => `/blog/${lang}`;
  const getPricingUrl = () => `/${lang}/pricing`;
  const getCompanyUrl = () => lang === 'de' ? '/de/aboutus' : `/${lang}/mbizglobal`;

  const handleLoginClick = () => {
    if (!hasConsented) {
      alert(t('auth_error_cookie_consent_required'));
      return;
    }
    router.push('/auth');
  };

  // On path-based [lang] pages: update context first (immediate UI), then navigate URL
  // On /app, /auth, etc.: update cookie/localStorage only
  const handleLanguageChange = (newLang: typeof currentLanguage) => {
    // Update context immediately so UI re-renders without waiting for navigation
    setLanguage(newLang);

    if (pathLangMatch) {
      const subPath = (pathname ?? '').slice(`/${pathLangMatch[1]}`.length);
      window.location.href = `/${newLang}${subPath}`;
      return;
    }
    setIsLanguageOpen(false);
  };

  return (
    <header className="bg-black text-white">
      <div className="container mx-auto px-4">
        <nav className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="flex-shrink-0">
            <Image
              src="/aitalk01_w.png"
              alt="AITalk.ch"
              width={204}
              height={68}
              className="h-7 sm:h-14 w-auto"
              priority
              sizes="(max-width: 640px) 100px, 204px"
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            {lang !== 'ja' && (
              <Link
                href={getBlogUrl()}
                className="font-bold hover:text-green-400 transition-colors"
              >
                {t('header_blog')}
              </Link>
            )}
            <Link
              href={getPricingUrl()}
              className="font-bold hover:text-green-400 transition-colors"
            >
              {t('header_pricing')}
            </Link>
            <Link
              href={getCompanyUrl()}
              className="font-bold hover:text-green-400 transition-colors"
            >
              {t('header_company')}
            </Link>
            
            {/* Language Dropdown */}
            <div className="relative" data-lang-dropdown>
              <button
                onClick={() => setIsLanguageOpen(!isLanguageOpen)}
                aria-expanded={isLanguageOpen}
                aria-haspopup="true"
                className="flex items-center space-x-1 font-bold hover:text-green-400 transition-colors"
              >
                <span>{t('header_language')}</span>
                <svg
                  aria-hidden="true"
                  className={`w-4 h-4 transition-transform ${
                    isLanguageOpen ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              
              {isLanguageOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-md shadow-lg py-2 z-50">
                  {supportedLanguages.map((l) => (
                    <button
                      key={l}
                      onClick={() => handleLanguageChange(l)}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors ${
                        currentLanguage === l ? 'bg-gray-700 text-green-400' : ''
                      }`}
                    >
                      {languageNames[l]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Login Button */}
            <button
              onClick={handleLoginClick}
              className="bg-green-700 hover:bg-green-800 text-white font-bold px-4 py-2 rounded-lg transition-colors"
            >
              {t('header_login')}
            </button>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
            className="md:hidden inline-flex items-center justify-center p-2 rounded-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-white"
          >
            <span className="sr-only">{t('open_main_menu')}</span>
            <svg
              className={`${isMenuOpen ? 'hidden' : 'block'} h-6 w-6`}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
            <svg
              className={`${isMenuOpen ? 'block' : 'hidden'} h-6 w-6`}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </nav>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div id="mobile-menu" className="md:hidden py-4 border-t border-gray-700">
            <div className="flex flex-col space-y-4">
              {lang !== 'ja' && (
                <Link
                  href={getBlogUrl()}
                  className="font-bold hover:text-green-400 transition-colors"
                  onClick={() => setIsMenuOpen(false)}
                >
                  {t('header_blog')}
                </Link>
              )}
              <Link
                href={getPricingUrl()}
                className="font-bold hover:text-green-400 transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('header_pricing')}
              </Link>
              <Link
                href={getCompanyUrl()}
                className="font-bold hover:text-green-400 transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('header_company')}
              </Link>
              
              {/* Mobile Login Button */}
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  handleLoginClick();
                }}
                className="bg-green-700 hover:bg-green-800 text-white font-bold px-4 py-3 rounded-lg text-center transition-colors"
              >
                {t('header_login')}
              </button>
              
              {/* Mobile Language Selection */}
              <div className="border-t border-gray-700 pt-4">
                <div className="text-sm font-bold mb-2">{t('header_language')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {supportedLanguages.map((l) => (
                    <button
                      key={l}
                      onClick={() => {
                        handleLanguageChange(l);
                        setIsMenuOpen(false);
                      }}
                      className={`text-left px-3 py-2 text-sm rounded hover:bg-gray-700 transition-colors ${
                        currentLanguage === l ? 'bg-gray-700 text-green-400' : ''
                      }`}
                    >
                      {languageNames[l]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}