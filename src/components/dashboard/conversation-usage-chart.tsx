'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLanguage } from '@/hooks/useLanguage'
import { format } from 'date-fns'
import { Loader2, AlertCircle } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface UsagePoint {
  day: number
  count: number
}

interface UsageResponse {
  success: boolean
  chartData: UsagePoint[]
  month: number
  year: number
  startDate: string
  endDate: string
  canGoPrev: boolean
  canGoNext: boolean
}

interface ConversationUsageChartProps {
  plan: string
  ready: boolean
  agentId?: string
}

export function ConversationUsageChart({ plan, ready, agentId }: ConversationUsageChartProps) {
  const { t, currentLanguage } = useLanguage()
  const [chartData, setChartData] = useState<UsagePoint[]>([])
  const [activeMonth, setActiveMonth] = useState(new Date().getMonth() + 1)
  const [activeYear, setActiveYear] = useState(new Date().getFullYear())
  const [canGoPrev, setCanGoPrev] = useState(false)
  const [canGoNext, setCanGoNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const activeDate = useMemo(() => new Date(activeYear, activeMonth - 1, 1), [activeMonth, activeYear])
  const isFreePlan = plan === 'free'

  const loadUsage = useCallback(async (month: number, year: number) => {
    if (!agentId) {
      setError(t('no_agent_selected'))
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/usage?month=${month}&year=${year}&agentId=${agentId}`)
      const data: UsageResponse = await response.json()

      if (!response.ok || !data?.success) {
        setChartData([])
        setLoading(false)
        return
      }

      setChartData(data.chartData ?? [])
      setActiveMonth(data.month)
      setActiveYear(data.year)
      setCanGoPrev(data.canGoPrev && !isFreePlan)
      setCanGoNext(data.canGoNext && !isFreePlan)
    } catch (err) {
      setChartData([])
    } finally {
      setLoading(false)
    }
  }, [t, isFreePlan, agentId])

  useEffect(() => {
    if (!ready || !agentId) {
      return
    }

    loadUsage(new Date().getMonth() + 1, new Date().getFullYear())
  }, [ready, agentId, loadUsage])

  const handlePrev = useCallback(() => {
    if (loading || !canGoPrev) {
      return
    }
    const prevDate = new Date(activeYear, activeMonth - 1, 1)
    prevDate.setMonth(prevDate.getMonth() - 1)
    loadUsage(prevDate.getMonth() + 1, prevDate.getFullYear())
  }, [activeMonth, activeYear, canGoPrev, loadUsage, loading])

  const handleNext = useCallback(() => {
    if (loading || !canGoNext) {
      return
    }
    const nextDate = new Date(activeYear, activeMonth - 1, 1)
    nextDate.setMonth(nextDate.getMonth() + 1)
    loadUsage(nextDate.getMonth() + 1, nextDate.getFullYear())
  }, [activeMonth, activeYear, canGoNext, loadUsage, loading])

  const chartLabel = useMemo(() => {
    const monthNames = [
      'month_january', 'month_february', 'month_march', 'month_april',
      'month_may', 'month_june', 'month_july', 'month_august',
      'month_september', 'month_october', 'month_november', 'month_december'
    ]
    const monthIndex = activeDate.getMonth()
    const year = activeDate.getFullYear()
    const monthName = t(monthNames[monthIndex])

    // Korean and some other languages prefer year-month format
    if (currentLanguage === 'ko') {
      return `${year}년 ${monthName}`
    }

    return `${monthName} ${year}`
  }, [activeDate, t, currentLanguage])

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <CardTitle>{t('usage_chart_title')}</CardTitle>
          <CardDescription>{t('usage_chart_description')}</CardDescription>
        </div>
        {!isFreePlan && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrev}
              disabled={!ready || loading || !canGoPrev}
            >
              {t('usage_chart_prev')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleNext}
              disabled={!ready || loading || !canGoNext}
            >
              {t('usage_chart_next')}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{chartLabel}</span>
          {ready && loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="h-[260px]">
          {!ready ? (
            <Skeleton className="h-full w-full" />
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-destructive">
              <AlertCircle className="mb-2 h-5 w-5" />
              <p>{error}</p>
            </div>
          ) : loading && chartData.length === 0 ? (
            <Skeleton className="h-full w-full" />
          ) : chartData.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <p>{t('usage_chart_empty')}</p>
            </div>
          ) : (
            <ResponsiveContainer>
              <BarChart
                data={chartData}
                margin={isMobile ? { top: 10, right: 5, left: -20, bottom: 0 } : { top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="4 4"
                  stroke="#e5e7eb"
                  className="dark:opacity-20"
                  vertical={!isMobile}
                />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  interval={0}
                  tickFormatter={(value) => {
                    if (isMobile) {
                      return value % 2 === 1 ? value.toString() : ''
                    }
                    return value.toString()
                  }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  tickCount={5}
                />
                <Tooltip cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }} />
                <Bar dataKey="count" fill="#6366F1" radius={[6, 6, 0, 0]} name={t('usage_chart_series_conversations')} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
