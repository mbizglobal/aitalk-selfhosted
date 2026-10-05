import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getClientIP, isIPAllowed, isConsoleIPAllowed } from '@/lib/ipAuth';
import { getConsoleAdminOrSession, issueConsoleAdminToken, getConsoleAdminCookieOptions } from '@/lib/consoleAuth';
import { isSelfHosted } from '@/lib/edition';
import { normalizeRoutePath, offFeatureForRoute } from '@/lib/edition-features';

import { VENDOR_TRUSTED_IP_RANGES, VENDOR_TRUSTED_IPS } from '@/lib/vendor-network';
import blockedIPsData from '@/data/blocked-ips/blocked-ips.json';
const PERMANENTLY_BLOCKED_IPS = new Set(blockedIPsData.map((item: { ip: string }) => item.ip));

// ============================================
// Bot Detection (Edge Runtime Compatible)
// ============================================

const ALLOWED_BOTS = [
  'Googlebot', 'Bingbot', 'Slurp', 'DuckDuckBot', 'Baiduspider',
  'YandexBot', 'Sogou', 'Exabot', 'Applebot',
  'Yeti',              // Naver
  'Daumoa',            // Daum
  'cURLbot',           // ZUM
  'Y!J-BRW', 'Y!J-BRS',  // Yahoo Japan
  'Qwant',
  'Ecosia',
  'PetalBot',          // Huawei
  'facebot', 'facebookexternalhit', 'Twitterbot', 'LinkedInBot',
  'Pinterest', 'Discordbot', 'TelegramBot', 'WhatsApp',
  'AhrefsBot', 'SemrushBot', 'MJ12bot', 'Screaming Frog',
  'GTmetrix', 'Pingdom', 'UptimeRobot', 'Azure-Monitor', 'ApplicationInsightsAvailability',
];

const MALICIOUS_BOT_PATTERNS = [
  /python-requests/i, /python-urllib/i, /python\/\d/i,
  /scrapy/i, /curl\//i, /wget\//i, /libwww-perl/i, /lwp-trivial/i,
  /php\//i, /java\/\d/i, /httpclient/i, /okhttp/i, /go-http-client/i,
  /node-fetch/i, /axios/i, /headless/i, /phantomjs/i,
  /selenium/i, /webdriver/i, /puppeteer/i, /playwright/i,
  /zgrab/i, /masscan/i, /nmap/i, /nikto/i, /sqlmap/i,
  /dirbuster/i, /gobuster/i, /nuclei/i, /httpx/i, /censys/i, /shodan/i,
];

const TRUSTED_IP_RANGES = VENDOR_TRUSTED_IP_RANGES;

const TRUSTED_IPS = new Set([
  ...VENDOR_TRUSTED_IPS,
  '127.0.0.1',       // localhost
  '::1',             // localhost IPv6
]);

function isTrustedIP(ip: string): boolean {
  if (TRUSTED_IPS.has(ip)) return true;
  return TRUSTED_IP_RANGES.some(range => {
    if (!ip.startsWith(range.prefix)) return false;
    const lastOctet = parseInt(ip.slice(range.prefix.length), 10);
    return !isNaN(lastOctet) && lastOctet >= range.min && lastOctet <= range.max;
  });
}

const ipRequestCounts = new Map<string, { count: number; firstRequest: number }>();

const IP_RATE_LIMIT = 1500;
const IP_RATE_WINDOW = 60 * 1000;
const BLOCK_THRESHOLD = 3000;

interface BotCheckResult {
  shouldBlock: boolean;
  reason?: string;
  requestCount?: number;
  isAllowedBot: boolean;
}

