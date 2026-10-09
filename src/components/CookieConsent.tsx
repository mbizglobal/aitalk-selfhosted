'use client';

import { useEdition } from '@/components/EditionProvider';
import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/useLanguage';

export function CookieConsent() {
  const edition = useEdition();
  const { t, currentLanguage } = useLanguage();
  const [showBanner, setShowBanner] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    if (typeof window !== 'undefined' && (window.location.pathname.startsWith('/chat/') || window.location.pathname.startsWith('/book/'))) {
      setShowBanner(false);
      return;
    }

    try {
      // Check if user has already consented
      const hasConsented = localStorage.getItem('cookie-consent');
      if (!hasConsented) {
        setShowBanner(true);
      }
    } catch (error) {
      console.warn('localStorage not available:', error);
      setShowBanner(true);
    }
  }, []);

  const handleAccept = () => {
    try {
      // Store consent in localStorage
      localStorage.setItem('cookie-consent', 'true');

      // Store current language when user consents
      localStorage.setItem('preferred-language', currentLanguage);
    } catch (error) {
      console.warn('Failed to save to localStorage:', error);
    }

    // Also set HTTP cookie for server-side access
    document.cookie = `preferred-language=${currentLanguage}; path=/; max-age=31536000; SameSite=Lax`;
    document.cookie = `cookie-consent=true; path=/; max-age=31536000; SameSite=Lax`;

    setShowBanner(false);

    // Dispatch custom event to notify other components
    window.dispatchEvent(new CustomEvent('cookie-consent-changed'));
  };

  if (!isClient || !showBanner || edition === 'selfhosted') {
    return null;
  }

  const consentHtml = t('cookie_consent').replaceAll(
        'href="/law/cookie-policy"',
        `href="/${currentLanguage}/law/cookie-policy"`
      );

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900 dark:bg-slate-800 p-4 shadow-lg z-50 border-t border-slate-700">
      <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex-1 text-sm text-white">
          <span dangerouslySetInnerHTML={{ __html: consentHtml }} />
        </div>
        <button
          onClick={handleAccept}
          className="bg-green-700 hover:bg-green-800 text-white px-6 py-2 rounded-lg font-medium transition-colors whitespace-nowrap"
        >
          {t('cookie_consent_btn')}
        </button>
      </div>
    </div>
  );
}
