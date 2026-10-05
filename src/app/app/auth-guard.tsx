'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [accessChecked, setAccessChecked] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session) {
      router.push('/auth')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/access-status')
        const data = res.ok ? await res.json() : { pending: false }
        if (cancelled) return
        if (data.pending) {
          router.replace('/auth/gate')
          return
        }
        setAccessChecked(true)
      } catch {
        if (!cancelled) setAccessChecked(true)
      }
    })()
    return () => { cancelled = true }
  }, [session, status, router])

  if (status === 'loading' || (!!session && !accessChecked)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return null
  }

  return <>{children}</>
}
