/**
 * Web Search Context
 * Used when configuring web search tool
 */

export const webSearchContext = `
## Context: Web Search Settings Help

User wants to configure web search tool.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Beginner Guide
When user asks "what is web search?", "help":
- Allows AI to search the internet in real-time
- Use for current events, latest information
- Results are used to answer questions

---

## NODE CONNECTION (Tool Node)

WebSearch is a **Tool node** that connects to AI node's **tools handle** (bottom).

### Connection Structure
\`\`\`
              [AI Node]
                  │
            tools handle (bottom, orange)
                  │
                  ↓
          [WebSearch Node]
\`\`\`

### How to Connect on Canvas
1. Add **AI node** to canvas
2. Add **WebSearch node** to canvas
3. Drag from AI node's **bottom handle** (orange) to WebSearch node's **top handle**
4. WebSearch automatically appears in AI's "Select tools" dropdown

### Tool Handle Types
| Node | Top Handle | Bottom Handle | Purpose |
|------|------------|---------------|---------|
| AI Node | Input (from previous) | Tools output (orange) | Connect Tool nodes |
| WebSearch Node | Tools input (orange) | None | Receive from AI |

### Multiple Tools
AI node can connect to multiple Tool nodes:
\`\`\`
              [AI Node]
                  │
            tools handle
           ┌────┼────┐
           ↓    ↓    ↓
      [Source] [WebSearch] [MCP]
\`\`\`

### In While Loop
When AI is a Loop Tool inside While:
- WebSearch node connects via AI's tools handle
- Tool settings (domains, timezone) are copied to AI node
- ⚠️ **Cost warning**: Each iteration may trigger web searches
- Claude: $10 per 1,000 searches (use maxUses to limit)

---

### Provider Support:

| Provider | Web Search Support | Notes |
|----------|-------------------|-------|
| **OpenAI** | ✅ gpt-5, gpt-5-mini, gpt-4o, gpt-4o-mini | gpt-4.1 does NOT support |
| **Gemini** | ✅ All models | Google Search grounding |
| **Claude** | ✅ All models | ⚠️ $10 per 1,000 searches (maxUses: 5 default) |
| **DeepSeek** | ❌ Not supported | No web search capability |
| **Grok** | ✅ All models | Token cost only (included in pricing) |

> **Note**: If using OpenAI gpt-4.1 models or DeepSeek, Web Search is not available.

### Output Token Requirements:

| Model | Max Output Tokens | Web Search Recommendation |
|-------|------------------|---------------------------|
| **GPT-4o** | 4,096 | ⚠️ May be insufficient |
| **GPT-5** | 65,536 | ✅ Recommended 8,192+ |

> **Warning**: Web Search results can be verbose. GPT-4o's 4,096 token limit may cause truncated responses. Use GPT-5 models or increase Max Tokens in AI node settings (minimum 8,192 recommended).

### Implementation Details:

**OpenAI**: Uses \`web_search_preview\` tool
- Domain filtering: max **20 domains**
- User location: type 'approximate' with country/region/city/timezone

**Gemini**: Uses Google Search grounding
- Simple \`{ googleSearch: {} }\` tool
- No domain filtering support

**Claude**: Uses \`web_search_20250305\` tool
- **maxUses**: Max searches per request (default: 5)
- **allowedDomains**: Domain filtering array (whitelist)
- **blockedDomains**: Domain blocking array (blacklist, alternative to allowedDomains)
- **userLocation**: Location object
- **Result**: Returns \`metadata.webSearchResults\` array with \`{url, title, pageAge}\`
- **Usage**: \`usage.webSearchRequests\` tracks search count

### Configuration Options:

- **webSearchDomains**: Comma or newline-separated list of allowed domains
  - Example: "example.com, docs.example.com"
  - Leave empty to search all domains
  - **OpenAI limit**: max 20 domains

- **webSearchCountry**: Country code for localized results
  - Example: "US", "KR", "CH"

- **webSearchRegion**: Region for more specific results
  - Example: "California", "Zurich"

- **webSearchCity**: City for local results
  - Example: "San Francisco", "Seoul"

- **webSearchTimezone**: Timezone for time-sensitive searches
  - Example: "America/Los_Angeles", "Europe/Zurich"

- **webSearchContextSize**: Amount of context to include (OpenAI)
  - Options: "low", "medium" (default), "high"

### Debug Output (web_search_call):
\`\`\`json
{
  "type": "web_search",
  "name": "Web Search",
  "input": { "query": "search query" },
  "output": {
    "resultCount": 5,
    "results": [
      { "title": "...", "url": "...", "snippet": "..." }
    ]
  }
}
\`\`\`

### Key Capabilities:
1. **Enable/Disable**: Turn web search on or off
2. **Explain Usage**: When to use web search
3. **Configure Options**: Domain filtering, location settings
4. **Check Compatibility**: Verify AI provider supports web search

### When to Use:
- Current events, news
- Latest prices, stock info
- Real-time data that changes frequently
- Information after AI's training cutoff

### When NOT to Use:
- Internal company data (use Source/RAG instead)
- Fixed/static information
- When speed is critical (adds latency)
- With DeepSeek (not supported)
- With OpenAI gpt-4.1 models (not supported)

### Modifiable Fields (on WebSearch Node):
| Field | Type | Description |
|-------|------|-------------|
| data.webSearchDomains | string | Comma or newline-separated domain list |
| data.webSearchCountry | string | Country code (e.g., "US", "KR") |
| data.webSearchRegion | string | Region name |
| data.webSearchCity | string | City name |
| data.webSearchTimezone | string | IANA timezone (e.g., "America/Los_Angeles") |
| data.webSearchContextSize | string | "low", "medium", "high" (OpenAI only) |

### Modification Examples:

**Set domain filter** (limit search to specific sites):
\`\`\`json
{
  "type": "modification",
  "message": "Web Search 도메인을 설정했습니다.",
  "changes": [
    { "nodeId": "WEBSEARCH_NODE_ID", "path": "data.webSearchDomains", "action": "set", "value": "docs.example.com\\nexample.com" }
  ]
}
\`\`\`

**Set location for localized results**:
\`\`\`json
{
  "type": "modification",
  "message": "검색 위치를 한국으로 설정했습니다.",
  "changes": [
    { "nodeId": "WEBSEARCH_NODE_ID", "path": "data.webSearchCountry", "action": "set", "value": "KR" },
    { "nodeId": "WEBSEARCH_NODE_ID", "path": "data.webSearchTimezone", "action": "set", "value": "Asia/Seoul" }
  ]
}
\`\`\`

**Clear domain filter** (search all sites):
\`\`\`json
{
  "type": "modification",
  "message": "도메인 필터를 제거했습니다.",
  "changes": [
    { "nodeId": "WEBSEARCH_NODE_ID", "path": "data.webSearchDomains", "action": "set", "value": "" }
  ]
}
\`\`\`

> ⚠️ **IMPORTANT**:
> - Use the **nodeId passed to you** (the WebSearch node ID)
> - Domain list uses newline or comma as separator
> - OpenAI has max 20 domains limit
`;
