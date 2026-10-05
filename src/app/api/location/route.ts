import { NextRequest, NextResponse } from 'next/server'
import { getLocationFromIP } from '@/lib/geolocation'
import { getApiTranslation } from '@/lib/translations'

export async function POST(request: NextRequest) {
  try {
    const t = getApiTranslation(request)
    const { ips } = await request.json()

    if (!Array.isArray(ips) || ips.length === 0) {
      return NextResponse.json({ error: t('api_error_ips_array_required') }, { status: 400 })
    }

    const limitedIPs = ips.slice(0, 20)

    const locationPromises = limitedIPs.map(async (ip: string) => {
      if (!ip || typeof ip !== 'string') {
        return { ip, location: {} }
      }

      const baseUrl = process.env.NEXTAUTH_URL || ''
      const isProduction = baseUrl.includes('aitalk.ch')

      if (isProduction) {
        return { ip, location: {} }
      } else {
        const location = await getLocationFromIP(ip)
        return { ip, location }
      }
    })

    const results = await Promise.all(locationPromises)

    return NextResponse.json({
      success: true,
      results
    })
  } catch (error) {
    console.error('[Location API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch location information' },
      { status: 500 }
    )
  }
}