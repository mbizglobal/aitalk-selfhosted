
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

interface NagerHoliday {
  date: string                  // 'YYYY-MM-DD'
  localName?: string
  name: string
  countryCode: string
  fixed: boolean
  global: boolean
  counties: string[] | null
  launchYear?: number | null
  types?: string[]
}

const MAX_DAYS_AHEAD = 730

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const sp = request.nextUrl.searchParams
    const countryCode = (sp.get('countryCode') || '').toUpperCase().trim()
    const subdivision = (sp.get('subdivision') || '').toUpperCase().trim() || null
    const yearsRaw = sp.get('years') || ''

    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      return NextResponse.json(
        { success: false, error: 'countryCode is required (ISO 3166-1 alpha-2)' },
        { status: 400 }
      )
    }

    const years = yearsRaw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 2020 && n <= 2099)
    if (years.length === 0) {
      return NextResponse.json(
        { success: false, error: 'years is required (comma-separated, e.g. "2026,2027")' },
        { status: 400 }
      )
    }
    if (years.length > 5) {
      return NextResponse.json(
        { success: false, error: 'Too many years requested (max 5)' },
        { status: 400 }
      )
    }

    if (subdivision && subdivision !== 'ALL' && !subdivision.startsWith(`${countryCode}-`)) {
      return NextResponse.json(
        { success: false, error: 'subdivision must match countryCode (e.g. CH → CH-GE)' },
        { status: 400 }
      )
    }

    const todayMs = Date.now()
    const horizonMs = todayMs + MAX_DAYS_AHEAD * 86400000

    const fetched = await Promise.all(
      years.map(async (year) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        try {
          const res = await fetch(
            `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
            { signal: controller.signal }
          )
          if (!res.ok) return { year, ok: false, status: res.status, items: [] as NagerHoliday[] }
          const items = (await res.json()) as NagerHoliday[]
          return { year, ok: true, items: Array.isArray(items) ? items : [] }
        } catch (err: any) {
          return { year, ok: false, error: err?.message, items: [] as NagerHoliday[] }
        } finally {
          clearTimeout(timeout)
        }
      })
    )

    const failed = fetched.filter((f) => !f.ok)
    if (failed.length === fetched.length) {
      return NextResponse.json(
        {
          success: false,
          error: `Nager.Date PublicHolidays failed for all years (${failed.map((f: any) => f.status || f.error || '?').join(', ')})`,
        },
        { status: 502 }
      )
    }

    const merged: Array<{ date: string; name: string; subdivisions?: string[] }> = []
    for (const f of fetched) {
      for (const h of f.items) {
        if (!h?.date || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) continue

        const matchesSubdivision =
          subdivision === 'ALL'
            ? true
            : subdivision
              ? h.global || h.counties === null || (Array.isArray(h.counties) && h.counties.includes(subdivision))
              : h.global || h.counties === null

        if (!matchesSubdivision) continue

        const dateMs = new Date(`${h.date}T00:00:00Z`).getTime()
        if (!Number.isFinite(dateMs)) continue
        if (dateMs < todayMs - 86400000) continue
        if (dateMs > horizonMs) continue

        const displayName = (h.localName && h.localName.trim()) || h.name || h.date
        const subs = Array.isArray(h.counties) && h.counties.length > 0 ? h.counties : undefined
        merged.push({ date: h.date, name: displayName, subdivisions: subs })
      }
    }

    const byKey = new Map<string, { date: string; name: string; subdivisions?: string[] }>()
    for (const h of merged) {
      const key = `${h.date}|${h.name}`
      const exist = byKey.get(key)
      if (!exist) {
        byKey.set(key, { ...h, subdivisions: h.subdivisions ? [...h.subdivisions] : undefined })
      } else if (h.subdivisions && h.subdivisions.length) {
        const set = new Set([...(exist.subdivisions || []), ...h.subdivisions])
        exist.subdivisions = Array.from(set)
      }
    }
    const dedup = Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      success: true,
      holidays: dedup,
      count: dedup.length,
      source: 'date.nager.at',
      ...(failed.length > 0 ? { partial: true, failedYears: failed.map((f) => f.year) } : {}),
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to import holidays' },
      { status: 500 }
    )
  }
}
