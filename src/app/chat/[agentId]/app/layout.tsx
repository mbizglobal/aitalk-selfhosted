import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Work App | AiTalk.ch',
  description: 'Open this Work App to continue — sign in required.',
  openGraph: {
    title: 'AI Work App · AiTalk.ch',
    description: 'Open this Work App to continue — sign in required.',
    siteName: 'AiTalk.ch',
    images: [{ url: '/og-cover-en.jpg', width: 1200, height: 630, alt: 'AI Talk — AI Work Apps' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Work App · AiTalk.ch',
    description: 'Open this Work App to continue — sign in required.',
    images: ['/og-cover-en.jpg'],
  },
};

export default function WorkAppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
