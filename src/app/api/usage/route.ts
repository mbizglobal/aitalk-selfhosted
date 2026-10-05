import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns'
import { getLanguageFromHeaders, getTranslations, getErrorMessage } from '@/lib/translations/dashboard'

interface UsagePoint {
  day: number
  count: number
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export async function GET(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const url = new URL(request.url)
    const monthParam = url.searchParams.get('month')
    const yearParam = url.searchParams.get('year')
    const agentId = url.searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: t.usage_agent_required }, { status: 400 })
    }

    const now = new Date()
    let targetStart = startOfMonth(now)

    if (monthParam && yearParam) {
      const parsedMonth = Number(monthParam)
      const parsedYear = Number(yearParam)
      if (!Number.isNaN(parsedMonth) && !Number.isNaN(parsedYear)) {
        targetStart = startOfMonth(new Date(parsedYear, parsedMonth - 1, 1))
      }
    }

    const settings = await prisma.settings.findUnique({
      where: { id: session.user.id },
      select: { plan: true },
    })

    const plan = settings?.plan ?? 'free'
    const isFree = plan === 'free'

    const currentStart = startOfMonth(now)

    if (isFree) {
      targetStart = currentStart
    }

    const earliestAllowedStart = startOfMonth(subDays(now, 179))
    if (!isFree && targetStart < earliestAllowedStart) {
      targetStart = earliestAllowedStart
    }

    if (targetStart > currentStart) {
      targetStart = currentStart
    }

    const targetEnd = endOfMonth(targetStart)

    // Verify the agent belongs to the user
    const agent = await prisma.agent.findFirst({
      where: {
        agentId: agentId,
        userId: session.user.id,
      },
    })

    if (!agent) {
      return NextResponse.json({ error: t.usage_agent_not_found }, { status: 404 })
    }

    const allLogs = await prisma.cpaUsageLog.findMany({
      where: { agentId: agentId },
      orderBy: { usageDate: 'desc' },
    })

    const logs = await prisma.cpaUsageLog.findMany({
      where: {
        agentId: agentId,
        usageDate: {
          gte: targetStart,
          lte: targetEnd,
        },
      },
      orderBy: { usageDate: 'asc' },
    })

    const usageMap = new Map<string, number>()
    for (const log of logs) {
      const key = normalizeDate(log.usageDate).toISOString().slice(0, 10)
      usageMap.set(key, (usageMap.get(key) ?? 0) + log.cpaUsed)
    }

    const days = eachDayOfInterval({ start: targetStart, end: targetEnd })
    const chartData: UsagePoint[] = days.map((day) => {
      const key = normalizeDate(day).toISOString().slice(0, 10)
      return {
        day: day.getDate(),
        count: usageMap.get(key) ?? 0,
      }
    })

    let canGoPrev = false
    let canGoNext = false

    if (!isFree) {
      const prevStart = startOfMonth(subMonths(targetStart, 1))
      const nextStart = startOfMonth(addMonths(targetStart, 1))
      const earliestStart = earliestAllowedStart

      canGoPrev = prevStart >= earliestStart && prevStart < targetStart
      canGoNext = nextStart <= currentStart && nextStart > targetStart
    }

    return NextResponse.json({
      success: true,
      plan,
      chartData,
      month: targetStart.getMonth() + 1,
      year: targetStart.getFullYear(),
      startDate: targetStart.toISOString(),
      endDate: targetEnd.toISOString(),
      canGoPrev,
      canGoNext,
    })
  } catch (error) {
    console.error('[USAGE_API] Failed to load usage data:', error)
    return NextResponse.json({ error: t.usage_internal_error }, { status: 500 })
  }
}