function checkBot(request: NextRequest): BotCheckResult {
  const userAgent = request.headers.get('user-agent') || '';
  const ip = getClientIP(request);

  if (PERMANENTLY_BLOCKED_IPS.has(ip)) {
    return {
      shouldBlock: true,
      reason: `Permanently blocked IP`,
      isAllowedBot: false,
    };
  }

  if (isTrustedIP(ip)) {
    return { shouldBlock: false, isAllowedBot: false };
  }

  for (const bot of ALLOWED_BOTS) {
    if (userAgent.includes(bot)) {
      return { shouldBlock: false, isAllowedBot: true };
    }
  }

  for (const pattern of MALICIOUS_BOT_PATTERNS) {
    if (pattern.test(userAgent)) {
      return {
        shouldBlock: true,
        reason: `Malicious bot: ${pattern.source}`,
        isAllowedBot: false,
      };
    }
  }

  // 3. Rate Limiting
  const now = Date.now();
  const ipData = ipRequestCounts.get(ip);
  let requestCount = 1;
  let shouldBlock = false;
  let reason: string | undefined;

  if (ipData) {
    if (now - ipData.firstRequest < IP_RATE_WINDOW) {
      ipData.count++;
      requestCount = ipData.count;

      if (requestCount > BLOCK_THRESHOLD) {
        shouldBlock = true;
        reason = `Extreme rate: ${requestCount} req/min`;
      } else if (requestCount > IP_RATE_LIMIT) {
        shouldBlock = true;
        reason = `Rate limit: ${requestCount} req/min`;
      }
    } else {
      ipRequestCounts.set(ip, { count: 1, firstRequest: now });
    }
  } else {
    ipRequestCounts.set(ip, { count: 1, firstRequest: now });
  }

  if (!userAgent && requestCount > IP_RATE_LIMIT / 2) {
    shouldBlock = true;
    reason = `Empty UA with high rate: ${requestCount}`;
  }

  return { shouldBlock, reason, requestCount, isAllowedBot: false };
}

// ============================================
// Language Routing
// ============================================

// Order matters: longer-prefix locales (de-ch) MUST come before shorter ones (de)
// in regex alternations so /de-ch/* does not incorrectly match the /de/ branch.
const SUPPORTED_LANGS = ['en', 'de-ch', 'de', 'fr', 'ko'];

// Public pages that should be served under /{lang}/ path
const PUBLIC_BASE_PATHS = ['/', '/pricing', '/mbizglobal', '/aboutus', '/law'];

function mapCountryToLanguage(countryCode: string, acceptLang: string): string | null {
  const cc = countryCode.toUpperCase();

  if (cc === 'KR') return 'ko';
  if (cc === 'DE' || cc === 'AT') return 'de';
  if (cc === 'FR' || cc === 'MC') return 'fr';

  if (cc === 'CH' || cc === 'LI') {
    if (acceptLang.includes('fr')) return 'fr';
    if (acceptLang.includes('it')) return 'en';
    return 'de-ch';
  }
  if (cc === 'CA') {
    if (acceptLang.includes('fr')) return 'fr';
    return 'en';
  }
  if (cc === 'BE') {
    if (acceptLang.includes('de')) return 'de';
    if (acceptLang.includes('nl')) return 'en';
    return 'fr';
  }
  if (cc === 'LU') {
    if (acceptLang.includes('de')) return 'de';
    if (acceptLang.includes('fr')) return 'fr';
    return 'en';
  }

  return null;
}

function detectLangFromRequest(request: NextRequest): string {
  const cookie = request.cookies.get('preferred-language')?.value;
  if (cookie && SUPPORTED_LANGS.includes(cookie)) return cookie;

  const acceptLang = request.headers.get('accept-language') || '';

  const azureGeoCountry = request.headers.get('x-azure-geo-country');
  if (azureGeoCountry) {
    const mapped = mapCountryToLanguage(azureGeoCountry, acceptLang);
    if (mapped && SUPPORTED_LANGS.includes(mapped)) return mapped;
  }

  for (const lang of SUPPORTED_LANGS) {
    if (acceptLang.startsWith(lang) || acceptLang.includes(`${lang}-`) || acceptLang.includes(`${lang},`)) {
      return lang;
    }
  }
  return 'en';
}

