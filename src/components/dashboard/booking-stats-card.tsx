'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/hooks/useLanguage'
import { CalendarCheck, CalendarPlus, RefreshCw } from 'lucide-react'

interface BookingStatsResponse {
  hasData: boolean
  hasCalendar: boolean
  upcoming: { h24: number; d7: number; d15: number }
  created: { h24: number; d7: number }
}

interface BookingStatsCardProps {
  ready: boolean
}

export function BookingStatsCard({ ready }: BookingStatsCardProps) {
  const { t } = useLanguage()
  const [stats, setStats] = useState<BookingStatsResponse | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard/bookings-stats')
        if (!res.ok) return
        const data: BookingStatsResponse = await res.json()
        if (!cancelled) setStats(data)
      } catch {
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready])

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await fetch('/api/dashboard/bookings-stats', { method: 'POST' })
      if (res.ok) setStats(await res.json())
    } catch {
      // best-effort
    } finally {
      setSyncing(false)
    }
  }

  if (!stats || (!stats.hasCalendar && !stats.hasData)) return null

  const upcoming = [
    { label: t('booking_stats_next_24h'), value: stats.upcoming.h24 },
    { label: t('booking_stats_next_7d'), value: stats.upcoming.d7 },
    { label: t('booking_stats_next_15d'), value: stats.upcoming.d15 },
  ]
  const created = [
    { label: t('booking_stats_created_24h'), value: stats.created.h24 },
    { label: t('booking_stats_created_7d'), value: stats.created.d7 },
  ]

  return (
    <Card className="relative transition-colors hover:border-primary/40 hover:bg-muted/30">
      <Link
        href="/app/bookings"
        aria-label={t('booking_stats_title')}
        className="absolute inset-0 z-0 rounded-xl"
      />
      <CardHeader className="pointer-events-none relative z-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t('booking_stats_title')}</CardTitle>
            <CardDescription>{t('booking_stats_subtitle')}</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSync}
            title={t('booking_stats_sync_hint')}
            className="pointer-events-auto relative z-20 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            <span className="ml-2 hidden sm:inline">{t('booking_stats_sync')}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pointer-events-none relative z-10">
        <div className="grid gap-6 md:grid-cols-2">
          <StatGroup
            icon={<CalendarCheck className="h-4 w-4" />}
            heading={t('booking_stats_upcoming')}
            items={upcoming}
          />
          <StatGroup
            icon={<CalendarPlus className="h-4 w-4" />}
            heading={t('booking_stats_new')}
            items={created}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function StatGroup({
  icon,
  heading,
  items,
}: {
  icon: React.ReactNode
  heading: string
  items: { label: string; value: number }[]
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>{heading}</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => (
          <div key={it.label} className="rounded-lg border p-3">
            <div className="text-2xl font-semibold tabular-nums">{it.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
