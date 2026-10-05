'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/hooks/useLanguage'
import { GraduationCap } from 'lucide-react'

interface VoiceQuizStats {
  hasVoiceQuiz: boolean
  program?: { schedule: any }
  summary?: {
    participants: number
    erasedParticipants: number
    completedRounds: number
    todayRoundNo: number | null
    todayDone: number | null
    earnedSum: number | null
    earnedKnown: number
  }
}

interface Props {
  ready: boolean
}

export function VoiceQuizStatsCard({ ready }: Props) {
  const { t } = useLanguage()
  const [stats, setStats] = useState<VoiceQuizStats | null>(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard/voice-quiz')
        if (!res.ok) return
        const data: VoiceQuizStats = await res.json()
        if (!cancelled) setStats(data)
      } catch {
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready])

  if (!stats || !stats.hasVoiceQuiz || !stats.summary) return null

  const s = stats.summary
  const schedule = stats.program?.schedule
  const roundText =
    schedule?.phase === 'open'
      ? t('vq_round_open').replace('{n}', String(schedule.roundNo)).replace('{total}', String(schedule.totalRounds))
      : schedule?.phase === 'before_start'
        ? t('vq_round_before').replace('{date}', schedule.startsOn)
        : schedule?.phase === 'finished'
          ? t('vq_round_finished').replace('{date}', schedule.endedOn)
          : t('vq_round_unscheduled')

  const tiles = [
    { label: t('vq_tile_participants'), value: s.participants },
    { label: t('vq_tile_today'), value: s.todayRoundNo === null ? '–' : s.todayDone },
    { label: t('vq_tile_completed'), value: s.completedRounds },
  ]

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-4 w-4" />
            {t('vq_title')}
          </CardTitle>
          <CardDescription className="mt-1">{roundText}</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/voice-quiz">{t('vq_open')}</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-md border p-3">
              <p className="text-2xl font-semibold">{tile.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{tile.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
