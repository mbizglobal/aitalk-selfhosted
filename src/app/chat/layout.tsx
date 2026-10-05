import type { Metadata } from 'next';
import '../app/dashboard.css';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
