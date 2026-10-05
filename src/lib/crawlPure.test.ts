import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidUrl,
  isSameOrigin,
  parseRobotsTxt,
  selectRobotsGroup,
  robotsPatternToRegex,
  isAllowedByRobots,
  CRAWLER_PRODUCT_TOKEN,
} from './crawlPure'

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────

test('isValidUrl: a normal http/https page is true', () => {
  assert.equal(isValidUrl('https://example.com'), true)
  assert.equal(isValidUrl('https://example.com/about'), true)
  assert.equal(isValidUrl('http://example.com/team/'), true)
})

test('isValidUrl: protocols other than http/https are false', () => {
  assert.equal(isValidUrl('ftp://example.com/file'), false)
  assert.equal(isValidUrl('file:///etc/passwd'), false)
  assert.equal(isValidUrl('mailto:a@b.com'), false)
  assert.equal(isValidUrl('javascript:alert(1)'), false)
})

test('isValidUrl: an unparseable string is false', () => {
  assert.equal(isValidUrl('not a url'), false)
  assert.equal(isValidUrl(''), false)
  assert.equal(isValidUrl('example.com'), false)
})

test('isValidUrl: path exclusion patterns (/api/ /admin/ /_next/ /static/) are false', () => {
  assert.equal(isValidUrl('https://example.com/api/users'), false)
  assert.equal(isValidUrl('https://example.com/admin/dashboard'), false)
  assert.equal(isValidUrl('https://example.com/_next/static/chunk'), false)
  assert.equal(isValidUrl('https://example.com/static/logo'), false)
})

test('isValidUrl: path exclusion patterns ignore case (pathname lowercase)', () => {
  assert.equal(isValidUrl('https://example.com/API/users'), false)
  assert.equal(isValidUrl('https://example.com/Admin/panel'), false)
})

test('isValidUrl: extension exclusion patterns (.xml .json .pdf .jpg .png .gif .css .js) are false', () => {
  for (const ext of ['.xml', '.json', '.pdf', '.jpg', '.png', '.gif', '.css', '.js']) {
    assert.equal(isValidUrl(`https://example.com/file${ext}`), false, `ext ${ext} 는 거부돼야 함`)
  }
})

test('isValidUrl: a URL containing a fragment (#) is false', () => {
  assert.equal(isValidUrl('https://example.com/page#section'), false)
})

test('isValidUrl: filtered by url.includes even if the pattern is only in the query, not the pathname (existing behavior)', () => {
  assert.equal(isValidUrl('https://example.com/page?doc=.pdf'), false)
})

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────

test('isSameOrigin: same origin (only path/query differ) is true', () => {
  assert.equal(isSameOrigin('https://example.com/', 'https://example.com/about?x=1'), true)
})

test('isSameOrigin: false if the host differs (including subdomains)', () => {
  assert.equal(isSameOrigin('https://example.com', 'https://other.com'), false)
  assert.equal(isSameOrigin('https://example.com', 'https://sub.example.com'), false)
})

test('isSameOrigin: false if the scheme differs (http vs https)', () => {
  assert.equal(isSameOrigin('http://example.com', 'https://example.com'), false)
})

test('isSameOrigin: false if the port differs', () => {
  assert.equal(isSameOrigin('https://example.com:8080', 'https://example.com'), false)
})

test('isSameOrigin: an unparseable URL is false', () => {
  assert.equal(isSameOrigin('not a url', 'https://example.com'), false)
  assert.equal(isSameOrigin('https://example.com', 'garbage'), false)
})

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────

test('parseRobotsTxt: default group + disallow parsing', () => {
  const rule = parseRobotsTxt('User-agent: *\nDisallow: /private')
  assert.equal(rule.groups.length, 1)
  assert.deepEqual(rule.groups[0].userAgents, ['*'])
  assert.deepEqual(rule.groups[0].rules, [{ type: 'disallow', path: '/private' }])
})

test('parseRobotsTxt: strips comments (#)', () => {
  const rule = parseRobotsTxt('User-agent: * # 모든 봇\nDisallow: /x # 비공개\n# 전체 주석 라인')
  assert.deepEqual(rule.groups[0].userAgents, ['*'])
  assert.deepEqual(rule.groups[0].rules, [{ type: 'disallow', path: '/x' }])
})

