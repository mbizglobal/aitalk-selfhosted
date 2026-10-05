
// ========================================
// ========================================

export interface HttpPresetRequest {
  alias: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  description?: string
  enabled: boolean
  signed?: boolean
}

export interface HttpPreset {
  id: string
  name: string
  description: string
  baseUrl: string | Record<string, string>
  authType: 'none' | 'apiKey' | 'bearer' | 'basic' | 'hmac'
  authHeaderName?: string
  environments?: string[]
  defaultEnvironment?: string
  requests: HttpPresetRequest[]
}

// ========================================
// ========================================

export const HTTP_PRESETS: HttpPreset[] = [
  {
    id: 'trading212',
    name: 'Trading 212',
    description: 'Portfolio & trading data',
    baseUrl: {
      demo: 'https://demo.trading212.com/api/v0',
      live: 'https://live.trading212.com/api/v0',
    },
    authType: 'basic',
    environments: ['demo', 'live'],
    defaultEnvironment: 'demo',
    requests: [
      { alias: 'positions',    method: 'GET', path: '/equity/positions',                       description: 'Current holdings',      enabled: true },
      { alias: 'orders',       method: 'GET', path: '/equity/history/orders?limit=50',         description: 'Order history',         enabled: true },
      { alias: 'dividends',    method: 'GET', path: '/equity/history/dividends?limit=50',      description: 'Dividend history',      enabled: true },
      { alias: 'account',      method: 'GET', path: '/equity/account/summary',                 description: 'Account summary',       enabled: true },
      { alias: 'portfolio',    method: 'GET', path: '/equity/portfolio',                       description: 'Portfolio value',       enabled: true },
      { alias: 'transactions', method: 'GET', path: '/equity/history/transactions?limit=50',   description: 'Transaction history',   enabled: true },
    ],
  },
  {
    id: 'newsapi',
    name: 'NewsAPI',
    description: 'News headlines & articles',
    baseUrl: 'https://newsapi.org/v2',
    authType: 'apiKey',
    authHeaderName: 'X-Api-Key',
    requests: [
      { alias: 'headlines',  method: 'GET', path: '/top-headlines?country=us&pageSize=10',  description: 'Breaking news headlines',  enabled: true },
      { alias: 'everything', method: 'GET', path: '/everything?q=technology&pageSize=10',   description: 'Search all articles',      enabled: true },
      { alias: 'sources',    method: 'GET', path: '/top-headlines/sources',                 description: 'Available news sources',   enabled: true },
    ],
  },
  {
    id: 'binance-public',
    name: 'Binance (Public)',
    description: 'Market data — no auth required',
    baseUrl: 'https://api.binance.com',
    authType: 'none',
    requests: [
      { alias: 'prices',    method: 'GET', path: '/api/v3/ticker/price?symbol=BTCUSDT',                  description: 'Coin price',        enabled: true },
      { alias: 'ticker24h', method: 'GET', path: '/api/v3/ticker/24hr?symbol=BTCUSDT',                   description: '24h price change',  enabled: true },
      { alias: 'klines',    method: 'GET', path: '/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=7',   description: 'Candlestick chart', enabled: true },
      { alias: 'depth',     method: 'GET', path: '/api/v3/depth?symbol=BTCUSDT&limit=10',               description: 'Order book',        enabled: true },
    ],
  },
  {
    id: 'binance-private',
    name: 'Binance (Private)',
    description: 'Account & trading — HMAC SHA256 auth',
    baseUrl: {
      demo: 'https://testnet.binance.vision',
      live: 'https://api.binance.com',
    },
    authType: 'hmac',
    environments: ['demo', 'live'],
    defaultEnvironment: 'demo',
    requests: [
      { alias: 'account',    method: 'GET', path: '/api/v3/account',                    description: 'Account balance', enabled: true, signed: true },
      { alias: 'myTrades',   method: 'GET', path: '/api/v3/myTrades?symbol=BTCUSDT',    description: 'Trade history',   enabled: true, signed: true },
      { alias: 'openOrders', method: 'GET', path: '/api/v3/openOrders',                 description: 'Open orders',     enabled: true, signed: true },
      { alias: 'allOrders',  method: 'GET', path: '/api/v3/allOrders?symbol=BTCUSDT',   description: 'All orders',      enabled: true, signed: true },
    ],
  },
]

export function getPresetById(id: string): HttpPreset | undefined {
  return HTTP_PRESETS.find(p => p.id === id)
}

export function getPresetBaseUrl(preset: HttpPreset, environment?: string): string {
  if (typeof preset.baseUrl === 'string') {
    return preset.baseUrl
  }
  const env = environment || preset.defaultEnvironment || Object.keys(preset.baseUrl)[0]
  return preset.baseUrl[env] || ''
}
