'use client'

import { usePathname } from 'next/navigation'
import { AppLayoutClient } from './app-layout-client'
import { AuthGuard } from './auth-guard'
import './dashboard.css'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  if (pathname?.startsWith('/app/agent-studio')) {
    return <AuthGuard>{children}</AuthGuard>
  }

  if (pathname?.startsWith('/app/deploy')) {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <AppLayoutClient>{children}</AppLayoutClient>
    </AuthGuard>
  )
}