test('parseRobotsTxt: consecutive User-agent lines share one group', () => {
  const rule = parseRobotsTxt('User-agent: A\nUser-agent: B\nDisallow: /x')
  assert.equal(rule.groups.length, 1)
  assert.deepEqual(rule.groups[0].userAgents, ['A', 'B'])
  assert.deepEqual(rule.groups[0].rules, [{ type: 'disallow', path: '/x' }])
})

test('parseRobotsTxt: a User-agent after a rule starts a new group', () => {
  const rule = parseRobotsTxt('User-agent: A\nDisallow: /x\nUser-agent: B\nDisallow: /y')
  assert.equal(rule.groups.length, 2)
  assert.deepEqual(rule.groups[0].userAgents, ['A'])
  assert.deepEqual(rule.groups[1].userAgents, ['B'])
})

test('parseRobotsTxt: an empty User-agent value is ignored (prevents the regression of matching all bots)', () => {
  const rule = parseRobotsTxt('User-agent:\nDisallow: /z')
  assert.equal(rule.groups.length, 0)
})

test('parseRobotsTxt: rules outside a group (before the first User-agent) are ignored', () => {
  const rule = parseRobotsTxt('Disallow: /early\nUser-agent: *\nDisallow: /late')
  assert.equal(rule.groups.length, 1)
  assert.deepEqual(rule.groups[0].rules, [{ type: 'disallow', path: '/late' }])
})

test('parseRobotsTxt: an empty disallow adds no rule (no blocking)', () => {
  const rule = parseRobotsTxt('User-agent: *\nDisallow:')
  assert.equal(rule.groups[0].rules.length, 0)
})

test('parseRobotsTxt: collects sitemaps + parses crawl-delay', () => {
  const rule = parseRobotsTxt(
    'Sitemap: https://example.com/sitemap.xml\nUser-agent: *\nCrawl-delay: 5\nDisallow: /x'
  )
  assert.deepEqual(rule.sitemaps, ['https://example.com/sitemap.xml'])
  assert.equal(rule.groups[0].crawlDelay, 5)
})

test('parseRobotsTxt: negative or abnormal crawl-delay is ignored', () => {
  const rule = parseRobotsTxt('User-agent: *\nCrawl-delay: -3\nDisallow: /x')
  assert.equal(rule.groups[0].crawlDelay, undefined)
})

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────

test('selectRobotsGroup: among prefix matches, the longest token wins', () => {
  const rule = parseRobotsTxt(
    'User-agent: AITalk\nDisallow: /short\n' +
    'User-agent: AITalk-Crawler\nDisallow: /long\n' +
    'User-agent: *\nDisallow: /star'
  )
  const g = selectRobotsGroup(rule, 'AITalk-Crawler')
  assert.deepEqual(g?.rules, [{ type: 'disallow', path: '/long' }])
})

test('selectRobotsGroup: falls back to * when there is no specific match', () => {
  const rule = parseRobotsTxt('User-agent: Googlebot\nDisallow: /g\nUser-agent: *\nDisallow: /star')
  const g = selectRobotsGroup(rule, 'AITalk-Crawler')
  assert.deepEqual(g?.rules, [{ type: 'disallow', path: '/star' }])
})

test('selectRobotsGroup: null when neither a match nor * exists (no rules)', () => {
  const rule = parseRobotsTxt('User-agent: Bingbot\nDisallow: /b')
  assert.equal(selectRobotsGroup(rule, 'AITalk-Crawler'), null)
})

test('selectRobotsGroup: duplicate groups with the same token merge their rules', () => {
  const rule = parseRobotsTxt(
    'User-agent: AITalk-Crawler\nDisallow: /a\n' +
    'User-agent: AITalk-Crawler\nDisallow: /b'
  )
  const g = selectRobotsGroup(rule, 'AITalk-Crawler')
  assert.deepEqual(g?.rules, [
    { type: 'disallow', path: '/a' },
    { type: 'disallow', path: '/b' },
  ])
})

test('selectRobotsGroup: matching is case-insensitive', () => {
  const rule = parseRobotsTxt('User-agent: aitalk-crawler\nDisallow: /x')
  const g = selectRobotsGroup(rule, 'AITalk-Crawler')
  assert.deepEqual(g?.rules, [{ type: 'disallow', path: '/x' }])
})

