import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import "./fonts.css";
import { FONT_PRELOAD_HREFS, DEFERRED_FONT_STYLESHEETS } from "./fonts-preload";
import "flag-icons/css/flag-icons.min.css";
import { LanguageProvider } from "@/components/LanguageProvider";
import { CookieConsent } from "@/components/CookieConsent";
import { SessionProvider } from "@/components/SessionProvider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { EditionProvider } from "@/components/EditionProvider";
import { enabledEeFeatures } from "@/ee";
import { getEdition } from "@/lib/edition";
import { isGoogleLoginEnabled } from "@/lib/auth/google-login";
import { getInstallationBrand, getFeedbackRecipient } from "@/lib/brand";
import { VENDOR_SALES_WIDGET } from '@/lib/vendor-site';

const CLOUD_METADATA: Metadata = {
  metadataBase: new URL('https://www.aitalk.ch'),
  other: {
    google: 'notranslate',
  },
  verification: {
    other: {
      'naver-site-verification': '5206ed5038a225b461bb749de3e405082c7bf0f0',
      'msvalidate.01': '475FFC7015A820E3A9EFAE87122F6F54',
    },
  },
  title: "AI Voice Agent & Agentic Workflow Platform | AiTalk.ch",
  description: "Build AI voice agents, chatbots & agentic workflows — no-code. Powered by Microsoft Azure in Switzerland (Zurich). Swiss data privacy, no API keys, no setup.",
  openGraph: {
    title: "AiTalk.ch — AI Voice Agent in Your Country. Core Infrastructure in Switzerland.",
    description: "Build AI voice agents, chatbots, and agentic workflows on Microsoft Azure. Conversations, accounts and RAG vector databases are stored in the Azure region Zurich; core infrastructure is in Switzerland.",
    url: 'https://aitalk.ch',
    siteName: 'AiTalk.ch',
    images: [
      {
        url: '/og-image2.jpg',
        width: 1200,
        height: 630,
        alt: 'AI Voice Agent in Your Country. Core Infrastructure in Switzerland — AiTalk.ch',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "AiTalk.ch — AI Voice Agent in Your Country. Core Infrastructure in Switzerland.",
    description: "Build AI voice agents, chatbots, and agentic workflows on Microsoft Azure. Conversations, accounts and RAG vector databases are stored in the Azure region Zurich; core infrastructure is in Switzerland.",
    images: ['/og-image2.jpg'],
  },
  icons: {
    icon: [
      { url: '/favicon/favicon.ico' },
      { url: '/favicon/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    shortcut: '/favicon/favicon.ico',
    apple: [
      { url: '/favicon/apple-touch-icon.png', sizes: '180x180' },
    ],
  },
  manifest: '/favicon/site.webmanifest',
};

export async function generateMetadata(): Promise<Metadata> {
  if (getEdition() !== 'selfhosted') return CLOUD_METADATA;
  return {
    title: getInstallationBrand().productName,
    other: CLOUD_METADATA.other,
    icons: CLOUD_METADATA.icons,
  };
}

interface RootLayoutProps {
  children: React.ReactNode;
}

const SUPPORTED_LANGUAGES = ['en', 'de', 'de-ch', 'fr', 'es', 'ko'] as const;
type Language = typeof SUPPORTED_LANGUAGES[number];

export default async function RootLayout({
  children,
}: Readonly<RootLayoutProps>) {
  const headersList = await headers();
  const urlLang = headersList.get('x-lang') as Language | null;
  const cookieStore = await cookies();
  const preferredLanguage = cookieStore.get('preferred-language')?.value as Language | undefined;
  const initialLanguage: Language =
    (urlLang && SUPPORTED_LANGUAGES.includes(urlLang))
      ? urlLang
      : (preferredLanguage && SUPPORTED_LANGUAGES.includes(preferredLanguage))
        ? preferredLanguage
        : 'en';

  return (
    <html lang={initialLanguage} translate="no" className="notranslate" data-edition={getEdition()} suppressHydrationWarning>
      <body className="antialiased notranslate">
        {FONT_PRELOAD_HREFS.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
        {DEFERRED_FONT_STYLESHEETS[initialLanguage] && (
          <link
            id="deferred-font-css"
            rel="stylesheet"
            href={DEFERRED_FONT_STYLESHEETS[initialLanguage]}
          />
        )}
        {getEdition() !== 'selfhosted' && <GoogleAnalytics />}
        <EditionProvider edition={getEdition()} googleLogin={isGoogleLoginEnabled()} feedback={getFeedbackRecipient() !== null} eeFeatures={enabledEeFeatures()}>
        <SessionProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <LanguageProvider initialLanguage={initialLanguage}>
              {children}
              <CookieConsent />
              <Toaster
                position="bottom-center"
                expand={true}
                richColors={true}
                closeButton={true}
                offset={80}
                toastOptions={{
                  style: {
                    left: '50%',
                    marginLeft: '128px',
                    transform: 'translateX(-50%)'
                  }
                }}
              />
            </LanguageProvider>
          </ThemeProvider>
        </SessionProvider>
        </EditionProvider>
        {getEdition() !== 'selfhosted' && VENDOR_SALES_WIDGET && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (window.location.pathname.startsWith('/admin')) return;
                if (window.location.pathname.startsWith('/book/')) return;
                var CONFIG = ${JSON.stringify(
                  process.env.NODE_ENV !== 'production' ? VENDOR_SALES_WIDGET.dev : VENDOR_SALES_WIDGET.prod
                )};
                if (window.location.hostname !== CONFIG.hostname) return;
                var origin = window.location.origin;
                var script = document.createElement('script');
                script.src = origin + '/embed.min.js';
                script.setAttribute('data-agent-id', CONFIG.agentId);
                script.setAttribute('data-base-url', origin);
                script.setAttribute('data-workflow-id', CONFIG.workflowId);
                script.async = true;
                document.head.appendChild(script);
              })();
            `,
          }}
        />
        )}
      </body>
    </html>
  );
}
