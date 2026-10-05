
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return false
    }

    const pathname = urlObj.pathname.toLowerCase()

    const excludePatterns = [
      '/api/',
      '/admin/',
      '/_next/',
      '/static/',
      '.xml',
      '.json',
      '.pdf',
      '.jpg',
      '.png',
      '.gif',
      '.css',
      '.js',
      '#'
    ]

    for (const pattern of excludePatterns) {
      if (pathname.includes(pattern) || url.includes(pattern)) {
        return false
      }
    }

    return true
  } catch {
    return false
  }
}

export function isSameOrigin(baseUrl: string, targetUrl: string): boolean {
  try {
    const base = new URL(baseUrl)
    const target = new URL(targetUrl)
    return base.origin === target.origin
  } catch {
    return false
  }
}

export const CRAWLER_PRODUCT_TOKEN = 'AITalk-Crawler'
export const CRAWLER_USER_AGENT = `${CRAWLER_PRODUCT_TOKEN}/1.0 (+https://www.aitalk.ch)`

export interface RobotsPathRule {
  type: 'allow' | 'disallow'
  path: string
}

export interface RobotsGroup {
  userAgents: string[]
  rules: RobotsPathRule[]
  crawlDelay?: number
}

export interface RobotsRule {
  groups: RobotsGroup[]
  sitemaps: string[]
}

export function parseRobotsTxt(robotsText: string): RobotsRule {
  const lines = robotsText.split('\n').map(line => line.replace(/#.*$/, '').trim())
  const rule: RobotsRule = { groups: [], sitemaps: [] }

  let current: RobotsGroup | null = null
  let lastDirectiveWasUserAgent = false

  for (const line of lines) {
    if (!line) continue

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim().toLowerCase()
    const value = line.slice(colonIdx + 1).trim()

    if (key === 'user-agent') {
      if (!value) continue
      if (!current || !lastDirectiveWasUserAgent) {
        current = { userAgents: [], rules: [] }
        rule.groups.push(current)
      }
      current.userAgents.push(value)
      lastDirectiveWasUserAgent = true
      continue
    }

    if (key === 'sitemap') {
      if (value) rule.sitemaps.push(value)
      lastDirectiveWasUserAgent = false
      continue
    }

    if (!current) {
      lastDirectiveWasUserAgent = false
      continue
    }

    switch (key) {
      case 'disallow':
        if (value) current.rules.push({ type: 'disallow', path: value })
        break
      case 'allow':
        if (value) current.rules.push({ type: 'allow', path: value })
        break
      case 'crawl-delay': {
        const n = parseInt(value, 10)
        if (Number.isFinite(n) && n >= 0) current.crawlDelay = n
        break
      }
    }
    lastDirectiveWasUserAgent = false
  }

  return rule
}

export function selectRobotsGroup(rule: RobotsRule, productToken: string): RobotsGroup | null {
  const target = productToken.toLowerCase()

  let bestTokenLower: string | null = null
  for (const group of rule.groups) {
    for (const token of group.userAgents) {
      if (token === '*') continue
      const tokenLower = token.toLowerCase()
      if (target.startsWith(tokenLower)) {
        if (!bestTokenLower || tokenLower.length > bestTokenLower.length) {
          bestTokenLower = tokenLower
        }
      }
    }
  }

  const selectedKey = bestTokenLower ?? '*'
  const matching: RobotsGroup[] = []
  for (const group of rule.groups) {
    if (group.userAgents.some(t => t.toLowerCase() === selectedKey)) {
      matching.push(group)
    }
  }
  if (matching.length === 0) return null
  if (matching.length === 1) return matching[0]

  return {
    userAgents: matching.flatMap(g => g.userAgents),
    rules: matching.flatMap(g => g.rules),
    crawlDelay: matching.map(g => g.crawlDelay).find(d => d !== undefined),
  }
}

export function robotsPatternToRegex(pattern: string): RegExp {
  let regex = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') {
      regex += '.*'
    } else if (ch === '$' && i === pattern.length - 1) {
      regex += '$'
    } else {
      regex += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(regex)
}

export function isAllowedByRobots(url: string, robotsRule: RobotsRule | null): boolean {
  if (!robotsRule) return true

  const group = selectRobotsGroup(robotsRule, CRAWLER_PRODUCT_TOKEN)
  if (!group || group.rules.length === 0) return true

  try {
    const urlObj = new URL(url)
    const target = urlObj.pathname + urlObj.search

    let bestLen = -1
    let bestType: 'allow' | 'disallow' = 'allow'

    for (const { type, path } of group.rules) {
      const match = target.match(robotsPatternToRegex(path))
      if (!match) continue
      const len = match[0].length
      if (len > bestLen) {
        bestLen = len
        bestType = type
      } else if (len === bestLen && type === 'allow') {
        bestType = 'allow'
      }
    }

    if (bestLen === -1) return true
    return bestType === 'allow'
  } catch (error) {
    console.warn(`[ROBOTS] Error checking URL ${url}:`, error)
    return true
  }
}
