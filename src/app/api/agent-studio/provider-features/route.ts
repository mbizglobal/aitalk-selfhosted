
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getProviderFeaturesFromCapabilities } from '@/lib/ai-providers'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const allFeatures = getProviderFeaturesFromCapabilities()

    const { searchParams } = new URL(request.url)
    const providerId = searchParams.get('provider')

    if (providerId) {
      const providerFeatures = allFeatures[providerId]
      if (!providerFeatures) {
        return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
      }

      return NextResponse.json({
        provider: providerId,
        features: providerFeatures.features
      })
    }

    return NextResponse.json({ providers: allFeatures })

  } catch (error) {
    console.error('[Provider Features] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
