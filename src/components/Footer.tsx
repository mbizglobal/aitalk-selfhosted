'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/hooks/useLanguage';

export function Footer() {
  const { t, currentLanguage } = useLanguage();
  const currentYear = new Date().getFullYear();

  const getLegalUrl = (page: string) => {
    return `/${currentLanguage}/law/${page}`;
  };

  const microsoftStartupsBlogUrl: Record<string, string> = {
    en: '/blog/en/aitalkch-joins-microsoft-for-startups-to-scale-ai-voice-agents-across-europe',
    de: '/blog/de/aitalkch-tritt-microsoft-for-startups-bei-um-ai-voice-agents-in-ganz-europa-zu-skalieren',
    fr: '/blog/fr/aitalkch-rejoint-microsoft-for-startups-pour-dvelopper-les-agents-vocaux-ia-travers-leurope',
    es: '/blog/es/aitalkch-se-une-a-microsoft-for-startups-para-escalar-agentes-de-voz-con-ia-en-toda-europa',
    ko: '/blog/ko/aitalkch-joins-microsoft-for-startups-to-scale-ai-voice-agents-across-europe',
    ja: '/blog/en/aitalkch-joins-microsoft-for-startups-to-scale-ai-voice-agents-across-europe',
  };
  const msStartupsUrl = microsoftStartupsBlogUrl[currentLanguage] ?? microsoftStartupsBlogUrl.en;

  return (
    <footer className="bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col md:flex-row justify-between gap-8">
          <div>
            <h3 className="text-lg font-semibold mb-4">{t('footer_sitemap')}</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href={`/blog/${currentLanguage}`}
                  className="hover:text-green-400 transition-colors"
                >
                  {t('footer_blog')}
                </Link>
              </li>
              <li>
                <Link
                  href="#pricing"
                  className="hover:text-green-400 transition-colors"
                >
                  {t('footer_pricing')}
                </Link>
              </li>
              <li>
                <Link
                  href={currentLanguage === 'de' ? '/de/aboutus' : `/${currentLanguage}/mbizglobal`}
                  className="hover:text-green-400 transition-colors"
                >
                  {t('footer_company')}
                </Link>
              </li>
            </ul>

            <div className="hidden md:block mt-8">
              <Link href={msStartupsUrl}>
              <Image
                src="/images/microsoft-for-startups-badge.jpg"
                alt="Proud to collaborate with Microsoft for Startups"
                width={240}
                height={103}
                className="rounded-lg"
              />
              </Link>
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-6">
            {/* Address */}
            <div>
              <h3 className="text-lg font-semibold mb-2">{t('footer_address_title')}:</h3>
              <div
                className="text-gray-300 text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: t('footer_address') }}
              />
            </div>

            {/* Email */}
            <div>
              <h3 className="text-lg font-semibold mb-2">{t('footer_email_title')}:</h3>
              <div>
                <a
                  href={`mailto:${t('footer_email')}`}
                  className="text-green-400 hover:text-green-300 transition-colors"
                >
                  {t('footer_email')}
                </a>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">AI Talk:</h3>
              <div>
                <a
                  href="tel:+41415627308"
                  className="text-green-400 hover:text-green-300 transition-colors"
                >
                  +41 41 562 73 08
                </a>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <a
                  href="https://www.linkedin.com/company/mbiz-global/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn — M-BIZ Global AG"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                </a>
                <a
                  href="https://www.youtube.com/@aitalk_ch"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="YouTube — AiTalk.ch"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                </a>
              </div>
            </div>

            <div className="md:hidden">
              <Link href={msStartupsUrl}>
              <Image
                src="/images/microsoft-for-startups-badge.jpg"
                alt="Proud to collaborate with Microsoft for Startups"
                width={240}
                height={103}
                className="rounded-lg"
              />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="bg-black">
        <div className="container mx-auto px-4 py-4">
          <div className="text-center">
            {/* Legal Links */}
            <ul className="flex justify-center items-center space-x-1 text-sm mb-2">
              <li>
                <Link
                  href={getLegalUrl('terms-of-use')}
                  target="_blank"
                  className="hover:text-green-400 transition-colors"
                >
                  {t('copyright_term')}
                </Link>
              </li>
              <li className="text-gray-400" aria-hidden="true">|</li>
              <li>
                <Link
                  href={getLegalUrl('privacy-policy')}
                  target="_blank"
                  className="hover:text-green-400 transition-colors"
                >
                  {t('copyright_privacy')}
                </Link>
              </li>
              <li className="text-gray-400" aria-hidden="true">|</li>
              <li>
                <Link
                  href={getLegalUrl('cookie-policy')}
                  target="_blank"
                  className="hover:text-green-400 transition-colors"
                >
                  {t('copyright_cookie')}
                </Link>
              </li>
              <li className="text-gray-400" aria-hidden="true">|</li>
              <li>
                <Link
                  href={getLegalUrl('account-deletion')}
                  target="_blank"
                  className="hover:text-green-400 transition-colors"
                >
                  {t('copyright_data_deletion')}
                </Link>
              </li>
            </ul>

            {/* Copyright */}
            <p className="text-sm text-gray-400">
              Copyright {currentYear}. M-BIZ Global AG. {t('copyright_all_right_reserved')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}