function isPublicBasePath(pathname: string): boolean {
  if (pathname === '/law/privacy_policy_s' || pathname.startsWith('/law/privacy_policy_s/')) {
    return false;
  }
  return PUBLIC_BASE_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isAlreadyLangPrefixed(pathname: string): boolean {
  return SUPPORTED_LANGS.some(l => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
}

// ============================================
// Main Middleware
// ============================================

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isSelfHosted()) {
    if (normalizeRoutePath(pathname) === '/') {
      return NextResponse.redirect(new URL('/app', request.url));
    }
    if (offFeatureForRoute(pathname)) {
      return normalizeRoutePath(pathname).startsWith('/api/')
        ? NextResponse.json({ error: 'Not found' }, { status: 404 })
        : new NextResponse('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    (!pathname.startsWith('/console') && !pathname.startsWith('/api/console') && pathname.includes('.')) && (
      pathname.endsWith('.ico') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.jpg') ||
      pathname.endsWith('.jpeg') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.webp') ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.js')
    )
  ) {
    return NextResponse.next();
  }

  // ========== Canonical Host Redirect (SEO) ==========
  const host = request.headers.get('host') || '';
  if (host === 'aitalk.ch') {
    const url = request.nextUrl.clone();
    url.host = 'www.aitalk.ch';
    return NextResponse.redirect(url, 301);
  }

  // ========== Legacy URL 301 Redirects (SEO) ==========

  // 1. /home/{lang}/* → /{lang}/*  (de-ch first so it matches before bare 'de')
  const homeLangMatch = pathname.match(/^\/home\/(de-ch|en|de|fr|es|ko|ja|it)(\/.*)?\/?$/);
  if (homeLangMatch) {
    const lang = (homeLangMatch[1] === 'it' || homeLangMatch[1] === 'ja') ? 'en' : homeLangMatch[1];
    const rest = homeLangMatch[2] || '';
    return NextResponse.redirect(new URL(`/${lang}${rest}`, request.url), 301);
  }

  // 2. /{lang}/home/* → /{lang}/*
  const langHomeMatch = pathname.match(/^\/(de-ch|en|de|fr|es|ko|ja|it)\/home(\/.*)?\/?$/);
  if (langHomeMatch) {
    const lang = (langHomeMatch[1] === 'it' || langHomeMatch[1] === 'ja') ? 'en' : langHomeMatch[1];
    const rest = langHomeMatch[2] || '';
    return NextResponse.redirect(new URL(`/${lang}${rest}`, request.url), 301);
  }

  // 3. /home or /home/ → /{detected_lang}
  if (pathname === '/home' || pathname === '/home/') {
    return NextResponse.redirect(new URL(`/${detectLangFromRequest(request)}`, request.url), 301);
  }

  const itMatch = pathname.match(/^\/it(\/.*)?\/?$/);
  if (itMatch) {
    return NextResponse.redirect(new URL(`/en${itMatch[1] || ''}`, request.url), 301);
  }

  const jaMatch = pathname.match(/^\/ja(\/.*)?\/?$/);
  if (jaMatch) {
    return NextResponse.redirect(new URL(`/en${jaMatch[1] || ''}`, request.url), 301);
  }
  if (pathname === '/blog/ja' || pathname.startsWith('/blog/ja/')) {
    return NextResponse.redirect(new URL('/blog/en', request.url), 301);
  }

  // ========== Language Routing ==========
  if (pathname === '/de/mbizglobal' || pathname.startsWith('/de/mbizglobal/')) {
    const rest = pathname.slice('/de/mbizglobal'.length);
    return NextResponse.redirect(new URL(`/de/aboutus${rest}`, request.url), 301);
  }
  const langAboutusMatch = pathname.match(/^\/(de-ch|en|fr|es|ko)\/aboutus(\/.*)?$/);
  if (langAboutusMatch) {
    return NextResponse.redirect(
      new URL(`/${langAboutusMatch[1]}/mbizglobal${langAboutusMatch[2] || ''}`, request.url),
      301
    );
  }

  // Handle ?lang=XX → redirect to /{lang}/path (301 permanent)
  const langParam = request.nextUrl.searchParams.get('lang');
  if (langParam && SUPPORTED_LANGS.includes(langParam) && isPublicBasePath(pathname)) {
    const finalPath = (langParam === 'de' && (pathname === '/mbizglobal' || pathname.startsWith('/mbizglobal/')))
      ? pathname.replace(/^\/mbizglobal/, '/aboutus')
      : (pathname === '/' ? '' : pathname);
    const newUrl = new URL(`/${langParam}${finalPath}`, request.url);
    newUrl.searchParams.delete('lang');
    // Preserve other query params if any
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'lang') newUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(newUrl, 301);
  }

  if (langParam && isAlreadyLangPrefixed(pathname)) {
    const newUrl = new URL(pathname, request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'lang') newUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(newUrl, 301);
  }

  // Redirect bare public paths to language-prefixed paths (302 dynamic).
  if (isPublicBasePath(pathname) && !isAlreadyLangPrefixed(pathname)) {
    const lang = detectLangFromRequest(request);
    const subPath = (lang === 'de' && (pathname === '/mbizglobal' || pathname.startsWith('/mbizglobal/')))
      ? pathname.replace(/^\/mbizglobal/, '/aboutus')
      : pathname;
    const adjustedSub = (lang !== 'de' && (subPath === '/aboutus' || subPath.startsWith('/aboutus/')))
      ? subPath.replace(/^\/aboutus/, '/mbizglobal')
      : subPath;
    const newPath = adjustedSub === '/' ? `/${lang}` : `/${lang}${adjustedSub}`;
    const newUrl = new URL(newPath, request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'lang') newUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(newUrl, 302);
  }

  // ========== Bot Detection ==========
  const isDev = host.includes('localhost') || host.includes('ngrok');
  const skipBotDetection = isDev || pathname.startsWith('/api/auth') || pathname.startsWith('/api/app-api') || pathname.startsWith('/api/bots/');
  const botResult = skipBotDetection ? { shouldBlock: false, isAllowedBot: false } : checkBot(request);

  if (botResult.shouldBlock) {
    const ip = getClientIP(request);
    console.warn(`[Bot Blocked] IP: ${ip}, Reason: ${botResult.reason}, Path: ${pathname}`);

    if (pathname.startsWith('/api/')) {
      return new NextResponse(
        JSON.stringify({
          error: 'Access denied',
          message: 'Your request has been blocked due to suspicious activity.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head><title>Access Denied</title></head>
<body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5;">
  <div style="text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <h1 style="color: #dc3545;">Access Denied</h1>
    <p>Your request has been blocked due to suspicious activity.</p>
    <p style="color: #666; font-size: 14px;">If you believe this is an error, please try again later.</p>
  </div>
</body>
</html>`,
      {
        status: 403,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }

  // ========== Auth URL Setting ==========
  if (pathname.startsWith('/api/auth') ||
      pathname.startsWith('/auth') ||
      pathname.startsWith('/app')) {

    const host = request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') ||
                     (request.url.startsWith('https') ? 'https' : 'http');

    let dynamicUrl = `${protocol}://${host}`;

    if (host.includes('ngrok')) {
      dynamicUrl = `https://${host}`;
      process.env.NEXTAUTH_URL = dynamicUrl;
    } else if (host.includes('localhost')) {
      dynamicUrl = `http://${host}`;
      process.env.NEXTAUTH_URL = dynamicUrl;
    }
  }

  if (pathname.startsWith('/console') || pathname.startsWith('/api/console')) {
    if (pathname === '/api/console/logout') {
      return NextResponse.next();
    }

    const devBypass = process.env.NODE_ENV !== 'production' && process.env.CONSOLE_DEV_BYPASS === '1';
    if (!devBypass) {
      const isApi = pathname.startsWith('/api/console');
      const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);

      if (isApi && isMutating) {
        const origin = request.headers.get('origin');
        if (origin) {
          let originHost = '';
          try { originHost = new URL(origin).host; } catch { /* malformed */ }
          const expectedHost = request.headers.get('host') || request.nextUrl.host;
          if (originHost && originHost !== expectedHost) {
            return new NextResponse(
              JSON.stringify({ error: 'Cross-origin request blocked' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
      }

      const auth = await getConsoleAdminOrSession(request);

      if (!auth) {
        if (isApi) {
          return new NextResponse(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return NextResponse.redirect(new URL('/auth', request.url));
      }

      if (auth.via === 'session' && !isApi && request.method === 'GET') {
        const clientIP = getClientIP(request);
        if (!isConsoleIPAllowed(clientIP)) {
          return NextResponse.redirect(new URL('/access-denied', request.url));
        }
        const cookie = getConsoleAdminCookieOptions();
        const res = NextResponse.next();
        res.cookies.set(cookie.name, await issueConsoleAdminToken(auth.email), cookie);
        return res;
      }
    }

    const clientIP = getClientIP(request);
    if (!isConsoleIPAllowed(clientIP)) {
      if (pathname.startsWith('/api/console')) {
        return new NextResponse(
          JSON.stringify({ error: 'Access denied', ip: clientIP }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return NextResponse.redirect(new URL('/access-denied', request.url));
    }
  }

  // ========== Admin IP Restriction ==========
  if (pathname.startsWith('/admin')) {
    const clientIP = getClientIP(request);

    if (!isIPAllowed(clientIP)) {
      if (pathname.startsWith('/api/admin')) {
        return new NextResponse(
          JSON.stringify({
            error: 'Access denied',
            message: 'Your IP address is not authorized to access this resource',
            ip: clientIP
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return NextResponse.redirect(new URL('/access-denied', request.url));
    }
  }

  // Inject x-lang header for [lang] paths so root layout can SSR with correct language
  // de-ch must precede de in alternation to win the match.
  const langPathMatch = pathname.match(/^\/(de-ch|en|de|fr|es|ko)(\/|$)/);
  if (langPathMatch) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-lang', langPathMatch[1]);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (pathname.startsWith('/app') || pathname.startsWith('/auth')) {
    const cookieLang = request.cookies.get('preferred-language')?.value;
    if (cookieLang === 'ja') {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-lang', 'en');
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ]
};