test('selectRobotsGroup: when merging duplicate * groups, crawlDelay keeps the first value seen', () => {
  const rule = parseRobotsTxt(
    'User-agent: *\nCrawl-delay: 5\nDisallow: /a\n' +
    'User-agent: *\nCrawl-delay: 10\nDisallow: /b'
  )
  const g = selectRobotsGroup(rule, 'AITalk-Crawler')
  assert.deepEqual(g?.rules, [
    { type: 'disallow', path: '/a' },
    { type: 'disallow', path: '/b' },
  ])
  assert.equal(g?.crawlDelay, 5)
})

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────

test('robotsPatternToRegex: prefix match (no anchor)', () => {
  const re = robotsPatternToRegex('/private')
  assert.equal(re.test('/private/page'), true)
  assert.equal(re.test('/public'), false)
})

test('robotsPatternToRegex: \'*\' expands to .*', () => {
  const re = robotsPatternToRegex('/a/*/b')
  assert.equal(re.test('/a/x/b'), true)
  assert.equal(re.test('/a/x/y/b'), true)
  assert.equal(re.test('/a/b'), false)
})

test('robotsPatternToRegex: a trailing \'$\' is an end anchor', () => {
  const re = robotsPatternToRegex('/file.pdf$')
  assert.equal(re.test('/file.pdf'), true)
  assert.equal(re.test('/file.pdfx'), false)
})

test('robotsPatternToRegex: regex metacharacters are escaped as literals', () => {
  const re = robotsPatternToRegex('/a.b')
  assert.equal(re.test('/a.b'), true)
  assert.equal(re.test('/axb'), false)
})

test('robotsPatternToRegex: a \'$\' not at the end is literal', () => {
  const re = robotsPatternToRegex('/a$b')
  assert.equal(re.test('/a$b'), true)
  assert.equal(re.test('/a'), false)
})

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────

test('isAllowedByRobots: always allowed when robotsRule is null', () => {
  assert.equal(isAllowedByRobots('https://example.com/anything', null), true)
})

test('isAllowedByRobots: allowed when no group matches our token or *', () => {
  const rule = parseRobotsTxt('User-agent: Bingbot\nDisallow: /')
  assert.equal(isAllowedByRobots('https://example.com/secret', rule), true)
})

test('isAllowedByRobots: disallowed paths are blocked, others allowed', () => {
  const rule = parseRobotsTxt('User-agent: *\nDisallow: /secret')
  assert.equal(isAllowedByRobots('https://example.com/secret/page', rule), false)
  assert.equal(isAllowedByRobots('https://example.com/public', rule), true)
})

test('isAllowedByRobots: a longer Allow overrides Disallow', () => {
  const rule = parseRobotsTxt('User-agent: *\nDisallow: /folder\nAllow: /folder/public')
  assert.equal(isAllowedByRobots('https://example.com/folder/public/x', rule), true)
  assert.equal(isAllowedByRobots('https://example.com/folder/private', rule), false)
})

test('isAllowedByRobots: Allow wins on equal length', () => {
  const rule = parseRobotsTxt('User-agent: *\nDisallow: /page\nAllow: /page')
  assert.equal(isAllowedByRobots('https://example.com/page', rule), true)
})

test('isAllowedByRobots: query-based disallow (Disallow: /*?preview=)', () => {
  const rule = parseRobotsTxt('User-agent: *\nDisallow: /*?preview=')
  assert.equal(isAllowedByRobots('https://example.com/page?preview=1', rule), false)
  assert.equal(isAllowedByRobots('https://example.com/page', rule), true)
})

test('isAllowedByRobots: a matching group with no rules (empty rules) is allowed', () => {
  const rule = parseRobotsTxt('User-agent: *\nDisallow:')
  assert.equal(isAllowedByRobots('https://example.com/x', rule), true)
})

test('isAllowedByRobots: an unparseable URL is allowed (keeps existing behavior)', () => {
  const rule = parseRobotsTxt('User-agent: *\nDisallow: /x')
  assert.equal(isAllowedByRobots('not a url', rule), true)
})

test('isAllowedByRobots: the group targeting the real CRAWLER_PRODUCT_TOKEN applies', () => {
  const rule = parseRobotsTxt(`User-agent: ${CRAWLER_PRODUCT_TOKEN}\nDisallow: /blocked`)
  assert.equal(isAllowedByRobots('https://example.com/blocked/x', rule), false)
  assert.equal(isAllowedByRobots('https://example.com/open', rule), true)
})
