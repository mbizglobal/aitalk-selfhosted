
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { FEATURED_COUNTRY_CODES, SUBDIVISION_SUPPORTED_COUNTRIES, ALLOWED_COUNTRY_CODES } from '@/lib/holidays/subdivision-names'

interface NagerCountry {
  countryCode: string
  name: string
}

interface CachedCountries {
  data: Array<{ code: string; name: string; hasSubdivisions: boolean }>
  expiresAt: number
}

let cache: CachedCountries | null = null
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    if (cache && cache.expiresAt > Date.now()) {
      return NextResponse.json({ success: true, countries: cache.data })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    let raw: NagerCountry[] = []
    try {
      const res = await fetch('https://date.nager.at/api/v3/AvailableCountries', {
        signal: controller.signal,
      })
      if (!res.ok) {
        return NextResponse.json(
          { success: false, error: `Nager.Date AvailableCountries failed (${res.status})` },
          { status: 502 }
        )
      }
      raw = (await res.json()) as NagerCountry[]
    } finally {
      clearTimeout(timeout)
    }

    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Nager.Date returned no countries' },
        { status: 502 }
      )
    }

    const allowedSet = new Set<string>(ALLOWED_COUNTRY_CODES)
    const filtered = raw.filter((c) => allowedSet.has(c.countryCode))

    const featuredSet = new Set<string>(FEATURED_COUNTRY_CODES)
    const subdivisionSet = new Set<string>(SUBDIVISION_SUPPORTED_COUNTRIES)
    const featured = filtered
      .filter((c) => featuredSet.has(c.countryCode))
      .sort(
        (a, b) => FEATURED_COUNTRY_CODES.indexOf(a.countryCode) - FEATURED_COUNTRY_CODES.indexOf(b.countryCode)
      )
    const others = filtered
      .filter((c) => !featuredSet.has(c.countryCode))
      .sort((a, b) => a.name.localeCompare(b.name))

    const data = [...featured, ...others].map((c) => ({
      code: c.countryCode,
      name: c.name,
      hasSubdivisions: subdivisionSet.has(c.countryCode),
    }))

    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
    return NextResponse.json({ success: true, countries: data })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch countries' },
      { status: 500 }
    )
  }
}
