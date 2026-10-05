import { isSelfHosted } from '@/lib/edition'

export interface LocationInfo {
  country?: string
  countryCode?: string
  region?: string
  city?: string
}

export async function getLocationFromIP(ip: string): Promise<LocationInfo> {
  if (isSelfHosted()) return {}
  try {
    const ipv6MockData: Record<string, LocationInfo> = {
      '2a02:1210:8210:3600:69ce:2a2e:ca0a:bccc': {
        country: 'Switzerland',
        countryCode: 'CH',
        region: 'Lucerne',
        city: 'Kriens'
      },
      '2a02:121e:7cd7:0:29fc:1c9e:2661:b1ae': {
        country: 'Switzerland',
        countryCode: 'CH',
        region: 'Zurich',
        city: 'Zurich'
      },
      '2a02:121e:7cd7:0:70a9:7f61:6eb3:7ea0': {
        country: 'Switzerland',
        countryCode: 'CH',
        region: 'Zurich',
        city: 'Zurich'
      },
      '2a02:1210:8210:3600:bd2c:673f:df0f:8b10': {
        country: 'Switzerland',
        countryCode: 'CH',
        region: 'Lucerne',
        city: 'Kriens'
      }
    }

    if (ipv6MockData[ip]) {
      return ipv6MockData[ip]
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    const response = await fetch(`https://ipapi.co/${ip}/json/`, {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()

    const result = {
      country: data.country_name,
      countryCode: data.country_code,
      region: data.region,
      city: data.city
    }

    return result
  } catch (error) {
    return {}
  }
}

export function getLocationFromFrontDoor(headers: Headers): LocationInfo | null {
  const countryCode = headers.get('X-Azure-Geo-Country')

  if (countryCode) {
    return {
      countryCode: countryCode
    }
  }

  return null
}

export function getClientIP(request: Request): string | null {
  const forwardedFor = request.headers.get('X-Forwarded-For')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }

  // X-Real-IP
  const realIP = request.headers.get('X-Real-IP')
  if (realIP) return realIP

  if (process.env.NODE_ENV === 'development') {
    return '8.8.8.8'
  }

  return null
}

export async function getIPAndLocation(request: Request): Promise<{ip: string | null, location: LocationInfo}> {
  const baseUrl = process.env.NEXTAUTH_URL || ''
  const isProduction = baseUrl.includes('aitalk.ch')
  const clientIP = getClientIP(request)

  if (isProduction) {
    const frontDoorLocation = getLocationFromFrontDoor(request.headers)
    if (frontDoorLocation) {
      return { ip: clientIP, location: frontDoorLocation }
    }

    return { ip: clientIP, location: {} }
  } else {
    return { ip: clientIP, location: {} }
  }
}
