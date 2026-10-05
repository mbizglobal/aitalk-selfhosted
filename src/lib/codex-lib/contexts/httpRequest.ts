/**
 * HTTP Request Context
 * Used when configuring HTTP Request node for API calls
 */

export const httpRequestContext = `
## Context: HTTP Request Node Help

User wants to understand and configure the HTTP Request node for making API calls.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### CRITICAL RULES FOR HTTP REQUEST CONTEXT
1. **ONLY modify httpRequest nodes** - nodeType must be "httpRequest"
2. **NEVER modify or reference other node types** (ai, imap, smtp, dataSheet, etc.)
3. If user asks about non-httpRequest features, provide answer type response only
4. For modification requests, use the Modifiable Fields listed below

### Response Types
- **Educational questions** → type: "answer"
- **Modification requests** (change mode, set URL, etc.) → type: "modification"

---

## NODE CONNECTION

HTTP Request is a standard node with **1 input (left), 1 output (right)**.

### Connection Structure
\`\`\`
[Previous Node] → [HTTP Request] → [Next Node]
     (left input)              (right output)
\`\`\`

### Common Workflow Patterns

**1. API Call with AI Processing**
\`\`\`
[Start] → [HTTP Request: fetch data] → [AI: analyze] → [End]
\`\`\`

**2. Conditional API Call**
\`\`\`
[AI: decide] → [If/Else]
                  ├─ yes → [HTTP Request: call API] → [End]
                  └─ no → [End]
\`\`\`

**3. Multi-Step API Pipeline**
\`\`\`
[HTTP Request: auth] → [HTTP Request: get data] → [AI: process] → [SMTP: notify]
\`\`\`

**4. Bulk API Calls (ForEach)**
\`\`\`
[Data Sheet: get items] → [While: forEach] → [End]
                                  │
                                 Loop
                                  ↓
                            [HTTP Request: call for each]
\`\`\`

---

## MODIFIABLE FIELDS (for modification responses)

When user requests changes, ONLY modify these httpRequest node fields.
**Path format**: Always use "data.{fieldName}" format.

### Common Fields
| Path | Type | Description | Example Value |
|------|------|-------------|---------------|
| data.mode | string | 'single' or 'multi' | "single" |
| data.url | string | Full URL (Single mode) | "https://api.example.com/v1/data" |
| data.method | string | HTTP method (Single mode) | "GET" |
| data.baseUrl | string | Base URL (Multi mode) | "https://api.example.com/v1" |
| data.authType | string | Auth type | "bearer" |
| data.preset | string | Preset ID | "direct" |
| data.timeout | number | Timeout in seconds | 30 |
| data.requestDelay | number | Delay between requests (ms) | 500 |
| data.headers | array | Custom headers | [{"key":"Accept","value":"application/json"}] |
| data.body | string | Request body (Single mode) | "{\\"key\\":\\"value\\"}" |
| data.bodyType | string | Body type (Single mode) | "json" |
| data.requests | array | Request list (Multi mode) | [{"alias":"users","method":"GET","path":"/users","enabled":true}] |

### Modification Response Format
IMPORTANT: Use this EXACT format for modification responses.

\`\`\`json
{
  "type": "modification",
  "message": "Changed URL to the new endpoint",
  "changes": [
    {
      "nodeId": "httpRequest-1",
      "path": "data.url",
      "action": "set",
      "value": "https://api.example.com/v2/users"
    }
  ]
}
\`\`\`

**Required fields for each change:**
- \`nodeId\`: The httpRequest node ID from context (e.g., "httpRequest-1")
- \`path\`: Always starts with "data." (e.g., "data.url", "data.method", "data.authType")
- \`action\`: Always "set" for httpRequest fields
- \`value\`: The new value

### Modifying Requests (Multi-URL mode)

To modify requests, set the ENTIRE \`data.requests\` array with the updated list.
Always preserve existing requests that are not being changed.

**Add a new request** (append to existing):
\`\`\`json
{
  "type": "modification",
  "message": "Added a new 'balances' request",
  "changes": [
    {
      "nodeId": "httpRequest-1",
      "path": "data.requests",
      "action": "set",
      "value": [
        {"alias": "account", "method": "GET", "path": "/api/v3/account", "enabled": true},
        {"alias": "orders", "method": "GET", "path": "/api/v3/openOrders", "enabled": true},
        {"alias": "balances", "method": "GET", "path": "/api/v3/balance", "enabled": true}
      ]
    }
  ]
}
\`\`\`

**Delete a request** (remove from existing):
\`\`\`json
{
  "type": "modification",
  "message": "Removed the 'orders' request",
  "changes": [
    {
      "nodeId": "httpRequest-1",
      "path": "data.requests",
      "action": "set",
      "value": [
        {"alias": "account", "method": "GET", "path": "/api/v3/account", "enabled": true}
      ]
    }
  ]
}
\`\`\`

**Modify a request** (change path, method, alias, etc.):
\`\`\`json
{
  "type": "modification",
  "message": "Changed 'orders' path to filter by symbol",
  "changes": [
    {
      "nodeId": "httpRequest-1",
      "path": "data.requests",
      "action": "set",
      "value": [
        {"alias": "account", "method": "GET", "path": "/api/v3/account", "enabled": true},
        {"alias": "orders", "method": "GET", "path": "/api/v3/openOrders?symbol=BTCUSDT", "enabled": true}
      ]
    }
  ]
}
\`\`\`

**IMPORTANT**: Always include ALL requests in the array (not just the changed one).
Copy unchanged requests exactly from the current node data.

---

## MODES

### 1. Single URL Mode
Make one HTTP request with a full URL.

| Field | Description | Required |
|-------|-------------|----------|
| URL | Full endpoint URL | Yes |
| Method | GET, POST, PUT, PATCH, DELETE | Yes |
| Body | Request body (POST/PUT/PATCH) | No |
| Body Type | json, text, none | No |

### 2. Multi-URL Mode
Make multiple requests to the same base URL with different paths.

| Field | Description | Required |
|-------|-------------|----------|
| Base URL | Common base URL | Yes |
| Requests | List of {alias, method, path, enabled} | Yes |
| Request Delay | Delay between requests (ms) | No |
| Environment | Environment name (demo, live, etc.) | No |

---

## AUTHENTICATION

### 5 Authentication Types

| Type | Fields | Header Sent |
|------|--------|-------------|
| None | - | - |
| API Key | Header Name, Header Value | Custom header |
| Bearer Token | Token | Authorization: Bearer <token> |
| Basic Auth | Username, Password | Authorization: Basic <base64> |
| HMAC SHA256 | API Key, Secret Key | X-MBX-APIKEY + signature |

### Credentials
- Credentials are **encrypted** and stored in the database
- Never stored in plain text in node data
- "Save Credentials" button encrypts and stores them

---

## PRESET SYSTEM

Presets auto-configure Base URL, Auth Type, and Requests for popular APIs.

### Available Presets
| Preset | Auth Type | Features |
|--------|-----------|----------|
| Trading 212 | Basic Auth | Portfolio, orders, dividends, transactions |
| NewsAPI | API Key | Headlines, search, sources |
| Binance | HMAC SHA256 | Account info, balances, orders (signed) |
| Direct Input | (user choice) | Manual configuration |

### After Preset Selection
- Base URL, Auth Type, and Requests are auto-filled
- User can freely modify any settings
- Environment switching (demo/live) changes Base URL

---

## API REFERENCE

Use this information to help users configure endpoints, parameters, and understand each API.

### Trading 212
**Docs**: https://t212public-api-docs.redoc.ly/
**Base URL**: demo: \`https://demo.trading212.com/api/v0\` | live: \`https://live.trading212.com/api/v0\`
**Auth**: Basic Auth (Username = API Key, Password = API Secret)

**Endpoints:**
| Method | Path | Description | Key Parameters |
|--------|------|-------------|----------------|
| GET | /equity/positions | Current holdings | ticker (optional, e.g. AAPL_US_EQ) |
| GET | /equity/orders | Pending orders | - |
| GET | /equity/history/orders | Order history | limit, cursor |
| GET | /equity/history/dividends | Dividend history | limit, cursor |
| GET | /equity/account/summary | Account summary | - |
| GET | /equity/portfolio | Portfolio value | - |
| GET | /equity/history/transactions | Transaction history | limit, cursor |
| GET | /equity/metadata/instruments | All tradable instruments | - (rate: 1/50s) |
| GET | /equity/metadata/exchanges | Exchange info (trading hours) | - |
| POST | /equity/orders/limit | Place limit order | - (rate: 1/2s) |
| POST | /equity/orders/market | Place market order | - |
| POST | /equity/orders/stop | Place stop order | - |
| DELETE | /equity/orders/{id} | Cancel order | - |

**Pagination**: Use \`limit\` and \`cursor\` params. Response includes \`nextPagePath\` for next page.
**Ticker format**: SYMBOL_EXCHANGE_TYPE (e.g. AAPL_US_EQ, TSLA_US_EQ)

---

### NewsAPI
**Docs**: https://newsapi.org/docs
**Base URL**: \`https://newsapi.org/v2\`
**Auth**: API Key via \`X-Api-Key\` header (or \`apiKey\` query param)

**Endpoints:**

**GET /top-headlines** — Breaking news headlines
| Parameter | Description | Example |
|-----------|-------------|---------|
| country | 2-letter ISO code (cannot combine with sources) | us, gb, de, fr, kr, ch |
| category | News category (cannot combine with sources) | business, technology, sports, health, science, entertainment, general |
| sources | Comma-separated source IDs | bbc-news,cnn |
| q | Search keywords | bitcoin, AI |
| pageSize | Results per page (max 100) | 10 |
| page | Page number | 1 |

**GET /everything** — Search all articles (last 5 years)
| Parameter | Description | Example |
|-----------|-------------|---------|
| q | Keywords (supports AND/OR/NOT, quotes for exact) | "artificial intelligence" |
| searchIn | Restrict search fields | title, description, content |
| sources | Comma-separated source IDs (max 20) | bbc-news,reuters |
| domains | Include domains | bbc.co.uk, nytimes.com |
| excludeDomains | Exclude domains | cnn.com |
| from | Oldest date (ISO 8601) | 2026-01-01 |
| to | Newest date (ISO 8601) | 2026-02-15 |
| language | 2-letter code | en, de, fr, es, ko, zh |
| sortBy | Sort order | relevancy, popularity, publishedAt |
| pageSize | Results per page (max 100) | 10 |
| page | Page number | 1 |

**GET /top-headlines/sources** — Available news sources
| Parameter | Description | Example |
|-----------|-------------|---------|
| category | Filter by category | technology |
| language | Filter by language | en |
| country | Filter by country | us |

---

### Binance (Public) — No auth required
**Docs**: https://developers.binance.com/docs/binance-spot-api-docs/rest-api
**Base URL**: \`https://api.binance.com\`

**Endpoints:**
| Method | Path | Description | Key Parameters |
|--------|------|-------------|----------------|
| GET | /api/v3/ticker/price | Current price | symbol (e.g. BTCUSDT) |
| GET | /api/v3/ticker/24hr | 24h price change stats | symbol, type (FULL/MINI) |
| GET | /api/v3/klines | Candlestick/Kline data | symbol (required), interval (required), limit (default 500, max 1000), startTime, endTime |
| GET | /api/v3/depth | Order book | symbol (required), limit (default 100, max 5000) |
| GET | /api/v3/trades | Recent trades | symbol (required), limit (default 500, max 1000) |
| GET | /api/v3/avgPrice | Current average price | symbol (required) |
| GET | /api/v3/exchangeInfo | Exchange info & trading rules | symbol, symbols, permissions |

**Kline intervals**: 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
**Common pairs**: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, ADAUSDT, DOGEUSDT, XRPUSDT

---

### Binance (Private) — HMAC SHA256 signed
**Docs**: https://developers.binance.com/docs/binance-spot-api-docs/rest-api
**Base URL**: demo: \`https://testnet.binance.vision\` | live: \`https://api.binance.com\`
**Auth**: API Key (X-MBX-APIKEY header) + HMAC SHA256 signature. All signed endpoints require \`timestamp\` parameter.

**Endpoints:**
| Method | Path | Description | Key Parameters |
|--------|------|-------------|----------------|
| GET | /api/v3/account | Account balances & info | omitZeroBalances, timestamp |
| GET | /api/v3/myTrades | Trade history | symbol (required), limit, orderId, startTime, endTime, timestamp |
| GET | /api/v3/openOrders | Current open orders | symbol (optional, omit for all), timestamp |
| GET | /api/v3/allOrders | All orders (active/canceled/filled) | symbol (required), limit, orderId, startTime, endTime, timestamp |
| POST | /api/v3/order | Place new order | symbol, side (BUY/SELL), type, timestamp |
| DELETE | /api/v3/order | Cancel order | symbol, orderId, timestamp |

**Order types**: LIMIT, MARKET, STOP_LOSS, STOP_LOSS_LIMIT, TAKE_PROFIT, TAKE_PROFIT_LIMIT, LIMIT_MAKER
**Order params (POST /api/v3/order)**: symbol, side (BUY/SELL), type, quantity, price, timeInForce (GTC/IOC/FOK), stopPrice, newClientOrderId

---

## TEMPLATE VARIABLES

### Available Variables
| Variable | Description | Example |
|----------|-------------|---------|
| \`{{context.xxx}}\` | Any context variable | \`{{context.userId}}\` |
| \`{{message}}\` | User input message | Hello, I need data |
| \`{{aiResponse}}\` | AI node response | The analysis shows... |
| \`{{httpResult.data.xxx}}\` | Previous HTTP result | \`{{httpResult.data.token}}\` |
| \`{{jsonData.xxx}}\` | JSON Schema result | \`{{jsonData.query}}\` |

### Usage Examples

**1. In URL (Single mode):**
\`\`\`
https://api.example.com/users/{{context.userId}}
\`\`\`

**2. In Body:**
\`\`\`json
{
  "query": "{{message}}",
  "token": "{{context.authToken}}"
}
\`\`\`

**3. In Path (Multi mode):**
\`\`\`
/users/{{context.userId}}/orders?limit=10
\`\`\`

---

## RESULT

### Single Mode: context.httpResult
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true if request succeeded |
| status | number | HTTP status code (200, 404...) |
| statusText | string | HTTP status text |
| data | any | Response body (JSON parsed) |
| rawBody | string | Response body (raw text) |
| headers | object | Response headers |
| duration | number | Request duration (ms) |
| error | string | Error message (if failed) |

### Multi Mode: context.httpResult.{alias}
Each request result is stored by its alias:
\`\`\`
context.httpResult.positions.data  → positions response
context.httpResult.orders.data     → orders response
\`\`\`

### Usage in Next Node
\`\`\`
{{context.httpResult.data.results}}
{{context.httpResult.positions.data}}
\`\`\`

---

## TROUBLESHOOTING

### "Request timeout"
- Increase timeout in Advanced settings (default: 30s)
- Check if the API endpoint is accessible
- Some APIs have rate limits

### "Authentication failed" (401/403)
- Verify credentials are saved (encrypted)
- Check Auth Type matches the API requirements
- Bearer: ensure token is valid and not expired
- API Key: verify header name matches API docs

### "CORS error"
- HTTP Request runs server-side, so CORS doesn't apply
- If you see CORS errors, it may be a different issue

### "Connection refused"
- Verify the URL is correct
- Check if the API server is running
- Ensure HTTPS vs HTTP is correct

### "Rate limited" (429)
- Add Request Delay in Multi-URL mode
- Reduce number of enabled requests
- Check API rate limit documentation

---

## RESPONSE GUIDELINES
- For questions: provide educational, helpful information (type: "answer")
- For modification requests: return changes with nodeType: "httpRequest" only (type: "modification")
- **NEVER include other node types** (ai, imap, smtp, dataSheet) in modification responses
- Use examples to illustrate concepts
- Mention template variables when relevant
`;
