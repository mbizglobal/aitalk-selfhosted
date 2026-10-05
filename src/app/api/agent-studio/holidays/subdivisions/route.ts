
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getSubdivisionsForCountry, SUBDIVISION_SUPPORTED_COUNTRIES } from '@/lib/holidays/subdivision-names'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const countryCode = (request.nextUrl.searchParams.get('countryCode') || '').toUpperCase().trim()
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      return NextResponse.json(
        { success: false, error: 'countryCode is required (ISO 3166-1 alpha-2)' },
        { status: 400 }
      )
    }

    if (!SUBDIVISION_SUPPORTED_COUNTRIES.includes(countryCode)) {
      return NextResponse.json({ success: true, subdivisions: [] })
    }

    const data = getSubdivisionsForCountry(countryCode)
    return NextResponse.json({ success: true, subdivisions: data })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch subdivisions' },
      { status: 500 }
    )
  }
}
