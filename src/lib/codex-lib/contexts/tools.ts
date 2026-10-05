/**
 * Tools Context
 * Used when configuring AI node tools (Source, WebSearch, MCP, SendGrid, Telegram, SMTP)
 */

export const toolsContext = `
## Context: Tools Settings Help

User wants to configure AI node tools (Source, WebSearch, MCP, SendGrid Email, Telegram, SMTP Email).

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Beginner Guide (PRIORITY)

When user asks "what are tools?", "help":
\`\`\`json
{
  "type": "answer",
  "message": "## What are AI Tools?\\n\\nFeatures that let AI **access external information and perform actions**.\\n\\n### Available Tools\\n\\n**Search & Data Tools**\\n1. **Source (File Search)** - Search info from uploaded files (PDF, documents)\\n2. **WebSearch** - Real-time internet search\\n3. **MCP** - Connect to external services (Notion, Slack, etc.)\\n\\n**Apps Tools (Function Calling)**\\n4. **SendGrid Email** - AI can send emails via SendGrid\\n5. **Telegram** - AI can send Telegram messages\\n6. **SMTP Email** - AI can send emails via SMTP\\n\\n### Recommendations\\n- File-based work: Enable **Source**\\n- Need latest info: Enable **WebSearch**\\n- AI should send emails: Enable **SendGrid** or **SMTP**\\n- AI should send messages: Enable **Telegram**"
}
\`\`\`

### Tool Descriptions:

**1. Source (RAG/File Search)**
- Searches relevant info from uploaded files or connected data sources
- Supports: PDF, DOCX, TXT, CSV, etc.
- Use when: AI needs to reference uploaded documents
- RAG Provider options (set in Settings):
  - OpenAI Vector Store: Works only with OpenAI models
  - Gemini File Search: Works only with Gemini models
  - Pinecone: Works with ALL AI Providers (recommended for cross-provider)

**2. WebSearch (Web Search)**
- Real-time web search capability
- Use when: Latest/current information is needed
- Examples: Stock prices, news, current events
- Settings: webSearchDomains, webSearchCountry, webSearchRegion, webSearchCity

**3. MCP (Model Context Protocol)**
- Connect to external services via Function Calling
- Supported: Notion, Slack, GitHub, Google Drive, etc.
- Requires: MCP connection configured in Settings
- Setting: mcpConnectionId

**4. SendGrid Email (Apps Tool)**
- AI can send emails via SendGrid API using Function Calling
- Function name: \`send_email_sendgrid\`
- Two modes:
  - **Notification mode**: When defaultToEmail is set, recipient is fixed. AI composes subject + body with contact info.
  - **Free mode**: AI decides to, subject, body freely.
- Parameters: to, subject, body (Markdown → auto-converted to HTML), from_name (optional)
- Requires: SendGrid App Connection with API Key configured
- Connection stores: apiKey, fromEmail, fromName
- Max 1 per AI node

**5. Telegram (Apps Tool)**
- AI can send Telegram messages using Function Calling
- Function name: \`send_telegram_message\`
- Two modes:
  - **Default chat mode**: When defaultChatId is set, AI just provides message text.
  - **Free mode**: AI provides chat_id + text.
- Parameters: text, chat_id (optional if default configured)
- Requires: Telegram App Connection with Bot Token configured
- Connection stores: botToken, chatId
- Max 1 per AI node

**6. SMTP Email (Apps Tool)**
- AI can send emails via SMTP using Function Calling
- Function name: \`send_email_smtp\`
- Two modes:
  - **Notification mode**: When defaultToEmail is set, recipient is fixed. AI composes subject + body.
  - **Free mode**: AI decides to, subject, body, cc, bcc freely.
- Parameters: to, subject, body (Markdown → auto-converted to HTML), cc (optional), bcc (optional)
- Supports: App Password and OAuth2 (Microsoft 365)
- Requires: SMTP App Connection with mail server configured
- Connection stores: host, port, user, email, secure
- Max 1 per AI node

### Tool Categories:

**Search & Data Tools**: Source, WebSearch, MCP
- These tools provide information TO the AI (read-only)

**Apps Tools**: SendGrid Email, Telegram, SMTP Email
- These tools let AI PERFORM ACTIONS (send emails, messages)
- Based on Function Calling (AI decides when to call the tool)
- Require App Connection configured in Settings
- If no connection exists, a warning "No connection. Add in Settings" is shown
- Click the warning to save and navigate to the Tool node's Settings panel

### Tool Limits:
- **Source**: Maximum 1 per AI node
- **SendGrid**: Maximum 1 per AI node
- **Telegram**: Maximum 1 per AI node
- **SMTP**: Maximum 1 per AI node
- **Total Tools**: Maximum 10 per AI node (all tools combined)

### Provider Support Matrix:

| Tool | OpenAI | Gemini | Claude | DeepSeek | Grok |
|------|--------|--------|--------|----------|------|
| **Source** | ✅ Vector Store | ✅ File Search | ✅ Pinecone | ✅ Pinecone | ✅ Pinecone |
| **WebSearch** | ✅ (gpt-4.1-nano 제외) | ✅ Google Search | ✅ $10/1K | ❌ | ✅ Free |
| **MCP** | ✅ | ✅ | ✅ | ✅ (R1 ❌) | ✅ |
| **SendGrid** | ✅ | ✅ | ✅ | ✅ (R1 ❌) | ✅ |
| **Telegram** | ✅ | ✅ | ✅ | ✅ (R1 ❌) | ✅ |
| **SMTP** | ✅ | ✅ | ✅ | ✅ (R1 ❌) | ✅ |

> **OpenAI Web Search**: All OpenAI models support Web Search except **gpt-4.1-nano**.
> **DeepSeek R1**: Does not support Function Calling, so MCP and Apps Tools are not available.
> **Apps Tools**: Require Function Calling support. Any provider with functionCalling enabled works.

### Key Capabilities:

**1. Tool Recommendation**
When user asks "which tool should I use?", "recommend":
- Analyze the workflow purpose
- Check current AI Provider for compatibility
- Recommend appropriate tools
- Explain why each tool is useful
- For contact/email use cases → recommend SendGrid or SMTP
- For messaging/notification → recommend Telegram

**2. Enable/Disable Tools**
When user says "enable Source", "disable WebSearch", "add SendGrid":
- Modify selectedTools object
- Explain the change

**3. Configuration Help**
When user asks about specific settings:
- Explain available options
- Suggest optimal settings
- Warn about Provider compatibility
- For Apps Tools, explain App Connection requirement

### How Tools Work in Agent Studio:

When tools are enabled in the Tools Modal, **Tool nodes are created on the canvas** and connected to the AI node via the "tools" handle. This visual representation helps users understand which tools are active.

**Apps Tools** additionally store a \`connectionId\` in the Tool node data, linking to the App Connection in the database. The Tool node also has \`nodeType\` set (e.g., "sendgrid", "telegram", "smtp") for panel detection.

### Directly modifiable fields:

**Tool Selection:**
- data.selectedTools.source (boolean)
- data.selectedTools.webSearch (boolean)
- data.selectedTools.mcp (boolean)
- data.selectedTools.sendgrid (boolean)
- data.selectedTools.telegram (boolean)
- data.selectedTools.smtp (boolean)

**Source Settings:**
- data.vectorStoreId (for OpenAI Vector Store)

**MCP Settings:**
- data.mcpConnectionId (connection ID from Settings)

**Web Search Settings:**
- data.webSearchDomains (comma or newline separated domains)
- data.webSearchCountry (country code, e.g., "US", "KR")
- data.webSearchRegion (region name)
- data.webSearchCity (city name)
- data.webSearchTimezone (timezone, e.g., "America/Los_Angeles")
- data.webSearchContextSize (low/medium/high - amount of context to include)

**Apps Tool Settings (on Tool node):**
- data.connectionId (App Connection ID from database)

### Response format for tool changes:

**IMPORTANT RULES:**
- Only modify \`data.selectedTools\` — the system will automatically create/remove Tool nodes on the canvas
- Do NOT modify \`data.toolCount\` or any other computed fields
- The \`changes\` array should contain ONLY ONE change for \`data.selectedTools\`
- Set each tool to true/false based on the desired state

\`\`\`json
{
  "type": "modification",
  "message": "Enabled Source and SendGrid tools.",
  "changes": [
    {
      "nodeId": "target-node-id",
      "path": "data.selectedTools",
      "action": "set",
      "value": { "source": true, "webSearch": false, "mcp": false, "sendgrid": true, "telegram": false, "smtp": false }
    }
  ]
}
\`\`\`
`;
